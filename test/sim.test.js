import test from 'node:test';
import assert from 'node:assert/strict';
import { World, boxHits, PVP_GOAL } from '../web/js/shared/sim.js';
import { makeCity, makeArena, solidAt } from '../web/js/shared/maps.js';
import { grantXp, xpNeed, sanitizeLoadout, derive, questFor, TILE, WEAPON_ORDER } from '../web/js/shared/data.js';

const DT = 1 / 30;
const base = { name: 'Tester', look: {}, companion: 'puddlo', level: 1, stats: { pow: 0, vit: 0, agi: 0 }, weapons: ['pistol'] };
const run = (w, secs, each) => { for (let i = 0; i < secs / DT; i++) { if (each) each(i); w.step(DT); } };
const finite = (w) => {
  for (const list of [w.players, w.enemies, w.bullets, w.cars, w.pickups]) for (const e of list) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), 'finite position');
};

test('maps are deterministic and fully connected', () => {
  for (const make of [makeCity, makeArena]) {
    const a = make(7), b = make(7);
    assert.deepEqual([...a.tiles], [...b.tiles]);
    // flood fill from spawn must reach every walkable tile
    const seen = new Uint8Array(a.w * a.h);
    const sx = Math.floor(a.spawn.x / TILE), sy = Math.floor(a.spawn.y / TILE);
    assert.equal(solidAt(a, sx, sy), false);
    const q = [[sx, sy]]; seen[sy * a.w + sx] = 1;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy;
        if (solidAt(a, nx, ny) || seen[ny * a.w + nx]) continue;
        seen[ny * a.w + nx] = 1; q.push([nx, ny]);
      }
    }
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (!solidAt(a, x, y)) assert.equal(seen[y * a.w + x], 1, `${a.kind} tile ${x},${y} reachable`);
    for (const n of a.npcs) assert.equal(boxHits(a, n.x, n.y, 9), false, 'npc on walkable ground');
    for (const c of a.cars) assert.equal(boxHits(a, c.x, c.y, 11), false, 'car on road');
    for (const c of a.carSpots) assert.equal(boxHits(a, c.x, c.y, 11), false, 'car spot on road');
  }
});

test('xp curve, level ups and loadout sanitizing', () => {
  const p = { level: 1, xp: 0, coins: 0, points: 0 };
  assert.equal(grantXp(p, xpNeed(1) - 1, 5), 0);
  assert.equal(grantXp(p, 1, 0), 1);
  assert.deepEqual([p.level, p.xp, p.points, p.coins], [2, 0, 1, 5]);
  const bad = sanitizeLoadout({ name: '<b>Hax</b>!!!!!!!!!!!!!!!!', level: 9999, stats: { pow: 999 }, weapons: ['rocket', 'nuke'], look: { skin: 99, hair: -4 }, companion: 'nope' });
  assert.equal(bad.level, 50);
  assert.ok(bad.name.length <= 12 && !/[<>]/.test(bad.name));
  assert.deepEqual(bad.weapons, ['pistol', 'rocket']);
  assert.equal(bad.companion, 'cindkit');
  assert.deepEqual([bad.look.skin, bad.look.hair], [4, 0]);
  const cheat = sanitizeLoadout({ level: 2, stats: { pow: 20, vit: 20, agi: 20 } });
  assert.deepEqual(cheat.stats, { pow: 0, vit: 0, agi: 0 });
  assert.equal(sanitizeLoadout(null).name, 'Rookie');
  // pvp is normalized
  const strong = sanitizeLoadout({ level: 30, stats: { pow: 10, vit: 10, agi: 9 } });
  assert.equal(derive(strong, 'pvp').maxHp, 100);
  assert.ok(derive(strong, 'coop').maxHp > 100);
  for (let i = 0; i < 12; i++) assert.ok(questFor(i).goal >= 1 && questFor(i).xp > 0);
});

test('city: player moves, collides with walls, fights and stays in bounds', () => {
  const w = new World({ mode: 'city', seed: 20260 });
  const p = w.addPlayer(base);
  assert.equal(boxHits(w.map, p.x, p.y, p.r), false);
  let xp = 0;
  run(w, 60, (i) => {
    const a = i * 0.013;
    p.input.mx = Math.cos(a); p.input.my = Math.sin(a * 0.7);
    p.input.fire = true;
    const near = w.enemies[0];
    if (near) p.input.ang = Math.atan2(near.y - p.y, near.x - p.x);
    for (const e of w.events.splice(0)) if (e.t === 'xp') xp += e.xp;
    assert.equal(boxHits(w.map, p.x, p.y, p.r), false, 'player never inside a wall');
    for (const e of w.enemies) assert.equal(boxHits(w.map, e.x, e.y, e.r), false, 'enemy never inside a wall');
  });
  finite(w);
  assert.ok(w.enemies.length > 0, 'ambient enemies spawn');
  assert.ok(xp > 0, 'kills award xp');
});

