// The game simulation. Runs in the browser for single player and on the
// Node server for multiplayer, so both modes share exactly the same rules.
import {
  TILE, WEAPONS, WEAPON_ORDER, ENEMIES, ENEMY_ORDER, CREATURES, BULLET_KINDS,
  derive, sanitizeLoadout, questFor,
} from './data.js';
import { makeCity, makeArena, solidAt, shotBlockedAt } from './maps.js';
import { mulberry32 } from './rng.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function boxHits(map, x, y, r) {
  r -= 0.01;
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(map, tx, ty)) return true;
  return false;
}
// Moves an entity one axis at a time so it slides along walls.
// Returns how many axes were blocked (0, 1 or 2).
export function moveBox(map, e, dx, dy, r) {
  let blocked = 0;
  if (dx) { if (boxHits(map, e.x + dx, e.y, r)) blocked++; else e.x += dx; }
  if (dy) { if (boxHits(map, e.x, e.y + dy, r)) blocked++; else e.y += dy; }
  return blocked;
}

export const PVP_GOAL = 10;
export const COOP_QUEST_WAVE = 10;

export class World {
  constructor({ mode, seed = 1 }) {
    this.mode = mode; // 'city' | 'coop' | 'pvp'
    this.seed = seed;
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.map = mode === 'city' ? makeCity(seed) : makeArena(seed);
    this.players = [];
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.cars = [];
    this.npcs = this.map.npcs;
    this.events = [];
    this.nextId = 1;
    this.time = 0;
    this.flow = new Int16Array(this.map.w * this.map.h);
    this.flowQ = new Int32Array(this.map.w * this.map.h);
    this.flowT = 0;
    // city
    this.quest = null;
    this.questNum = 0;
    this.ambT = 2;
    // coop
    this.wave = 0;
    this.waveTimer = 4;
    this.toSpawn = [];
    this.spawnT = 0;
    this.cleared = true;
    this.wiped = false;
    this.wipeT = 0;
    // pvp
    this.round = { over: false, timer: 0, winner: 0, goal: PVP_GOAL };
    this.pickT = 4;
    for (const c of this.map.cars) this.cars.push({ id: this.nextId++, x: c.x, y: c.y, ang: c.ang, speed: 0, driver: 0, color: c.color });
  }

  byId(id) { return this.players.find((p) => p.id === id) || null; }

  // ---------- players ----------
  addPlayer(loadout) {
    const p = {
      id: this.nextId++, x: 0, y: 0, r: 9, ang: 0, hp: 1, maxHp: 1, dead: false, respawn: 0, car: 0,
      wpn: 'pistol', ammo: {}, cd: 0, hurtT: -99, slowT: 0, kills: 0, deaths: 0, moving: false,
      input: { mx: 0, my: 0, ang: 0, fire: false, wpn: null, act: 0 }, lastAct: 0,
      pet: { x: 0, y: 0, cd: 1 },
    };
    this.setLoadout(p, loadout, true);
    this.spawnPlayer(p);
    this.players.push(p);
    return p;
  }

  setLoadout(p, loadout, fresh = false) {
    const l = sanitizeLoadout(loadout);
    const d = derive(l, this.mode);
    const ratio = fresh ? 1 : p.hp / p.maxHp;
    p.name = l.name; p.look = l.look; p.petType = l.companion; p.level = l.level;
    p.maxHp = d.maxHp; p.dmgMul = d.dmgMul; p.speed = d.speed; p.weapons = d.weapons;
    p.petMul = d.petMul; p.evolved = d.evolved;
    if (fresh) p.hp = p.maxHp;
    else if (!p.dead) p.hp = clamp(Math.round(p.maxHp * ratio), 1, p.maxHp);
    for (const w of p.weapons) if (p.ammo[w] === undefined) p.ammo[w] = this.startAmmo(w);
    if (!p.weapons.includes(p.wpn)) p.wpn = 'pistol';
  }

  startAmmo(w) { return this.mode === 'pvp' ? WEAPONS[w].pvpStart : WEAPONS[w].start; }

