// Game data shared by the browser client and the multiplayer server.
export const TILE = 32;
export const MAX_LEVEL = 50;
export const EVOLVE_LEVEL = 10;

export const WEAPON_ORDER = ['pistol', 'uzi', 'shotgun', 'rifle', 'rocket'];
export const WEAPONS = {
  pistol: { name: 'Pistol', dmg: 14, rate: 0.3, speed: 520, spread: 0.03, pellets: 1, life: 0.9, max: Infinity, start: Infinity, pvpStart: Infinity, cost: 0, lvl: 1 },
  uzi: { name: 'Uzi', dmg: 8, rate: 0.08, speed: 560, spread: 0.12, pellets: 1, life: 0.7, max: 300, start: 150, pvpStart: 60, cost: 150, lvl: 2 },
  shotgun: { name: 'Shotgun', dmg: 9, rate: 0.7, speed: 480, spread: 0.3, pellets: 6, life: 0.35, max: 60, start: 24, pvpStart: 8, cost: 300, lvl: 4 },
  rifle: { name: 'Rifle', dmg: 40, rate: 0.5, speed: 800, spread: 0.01, pellets: 1, life: 0.9, max: 60, start: 30, pvpStart: 6, cost: 600, lvl: 7, pierce: 3 },
  rocket: { name: 'Rocket', dmg: 90, rate: 1.1, speed: 340, spread: 0.02, pellets: 1, life: 1.4, max: 15, start: 6, pvpStart: 2, cost: 1200, lvl: 10, aoe: 70 },
};

export const ENEMY_ORDER = ['zombie', 'runner', 'brute', 'spitter'];
export const ENEMIES = {
  zombie: { name: 'Glitch', hp: 30, spd: 55, dmg: 10, r: 10, xp: 6, coins: 2, rate: 0.8 },
  runner: { name: 'Dasher', hp: 16, spd: 115, dmg: 7, r: 8, xp: 8, coins: 3, rate: 0.7 },
  brute: { name: 'Brute', hp: 220, spd: 42, dmg: 28, r: 14, xp: 40, coins: 20, rate: 1.1 },
  spitter: { name: 'Spitter', hp: 40, spd: 45, dmg: 12, r: 10, xp: 14, coins: 6, rate: 2, ranged: true, range: 260, keep: 170 },
};

export const CREATURE_ORDER = ['cindkit', 'puddlo', 'thornub'];
export const CREATURES = {
  cindkit: { name: 'Cindkit', evo: 'Blazelynx', elem: 'fire', dmg: 9, rate: 1.1, blurb: 'Fire. Hits the hardest.' },
  puddlo: { name: 'Puddlo', evo: 'Tidalor', elem: 'water', dmg: 6, rate: 1.0, blurb: 'Water. Slows what it hits.' },
  thornub: { name: 'Thornub', evo: 'Briarok', elem: 'grass', dmg: 6, rate: 1.0, blurb: 'Grass. Heals you on hit.' },
};
export const BULLET_KINDS = [...WEAPON_ORDER, 'fire', 'water', 'grass', 'spit'];

// Character customization palettes. A "look" stores an index into each list.
export const LOOK = {
  skin: ['#f6d2b0', '#e8b98a', '#c98d5e', '#8d5a3b', '#5a3a28'],
  hair: ['#2b2b33', '#6b4226', '#d9a441', '#c0392b', '#e8e8ee', '#3d6fd9'],
  style: ['Short', 'Spiky', 'Long'],
  hat: ['None', 'Cap', 'Beanie'],
  shirt: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#ecf0f1', '#34495e', '#e67e22'],
  pants: ['#2c3e50', '#4a5568', '#7f5539', '#1e8449', '#6c3483', '#95a5a6'],
};
export const LOOK_KEYS = ['skin', 'hair', 'style', 'hat', 'shirt', 'pants'];
export const STAT_KEYS = ['pow', 'vit', 'agi'];
export const STAT_MAX = 20;

