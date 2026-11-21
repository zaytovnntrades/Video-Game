// Fighter spec: one versioned JSON object describes a custom fighter.
// Everything visual is cosmetic (the hit volume is fixed); style and moves are
// balanced sidegrades. sanitizeSpec() makes any input (saved, shared, random, or an
// older version) safe and current. Option lists only ever grow at the END, so
// saved fighters and share codes keep their meaning.
import { STYLE_KEYS, BLASTS, BEAMS, RUSHES, APEXES } from './data.js';
import { mulberry32 } from './rng.js';

export const SPEC_VERSION = 2;

export const OPTIONS = {
  hairStyle: ['Spiked Crown', 'Swept Back', 'Long Spikes', 'Wild Mane', 'Topknot', 'Buzz Cut', 'Side Fringe', 'Ponytail', 'Mohawk', 'Twin Tails', 'Shaggy', 'Bald',
    'Braids', 'Undercut', 'Afro', 'Long Straight', 'Curly Top', 'Locs'],
  eyes: ['Sharp', 'Round', 'Narrow', 'Fierce'],
  brows: ['Straight', 'Arched', 'Angry', 'Thin'],
  marks: ['None', 'Scar', 'Cheek Stripes', 'Freckles', 'Brow Tattoo', 'War Paint', 'Tribal Lines'],
  ears: ['Round', 'Pointed'],
  facialHair: ['None', 'Stubble', 'Goatee', 'Mustache', 'Full Beard', 'Chin Strap'],
  top: ['Wrap Gi', 'Sleeveless Gi', 'Jacket', 'Vest', 'Tank', 'Hoodie', 'Armor'],
  bottom: ['Gi Pants', 'Baggy', 'Fitted', 'Shorts'],
  feet: ['Boots', 'Wraps', 'Sneakers', 'Sandals'],
  hands: ['Bare', 'Wraps', 'Gloves', 'Gauntlets'],
  accessory: ['None', 'Scarf', 'Cape', 'Shoulder Guard', 'Cloth Headband', 'Belt Pouch'],
  // creature parts (unlocked by player level, see UNLOCKS)
  animalEars: ['None', 'Wolf', 'Cat', 'Fox', 'Rabbit', 'Bear'],
  tail: ['None', 'Wolf', 'Cat', 'Fox', 'Lizard'],
  pattern: ['None', 'Stripes', 'Spots', 'Scales'],
  snout: ['None', 'Wolf', 'Cat', 'Lizard', 'Beak', 'Bear'],
  horns: ['None', 'Ram', 'Bull', 'Demon', 'Antlers'],
  fangs: ['None', 'Fangs'],
  wings: ['None', 'Feathered', 'Bat'],
  claws: ['None', 'Claws'],
};

// Player level needed to pick a creature part in the creator. Cosmetic only:
// imported fighters and CPU rivals may wear parts you haven't unlocked yet.
export const UNLOCKS = { animalEars: 2, tail: 2, pattern: 3, snout: 4, horns: 5, fangs: 5, wings: 7, claws: 7 };
export const STAGE_NAMES = ['Base', 'Ascend I', 'Ascend II', 'Ascend III'];

export const PALETTE = {
  skin: ['#f6d7c2', '#eec4a4', '#d9a47c', '#b97b52', '#8d5a3b', '#5e3a26', '#9fc8a8', '#a9b8e8'],
  hair: ['#1d1b22', '#4a2f1f', '#a0522d', '#d9a441', '#e8e2d6', '#c0392b', '#2e86de', '#8e44ad', '#16a085', '#ff7ab6'],
  cloth: ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#3d3d8f', '#8e44ad', '#2c2c34', '#ecf0f1', '#7f8c8d', '#6d4c2f', '#b03a6b', '#0e5a8a'],
  aura: ['#4fc3ff', '#7cff6b', '#ff5a5a', '#c77dff', '#ff9f1c', '#ffffff', '#ff4fd8', '#2effc4', '#ffd23f'],
  eye: ['#3b2a20', '#2e6b3a', '#2a5f9e', '#8a2be2', '#c0392b', '#d4a017', '#1d1b22'],
  fur: ['#8a6a4a', '#3b2f2a', '#c9a27a', '#e8e2d6', '#a0522d', '#5c5c66', '#2d4b3a', '#7a3b8f'],
};
export const GOLD = ['#d9a441', '#ffd23f', '#f1c40f'];
const isGold = (c) => GOLD.includes(c);

