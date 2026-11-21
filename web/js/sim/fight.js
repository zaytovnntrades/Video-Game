// Aura Ascendants: deterministic fight simulation (60 ticks/s).
// step([inputA, inputB]) is the only way in: the CPU, replays, tests and any future
// online play all drive fights the same way. Hit-stop lives in here too.
import {
  DT, ARENA, BODY, MAX_HP, MAX_METER, MAX_BLINK, ROUND_TIME, STYLES, MELEE, COMBO, REACH, HIT_RADIUS, LUNGE_RANGE,
  MAX_COMBO_HITS, SCALING, BLASTS, BEAMS, RUSHES, APEXES, SPEED, DASH_FRAMES, DASH_IN_MAX, CHARGE_RATE,
  BLINK_WINDOW, BLINK_REGEN, ASCEND_COST, ASCEND_DRAIN, ASCEND_FRAMES, APEX_COST, HITSTOP,
} from './data.js';
import { sanitizeSpec } from './spec.js';
import { mulberry32 } from './rng.js';

const HOLD = 14; // frames: a press held this long becomes the "held" version
const BUTTONS = ['atk', 'blast', 'guard', 'dash', 'jump', 'special'];
export function blankInput() { return { mx: 0, my: 0, atk: false, blast: false, guard: false, dash: false, jump: false, special: false }; }

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => { const l = len(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// distance from point p to segment a-b
function segDist(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a);
  const L = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1;
  const t = clamp((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / L, 0, 1);
  return Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y, a.z + ab.z * t - p.z);
}
// closest distance between two segments (sampled; plenty for 2 m bodies)
function segSeg(a0, a1, b0, b1) {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    best = Math.min(best, segDist(v3(a0.x + (a1.x - a0.x) * t, a0.y + (a1.y - a0.y) * t, a0.z + (a1.z - a0.z) * t), b0, b1));
  }
  return best;
}

class Fighter {
  constructor(spec, side) {
    this.spec = sanitizeSpec(spec);
    this.side = side;
    this.style = STYLES[this.spec.style];
    this.maxHp = Math.round(MAX_HP * this.style.hp);
    this.hp = this.maxHp;
    this.meter = 20;
    this.blink = MAX_BLINK; this.blinkT = 0;
    this.pos = v3(0, 0, side ? 14 : -14);
    this.vel = v3();
    this.face = v3(0, 0, side ? -1 : 1); // horizontal, toward the rival
    this.aim = this.face; // 3D, toward the rival's chest
    this.flying = false; this.dropping = false;
    this.state = 'idle'; this.t = 0;
    this.move = null; this.step = 0; this.queued = false; this.hit = false; this.rushHits = 0;
    this.comboHits = 0; this.calm = 0;
    this.ascended = false;
    this.prev = blankInput();
    this.latch = {};
    this.used = {}; // a long hold fires its move once, even if it matures while busy
    this.hold = { atk: 0, blast: 0, dash: 0, jump: 0 };
    this.pendingDash = false;
    this.guardPress = -999;
    this.cd = 0;
    this.stun = 0;
    this.after = null; // what a dash-in turns into
  }
  get chest() { return v3(this.pos.x, this.pos.y + 1.1, this.pos.z); }
  get capA() { return v3(this.pos.x, this.pos.y + 0.25, this.pos.z); }
  get capB() { return v3(this.pos.x, this.pos.y + BODY.height - 0.25, this.pos.z); }
  get onGround() { return this.pos.y <= 0.001; }
  set(state) { this.state = state; this.t = 0; }
}