export function xpNeed(level) {
  return Math.round(40 + 30 * Math.pow(level - 1, 1.5));
}

// Adds xp/coins to a profile. Returns how many levels were gained.
export function grantXp(profile, xp, coins) {
  profile.coins += Math.max(0, Math.round(coins || 0));
  let gained = 0;
  if (profile.level >= MAX_LEVEL) return 0;
  profile.xp += Math.max(0, Math.round(xp || 0));
  while (profile.level < MAX_LEVEL && profile.xp >= xpNeed(profile.level)) {
    profile.xp -= xpNeed(profile.level);
    profile.level++;
    profile.points++;
    gained++;
  }
  if (profile.level >= MAX_LEVEL) profile.xp = 0;
  return gained;
}

const int = (v, lo, hi, def) => {
  v = Math.floor(Number(v));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
};

// Never trust a loadout that came over the network: clamp everything.
export function sanitizeLoadout(l) {
  l = l && typeof l === 'object' ? l : {};
  const look = {};
  const src = l.look && typeof l.look === 'object' ? l.look : {};
  for (const k of LOOK_KEYS) look[k] = int(src[k], 0, LOOK[k].length - 1, 0);
  const level = int(l.level, 1, MAX_LEVEL, 1);
  const st = l.stats && typeof l.stats === 'object' ? l.stats : {};
  let stats = {};
  let sum = 0;
  for (const k of STAT_KEYS) {
    stats[k] = int(st[k], 0, STAT_MAX, 0);
    sum += stats[k];
  }
  if (sum > level - 1) stats = { pow: 0, vit: 0, agi: 0 };
  const owned = Array.isArray(l.weapons) ? l.weapons : [];
  const weapons = WEAPON_ORDER.filter((w) => w === 'pistol' || owned.includes(w));
  let name = String(l.name == null ? '' : l.name).replace(/[^\w \-]/g, '').trim().slice(0, 12);
  if (!name) name = 'Rookie';
  const companion = CREATURES[l.companion] ? l.companion : 'cindkit';
  return { name, look, companion, level, stats, weapons };
}

// Turns a loadout into combat numbers. PvP is normalized so matches are fair.
export function derive(l, mode) {
  const fair = mode === 'pvp';
  const lvl = fair ? 1 : l.level;
  const s = fair ? { pow: 0, vit: 0, agi: 0 } : l.stats;
  const evolved = l.level >= EVOLVE_LEVEL;
  return {
    maxHp: 100 + 10 * (lvl - 1) + 15 * s.vit,
    dmgMul: 1 + 0.03 * (lvl - 1) + 0.08 * s.pow,
    speed: 150 * (1 + 0.04 * s.agi),
    weapons: fair ? WEAPON_ORDER.slice() : l.weapons.slice(),
    petMul: fair ? 1 : (1 + 0.08 * (lvl - 1)) * (evolved ? 1.6 : 1),
    evolved,
  };
}

const QUESTS = [
  { type: 'kill', title: 'Street Sweep', goal: (t) => 8 + 3 * t, desc: (n) => `Glitches are swarming the block. Take down ${n} of them!` },
  { type: 'collect', title: 'Lost Cargo', goal: (t) => Math.min(4 + t, 8), desc: (n) => `My delivery crates got scattered. Find ${n} of them. Check your radar!` },
  { type: 'drive', title: 'Hot Wheels', goal: () => 1, desc: () => 'Grab any car and park it at the marked garage. Press A next to a car to hop in.' },
  { type: 'boss', title: 'Big Trouble', goal: () => 1, desc: () => 'A giant Brute is stomping around nearby. Bring it down!' },
];
export function questFor(num) {
  const q = QUESTS[num % QUESTS.length];
  const tier = Math.floor(num / QUESTS.length);
  const goal = q.goal(tier);
  return {
    num, type: q.type, title: q.title, tier, goal, desc: q.desc(goal),
    xp: 60 + 40 * tier + (q.type === 'boss' ? 40 : 0),
    coins: 50 + 30 * tier,
  };
}
