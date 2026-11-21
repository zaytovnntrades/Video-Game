// Fighter spec: one versioned JSON object describes a custom fighter.
// Everything visual is cosmetic (the hit volume is fixed); style and moves are
// balanced sidegrades. sanitizeSpec() makes any input (saved, shared, random) safe.
import { STYLE_KEYS, BLASTS, BEAMS, RUSHES, APEXES } from './data.js';
import { mulberry32 } from './rng.js';

export const SPEC_VERSION = 1;

export const OPTIONS = {
  hairStyle: ['Spiked Crown', 'Swept Back', 'Long Spikes', 'Wild Mane', 'Topknot', 'Buzz Cut', 'Side Fringe', 'Ponytail', 'Mohawk', 'Twin Tails', 'Shaggy', 'Bald'],
  eyes: ['Sharp', 'Round', 'Narrow', 'Fierce'],
  brows: ['Straight', 'Arched', 'Angry', 'Thin'],
  marks: ['None', 'Scar', 'Cheek Stripes', 'Freckles', 'Brow Tattoo'],
  ears: ['Round', 'Pointed'],
  top: ['Wrap Gi', 'Sleeveless Gi', 'Jacket', 'Vest', 'Tank', 'Hoodie', 'Armor'],
  bottom: ['Gi Pants', 'Baggy', 'Fitted', 'Shorts'],
  feet: ['Boots', 'Wraps', 'Sneakers', 'Sandals'],
  hands: ['Bare', 'Wraps', 'Gloves', 'Gauntlets'],
  accessory: ['None', 'Scarf', 'Cape', 'Shoulder Guard', 'Cloth Headband', 'Belt Pouch'],
};

export const PALETTE = {
  skin: ['#f6d7c2', '#eec4a4', '#d9a47c', '#b97b52', '#8d5a3b', '#5e3a26', '#9fc8a8', '#a9b8e8'],
  hair: ['#1d1b22', '#4a2f1f', '#a0522d', '#d9a441', '#e8e2d6', '#c0392b', '#2e86de', '#8e44ad', '#16a085', '#ff7ab6'],
  cloth: ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#3d3d8f', '#8e44ad', '#2c2c34', '#ecf0f1', '#7f8c8d', '#6d4c2f', '#b03a6b', '#0e5a8a'],
  aura: ['#4fc3ff', '#7cff6b', '#ff5a5a', '#c77dff', '#ff9f1c', '#ffffff', '#ff4fd8', '#2effc4', '#ffd23f'],
  eye: ['#3b2a20', '#2e6b3a', '#2a5f9e', '#8a2be2', '#c0392b', '#d4a017', '#1d1b22'],
};

const HEX = /^#[0-9a-f]{6}$/i;
const col = (v, def) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : def);
const num = (v, lo, hi, def) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; };
const idx = (v, list, def = 0) => { v = Math.floor(Number(v)); return v >= 0 && v < list.length ? v : def; };
const key = (v, obj, def) => (Object.prototype.hasOwnProperty.call(obj, v) ? v : def);

export function defaultSpec() {
  return {
    v: SPEC_VERSION, name: 'Rookie',
    body: { height: 0.5, build: 0.5, shoulders: 0.5, skin: '#eec4a4' },
    face: { eyes: 0, eyeColor: '#2a5f9e', brows: 0, marks: 0, ears: 0 },
    hair: { style: 1, color: '#1d1b22', ascend: '#e8f4ff' },
    outfit: {
      top: 0, topColor: '#3d3d8f', topAccent: '#ecf0f1', bottom: 0, bottomColor: '#2c2c34', sash: '#c0392b',
      feet: 0, feetColor: '#1d1b22', hands: 1, handsColor: '#ecf0f1', accessory: 0, accessoryColor: '#c0392b',
    },
    aura: { color: '#4fc3ff', ascend: '#c77dff' },
    style: 'striker',
    moves: { blast: 'volley', beam: 'lance', rush: 'meteor', apex: 'supernova' },
  };
}