  spawnPlayer(p) {
    let spot;
    if (this.mode === 'city') spot = this.map.spawn;
    else if (this.mode === 'pvp') spot = this.findSpot({ avoid: 220 }) || this.findSpot({}) || this.map.spawn;
    else spot = this.findSpot({ around: this.map.spawn, min: 0, max: 80 }) || this.map.spawn;
    this.releaseCar(p);
    p.x = spot.x; p.y = spot.y; p.dead = false; p.hp = p.maxHp; p.slowT = 0; p.cd = 0;
    p.pet.x = p.x; p.pet.y = p.y;
    if (this.mode === 'pvp') { for (const w of p.weapons) p.ammo[w] = this.startAmmo(w); p.wpn = 'pistol'; }
  }

  removePlayer(id) {
    const p = this.byId(id);
    if (!p) return;
    this.releaseCar(p);
    this.players = this.players.filter((q) => q.id !== id);
  }

  releaseCar(p) {
    if (!p.car) return;
    const c = this.cars.find((k) => k.id === p.car);
    if (c) c.driver = 0;
    p.car = 0;
  }

  // Finds the centre of a walkable tile. Options: around/min/max (ring around a
  // point) and avoid (minimum distance from every living player).
  findSpot({ around = null, min = 0, max = 0, avoid = 0 }) {
    const m = this.map;
    for (let i = 0; i < 80; i++) {
      let x, y;
      if (around) {
        const a = this.rng() * TAU, d = min + this.rng() * (max - min);
        x = around.x + Math.cos(a) * d; y = around.y + Math.sin(a) * d;
      } else {
        x = this.rng() * m.w * TILE; y = this.rng() * m.h * TILE;
      }
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (solidAt(m, tx, ty)) continue;
      const s = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (avoid && this.players.some((p) => !p.dead && dist(p, s) < avoid)) continue;
      return s;
    }
    return null;
  }

