// CPU opponent: reads the fight and produces the same input struct a player would.
// Buttons are "tapped" by pressing for one tick and releasing on the next.
import { blankInput } from './fight.js';
import { mulberry32 } from './rng.js';
import { BEAMS, ASCEND_COST, APEX_COST, MELEE } from './data.js';

export const LEVELS = {
  easy: { react: 0.15, aggro: 0.35, blink: 0.05, guard: 0.2, think: 24 },
  normal: { react: 0.35, aggro: 0.55, blink: 0.18, guard: 0.4, think: 14 },
  hard: { react: 0.6, aggro: 0.75, blink: 0.4, guard: 0.6, think: 8 },
  master: { react: 0.7, aggro: 0.8, blink: 0.4, guard: 0.6, think: 6, smart: true }, // reads frame data
};
export const LEVEL_KEYS = Object.keys(LEVELS);

export class CPU {
  constructor(side, level = 'normal', seed = 7) {
    this.side = side; this.L = LEVELS[level] || LEVELS.normal;
    this.R = mulberry32((seed ^ (side * 0x5bd1)) >>> 0);
    this.plan = 'approach'; this.planT = 0;
    this.tap = null; this.holdKey = null; this.holdT = 0;
    this.strafe = this.R() < 0.5 ? -1 : 1;
  }