export function sanitizeSpec(s) {
  const d = defaultSpec();
  s = s && typeof s === 'object' ? s : {};
  const b = s.body || {}, f = s.face || {}, h = s.hair || {}, o = s.outfit || {}, a = s.aura || {}, m = s.moves || {};
  let name = String(s.name == null ? '' : s.name).replace(/[^\p{L}\p{N} \-']/gu, '').trim().slice(0, 14);
  if (!name) name = d.name;
  return {
    v: SPEC_VERSION, name,
    body: { height: num(b.height, 0, 1, 0.5), build: num(b.build, 0, 1, 0.5), shoulders: num(b.shoulders, 0, 1, 0.5), skin: col(b.skin, d.body.skin) },
    face: { eyes: idx(f.eyes, OPTIONS.eyes), eyeColor: col(f.eyeColor, d.face.eyeColor), brows: idx(f.brows, OPTIONS.brows), marks: idx(f.marks, OPTIONS.marks), ears: idx(f.ears, OPTIONS.ears) },
    hair: { style: idx(h.style, OPTIONS.hairStyle, 1), color: col(h.color, d.hair.color), ascend: col(h.ascend, d.hair.ascend) },
    outfit: {
      top: idx(o.top, OPTIONS.top), topColor: col(o.topColor, d.outfit.topColor), topAccent: col(o.topAccent, d.outfit.topAccent),
      bottom: idx(o.bottom, OPTIONS.bottom), bottomColor: col(o.bottomColor, d.outfit.bottomColor), sash: col(o.sash, d.outfit.sash),
      feet: idx(o.feet, OPTIONS.feet), feetColor: col(o.feetColor, d.outfit.feetColor),
      hands: idx(o.hands, OPTIONS.hands, 1), handsColor: col(o.handsColor, d.outfit.handsColor),
      accessory: idx(o.accessory, OPTIONS.accessory), accessoryColor: col(o.accessoryColor, d.outfit.accessoryColor),
    },
    aura: { color: col(a.color, d.aura.color), ascend: col(a.ascend, d.aura.ascend) },
    style: STYLE_KEYS.includes(s.style) ? s.style : d.style,
    moves: { blast: key(m.blast, BLASTS, 'volley'), beam: key(m.beam, BEAMS, 'lance'), rush: key(m.rush, RUSHES, 'meteor'), apex: key(m.apex, APEXES, 'supernova') },
  };
}

const NAMES = ['Kaito', 'Rhea', 'Soren', 'Vexa', 'Bram', 'Lyra', 'Dax', 'Ines', 'Toma', 'Nyx', 'Oren', 'Sable', 'Juno', 'Riven', 'Mika', 'Zeph'];

// Random fighter from a seed (the creator's Randomize and the CPU roster).
// Steers away from famous anime looks: never gold hair together with a gold aura.
export function randomSpec(seed) {
  const R = mulberry32(seed >>> 0);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const s = {
    name: pick(NAMES),
    body: { height: R(), build: R(), shoulders: R(), skin: pick(PALETTE.skin) },
    face: { eyes: Math.floor(R() * 4), eyeColor: pick(PALETTE.eye), brows: Math.floor(R() * 4), marks: R() < 0.6 ? 0 : 1 + Math.floor(R() * 4), ears: R() < 0.8 ? 0 : 1 },
    hair: { style: Math.floor(R() * OPTIONS.hairStyle.length), color: pick(PALETTE.hair), ascend: pick(PALETTE.hair) },
    outfit: {
      top: Math.floor(R() * OPTIONS.top.length), topColor: pick(PALETTE.cloth), topAccent: pick(PALETTE.cloth),
      bottom: Math.floor(R() * OPTIONS.bottom.length), bottomColor: pick(PALETTE.cloth), sash: pick(PALETTE.cloth),
      feet: Math.floor(R() * OPTIONS.feet.length), feetColor: pick(PALETTE.cloth),
      hands: Math.floor(R() * OPTIONS.hands.length), handsColor: pick(PALETTE.cloth),
      accessory: Math.floor(R() * OPTIONS.accessory.length), accessoryColor: pick(PALETTE.cloth),
    },
    aura: { color: pick(PALETTE.aura), ascend: pick(PALETTE.aura) },
    style: pick(STYLE_KEYS),
    moves: { blast: pick(Object.keys(BLASTS)), beam: pick(Object.keys(BEAMS)), rush: pick(Object.keys(RUSHES)), apex: pick(Object.keys(APEXES)) },
  };
  const gold = (c) => c === '#d9a441' || c === '#ffd23f' || c === '#f1c40f';
  if (gold(s.hair.ascend) && gold(s.aura.ascend)) s.aura.ascend = '#c77dff';
  if (gold(s.hair.color) && gold(s.aura.color)) s.aura.color = '#4fc3ff';
  if ([0, 2, 3].includes(s.hair.style) && (gold(s.hair.color) || gold(s.hair.ascend))) { s.hair.color = gold(s.hair.color) ? '#c0392b' : s.hair.color; s.hair.ascend = gold(s.hair.ascend) ? '#e8f4ff' : s.hair.ascend; } // no golden spiky hair
  return sanitizeSpec(s);
}