test('city: enemies path around buildings to reach the player', () => {
  const w = new World({ mode: 'city', seed: 20260 });
  const p = w.addPlayer(base);
  w.ambT = 1e9; // no ambient spawns
  // put an enemy two blocks away with buildings in between
  const e = w.spawnEnemy('runner', { x: 12.5 * TILE, y: 12.5 * TILE });
  const d0 = Math.hypot(e.x - p.x, e.y - p.y);
  p.hp = p.maxHp = 1e6;
  p.pet.cd = 1e9; // keep the companion from killing it on the way
  let d1 = Infinity;
  run(w, 25, () => { d1 = Math.min(d1, Math.hypot(e.x - p.x, e.y - p.y)); });
  assert.equal(e.dead, undefined);
  assert.ok(d1 < 40, `enemy reached player (from ${d0 | 0} to ${d1 | 0})`);
});

test('city: cars can be entered, driven and exited', () => {
  const w = new World({ mode: 'city', seed: 20260 });
  const p = w.addPlayer(base);
  w.ambT = 1e9;
  const car = w.cars[0];
  p.x = car.x; p.y = car.y - 30;
  p.input.act = 1; w.step(DT);
  assert.equal(p.car, car.id);
  const x0 = car.x;
  p.input.mx = 1;
  run(w, 2);
  assert.ok(car.x - x0 > 150, 'car drove east');
  assert.equal(p.x, car.x);
  p.input.mx = 0; p.input.act = 2; w.step(DT);
  assert.equal(p.car, 0);
  assert.equal(car.driver, 0);
  assert.equal(boxHits(w.map, p.x, p.y, p.r), false);
});

test('city: all four quest types can be completed', () => {
  const w = new World({ mode: 'city', seed: 20260 });
  const p = w.addPlayer({ ...base, level: 5 });
  p.maxHp = p.hp = 1e6;
  const done = [];
  const drain = () => { for (const e of w.events.splice(0)) if (e.t === 'questDone') done.push(e.num); };
  const npc = w.npcs[0];
  const talk = () => { p.x = npc.x + 20; p.y = npc.y; p.input.act++; w.step(DT); assert.ok(w.quest, 'quest started'); };
  // 0: kill
  talk(); assert.equal(w.quest.type, 'kill');
  const goal = w.quest.goal;
  for (let i = 0; i < goal; i++) w.damageEnemy(w.spawnEnemy('zombie', { x: p.x + 60, y: p.y }), 1e6, p.id);
  drain(); assert.deepEqual(done, [0]);
  // 1: collect
  talk(); assert.equal(w.quest.type, 'collect');
  for (const k of w.pickups.filter((k) => k.kind === 'crate')) { p.x = k.x; p.y = k.y; w.step(DT); }
  drain(); assert.deepEqual(done, [0, 1]);
  // 2: drive
  talk(); assert.equal(w.quest.type, 'drive');
  const car = w.cars[0];
  p.x = car.x; p.y = car.y - 30; p.input.act++; w.step(DT);
  assert.equal(p.car, car.id);
  car.x = w.quest.dest.x; car.y = w.quest.dest.y; w.step(DT);
  drain(); assert.deepEqual(done, [0, 1, 2]);
  p.input.act++; w.step(DT); assert.equal(p.car, 0);
  // 3: boss
  talk(); assert.equal(w.quest.type, 'boss');
  const boss = w.enemies.find((e) => e.id === w.quest.bossId);
  assert.ok(boss && boss.boss);
  w.damageEnemy(boss, 1e9, p.id); w.step(DT);
  drain(); assert.deepEqual(done, [0, 1, 2, 3]);
  assert.equal(w.questNum, 4);
  assert.equal(w.quest, null);
});

test('city: knocked out player respawns', () => {
  const w = new World({ mode: 'city', seed: 20260 });
  const p = w.addPlayer(base);
  w.damagePlayer(p, 1e6, 0);
  assert.equal(p.dead, true);
  assert.ok(w.events.some((e) => e.t === 'ko'));
  run(w, 3.5);
  assert.equal(p.dead, false);
  assert.equal(p.hp, p.maxHp);
});