const HEX = /^#[0-9a-f]{6}$/i;
const col = (v, def) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : def);
const num = (v, lo, hi, def) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };
const idx = (v, list, def = 0) => { v = Math.floor(Number(v)); return v >= 0 && v < list.length ? v : def; };
const key = (v, obj, def) => (Object.prototype.hasOwnProperty.call(obj, v) ? v : def);

export function defaultTransforms() {
  return [
    { hair: '#e8f4ff', aura: '#c77dff', eyes: '#c77dff' },
    { hair: '#bff3ff', aura: '#4fc3ff', eyes: '#9ff3ff' },
    { hair: '#ffffff', aura: '#ff4fd8', eyes: '#ff9ff0' },
  ];
}

export function defaultSpec() {
  return {
    v: SPEC_VERSION, name: 'Rookie',
    body: { height: 0.5, build: 0.5, shoulders: 0.5, skin: '#eec4a4' },
    face: { eyes: 0, eyeColor: '#2a5f9e', brows: 0, marks: 0, ears: 0, facialHair: 0 },
    hair: { style: 1, color: '#1d1b22' },
    outfit: {
      top: 0, topColor: '#3d3d8f', topAccent: '#ecf0f1', bottom: 0, bottomColor: '#2c2c34', sash: '#c0392b',
      feet: 0, feetColor: '#1d1b22', hands: 1, handsColor: '#ecf0f1', accessory: 0, accessoryColor: '#c0392b',
    },
    aura: { color: '#4fc3ff' },
    transforms: defaultTransforms(),
    creature: { animalEars: 0, tail: 0, pattern: 0, snout: 0, horns: 0, fangs: 0, wings: 0, claws: 0, fur: '#8a6a4a', markColor: '#2a1a10' },
    style: 'striker',
    moves: { blast: 'volley', beam: 'lance', rush: 'meteor', apex: 'supernova' },
  };
}