export class Fight {
  constructor({ specs, seed = 1, time = ROUND_TIME }) {
    this.f = [new Fighter(specs[0], 0), new Fighter(specs[1], 1)];
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed ^ 0xa11a);
    this.tick = 0;
    this.timer = time;
    this.hitstop = 0;
    this.over = false; this.winner = -1; this.reason = '';
    this.events = [];
    this.projectiles = [];
    this.beams = [];
    this.nextId = 1;
    // rock pillars to fight around (deterministic from the seed)
    this.pillars = [];
    const R = mulberry32(this.seed ^ 0x9111);
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2, d = 35 + R() * 90;
      this.pillars.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 4 + R() * 6, h: 14 + R() * 42 });
    }
  }

  emit(e) { this.events.push(e); }

  step(inputs) {
    this.tick++;
    if (this.over) { for (const f of this.f) this.physics(f, this.other(f)); return; }
    if (this.hitstop > 0) { // impact freeze: remember presses so a tap during it still counts
      this.hitstop--;
      for (const f of this.f) { const i = inputs[f.side] || {}; for (const k of BUTTONS) if (i[k]) f.latch[k] = true; }
      return;
    }
    inputs = this.f.map((f) => { const i = { ...blankInput(), ...(inputs[f.side] || {}) }; for (const k of BUTTONS) { if (f.latch[k]) i[k] = true; f.latch[k] = false; } return i; });
    for (const f of this.f) this.control(f, inputs[f.side] || blankInput(), this.other(f));
    for (const f of this.f) this.physics(f, this.other(f));
    this.updateProjectiles();
    this.updateBeams();
    this.resolveMelee();
    this.separate();
    this.timer = Math.max(0, this.timer - DT);
    if (!this.over && this.timer <= 0) {
      const [a, b] = this.f, ra = a.hp / a.maxHp, rb = b.hp / b.maxHp;
      this.finish(ra > rb ? 0 : rb > ra ? 1 : -1, 'time');
    }
  }

  other(f) { return this.f[1 - f.side]; }

  finish(winner, reason) {
    this.over = true; this.winner = winner; this.reason = reason;
    this.emit({ t: 'end', winner, reason });
  }

  // ---------------------------------------------------------------- input -> actions
  control(f, inp, o) {
    f.t++;
    const press = (k) => inp[k] && !f.prev[k];
    const release = (k) => !inp[k] && f.prev[k];
    const heldFor = {};
    for (const k of ['atk', 'blast', 'dash', 'jump']) { heldFor[k] = f.hold[k]; f.hold[k] = inp[k] ? f.hold[k] + 1 : 0; if (!inp[k]) f.used[k] = false; }
    if (press('guard')) f.guardPress = this.tick;
    if (f.cd > 0) f.cd--;
    // facing: always locked on the rival
    const d = sub(o.chest, f.chest);
    const h = Math.hypot(d.x, d.z);
    if (h > 0.05) f.face = v3(d.x / h, 0, d.z / h);
    f.aim = norm(d);
    // passive resources
    if (f.blink < MAX_BLINK && (f.blinkT += DT) >= BLINK_REGEN) { f.blink++; f.blinkT = 0; }
    if (f.ascended && f.state !== 'apex') {
      f.meter -= ASCEND_DRAIN * DT;
      if (f.meter <= 0) { f.meter = 0; f.ascended = false; this.emit({ t: 'descend', who: f.side }); }
    }
    if (f.state !== 'stun' && f.state !== 'launched') { if (++f.calm > 30) f.comboHits = 0; } else f.calm = 0;
    const speedMul = f.style.speed * (f.ascended ? 1.15 : 1);
    const stick = Math.hypot(inp.mx, inp.my);
    const right = v3(-f.face.z, 0, f.face.x);
    const blast = BLASTS[f.spec.moves.blast], beam = BEAMS[f.spec.moves.beam];

    switch (f.state) {
      case 'ko': f.prev = { ...inp }; return;
      case 'idle': case 'guard': case 'charge': {
        // contextual special: Ascend, or Apex once ascended with a full meter
        if (press('special')) {
          if (!f.ascended && f.meter >= ASCEND_COST) { f.meter -= ASCEND_COST; f.set('ascending'); f.vel = v3(); this.emit({ t: 'ascend', who: f.side }); break; }
          if (f.ascended && f.meter >= APEX_COST - 1) { /* -1: ascension drains a sliver each tick */ f.meter = 0; f.set('apex'); f.vel = v3(); this.emit({ t: 'apexStart', who: f.side }); break; }
        }
        if (inp.guard && f.state !== 'charge') { if (f.state !== 'guard') f.set('guard'); f.vel.x *= 0.7; f.vel.z *= 0.7; if (f.flying) f.vel.y *= 0.7; break; }
        if (f.state === 'guard') f.set('idle');
        if (f.state === 'charge') {
          if (!inp.dash || stick > 0.3) { f.set('idle'); this.emit({ t: 'chargeEnd', who: f.side }); }
          else { f.meter = Math.min(MAX_METER, f.meter + CHARGE_RATE * f.style.regen * DT); f.vel = v3(); break; }
        }
        // attack: tap = combo (lunging in from range), hold = guard-breaking smash
        if (heldFor.atk > 0 && release('atk') && heldFor.atk < HOLD) { this.startAttack(f, o, 'combo'); break; }
        if (inp.atk && f.hold.atk >= HOLD && !f.used.atk) { f.used.atk = true; this.startAttack(f, o, 'smash'); break; }
        // blast: tap = projectile, hold = beam
        if (heldFor.blast > 0 && release('blast') && heldFor.blast < HOLD) { this.fireBlast(f, o, blast); break; }
        if (inp.blast && f.hold.blast >= HOLD && !f.used.blast && f.meter >= beam.cost) { f.used.blast = true; f.set('beamcharge'); f.vel = v3(); this.emit({ t: 'beamCharge', who: f.side }); break; }
        // dash with the stick, dash in (tap, no stick) or charge aura (hold, no stick)
        if (press('dash')) {
          if (stick > 0.3) {
            const dir = norm(v3(f.face.x * inp.my + right.x * inp.mx, 0, f.face.z * inp.my + right.z * inp.mx));
            f.dashDir = dir; f.set('dash'); this.emit({ t: 'dash', who: f.side }); break;
          }
          f.pendingDash = true;
        }
        if (f.pendingDash && release('dash') && heldFor.dash < 10) { f.pendingDash = false; f.after = null; f.set('dashin'); this.emit({ t: 'dash', who: f.side }); break; }
        if (f.pendingDash && inp.dash && f.hold.dash >= 10 && stick < 0.3) { f.pendingDash = false; f.set('charge'); this.emit({ t: 'charge', who: f.side }); break; }
        if (!inp.dash) f.pendingDash = false;
        // jump / fly / drop
        if (press('jump') && f.onGround) { f.vel.y = SPEED.jump; f.flying = true; f.dropping = false; f.jumpTick = this.tick; this.emit({ t: 'jump', who: f.side }); }
        else if (release('jump') && heldFor.jump < 10 && f.flying && this.tick - (f.jumpTick || 0) > 12) f.dropping = true; // tap in the air = drop
        if (inp.jump && f.hold.jump > 6) f.dropping = false;
        // movement relative to the lock-on (forward = toward the rival)
        const sp = SPEED.move * speedMul;
        f.vel.x = (f.face.x * inp.my + right.x * inp.mx) * sp;
        f.vel.z = (f.face.z * inp.my + right.z * inp.mx) * sp;
        if (f.flying) {
          if (f.dropping) f.vel.y = -SPEED.drop;
          else if (inp.jump && f.hold.jump > 6) f.vel.y = SPEED.rise * speedMul;
          else if (f.vel.y > 0 && f.pos.y < 5) { /* still rising from the jump */ }
          else if (inp.my > 0.3) f.vel.y = clamp((o.pos.y - f.pos.y) * 2, -SPEED.fly, SPEED.fly) * inp.my; // fly toward them in 3D
          else f.vel.y *= 0.8;
        }
        break;
      }
      case 'dash': {
        f.vel = v3(f.dashDir.x * SPEED.dash * speedMul, f.flying ? f.vel.y * 0.5 : f.vel.y, f.dashDir.z * SPEED.dash * speedMul);
        if (press('atk')) {
          const rush = RUSHES[f.spec.moves.rush];
          if (f.meter >= rush.cost) { f.meter -= rush.cost; this.startRush(f); break; }
          this.startAttack(f, o, 'combo'); break;
        }
        if (f.t >= DASH_FRAMES) f.set('idle');
        break;
      }
      case 'dashin': { // close the gap in 3D, then (maybe) attack
        const dist = len(sub(o.chest, f.chest));
        const dir = f.aim;
        f.vel = v3(dir.x * SPEED.dashIn * speedMul, dir.y * SPEED.dashIn * speedMul, dir.z * SPEED.dashIn * speedMul);
        if (dir.y > 0.2 || f.pos.y > 0.5) f.flying = true;
        if (press('atk') && !f.after) f.after = 'combo';
        if (dist < 2.3 || f.t >= DASH_IN_MAX) {
          f.vel = v3(f.vel.x * 0.1, f.vel.y * 0.1, f.vel.z * 0.1);
          if (f.after === 'combo' || f.after === 'smash') this.beginMelee(f, f.after === 'smash' ? 'smash' : COMBO[0], 0);
          else f.set('idle');
        }
        break;
      }
      case 'attack': {
        const m = MELEE[f.move];
        if (f.move !== 'smash' && (press('atk') || release('atk'))) f.queued = true;
        if (f.t < m.startup) { f.vel = v3(f.aim.x * 5, f.flying ? f.aim.y * 5 : f.vel.y, f.aim.z * 5); }
        else { f.vel.x *= 0.7; f.vel.z *= 0.7; if (f.flying) f.vel.y *= 0.7; }
        // combo chain: cancel into the next hit once this one has been active
        if (f.queued && f.t >= m.startup + m.active && f.move !== 'smash' && f.step < COMBO.length - 1) { this.beginMelee(f, COMBO[f.step + 1], f.step + 1); break; }
        if (f.t >= m.startup + m.active + m.recovery) f.set('idle');
        break;
      }
      case 'rush': {
        const m = MELEE.rush, rush = RUSHES[f.spec.moves.rush];
        const dist = len(sub(o.chest, f.chest));
        if (f.rushT < 0 && f.t < 22 && dist > 2.0) { // charge in
          f.vel = v3(f.aim.x * 42, f.aim.y * 42, f.aim.z * 42);
          if (f.aim.y > 0.2) f.flying = true;
        } else {
          if (f.rushT < 0) f.rushT = f.t; // strikes start now
          // stay on top of the target through the flurry
          f.vel = dist > 1.8 ? v3(f.aim.x * 20, f.aim.y * 20, f.aim.z * 20) : v3();
          const k = f.t - f.rushT;
          const hits = m.hits + (rush.extraHit ? 1 : 0);
          if (k % m.every === 0 && f.rushHits < hits) {
            f.rushHits++; // a whiffed strike still counts, so the rush always ends
            const last = f.rushHits === hits;
            if (dist < 3.2) this.applyHit(f, o, { dmg: m.dmg * rush.dmgMul * (last ? 2.4 : 1), stun: last ? 34 : m.stun, kb: last ? [30, 10] : m.kb, launch: last, meter: 0, kind: 'rush', noBlink: f.rushHits > 1 });
          }
          if (k >= (hits - 1) * m.every + m.recovery) f.set('idle');
        }
        break;
      }
      case 'blastrec': if (f.t >= 8) f.set('idle'); f.vel.x *= 0.8; f.vel.z *= 0.8; break;
      case 'beamcharge': {
        f.vel = v3();
        if (release('blast') || f.t >= 70) {
          if (f.meter >= beam.cost) { f.meter -= beam.cost; this.fireBeam(f, o, beam); f.set('beam'); }
          else f.set('idle');
        }
        break;
      }
      case 'beam': { f.vel = v3(); if (f.t >= beam.ticks * beam.every + 28) f.set('idle'); break; }
      case 'stun': case 'guardstun': {
        // combo breaker: tap guard to blink out (costs a blink and aura)
        if (f.state === 'stun' && press('guard') && f.blink > 0 && f.meter >= 20) { f.meter -= 20; this.blinkBehind(f, o, true); break; }
        if (--f.stun <= 0) f.set('idle');
        break;
      }
      case 'launched': {
        if (press('guard') && f.blink > 0 && f.meter >= 20 && f.t > 6) { f.meter -= 20; f.flying = true; this.blinkBehind(f, o, true); break; }
        break;
      }
      case 'down': f.vel = v3(); if (f.t >= 40) f.set('idle'); break;
      case 'blinking': f.vel = v3(); if (f.t >= 9) f.set('idle'); break;
      case 'ascending': f.vel = v3(); if (f.t >= ASCEND_FRAMES) { f.ascended = true; f.set('idle'); this.emit({ t: 'ascended', who: f.side }); } break;
      case 'apex': {
        f.vel = v3();
        if (f.t === 40) this.fireApex(f, o);
        if (f.t >= 70) { f.set('idle'); f.ascended = false; this.emit({ t: 'descend', who: f.side, quiet: true }); } // the finisher spends the transformation
        break;
      }
      default: if (f.t > 60) f.set('idle');
    }
    f.prev = { ...inp };
  }

  startAttack(f, o, kind) {
    const dist = len(sub(o.chest, f.chest));
    if (dist > LUNGE_RANGE) { f.after = kind; f.set('dashin'); this.emit({ t: 'dash', who: f.side }); return; }
    this.beginMelee(f, kind === 'smash' ? 'smash' : COMBO[0], 0);
  }
  beginMelee(f, move, step) {
    f.move = move; f.step = step; f.queued = false; f.hit = false;
    f.set('attack');
    this.emit({ t: 'swing', who: f.side, move });
  }
  startRush(f) { f.set('rush'); f.rushHits = 0; f.rushT = -1; this.emit({ t: 'rush', who: f.side }); }

  fireBlast(f, o, B) {
    if (f.cd > 0 || f.meter < B.cost) return;
    f.meter -= B.cost; f.cd = B.cd;
    for (let i = 0; i < B.count; i++) {
      const spread = B.count > 1 ? (i - (B.count - 1) / 2) * 0.22 : 0;
      const c = Math.cos(spread), s = Math.sin(spread);
      const dir = norm(v3(f.aim.x * c - f.aim.z * s, f.aim.y, f.aim.x * s + f.aim.z * c));
      const p = f.chest;
      this.projectiles.push({ id: this.nextId++, owner: f.side, kind: f.spec.moves.blast, pos: v3(p.x + dir.x, p.y + dir.y, p.z + dir.z), vel: v3(dir.x * B.speed, dir.y * B.speed, dir.z * B.speed), speed: B.speed, radius: B.radius, dmg: B.dmg * f.style.blast * (f.ascended ? 1.2 : 1), home: B.home, life: 150, stun: 12, kb: 3 });
    }
    f.set('blastrec');
    this.emit({ t: 'blast', who: f.side, kind: f.spec.moves.blast });
  }

  fireBeam(f, o, B) {
    const p = f.chest;
    this.beams.push({ id: this.nextId++, owner: f.side, kind: f.spec.moves.beam, origin: v3(p.x + f.aim.x * 0.8, p.y + f.aim.y * 0.8, p.z + f.aim.z * 0.8), dir: f.aim, len: 0, speed: B.speed, width: B.width, dmg: B.dmg * f.style.blast * (f.ascended ? 1.2 : 1), ticks: B.ticks, every: B.every, timer: 0, hits: 0, life: B.ticks * B.every + 24, blinked: false });
    this.emit({ t: 'beam', who: f.side, kind: f.spec.moves.beam });
  }

  fireApex(f, o) {
    const A = APEXES[f.spec.moves.apex];
    const dmg = A.dmg * (f.style.blast + f.style.melee) / 2;
    this.emit({ t: 'apex', who: f.side, kind: f.spec.moves.apex });
    if (A.kind === 'beam') {
      const p = f.chest;
      this.beams.push({ id: this.nextId++, owner: f.side, kind: 'apex', origin: v3(p.x, p.y, p.z), dir: f.aim, len: 0, speed: A.speed * 1.4, width: A.radius, dmg: dmg / 6, ticks: 6, every: 6, timer: 0, hits: 0, life: 60, apex: true });
    } else if (A.kind === 'rain') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r = 2 + (i % 3);
        const start = v3(o.pos.x + Math.cos(a) * r, Math.min(ARENA.ceiling, o.pos.y + 30 + i * 3), o.pos.z + Math.sin(a) * r);
        const dir = norm(sub(o.chest, start));
        this.projectiles.push({ id: this.nextId++, owner: f.side, kind: 'star', pos: start, vel: v3(dir.x * A.speed, dir.y * A.speed, dir.z * A.speed), speed: A.speed, radius: A.radius, dmg: dmg / 8, home: 2.2, life: 120, stun: 20, kb: 6, apex: true });
      }
    } else {
      const p = f.chest;
      this.projectiles.push({ id: this.nextId++, owner: f.side, kind: 'nova', pos: v3(p.x, p.y + 4, p.z), vel: v3(f.aim.x * A.speed, f.aim.y * A.speed, f.aim.z * A.speed), speed: A.speed, radius: A.radius, dmg, home: 1.4, life: 160, stun: 40, kb: 30, apex: true });
    }
  }

  // ---------------------------------------------------------------- hits
  invulnerable(f) {
    if (f.comboHits >= MAX_COMBO_HITS && (f.state === 'launched' || f.state === 'stun')) return true; // combo cap: no infinites
    return ['down', 'blinking', 'ascending', 'ko'].includes(f.state) || (f.state === 'apex' && f.t < 40);
  }
  canBlink(f) { return f.blink > 0 && this.tick - f.guardPress <= BLINK_WINDOW && ['idle', 'guard', 'charge', 'dash', 'blastrec', 'dashin'].includes(f.state); }

  blinkBehind(f, a, breaker = false) {
    f.blink--; f.blinkT = 0;
    const back = norm(v3(a.face.x, 0, a.face.z));
    f.pos = v3(a.pos.x - back.x * 2.4, a.pos.y, a.pos.z - back.z * 2.4);
    this.clampArena(f);
    f.vel = v3(); f.stun = 0; f.comboHits = 0;
    f.set('blinking');
    if (!breaker && a.state === 'attack') a.t = Math.max(a.t, 0) - 10; // attacker left hanging a little longer
    this.emit({ t: 'blink', who: f.side, breaker });
  }

  // Applies one hit from attacker a to defender d. Returns 'hit' | 'guard' | 'blink' | 'miss'.
  applyHit(a, d, h) {
    if (this.invulnerable(d)) return 'miss';
    if (!h.noBlink && this.canBlink(d)) { this.blinkBehind(d, a); return 'blink'; }
    const pos = d.chest;
    if (d.state === 'guard' || d.state === 'guardstun') {
      if (h.breaker) {
        d.set('stun'); d.stun = 40;
        this.hitstop = HITSTOP.heavy;
        this.emit({ t: 'guardbreak', who: d.side, x: pos.x, y: pos.y, z: pos.z });
        return 'hit';
      }
      const chip = h.dmg * (h.apex ? 0.35 : h.kind === 'blast' ? 0.25 : 0.15);
      this.damage(a, d, chip);
      d.set('guardstun'); d.stun = 8;
      d.vel = v3(a.aim.x * 4, 0, a.aim.z * 4);
      a.meter = Math.min(MAX_METER, a.meter + 1); d.meter = Math.min(MAX_METER, d.meter + 2);
      this.emit({ t: 'guard', who: d.side, x: pos.x, y: pos.y, z: pos.z });
      return 'guard';
    }
    if (d.state !== 'stun' && d.state !== 'launched') d.comboHits = 0; // a fresh hit starts a fresh combo
    const scale = Math.max(0.4, 1 - SCALING * d.comboHits);
    const dmg = h.dmg * scale * (h.kind === 'melee' || h.kind === 'rush' ? a.style.melee * (a.ascended ? 1.2 : 1) : 1);
    d.comboHits++;
    this.damage(a, d, dmg);
    if (this.over) return 'hit';
    const launch = h.launch || d.comboHits >= MAX_COMBO_HITS;
    const dir = a.aim;
    d.vel = v3(dir.x * h.kb[0], dir.y * h.kb[0] + h.kb[1], dir.z * h.kb[0]);
    if (launch) { d.set('launched'); d.flying = d.pos.y > 0.5 || h.kb[1] > 0; }
    else { d.set('stun'); d.stun = h.stun; }
    a.meter = Math.min(MAX_METER, a.meter + (h.meter || 0));
    d.meter = Math.min(MAX_METER, d.meter + 2);
    this.hitstop = Math.max(this.hitstop, h.apex ? HITSTOP.apex : launch ? HITSTOP.heavy : HITSTOP.light);
    this.emit({ t: 'hit', who: d.side, by: a.side, x: pos.x, y: pos.y, z: pos.z, dmg: Math.round(dmg), heavy: launch, apex: !!h.apex, kind: h.kind, combo: d.comboHits });
    return 'hit';
  }

  damage(a, d, dmg) {
    d.hp = Math.max(0, d.hp - dmg);
    if (d.hp <= 0 && !this.over) {
      d.set('ko'); d.flying = false;
      this.emit({ t: 'ko', who: d.side });
      this.finish(a.side, 'ko');
    }
  }

  resolveMelee() { // find both fighters' hits first, then apply them: trades are fair to both sides
    const hits = [];
    for (const a of this.f) {
      if (a.state !== 'attack' || a.hit) continue;
      const m = MELEE[a.move];
      if (a.t < m.startup || a.t >= m.startup + m.active) continue;
      const d = this.other(a);
      const c = a.chest;
      const p = v3(c.x + a.aim.x * REACH, c.y + a.aim.y * REACH, c.z + a.aim.z * REACH);
      if (segDist(p, d.capA, d.capB) > HIT_RADIUS + BODY.radius) continue;
      hits.push([a, d, m]);
    }
    for (const [a, d, m] of hits) { a.hit = true; if (!this.over) this.applyHit(a, d, { ...m, kind: 'melee' }); }
  }

  // ---------------------------------------------------------------- projectiles & beams
  updateProjectiles() {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      const t = this.f[1 - p.owner];
      const want = norm(sub(t.chest, p.pos));
      const cur = norm(p.vel);
      const k = Math.min(1, p.home * DT);
      const nd = norm(v3(cur.x + (want.x - cur.x) * k, cur.y + (want.y - cur.y) * k, cur.z + (want.z - cur.z) * k));
      p.vel = v3(nd.x * p.speed, nd.y * p.speed, nd.z * p.speed);
      p.pos = v3(p.pos.x + p.vel.x * DT, p.pos.y + p.vel.y * DT, p.pos.z + p.vel.z * DT);
      if (--p.life <= 0 || p.pos.y < -1 || Math.hypot(p.pos.x, p.pos.z) > ARENA.radius) { p.dead = true; continue; }
      for (const pl of this.pillars) {
        if (p.pos.y < pl.h && Math.hypot(p.pos.x - pl.x, p.pos.z - pl.z) < pl.r) { p.dead = true; this.emit({ t: 'pop', x: p.pos.x, y: p.pos.y, z: p.pos.z, apex: !!p.apex }); break; }
      }
      if (p.dead) continue;
      if (segDist(p.pos, t.capA, t.capB) < p.radius + BODY.radius) {
        const owner = this.f[p.owner];
        const r = this.applyHit(owner, t, { dmg: p.dmg, stun: p.stun, kb: [p.kb, p.apex ? 8 : 0.5], launch: !!p.apex, kind: 'blast', apex: !!p.apex, meter: 1 });
        if (r !== 'miss') { p.dead = true; this.emit({ t: 'pop', x: p.pos.x, y: p.pos.y, z: p.pos.z, apex: !!p.apex }); }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  updateBeams() {
    for (const b of this.beams) {
      const owner = this.f[b.owner], t = this.f[1 - b.owner];
      b.life--;
      b.len = Math.min(170, b.len + b.speed * DT);
      if (b.life <= 0 || (!b.apex && owner.state !== 'beam') || owner.state === 'ko') { b.dead = true; continue; }
      if (b.hits >= b.ticks) continue;
      if (++b.timer < b.every) continue;
      const end = v3(b.origin.x + b.dir.x * b.len, b.origin.y + b.dir.y * b.len, b.origin.z + b.dir.z * b.len);
      if (segSeg(b.origin, end, t.capA, t.capB) < b.width + BODY.radius) {
        b.timer = 0;
        const last = b.hits === b.ticks - 1;
        const r = this.applyHit(owner, t, { dmg: b.dmg, stun: 14, kb: last ? [24, 6] : [2, 0], launch: last, kind: 'blast', apex: !!b.apex, meter: 1, noBlink: b.hits > 0 });
        if (r === 'blink') { b.hits = b.ticks; continue; }
        if (r !== 'miss') b.hits++;
      }
    }
    this.beams = this.beams.filter((b) => !b.dead);
  }

  // ---------------------------------------------------------------- physics
  physics(f, o) {
    if (f.state === 'launched' || f.state === 'ko') {
      f.vel.x *= 0.965; f.vel.z *= 0.965;
      if (!f.flying || f.state === 'ko') f.vel.y -= SPEED.gravity * DT; else f.vel.y *= 0.965;
    } else if (!f.flying && f.pos.y > 0) {
      f.vel.y -= SPEED.gravity * DT;
    }
    f.pos = v3(f.pos.x + f.vel.x * DT, f.pos.y + f.vel.y * DT, f.pos.z + f.vel.z * DT);
    if (f.pos.y <= 0) {
      const impact = -f.vel.y;
      f.pos.y = 0;
      if (f.state === 'launched' && (impact > 12 || Math.hypot(f.vel.x, f.vel.z) > 6)) { f.set('down'); this.emit({ t: 'land', who: f.side, hard: true, x: f.pos.x, z: f.pos.z }); }
      else if (f.state === 'launched') { f.set('stun'); f.stun = 12; }
      else if (f.flying && f.vel.y < 0) { this.emit({ t: 'land', who: f.side, hard: false, x: f.pos.x, z: f.pos.z }); }
      if (f.vel.y < 0) f.vel.y = 0;
      f.flying = false; f.dropping = false;
    }
    if (f.pos.y > ARENA.ceiling) { f.pos.y = ARENA.ceiling; if (f.vel.y > 0) f.vel.y = 0; }
    if (f.state === 'launched' && f.t > 6 && Math.hypot(f.vel.x, f.vel.y, f.vel.z) < 5 && f.pos.y > 0.3) { f.set('idle'); f.flying = true; } // recover in the air
    if (f.state === 'launched' && f.t > 70) { f.set('idle'); f.flying = f.pos.y > 0.3; }
    // rock pillars
    for (const pl of this.pillars) {
      if (f.pos.y >= pl.h) continue;
      const dx = f.pos.x - pl.x, dz = f.pos.z - pl.z, dd = Math.hypot(dx, dz), min = pl.r + BODY.radius;
      if (dd >= min) continue;
      const k = (dd || 1);
      f.pos.x = pl.x + (dx / k) * min; f.pos.z = pl.z + (dz / k) * min;
      if (f.state === 'launched' && Math.hypot(f.vel.x, f.vel.z) > 15) {
        this.damage(o, f, 40);
        this.emit({ t: 'crash', who: f.side, x: f.pos.x, y: f.pos.y + 1, z: f.pos.z });
        f.vel = v3(0, f.vel.y, 0);
      }
    }
    this.clampArena(f);
  }

  clampArena(f) {
    const r = Math.hypot(f.pos.x, f.pos.z);
    if (r > ARENA.radius) { f.pos.x *= ARENA.radius / r; f.pos.z *= ARENA.radius / r; f.vel.x *= -0.3; f.vel.z *= -0.3; }
    f.pos.y = clamp(f.pos.y, 0, ARENA.ceiling);
  }

  separate() {
    const [a, b] = this.f;
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (Math.abs(dy) > 1.6 || d >= 1.1) return;
    const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0, push = (1.1 - d) / 2;
    a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push;
    this.clampArena(a); this.clampArena(b);
  }

  // Compact state for the renderer and HUD.
  view() {
    return {
      tick: this.tick, timer: this.timer, over: this.over, winner: this.winner, hitstop: this.hitstop,
      f: this.f.map((f) => ({ side: f.side, pos: { ...f.pos }, vel: { ...f.vel }, face: { ...f.face }, aim: { ...f.aim }, state: f.state, t: f.t, move: f.move, step: f.step, hp: f.hp, maxHp: f.maxHp, meter: f.meter, blink: f.blink, ascended: f.ascended, flying: f.flying, spec: f.spec })),
      projectiles: this.projectiles.map((p) => ({ id: p.id, owner: p.owner, kind: p.kind, pos: { ...p.pos }, radius: p.radius, apex: !!p.apex })),
      beams: this.beams.map((b) => ({ id: b.id, owner: b.owner, kind: b.kind, origin: { ...b.origin }, dir: { ...b.dir }, len: b.len, width: b.width, apex: !!b.apex })),
    };
  }
}
