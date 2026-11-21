// Aura Ascendants: game data shared by the simulation, the CPU and the renderer.
// Units: metres and seconds. The simulation runs at 60 ticks per second; all move
// timings are in ticks ("frames"). One table drives both hit timing and the poses,
// so the visible strike frame is the hit frame.

export const TICK = 60;
export const DT = 1 / TICK;

export const ARENA = { radius: 140, ceiling: 70 };
export const BODY = { radius: 0.6, height: 1.8 }; // hit volume: identical for every fighter
export const MAX_HP = 1000;
export const MAX_METER = 100;
export const MAX_BLINK = 3;
export const ROUND_TIME = 99;

// Fighting styles: balanced sidegrades (every style totals the same budget).
export const STYLES = {
  brawler: { name: 'Brawler', blurb: 'Hits hard up close, takes hits well.', melee: 1.15, blast: 0.9, speed: 0.95, hp: 1.08, regen: 0.95 },
  striker: { name: 'Striker', blurb: 'Fast on its feet, long combos.', melee: 1.0, blast: 0.95, speed: 1.12, hp: 0.97, regen: 1.0 },
  mystic: { name: 'Mystic', blurb: 'Strong blasts, quick aura recovery.', melee: 0.9, blast: 1.18, speed: 1.0, hp: 0.95, regen: 1.15 },
};
export const STYLE_KEYS = Object.keys(STYLES);

// Melee frame data. reach: metres in front of the attacker; kb: knockback [forward, up] m/s.
export const MELEE = {
  jab: { startup: 5, active: 3, recovery: 10, dmg: 32, stun: 18, kb: [2, 0], meter: 3 },
  cross: { startup: 6, active: 3, recovery: 11, dmg: 36, stun: 19, kb: [2.5, 0], meter: 3 },
  knee: { startup: 7, active: 3, recovery: 12, dmg: 40, stun: 20, kb: [3, 1], meter: 3 },
  roundhouse: { startup: 8, active: 4, recovery: 13, dmg: 46, stun: 22, kb: [3.5, 0.5], meter: 4 },
  axe: { startup: 10, active: 4, recovery: 22, dmg: 70, stun: 34, kb: [26, 9], meter: 6, launch: true }, // combo ender
  smash: { startup: 16, active: 4, recovery: 24, dmg: 90, stun: 36, kb: [32, 12], meter: 6, launch: true, breaker: true }, // held attack
  rush: { startup: 4, active: 30, recovery: 18, dmg: 26, stun: 14, kb: [6, 1], meter: 0, hits: 6, every: 5 }, // rush special
};
export const COMBO = ['jab', 'cross', 'knee', 'roundhouse', 'axe'];
export const REACH = 1.7; // melee hit sphere centre, in front
export const HIT_RADIUS = 1.15;
export const LUNGE_RANGE = 3.2; // beyond this an attack press lunges in first
export const MAX_COMBO_HITS = 9; // forced knockback after this many hits: no infinites
export const SCALING = 0.09; // damage scale loss per hit in a combo (min 0.4)

// Choosable special moves (sidegrades). Names are original.
export const BLASTS = {
  volley: { name: 'Spark Volley', blurb: 'Fast little bolts.', dmg: 22, speed: 55, radius: 0.45, cost: 4, cd: 9, home: 0.9, count: 1 },
  orb: { name: 'Pulse Orb', blurb: 'Slow, heavy sphere.', dmg: 48, speed: 34, radius: 0.9, cost: 8, cd: 20, home: 1.6, count: 1 },
  needle: { name: 'Shard Fan', blurb: 'Three spread shards.', dmg: 14, speed: 62, radius: 0.35, cost: 7, cd: 16, home: 0.4, count: 3 },
};
export const BEAMS = {
  lance: { name: 'Lance Ray', blurb: 'Thin, very fast beam.', dmg: 34, width: 0.7, speed: 160, cost: 30, ticks: 7, every: 5 },
  wave: { name: 'Tidal Burst', blurb: 'Wide, heavy beam.', dmg: 42, width: 1.6, speed: 95, cost: 35, ticks: 7, every: 6 },
  twin: { name: 'Twin Comet', blurb: 'Two spiralling streams.', dmg: 30, width: 1.0, speed: 120, cost: 30, ticks: 9, every: 4 },
};
export const RUSHES = {
  meteor: { name: 'Meteor Drive', blurb: 'Charging punch barrage.', cost: 30, dmgMul: 1.0 },
  cyclone: { name: 'Cyclone Heel', blurb: 'Spinning kick flurry.', cost: 30, dmgMul: 0.92, extraHit: true },
};
export const APEXES = {
  supernova: { name: 'Supernova', blurb: 'A blinding sphere hurled down.', dmg: 330, speed: 40, radius: 4.0, kind: 'orb' },
  starfall: { name: 'Starfall', blurb: 'A rain of falling stars.', dmg: 300, speed: 70, radius: 2.4, kind: 'rain' },
  eclipse: { name: 'Eclipse Cannon', blurb: 'An enormous dark-light beam.', dmg: 340, speed: 120, radius: 2.8, kind: 'beam' },
};

export const SPEED = { move: 9, fly: 10, rise: 14, dash: 30, dashIn: 34, drop: 26, jump: 15, gravity: 32 };
export const DASH_FRAMES = 14;
export const DASH_IN_MAX = 40;
export const CHARGE_RATE = 24; // meter per second while charging aura
export const BLINK_WINDOW = 8; // frames: tap guard this close before a hit lands to blink
export const BLINK_REGEN = 4.5; // seconds per blink charge
export const ASCEND_COST = 50;
export const ASCEND_DRAIN = 2.2; // meter per second while ascended
export const ASCEND_FRAMES = 50;
export const APEX_COST = 100;
export const HITSTOP = { light: 4, heavy: 9, apex: 16 };