export function sanitizeSpec(s) {
  const d = defaultSpec();
  s = s && typeof s === 'object' ? s : {};
  const b = s.body || {}, f = s.face || {}, h = s.hair || {}, o = s.outfit || {}, a = s.aura || {}, m = s.moves || {}, c = s.creature || {};
  let name = String(s.name == null ? '' : s.name).replace(/[^\p{L}\p{N} \-']/gu, '').trim().slice(0, 14);
  if (!name) name = d.name;
  // v1 had a single ascended look (hair.ascend / aura.ascend): it becomes stage I
  let tf = Array.isArray(s.transforms) ? s.transforms : [];
  if (!tf.length && (h.ascend || a.ascend)) tf = [{ hair: h.ascend, aura: a.ascend, eyes: a.ascend }];
  const transforms = d.transforms.map((dt, i) => { const t = tf[i] || {}; return { hair: col(t.hair, dt.hair), aura: col(t.aura, dt.aura), eyes: col(t.eyes, dt.eyes) }; });
  const creature = {};
  for (const k of Object.keys(UNLOCKS)) creature[k] = idx(c[k], OPTIONS[k]);
  creature.fur = col(c.fur, d.creature.fur); creature.markColor = col(c.markColor, d.creature.markColor);
  return {
    v: SPEC_VERSION, name,
    body: { height: num(b.height, 0, 1, 0.5), build: num(b.build, 0, 1, 0.5), shoulders: num(b.shoulders, 0, 1, 0.5), skin: col(b.skin, d.body.skin) },
    face: { eyes: idx(f.eyes, OPTIONS.eyes), eyeColor: col(f.eyeColor, d.face.eyeColor), brows: idx(f.brows, OPTIONS.brows), marks: idx(f.marks, OPTIONS.marks), ears: idx(f.ears, OPTIONS.ears), facialHair: idx(f.facialHair, OPTIONS.facialHair) },
    hair: { style: idx(h.style, OPTIONS.hairStyle, 1), color: col(h.color, d.hair.color) },
    outfit: {
      top: idx(o.top, OPTIONS.top), topColor: col(o.topColor, d.outfit.topColor), topAccent: col(o.topAccent, d.outfit.topAccent),
      bottom: idx(o.bottom, OPTIONS.bottom), bottomColor: col(o.bottomColor, d.outfit.bottomColor), sash: col(o.sash, d.outfit.sash),
      feet: idx(o.feet, OPTIONS.feet), feetColor: col(o.feetColor, d.outfit.feetColor),
      hands: idx(o.hands, OPTIONS.hands, 1), handsColor: col(o.handsColor, d.outfit.handsColor),
      accessory: idx(o.accessory, OPTIONS.accessory), accessoryColor: col(o.accessoryColor, d.outfit.accessoryColor),
    },
    aura: { color: col(a.color, d.aura.color) },
    transforms,
    creature,
    style: STYLE_KEYS.includes(s.style) ? s.style : d.style,
    moves: { blast: key(m.blast, BLASTS, 'volley'), beam: key(m.beam, BEAMS, 'lance'), rush: key(m.rush, RUSHES, 'meteor'), apex: key(m.apex, APEXES, 'supernova') },
  };
}

// which creature parts a spec uses that need a higher level than `level`
export function lockedParts(spec, level) {
  return Object.entries(UNLOCKS).filter(([k, lv]) => spec.creature[k] > 0 && level < lv).map(([k]) => k);
}

const NAMES = ['Kaito', 'Rhea', 'Soren', 'Vexa', 'Bram', 'Lyra', 'Dax', 'Ines', 'Toma', 'Nyx', 'Oren', 'Sable', 'Juno', 'Riven', 'Mika', 'Zeph'];
const SPIKY = [0, 2, 3]; // spiked crown, long spikes, wild mane

// Random fighter from a seed (the creator's Randomize and the CPU roster).
// Steers away from famous anime looks: no gold hair with a gold aura at any stage,
// no golden spiky hair, and no tail on spiky hair.
export function randomSpec(seed, { creatures = 0.35 } = {}) {
  const R = mulberry32(seed >>> 0);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const n = (list) => Math.floor(R() * OPTIONS[list].length);
  const s = {
    name: pick(NAMES),
    body: { height: R(), build: R(), shoulders: R(), skin: pick(PALETTE.skin) },
    face: { eyes: n('eyes'), eyeColor: pick(PALETTE.eye), brows: n('brows'), marks: R() < 0.6 ? 0 : 1 + Math.floor(R() * 6), ears: R() < 0.8 ? 0 : 1, facialHair: R() < 0.6 ? 0 : 1 + Math.floor(R() * 5) },
    hair: { style: n('hairStyle'), color: pick(PALETTE.hair) },
    outfit: {
      top: n('top'), topColor: pick(PALETTE.cloth), topAccent: pick(PALETTE.cloth),
      bottom: n('bottom'), bottomColor: pick(PALETTE.cloth), sash: pick(PALETTE.cloth),
      feet: n('feet'), feetColor: pick(PALETTE.cloth),
      hands: n('hands'), handsColor: pick(PALETTE.cloth),
      accessory: n('accessory'), accessoryColor: pick(PALETTE.cloth),
    },
    aura: { color: pick(PALETTE.aura) },
    transforms: [0, 1, 2].map(() => { const au = pick(PALETTE.aura); return { hair: pick(PALETTE.hair.concat(['#e8f4ff', '#ffffff'])), aura: au, eyes: au }; }),
    creature: { fur: pick(PALETTE.fur), markColor: pick(['#2a1a10', '#1d1b22', '#6b2a1a', '#2d4b3a']) },
    style: pick(STYLE_KEYS),
    moves: { blast: pick(Object.keys(BLASTS)), beam: pick(Object.keys(BEAMS)), rush: pick(Object.keys(RUSHES)), apex: pick(Object.keys(APEXES)) },
  };
  if (R() < creatures) { // animal-people and monsters
    for (const k of Object.keys(UNLOCKS)) s.creature[k] = R() < (k === 'wings' ? 0.18 : 0.35) ? 1 + Math.floor(R() * (OPTIONS[k].length - 1)) : 0;
  }
  // originality guards
  if (isGold(s.hair.color) && isGold(s.aura.color)) s.aura.color = '#4fc3ff';
  for (const t of s.transforms) { if (isGold(t.hair) && isGold(t.aura)) t.aura = t.eyes = '#c77dff'; }
  if (SPIKY.includes(s.hair.style)) {
    if (isGold(s.hair.color)) s.hair.color = '#c0392b';
    for (const t of s.transforms) if (isGold(t.hair)) t.hair = '#e8f4ff';
    s.creature.tail = 0;
  }
  return sanitizeSpec(s);
}