  // fight: the Fight instance (read only)
  think(fight) {
    const inp = blankInput();
    const me = fight.f[this.side], o = fight.f[1 - this.side];
    if (fight.over || me.state === 'ko') return inp;
    const R = this.R, L = this.L;
    const dx = o.pos.x - me.pos.x, dy = o.pos.y - me.pos.y, dz = o.pos.z - me.pos.z;
    const dist = Math.hypot(dx, dy, dz);

    // finish a held button first
    if (this.holdKey) {
      inp[this.holdKey] = true;
      if (--this.holdT <= 0) this.holdKey = null;
      return inp;
    }
    // a tap is press-one-tick, release the next: emit nothing this tick
    if (this.tap) { this.tap = null; return inp; }
    const tap = (k) => { inp[k] = true; this.tap = k; };
    const hold = (k, t) => { inp[k] = true; this.holdKey = k; this.holdT = t; };

    // master: read the opponent's frame data instead of guessing
    if (L.smart) {
      const free = me.state === 'idle' || me.state === 'guard';
      if (o.state === 'attack' && o.move && dist < 3.8 && free) {
        const m = MELEE[o.move], until = m.startup - o.t;
        if (until >= 1 && until <= 4 && me.blink > 0 && (o.move === 'smash' || o.move === 'axe' || R() < 0.35)) { tap('guard'); return inp; } // blink the big ones
        if (until > 0 && o.move !== 'smash' && R() < 0.85) { hold('guard', until + m.active + 2); return inp; }
      }
      if (free && fight.beams.some((b) => b.owner === o.side) && R() < 0.7) { inp.mx = this.strafe; inp.my = 0; tap('dash'); return inp; } // sidestep beams
      if (me.state === 'stun' && me.comboHits >= 4 && me.blink > 0 && me.meter >= 20 && R() < 0.5) { tap('guard'); return inp; } // break real combos only
    }
    // defence: react to incoming attacks
    const threatened = (o.state === 'attack' && dist < 4) || o.state === 'rush' || fight.beams.some((b) => b.owner === o.side) ||
      fight.projectiles.some((p) => p.owner === o.side && Math.hypot(p.pos.x - me.pos.x, p.pos.y - me.pos.y - 1, p.pos.z - me.pos.z) < 6);
    if (!L.smart && (me.state === 'stun' || me.state === 'launched') && me.blink > 0 && me.meter >= 20 && R() < L.blink * 0.15) { tap('guard'); return inp; }
    if (threatened && ['idle', 'guard'].includes(me.state)) {
      if (me.blink > 0 && R() < L.blink * 0.5) { tap('guard'); return inp; }
      if (R() < L.guard) { hold('guard', 10 + Math.floor(R() * 14)); return inp; }
    }
    if (me.state === 'dash' && this.plan === 'rushfollow') { tap('atk'); this.plan = 'rushdown'; return inp; }
    if (me.state === 'charge') { // keep charging until full enough, unless they close in
      if (dist > (me.ascended ? 6 : 9) && me.meter < (me.ascended ? 100 : 90)) inp.dash = true;
      return inp;
    }
    if (me.state !== 'idle') { // mid-move: keep comboing if we're attacking
      if (me.state === 'attack' && me.move !== 'smash' && R() < L.aggro + 0.2) tap('atk');
      return inp;
    }

    // punish a whiffed swing while it recovers
    if (o.state === 'attack' && o.move && dist < 3.4) {
      const m = MELEE[o.move];
      if (o.t >= m.startup + m.active && R() < L.react * 0.5) { tap('atk'); return inp; }
    }
    // finisher: ascended with a full aura
    if (me.ascended && me.meter >= APEX_COST - 1 && dist < 45) { tap('special'); return inp; }
    // they're flying away from a launcher: follow up at range
    if (o.state === 'launched' && dist > 8 && me.meter >= BEAMS[me.spec.moves.beam].cost && R() < 0.5 * L.aggro) { hold('blast', 20); return inp; }
    if (o.state === 'launched' && dist > 8 && R() < 0.3) { tap('blast'); return inp; }
    // re-plan every so often
    if (--this.planT <= 0) {
      this.planT = L.think + Math.floor(R() * L.think);
      const r = R();
      if (me.ascended && me.meter >= APEX_COST - 1) this.plan = 'apex';
      else if (!me.ascended && me.meter >= ASCEND_COST + 30 && r < 0.45) this.plan = 'ascend';
      else if (me.ascended && me.meter < 99 && r < 0.75) this.plan = dist > 7 ? 'charge' : 'powerup';
      else if (me.meter < 45 && dist > 16 && r < 0.6) this.plan = 'charge';
      else if (dist > 10 && r < 0.6) this.plan = me.meter >= BEAMS[me.spec.moves.beam].cost && R() < 0.4 ? 'beam' : 'blast';
      else if (r < L.aggro + 0.25) this.plan = 'rushdown';
      else this.plan = 'strafe';
      if (R() < 0.3) this.strafe = -this.strafe;
    }

    switch (this.plan) {
      case 'apex': case 'ascend': tap('special'); this.planT = 0; break;
      case 'charge': hold('dash', 14); this.planT = 0; break; // then the 'charge' state keeps holding
      case 'beam': hold('blast', 20); this.planT = 0; break;
      case 'blast': tap('blast'); inp.mx = this.strafe; break;
      case 'rushdown':
        if (dist > 12 && R() < 0.4) { tap('dash'); break; } // dash in
        if (dist < 3.2) {
          if (me.meter >= 30 && R() < 0.12) { inp.mx = this.strafe; tap('dash'); this.plan = 'rushfollow'; this.planT = 30; break; }
          if (o.state === 'guard' && R() < 0.5) { hold('atk', 16); break; }
          tap('atk'); break;
        }
        inp.my = 1;
        if (Math.abs(dy) > 2) { if (dy > 0) inp.jump = me.onGround ? R() < 0.5 : true; }
        if (me.onGround && dy > 2 && R() < 0.2) tap('jump');
        break;
      case 'rushfollow': tap('atk'); break;
      case 'powerup': // make room to charge for the finisher
        inp.my = -1; inp.mx = this.strafe * 0.5;
        if (R() < 0.15) { tap('dash'); inp.my = -1; }
        break;
      default: // strafe
        inp.mx = this.strafe; inp.my = dist > 8 ? 0.6 : dist < 4 ? -0.6 : 0;
        if (R() < 0.04) tap('blast');
    }
    return inp;
  }
}