test('coop: waves start, clear, reward and escalate; wipe restarts', () => {
  const w = new World({ mode: 'coop', seed: 5 });
  const a = w.addPlayer(base), b = w.addPlayer({ ...base, name: 'Two' });
  a.maxHp = a.hp = b.maxHp = b.hp = 1e7;
  const waves = [];
  let clears = 0, xpA = 0;
  for (let i = 0; i < 400 / DT && w.wave < 4; i++) {
    for (const e of w.enemies) if (w.time % 1 < DT) w.damageEnemy(e, 1e6, a.id);
    w.step(DT);
    for (const e of w.events.splice(0)) {
      if (e.t === 'wave' && !e.clear) waves.push(e.n);
      if (e.t === 'wave' && e.clear) clears++;
      if (e.t === 'xp' && e.pid === b.id) xpA += e.xp;
    }
  }
  assert.deepEqual(waves, [1, 2, 3, 4]);
  assert.equal(clears, 3);
  assert.ok(xpA > 0, 'squad shares xp');
  finite(w);
  // wipe
  a.hp = b.hp = 1; w.damagePlayer(a, 10, 0); w.damagePlayer(b, 10, 0);
  run(w, 5);
  assert.equal(w.wave, 0);
  assert.equal(a.dead || b.dead, false);
  run(w, 5);
  assert.equal(w.wave, 1);
});

test('coop: dead player revives on next wave', () => {
  const w = new World({ mode: 'coop', seed: 9 });
  const a = w.addPlayer(base), b = w.addPlayer(base);
  a.maxHp = a.hp = 1e7;
  run(w, 5);
  assert.equal(w.wave, 1);
  w.damagePlayer(b, 1e6, 0);
  assert.equal(b.dead, true);
  for (let i = 0; i < 60 / DT && w.wave < 2; i++) { for (const e of w.enemies) w.damageEnemy(e, 1e6, a.id); w.step(DT); }
  assert.equal(w.wave, 2);
  assert.equal(b.dead, false);
});

test('pvp: shooting damages, kills score, round ends and resets', () => {
  const w = new World({ mode: 'pvp', seed: 3 });
  const a = w.addPlayer({ ...base, level: 40, stats: { pow: 20, vit: 10, agi: 5 } });
  const b = w.addPlayer({ ...base, name: 'Target' });
  assert.equal(a.maxHp, 100, 'pvp stats are normalized');
  assert.deepEqual(a.weapons, WEAPON_ORDER);
  let won = null;
  for (let i = 0; i < 300 / DT && !won; i++) {
    if (!a.dead && !b.dead) { b.x = a.x + 60; b.y = a.y; b.pet.cd = 9; }
    a.input.ang = 0; a.input.fire = true; a.hp = a.maxHp;
    w.step(DT);
    for (const e of w.events.splice(0)) if (e.t === 'round') won = e;
  }
  assert.ok(won, 'round finished');
  assert.equal(won.winner, a.id);
  assert.equal(a.kills, PVP_GOAL);
  assert.equal(b.deaths, PVP_GOAL);
  const hp = b.hp;
  w.damagePlayer(b, 50, a.id);
  assert.equal(b.hp, hp, 'no damage between rounds');
  run(w, 9);
  assert.equal(w.round.over, false);
  assert.deepEqual([a.kills, b.deaths], [0, 0]);
});

test('weapons: ammo drains and falls back to pistol; rocket explodes; rifle pierces', () => {
  const w = new World({ mode: 'coop', seed: 4 });
  const p = w.addPlayer({ ...base, level: 12, weapons: [...WEAPON_ORDER] });
  w.waveTimer = 1e9;
  p.input.wpn = 'rocket'; p.input.fire = true; p.input.ang = 0;
  const e1 = w.spawnEnemy('zombie', { x: p.x + 50, y: p.y });
  const e2 = w.spawnEnemy('zombie', { x: p.x + 70, y: p.y + 10 });
  run(w, 1);
  assert.ok(e1.dead && e2.dead, 'rocket splash kills both');
  p.input.fire = false; run(w, 1.5);
  p.input.wpn = 'rifle'; p.input.fire = true;
  const row = [0, 1, 2].map((i) => w.spawnEnemy('runner', { x: p.x + 40 + i * 20, y: p.y }));
  w.step(DT); p.input.fire = false; run(w, 0.5);
  assert.ok(row.every((e) => e.dead), 'rifle pierces a line');
  p.ammo.uzi = 3; p.input.wpn = 'uzi'; p.input.fire = true;
  run(w, 1);
  assert.equal(p.ammo.uzi, 0);
  assert.equal(p.wpn, 'pistol');
  w.pickups.push({ id: 999, x: p.x, y: p.y, kind: 'ammo', life: 5 });
  p.input.fire = false; w.step(DT); w.step(DT);
  assert.ok(p.ammo.uzi > 0, 'ammo pickup refills');
  assert.equal(p.wpn, 'uzi', 'switches back to the selected weapon');
  const s = JSON.parse(JSON.stringify(w.snapshot()));
  assert.equal(s.p.length, 1);
  assert.ok(s.p[0].every((v) => v !== null), 'snapshot has no NaN/Infinity');
});