  // ---------- main step ----------
  step(dt) {
    this.time += dt;
    this.updateFlow(dt);
    for (const p of this.players) this.updatePlayer(p, dt);
    for (const c of this.cars) this.updateCar(c, dt);
    for (const e of this.enemies) if (!e.dead) this.updateEnemy(e, dt);
    this.separate();
    this.updateBullets(dt);
    this.updatePickups(dt);
    if (this.mode === 'city') this.stepCity(dt);
    else if (this.mode === 'coop') this.stepCoop(dt);
    else this.stepPvp(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.pickups = this.pickups.filter((k) => !k.dead);
  }

  updatePlayer(p, dt) {
    const inp = p.input;
    if (p.dead) {
      p.lastAct = inp.act;
      p.moving = false;
      if (this.mode !== 'coop') {
        p.respawn -= dt;
        if (p.respawn <= 0 && !this.round.over) this.spawnPlayer(p);
      }
      return;
    }
    p.cd = Math.max(0, p.cd - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    if (this.time - p.hurtT > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 4 * dt);
    if (inp.act !== p.lastAct) { p.lastAct = inp.act; this.doAction(p); }
    if (inp.wpn && inp.wpn !== p.wpn && p.weapons.includes(inp.wpn) && p.ammo[inp.wpn] > 0) p.wpn = inp.wpn;
    if (Number.isFinite(inp.ang)) p.ang = inp.ang;
    if (p.car) {
      p.moving = false;
    } else {
      let mx = inp.mx, my = inp.my;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      p.moving = m > 0.1;
      const sp = p.speed * (p.slowT > 0 ? 0.6 : 1);
      if (p.moving) moveBox(this.map, p, mx * sp * dt, my * sp * dt, p.r);
      if (inp.fire && p.cd <= 0) this.fire(p);
    }
    this.updatePet(p, dt);
  }

  fire(p) {
    if (!(p.ammo[p.wpn] > 0)) { p.wpn = 'pistol'; }
    const w = WEAPONS[p.wpn];
    p.cd = w.rate;
    if (w.max !== Infinity) p.ammo[p.wpn]--;
    let sx = p.x + Math.cos(p.ang) * 14, sy = p.y + Math.sin(p.ang) * 14;
    if (shotBlockedAt(this.map, sx, sy)) { sx = p.x; sy = p.y; }
    for (let i = 0; i < w.pellets; i++) {
      const a = p.ang + (this.rng() - 0.5) * 2 * w.spread;
      const sp = w.speed * (w.pellets > 1 ? 0.85 + this.rng() * 0.3 : 1);
      this.bullets.push({
        id: this.nextId++, x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: w.life,
        dmg: w.dmg * p.dmgMul, owner: p.id, team: 'p', kind: p.wpn, pierce: w.pierce || 0, aoe: w.aoe || 0, hit: null,
      });
    }
    this.events.push({ t: 'shot', x: Math.round(sx), y: Math.round(sy), k: p.wpn, pid: p.id });
    if (!(p.ammo[p.wpn] > 0)) p.wpn = 'pistol';
  }

  doAction(p) {
    if (p.car) { this.exitCar(p); return; }
    let best = null, bd = 46;
    for (const c of this.cars) {
      const d = dist(c, p);
      if (!c.driver && d < bd) { best = c; bd = d; }
    }
    if (best) {
      best.driver = p.id; p.car = best.id; p.x = best.x; p.y = best.y;
      this.events.push({ t: 'car', pid: p.id });
      return;
    }
    for (const n of this.npcs) if (dist(n, p) < 56) { this.talk(p, n); return; }
  }

  exitCar(p) {
    const c = this.cars.find((k) => k.id === p.car);
    if (!c) { p.car = 0; return; }
    for (const off of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
      const x = c.x + Math.cos(c.ang + off) * 28, y = c.y + Math.sin(c.ang + off) * 28;
      if (!boxHits(this.map, x, y, p.r)) {
        p.x = x; p.y = y; c.driver = 0; p.car = 0;
        return;
      }
    }
    this.events.push({ t: 'msg', text: 'No room to get out here!', pid: p.id });
  }

  updatePet(p, dt) {
    const pet = p.pet;
    // follow at the hero's back-left: out of the line of fire and out of a
    // behind-the-shoulder camera's view
    const tx = p.x + Math.cos(p.ang - 2.2) * 26, ty = p.y + Math.sin(p.ang - 2.2) * 26 + 4;
    if (Math.hypot(tx - pet.x, ty - pet.y) > 220) { pet.x = tx; pet.y = ty; }
    const k = Math.min(1, dt * 6);
    pet.x += (tx - pet.x) * k; pet.y += (ty - pet.y) * k;
    pet.cd -= dt;
    if (pet.cd > 0) return;
    let target = null, bd = 230;
    for (const e of this.enemies) {
      const d = dist(e, pet);
      if (!e.dead && d < bd) { target = e; bd = d; }
    }
    if (this.mode === 'pvp' && !this.round.over) {
      for (const q of this.players) {
        const d = dist(q, pet);
        if (q !== p && !q.dead && d < bd) { target = q; bd = d; }
      }
    }
    if (!target) { pet.cd = 0.25; return; }
    const C = CREATURES[p.petType];
    const a = Math.atan2(target.y - pet.y, target.x - pet.x);
    this.bullets.push({
      id: this.nextId++, x: pet.x, y: pet.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 0.9,
      dmg: C.dmg * p.petMul, owner: p.id, team: 'p', kind: C.elem, pierce: 0, aoe: 0, hit: null,
    });
    pet.cd = C.rate;
    this.events.push({ t: 'pshot', pid: p.id });
  }

  // ---------- cars ----------
  updateCar(c, dt) {
    let drv = c.driver ? this.byId(c.driver) : null;
    if (c.driver && (!drv || drv.dead || drv.car !== c.id)) { c.driver = 0; drv = null; }
    let target = 0;
    if (drv) {
      const mx = drv.input.mx, my = drv.input.my;
      const m = Math.min(1, Math.hypot(mx, my));
      if (m > 0.15) {
        const diff = wrap(Math.atan2(my, mx) - c.ang);
        const turn = 3.4 * dt;
        c.ang = wrap(c.ang + clamp(diff, -turn, turn));
        target = 300 * m * Math.max(0.25, Math.cos(diff));
      }
    }
    const acc = (target > c.speed ? 260 : 320) * dt;
    c.speed += clamp(target - c.speed, -acc, acc);
    if (Math.abs(c.speed) > 1) {
      const blocked = moveBox(this.map, c, Math.cos(c.ang) * c.speed * dt, Math.sin(c.ang) * c.speed * dt, 11);
      if (blocked === 2) c.speed *= 0.3;
      else if (blocked === 1) c.speed *= Math.max(0, 1 - 1.5 * dt);
      if (Math.abs(c.speed) > 90) {
        for (const e of this.enemies) {
          if (e.dead || e.carHitT > 0 || dist(e, c) > 14 + e.r) continue;
          e.carHitT = 0.35;
          this.damageEnemy(e, Math.abs(c.speed) * 0.45, c.driver);
          c.speed *= 0.8;
        }
      }
    } else {
      c.speed = 0;
    }
    if (drv) { drv.x = c.x; drv.y = c.y; }
    // Walkers cannot stand inside a car.
    for (const p of this.players) if (!p.dead && !p.car) this.pushOut(p, c, 13 + p.r);
    for (const e of this.enemies) if (!e.dead) this.pushOut(e, c, 13 + e.r);
  }

  pushOut(e, c, minD) {
    const dx = e.x - c.x, dy = e.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d >= minD) return;
    if (d < 0.01) { moveBox(this.map, e, minD, 0, e.r); return; }
    const k = (minD - d) / d;
    moveBox(this.map, e, dx * k, dy * k, e.r);
  }

  // ---------- enemies ----------
  spawnEnemy(type, pos, { d = 0, boss = false } = {}) {
    const E = ENEMIES[type];
    const hp = E.hp * (1 + 0.12 * d) * (boss ? 3.5 : 1);
    const e = {
      id: this.nextId++, type, x: pos.x, y: pos.y, r: E.r * (boss ? 1.3 : 1), hp, maxHp: hp, ang: Math.PI / 2,
      cd: 0.5, slowT: 0, carHitT: 0, boss, los: false, losT: this.rng() * 0.25, dmgMul: 1 + 0.06 * d,
      xp: Math.round(E.xp * (1 + 0.1 * d) * (boss ? 5 : 1)), coins: Math.round(E.coins * (boss ? 5 : 1)),
    };
    this.enemies.push(e);
    this.events.push({ t: 'spawn', x: Math.round(e.x), y: Math.round(e.y) });
    return e;
  }

  pickType(d) {
    const r = this.rng();
    if (d >= 5 && r < 0.07) return 'brute';
    if (d >= 3 && r < 0.22) return 'spitter';
    if (d >= 1 && r < 0.45) return 'runner';
    return 'zombie';
  }

  // Breadth-first distance field from every living player, used for pathing.
  updateFlow(dt) {
    this.flowT -= dt;
    if (this.flowT > 0) return;
    this.flowT = 0.3;
    const { w, h } = this.map;
    const f = this.flow, q = this.flowQ;
    f.fill(-1);
    let head = 0, tail = 0;
    for (const p of this.players) {
      if (p.dead) continue;
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if (solidAt(this.map, tx, ty)) continue;
      const i = ty * w + tx;
      if (f[i] === 0) continue;
      f[i] = 0; q[tail++] = i;
    }
    while (head < tail) {
      const i = q[head++];
      const x = i % w, y = (i - x) / w, d = f[i] + 1;
      if (x > 0 && f[i - 1] < 0 && !solidAt(this.map, x - 1, y)) { f[i - 1] = d; q[tail++] = i - 1; }
      if (x < w - 1 && f[i + 1] < 0 && !solidAt(this.map, x + 1, y)) { f[i + 1] = d; q[tail++] = i + 1; }
      if (y > 0 && f[i - w] < 0 && !solidAt(this.map, x, y - 1)) { f[i - w] = d; q[tail++] = i - w; }
      if (y < h - 1 && f[i + w] < 0 && !solidAt(this.map, x, y + 1)) { f[i + w] = d; q[tail++] = i + w; }
    }
  }

  clearLine(a, b, r) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d > 700) return false;
    const steps = Math.ceil(d / 12);
    for (let i = 1; i < steps; i++) {
      if (boxHits(this.map, a.x + (dx * i) / steps, a.y + (dy * i) / steps, r * 0.9)) return false;
    }
    return true;
  }

  updateEnemy(e, dt) {
    const E = ENEMIES[e.type];
    e.cd = Math.max(0, e.cd - dt);
    e.slowT = Math.max(0, e.slowT - dt);
    e.carHitT = Math.max(0, e.carHitT - dt);
    let t = null, bd = Infinity;
    for (const p of this.players) {
      const d = dist(p, e);
      if (!p.dead && d < bd) { t = p; bd = d; }
    }
    if (!t) return;
    const dx = t.x - e.x, dy = t.y - e.y;
    const d = bd;
    e.losT -= dt;
    if (e.losT <= 0) { e.losT = 0.25; e.los = this.clearLine(e, t, e.r); }
    let ux = 0, uy = 0;
    if (e.los || d < TILE) {
      if (d > 0.01) { ux = dx / d; uy = dy / d; }
    } else {
      const { w } = this.map;
      const cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE);
      const here = this.flow[cy * w + cx];
      let best = here < 0 ? 32767 : here, bx = cx, by = cy;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, ny = cy + oy;
        if (solidAt(this.map, nx, ny)) continue;
        const v = this.flow[ny * w + nx];
        if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
      }
      let gx = dx, gy = dy;
      if (bx !== cx || by !== cy) { gx = (bx + 0.5) * TILE - e.x; gy = (by + 0.5) * TILE - e.y; }
      const g = Math.hypot(gx, gy);
      if (g > 0.01) { ux = gx / g; uy = gy / g; }
    }
    const tr = t.car ? 14 : t.r;
    if (E.ranged) {
      if (e.los && d < E.range) {
        if (e.cd <= 0) {
          const a = Math.atan2(dy, dx);
          this.bullets.push({
            id: this.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, life: 1.6,
            dmg: E.dmg * e.dmgMul, owner: 0, team: 'e', kind: 'spit', pierce: 0, aoe: 0, hit: null,
          });
          e.cd = E.rate;
          this.events.push({ t: 'atk', id: e.id });
        }
        if (d < E.keep) { e.ang = Math.atan2(dy, dx); ux = 0; uy = 0; }
      }
    } else if (d < e.r + tr + 4 && e.cd <= 0) {
      e.cd = E.rate;
      this.events.push({ t: 'atk', id: e.id });
      this.damagePlayer(t, E.dmg * e.dmgMul, 0);
    }
    if (ux || uy) {
      const sp = E.spd * (e.slowT > 0 ? 0.5 : 1) * (e.boss ? 0.9 : 1);
      // Do not walk through the target: stop at touching distance.
      if (d > e.r + tr) moveBox(this.map, e, ux * sp * dt, uy * sp * dt, e.r);
      e.ang = Math.atan2(uy, ux);
    }
  }

  separate() {
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.dead) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
        const push = (min - d) / 2;
        moveBox(this.map, a, -nx * push, -ny * push, a.r);
        moveBox(this.map, b, nx * push, ny * push, b.r);
      }
    }
  }

  damageEnemy(e, dmg, pid) {
    if (e.dead) return;
    e.hp -= dmg;
    this.events.push({ t: 'hit', id: e.id, x: Math.round(e.x), y: Math.round(e.y), d: Math.round(dmg) });
    if (e.hp <= 0) this.killEnemy(e, pid);
  }

  killEnemy(e, pid) {
    e.dead = true;
    this.events.push({ t: 'die', id: e.id, x: Math.round(e.x), y: Math.round(e.y), k: e.type, boss: e.boss ? 1 : 0 });
    const killer = this.byId(pid);
    if (killer) killer.kills++;
    // Co-op shares rewards with the whole squad.
    for (const p of this.players) {
      if (this.mode === 'coop' || p === killer || this.mode === 'city') this.events.push({ t: 'xp', pid: p.id, xp: e.xp, coins: e.coins });
    }
    const r = this.rng();
    if (r < 0.1) this.pickups.push({ id: this.nextId++, x: e.x, y: e.y, kind: 'health', life: 20 });
    else if (r < 0.24) this.pickups.push({ id: this.nextId++, x: e.x, y: e.y, kind: 'ammo', life: 20 });
    const q = this.quest;
    if (q) {
      if (q.type === 'kill') { q.progress++; if (q.progress >= q.goal) this.completeQuest(); }
      else if (q.type === 'boss' && e.id === q.bossId) this.completeQuest();
    }
  }

  damagePlayer(p, dmg, byPid) {
    if (p.dead || this.round.over) return;
    p.hp -= dmg;
    p.hurtT = this.time;
    this.events.push({ t: 'hurt', pid: p.id, x: Math.round(p.x), y: Math.round(p.y), d: Math.round(dmg) });
    if (p.hp > 0) return;
    p.hp = 0; p.dead = true; p.deaths++; p.respawn = 3;
    this.releaseCar(p);
    this.events.push({ t: 'pdie', pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
    if (this.mode === 'city') this.events.push({ t: 'ko', pid: p.id });
    if (this.mode === 'pvp') {
      const killer = this.byId(byPid);
      if (killer && killer !== p) {
        killer.kills++;
        this.events.push({ t: 'xp', pid: killer.id, xp: 30, coins: 15 });
        this.events.push({ t: 'msg', text: `${killer.name} knocked out ${p.name}!` });
        if (killer.kills >= this.round.goal) this.endRound(killer);
      }
    }
  }

  explode(x, y, r, dmg, owner) {
    this.events.push({ t: 'boom', x: Math.round(x), y: Math.round(y), r });
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < r + e.r) this.damageEnemy(e, dmg * (1 - 0.6 * Math.min(1, d / r)), owner);
    }
    if (this.mode === 'pvp') {
      for (const p of this.players) {
        if (p.dead || p.id === owner) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < r + p.r) this.damagePlayer(p, dmg * (1 - 0.6 * Math.min(1, d / r)), owner);
      }
    }
  }

  // ---------- bullets & pickups ----------
  updateBullets(dt) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) {
        if (b.aoe) this.explode(b.x, b.y, b.aoe, b.dmg, b.owner);
        b.dead = true;
        continue;
      }
      const len = Math.hypot(b.vx, b.vy) * dt;
      const steps = Math.max(1, Math.ceil(len / 8));
      const sx = (b.vx * dt) / steps, sy = (b.vy * dt) / steps;
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += sx; b.y += sy;
        if (shotBlockedAt(this.map, b.x, b.y)) {
          this.events.push({ t: 'spark', x: Math.round(b.x), y: Math.round(b.y) });
          if (b.aoe) this.explode(b.x, b.y, b.aoe, b.dmg, b.owner);
          b.dead = true;
          break;
        }
        if (b.team === 'p') {
          for (const e of this.enemies) {
            if (e.dead || (b.hit && b.hit.includes(e.id))) continue;
            if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 3) { this.bulletHit(b, e, false); if (b.dead) break; }
          }
          if (!b.dead && this.mode === 'pvp') {
            for (const q of this.players) {
              if (q.dead || q.id === b.owner || (b.hit && b.hit.includes(q.id))) continue;
              if (Math.hypot(q.x - b.x, q.y - b.y) < q.r + 3) { this.bulletHit(b, q, true); if (b.dead) break; }
            }
          }
        } else {
          for (const p of this.players) {
            if (p.dead) continue;
            if (Math.hypot(p.x - b.x, p.y - b.y) < (p.car ? 14 : p.r) + 3) {
              this.damagePlayer(p, b.dmg, 0);
              b.dead = true;
              break;
            }
          }
        }
      }
    }
  }

  bulletHit(b, target, isPlayer) {
    if (b.aoe) { this.explode(b.x, b.y, b.aoe, b.dmg, b.owner); b.dead = true; return; }
    if (b.kind === 'water') target.slowT = 1.5;
    if (b.kind === 'grass') {
      const o = this.byId(b.owner);
      if (o && !o.dead) o.hp = Math.min(o.maxHp, o.hp + 3);
    }
    if (isPlayer) this.damagePlayer(target, b.dmg, b.owner);
    else this.damageEnemy(target, b.dmg, b.owner);
    if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = [])).push(target.id); }
    else b.dead = true;
  }

  updatePickups(dt) {
    for (const k of this.pickups) {
      if (k.dead) continue;
      k.life -= dt;
      if (k.life <= 0) { k.dead = true; continue; }
      for (const p of this.players) {
        if (p.dead || dist(p, k) > (p.car ? 28 : 22)) continue;
        if (k.kind === 'health') {
          if (p.hp >= p.maxHp) continue;
          p.hp = Math.min(p.maxHp, p.hp + 35);
        } else if (k.kind === 'ammo') {
          for (const w of p.weapons) {
            const W = WEAPONS[w];
            if (W.max !== Infinity) p.ammo[w] = Math.min(W.max, p.ammo[w] + Math.ceil(W.max * 0.35));
          }
        } else if (k.kind === 'crate') {
          const q = this.quest;
          if (q && q.type === 'collect') { q.progress++; if (q.progress >= q.goal) this.completeQuest(); }
        }
        k.dead = true;
        this.events.push({ t: 'pick', pid: p.id, k: k.kind, x: Math.round(k.x), y: Math.round(k.y) });
        break;
      }
    }
  }

  // ---------- single player city ----------
  talk(p, n) {
    if (this.mode !== 'city') return;
    if (this.quest) {
      this.events.push({ t: 'msg', text: `${n.name}: Finish your current job first: ${this.quest.title}.`, pid: p.id });
      return;
    }
    this.startQuest(p, n);
  }

  startQuest(p, n) {
    const q = { ...questFor(this.questNum), progress: 0, target: null, bossId: 0 };
    if (q.type === 'collect') {
      for (let i = 0; i < q.goal; i++) {
        const s = this.findSpot({ around: p, min: 250, max: 900 }) || this.findSpot({});
        this.pickups.push({ id: this.nextId++, x: s.x, y: s.y, kind: 'crate', life: Infinity });
      }
    } else if (q.type === 'drive') {
      const far = this.map.carSpots.filter((s) => dist(s, p) > 600);
      const s = far[Math.floor(this.rng() * far.length)] || this.map.carSpots[0];
      q.dest = { x: s.x, y: s.y };
    } else if (q.type === 'boss') {
      const s = this.findSpot({ around: p, min: 300, max: 520 }) || this.findSpot({});
      q.bossId = this.spawnEnemy('brute', s, { d: p.level - 1, boss: true }).id;
    }
    this.quest = q;
    this.events.push({ t: 'quest', title: q.title, text: `${n ? n.name + ': ' : ''}${q.desc}` });
  }

  completeQuest() {
    const q = this.quest;
    if (!q) return;
    this.quest = null;
    this.questNum = q.num + 1;
    this.events.push({ t: 'questDone', num: q.num, title: q.title, xp: q.xp, coins: q.coins });
  }

  stepCity(dt) {
    const p = this.players[0];
    if (!p) return;
    const q = this.quest;
    if (q) {
      q.target = null;
      if (q.type === 'drive') {
        q.target = q.dest;
        if (p.car && !p.dead && dist(p, q.dest) < 44) this.completeQuest();
      } else if (q.type === 'boss') {
        const b = this.enemies.find((e) => e.id === q.bossId && !e.dead);
        if (b) q.target = { x: b.x, y: b.y };
        else if (this.quest === q) this.completeQuest(); // boss vanished: do not soft-lock
      } else if (q.type === 'collect') {
        let bd = Infinity;
        for (const k of this.pickups) {
          const d = dist(k, p);
          if (k.kind === 'crate' && !k.dead && d < bd) { bd = d; q.target = { x: k.x, y: k.y }; }
        }
      }
    }
    // Ambient enemies: keep a few around the player, scaled to their level.
    for (const e of this.enemies) if (!e.boss && !e.dead && dist(e, p) > 1000) e.dead = true;
    this.ambT -= dt;
    if (this.ambT <= 0 && !p.dead) {
      this.ambT = 1;
      const cap = Math.min(6 + p.level, 22);
      const n = this.enemies.reduce((a, e) => a + (e.dead || e.boss ? 0 : 1), 0);
      if (n < cap) {
        const s = this.findSpot({ around: p, min: 380, max: 640 });
        if (s) this.spawnEnemy(this.pickType(p.level - 1), s, { d: p.level - 1 });
      }
    }
  }

  // ---------- co-op waves ----------
  stepCoop(dt) {
    if (!this.players.length) return;
    if (this.players.every((p) => p.dead)) {
      if (!this.wiped) {
        this.wiped = true; this.wipeT = 4;
        this.events.push({ t: 'msg', text: `Squad wiped out on wave ${this.wave}! Restarting...` });
      }
      this.wipeT -= dt;
      if (this.wipeT <= 0) {
        for (const e of this.enemies) e.dead = true;
        for (const k of this.pickups) k.dead = true;
        this.toSpawn = []; this.wave = 0; this.waveTimer = 4; this.cleared = true; this.wiped = false;
        for (const p of this.players) this.spawnPlayer(p);
      }
      return;
    }
    if (this.toSpawn.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 0.3;
        const s = this.findSpot({ avoid: 240 }) || this.findSpot({ avoid: 120 }) || this.findSpot({});
        if (s) {
          const n = this.toSpawn.pop();
          this.spawnEnemy(n.type, s, { d: this.wave - 1, boss: n.boss });
        }
      }
      return;
    }
    if (this.enemies.some((e) => !e.dead)) return;
    if (!this.cleared) {
      this.cleared = true;
      const quest = this.wave === COOP_QUEST_WAVE;
      for (const p of this.players) {
        this.events.push({ t: 'xp', pid: p.id, xp: 20 + 10 * this.wave + (quest ? 300 : 0), coins: 10 + 5 * this.wave + (quest ? 200 : 0) });
      }
      this.events.push({ t: 'wave', n: this.wave, clear: 1, quest: quest ? 1 : 0 });
    }
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) this.startWave();
  }

  startWave() {
    this.wave++;
    this.cleared = false;
    this.waveTimer = 5;
    this.spawnT = 0.5;
    for (const p of this.players) if (p.dead) this.spawnPlayer(p);
    const count = 4 + 3 * this.wave + 2 * this.players.length;
    this.toSpawn = [];
    if (this.wave % 5 === 0) this.toSpawn.push({ type: 'brute', boss: true });
    for (let i = 0; i < count; i++) this.toSpawn.push({ type: this.pickType(this.wave - 1), boss: false });
    this.events.push({ t: 'wave', n: this.wave, clear: 0 });
  }

  // ---------- pvp ----------
  endRound(winner) {
    this.round.over = true; this.round.timer = 8; this.round.winner = winner.id;
    this.events.push({ t: 'xp', pid: winner.id, xp: 150, coins: 100 });
    this.events.push({ t: 'round', winner: winner.id, name: winner.name });
  }

  stepPvp(dt) {
    if (this.round.over) {
      this.round.timer -= dt;
      if (this.round.timer <= 0) {
        this.round.over = false; this.round.winner = 0;
        for (const k of this.pickups) k.dead = true;
        for (const b of this.bullets) b.dead = true;
        for (const p of this.players) { p.kills = 0; p.deaths = 0; this.spawnPlayer(p); }
      }
      return;
    }
    this.pickT -= dt;
    if (this.pickT <= 0) {
      this.pickT = 6;
      if (this.pickups.length < 6) {
        const s = this.findSpot({});
        if (s) this.pickups.push({ id: this.nextId++, x: s.x, y: s.y, kind: this.rng() < 0.5 ? 'health' : 'ammo', life: 30 });
      }
    }
  }

  // ---------- network snapshot (compact arrays) ----------
  snapshot() {
    const r = Math.round;
    return {
      tm: r(this.time * 1000),
      p: this.players.map((p) => [p.id, r(p.x), r(p.y), r(p.ang * 100) / 100, Math.ceil(p.hp), p.maxHp, WEAPON_ORDER.indexOf(p.wpn), p.dead ? 1 : 0, p.kills, p.deaths, r(p.pet.x), r(p.pet.y), p.moving ? 1 : 0]),
      e: this.enemies.map((e) => [e.id, ENEMY_ORDER.indexOf(e.type), r(e.x), r(e.y), r(e.ang * 10) / 10, Math.max(1, r((e.hp / e.maxHp) * 100)), e.boss ? 1 : 0]),
      b: this.bullets.map((b) => [b.id, r(b.x), r(b.y), BULLET_KINDS.indexOf(b.kind)]),
      k: this.pickups.map((k) => [k.id, r(k.x), r(k.y), k.kind]),
      c: this.cars.map((c) => [c.id, r(c.x), r(c.y), r(c.ang * 100) / 100, c.color, c.driver]),
      w: this.wave,
      left: this.enemies.length + this.toSpawn.length,
      rd: this.mode === 'pvp' ? [this.round.over ? 1 : 0, this.round.winner, this.round.goal] : null,
    };
  }

  // Private per-player info (ammo is not in the shared snapshot).
  // -1 = unlimited, -2 = not owned. JSON cannot carry Infinity.
  privateFor(pid) {
    const p = this.byId(pid);
    if (!p) return null;
    return {
      ammo: WEAPON_ORDER.map((w) => (!p.weapons.includes(w) ? -2 : p.ammo[w] === Infinity ? -1 : p.ammo[w])),
      wpn: p.wpn, car: p.car, respawn: p.dead ? Math.max(0, Math.ceil(p.respawn)) : 0,
    };
  }

  roster() {
    return this.players.map((p) => ({ id: p.id, name: p.name, look: p.look, pet: p.petType, evolved: p.evolved, level: p.level }));
  }
}
