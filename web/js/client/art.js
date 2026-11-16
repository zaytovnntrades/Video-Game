// Procedural pixel art. Every sprite is drawn in code at 1x and cached,
// then scaled up with smoothing off for a crisp handheld-RPG look.
import { LOOK, TILE } from '../shared/data.js';
import { T, tileAt } from '../shared/maps.js';

const OUTLINE = '#1d1a2b';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Paints a 1px dark outline around every opaque pixel.
function outline(c, color = OUTLINE) {
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h);
  const a = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 0;
  const marks = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push(x, y);
  }
  ctx.fillStyle = color;
  for (let i = 0; i < marks.length; i += 2) ctx.fillRect(marks[i], marks[i + 1], 1, 1);
  return c;
}

function sprite(w, h, draw, withOutline = true) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const R = (x, y, ww, hh, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, ww, hh); };
  draw(R, ctx);
  return withOutline ? outline(c) : c;
}

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------------- characters ----------------
// Sprite is 16x22 (2px of headroom for hats). dir: 0 down, 1 left, 2 right, 3 up.
const charCache = new Map();
export function charSprite(look, dir, frame) {
  const key = `${look.skin}${look.hair}${look.style}${look.hat}${look.shirt}${look.pants}:${dir}:${frame}`;
  let c = charCache.get(key);
  if (c) return c;
  const skin = LOOK.skin[look.skin] || LOOK.skin[0];
  const hair = LOOK.hair[look.hair] || LOOK.hair[0];
  const shirt = LOOK.shirt[look.shirt] || LOOK.shirt[0];
  const pants = LOOK.pants[look.pants] || LOOK.pants[0];
  const hat = look.hat | 0, style = look.style | 0;
  const side = dir === 1 || dir === 2;
  c = sprite(16, 22, (R) => {
    const oy = 2;
    // legs (walk cycle)
    const lA = frame === 1 ? -1 : 0, lB = frame === 2 ? -1 : 0;
    if (side) {
      R(6, 15 + oy + lA, 2, 3, pants); R(8, 15 + oy + lB, 2, 3, shade(pants, -0.25));
      R(6, 18 + oy + lA, 2, 1, '#3b3340'); R(8, 18 + oy + lB, 2, 1, '#3b3340');
    } else {
      R(5, 15 + oy, 6, 1, pants);
      R(5, 16 + oy + lA, 2, 2, pants); R(9, 16 + oy + lB, 2, 2, pants);
      R(5, 18 + oy + lA, 2, 1, '#3b3340'); R(9, 18 + oy + lB, 2, 1, '#3b3340');
    }
    // body
    R(4, 10 + oy, 8, 5, shirt);
    R(4, 14 + oy, 8, 1, shade(shirt, -0.25));
    if (!side) R(7, 10 + oy, 2, 1, shade(shirt, 0.3));
    // arms
    const swing = frame === 0 ? 0 : frame === 1 ? 1 : -1;
    if (side) {
      R(7, 11 + oy + swing, 2, 3, shade(shirt, -0.15)); R(7, 14 + oy + swing, 2, 1, skin);
    } else {
      R(3, 11 + oy + swing, 1, 3, shirt); R(12, 11 + oy - swing, 1, 3, shirt);
      R(3, 14 + oy + swing, 1, 1, skin); R(12, 14 + oy - swing, 1, 1, skin);
    }
    // head
    R(4, 2 + oy, 8, 8, skin);
    R(4, 9 + oy, 8, 1, shade(skin, -0.15));
    // face
    if (dir === 0) {
      R(5, 6 + oy, 2, 2, '#25213a'); R(9, 6 + oy, 2, 2, '#25213a');
      R(5, 6 + oy, 1, 1, '#ffffff'); R(9, 6 + oy, 1, 1, '#ffffff');
      R(4, 8 + oy, 1, 1, '#f39c9c'); R(11, 8 + oy, 1, 1, '#f39c9c');
    } else if (side) {
      const ex = dir === 1 ? 5 : 9;
      R(ex, 6 + oy, 2, 2, '#25213a'); R(ex + (dir === 1 ? 0 : 1), 6 + oy, 1, 1, '#ffffff');
    }
    // hair
    const hd = shade(hair, -0.25);
    R(3, 1 + oy, 10, 3, hair);
    if (dir === 3) R(3, 1 + oy, 10, 8, hair);
    else if (side) {
      const bx = dir === 1 ? 10 : 3;
      R(bx, 2 + oy, 3, 6, hair);
    } else {
      R(3, 4 + oy, 1, 3, hair); R(12, 4 + oy, 1, 3, hair);
      R(6, 4 + oy, 3, 1, hair);
    }
    if (style === 1) { // spiky
      R(3, 0 + oy, 2, 1, hair); R(6, -1 + oy, 2, 2, hair); R(9, -1 + oy, 2, 2, hair); R(12, 0 + oy, 1, 1, hair);
      R(7, -1 + oy, 1, 1, shade(hair, 0.3));
    } else if (style === 2) { // long
      if (dir === 3) R(3, 9 + oy, 10, 3, hair);
      else if (side) R(dir === 1 ? 10 : 3, 8 + oy, 3, 4, hd);
      else { R(2, 4 + oy, 2, 7, hair); R(12, 4 + oy, 2, 7, hair); }
    }
    R(4, 1 + oy, 6, 1, shade(hair, 0.25));
    // hats
    if (hat === 1) { // cap
      const cc = '#2bb3a3';
      R(3, 0 + oy, 10, 3, cc); R(4, -1 + oy, 8, 1, cc); R(7, 0 + oy, 2, 1, '#ffd23f');
      if (dir === 0) R(3, 3 + oy, 10, 1, shade(cc, -0.3));
      else if (dir === 1) R(1, 2 + oy, 4, 1, shade(cc, -0.3));
      else if (dir === 2) R(11, 2 + oy, 4, 1, shade(cc, -0.3));
    } else if (hat === 2) { // beanie
      const bc = '#3f7fd8';
      R(3, 0 + oy, 10, 3, bc); R(4, -1 + oy, 8, 1, bc); R(3, 2 + oy, 10, 1, shade(bc, 0.35));
      R(7, -2 + oy, 2, 1, '#f5f5f5');
    }
  });
  charCache.set(key, c);
  return c;
}

// ---------------- companion creatures (original designs) ----------------
const petCache = new Map();
export function petSprite(type, evolved, frame) {
  const key = `${type}${evolved ? 1 : 0}${frame}`;
  let c = petCache.get(key);
  if (c) return c;
  const s = evolved ? 22 : 16;
  const b = frame ? 1 : 0; // bob
  c = sprite(s, s, (R) => {
    if (type === 'cindkit') {
      const body = evolved ? '#e0632a' : '#f28a3a', belly = '#ffe1b0';
      if (!evolved) {
        R(1, 8 + b, 3, 2, body); R(1, 6 + b, 2, 2, body); R(1, 7 + b, 2, 1, '#8a3b12'); // striped tail
        R(8, 0 + b, 2, 2, '#ffd23f'); R(8, 0 + b, 1, 1, '#ff5a1f'); // ember tuft on the head
        R(4, 7 + b, 9, 6, body); R(6, 9 + b, 5, 4, belly);
        R(5, 2 + b, 8, 6, body); R(5, 1 + b, 2, 2, body); R(11, 1 + b, 2, 2, body); R(6, 2 + b, 1, 1, '#ffb1a1'); R(11, 2 + b, 1, 1, '#ffb1a1');
        R(7, 4 + b, 1, 2, '#25213a'); R(10, 4 + b, 1, 2, '#25213a'); R(8, 6 + b, 2, 1, '#c0392b');
        R(5, 13, 2, 2, shade(body, -0.2)); R(10, 13, 2, 2, shade(body, -0.2));
      } else {
        R(1, 10 + b, 4, 3, body); R(0, 7 + b, 3, 3, body); R(0, 8 + b, 3, 1, '#8a3b12'); R(2, 11 + b, 2, 1, '#8a3b12'); // striped tail
        R(5, 9 + b, 13, 8, body); R(8, 12 + b, 7, 5, belly);
        R(8, 2 + b, 11, 9, body); R(8, 0 + b, 3, 3, body); R(16, 0 + b, 3, 3, body);
        R(6, 3 + b, 3, 7, '#ff5a1f'); R(19, 3 + b, 2, 6, '#ff5a1f'); R(7, 2 + b, 2, 2, '#ffd23f'); // flame mane
        R(11, 5 + b, 2, 2, '#25213a'); R(15, 5 + b, 2, 2, '#25213a'); R(11, 5 + b, 1, 1, '#fff'); R(15, 5 + b, 1, 1, '#fff');
        R(13, 8 + b, 2, 1, '#8a1f12');
        R(6, 17, 3, 3, shade(body, -0.25)); R(14, 17, 3, 3, shade(body, -0.25));
      }
    } else if (type === 'puddlo') {
      const body = evolved ? '#2f7fd6' : '#58a9ef', belly = '#d4f1ff';
      if (!evolved) {
        R(8, 2 + b, 1, 1, '#2a5b9a'); R(7, 0 + b, 3, 2, '#bff0ff'); // droplet antenna
        R(3, 3 + b, 10, 10, body); R(2, 6 + b, 12, 6, body); R(5, 8 + b, 6, 5, belly);
        R(5, 5 + b, 2, 3, '#ffffff'); R(9, 5 + b, 2, 3, '#ffffff'); R(6, 6 + b, 1, 2, '#25213a'); R(10, 6 + b, 1, 2, '#25213a');
        R(7, 9 + b, 2, 1, '#2a5b9a');
        R(3, 9 + b, 1, 1, '#bff0ff'); R(12, 9 + b, 1, 1, '#bff0ff'); // bubble cheeks
        R(4, 13, 2, 2, shade(body, -0.25)); R(10, 13, 2, 2, shade(body, -0.25));
      } else {
        R(10, 2 + b, 2, 2, '#1d4a85'); R(9, 0 + b, 4, 2, '#bff0ff'); R(5, 3 + b, 12, 2, '#7fc4f0'); // droplet + shell rim
        R(4, 4 + b, 14, 13, body); R(2, 8 + b, 18, 7, body); R(7, 10 + b, 8, 7, belly);
        R(0, 10 + b, 3, 3, body); R(19, 10 + b, 3, 3, body); // stubby arms
        R(7, 6 + b, 3, 3, '#ffffff'); R(12, 6 + b, 3, 3, '#ffffff'); R(8, 7 + b, 2, 2, '#25213a'); R(13, 7 + b, 2, 2, '#25213a');
        R(9, 11 + b, 4, 1, '#1d4a85');
        R(5, 17, 3, 3, shade(body, -0.25)); R(14, 17, 3, 3, shade(body, -0.25));
      }
    } else { // thornub
      const body = evolved ? '#3f9a4a' : '#6cc46a', belly = '#e9f7c9';
      if (!evolved) {
        R(7, 0 + b, 2, 3, '#3d8b3d'); R(4, 0 + b, 3, 2, '#8fe07a'); R(9, 1 + b, 3, 2, '#8fe07a'); // sprout
        R(3, 3 + b, 10, 10, body); R(5, 8 + b, 6, 5, belly);
        R(5, 6 + b, 2, 2, '#25213a'); R(9, 6 + b, 2, 2, '#25213a'); R(5, 6 + b, 1, 1, '#fff'); R(9, 6 + b, 1, 1, '#fff');
        R(7, 9 + b, 2, 1, '#2d6b2d'); R(3, 9 + b, 1, 1, '#f7a8c4'); R(12, 9 + b, 1, 1, '#f7a8c4');
        R(4, 13, 2, 2, shade(body, -0.25)); R(10, 13, 2, 2, shade(body, -0.25));
      } else {
        R(7, 0 + b, 8, 3, '#ff7fae'); R(9, 1 + b, 4, 2, '#ffd23f'); // blossom
        R(3, 3 + b, 16, 14, body); R(7, 10 + b, 8, 7, belly);
        R(1, 6 + b, 2, 2, '#8d6e4a'); R(19, 6 + b, 2, 2, '#8d6e4a'); R(2, 12 + b, 2, 2, '#8d6e4a'); R(18, 12 + b, 2, 2, '#8d6e4a'); // thorns
        R(7, 6 + b, 3, 3, '#25213a'); R(12, 6 + b, 3, 3, '#25213a'); R(7, 6 + b, 1, 1, '#fff'); R(12, 6 + b, 1, 1, '#fff');
        R(9, 10 + b, 4, 1, '#1f5a24');
        R(5, 17, 4, 3, shade(body, -0.3)); R(13, 17, 4, 3, shade(body, -0.3));
      }
    }
  });
  petCache.set(key, c);
  return c;
}

// ---------------- enemies (original designs) ----------------
const enemyCache = new Map();
export function enemySprite(type, frame, boss) {
  const key = `${type}${frame}${boss ? 1 : 0}`;
  let c = enemyCache.get(key);
  if (c) return c;
  const b = frame ? 1 : 0;
  if (type === 'zombie') { // Glitch: a corrupted pixel ghoul
    c = sprite(16, 18, (R) => {
      const body = '#8e6bd1';
      R(3, 2 + b, 10, 9, body); R(2, 6 + b, 12, 4, body);
      R(4, 11, 8, 4, shade(body, -0.25));
      R(4, 15, 3, 2, '#4b3a73'); R(9, 15, 3, 2, '#4b3a73');
      R(1, 7 + b, 2, 4, body); R(13, 7 + b, 2, 4, body);
      R(5, 5 + b, 2, 2, '#ff4f6d'); R(9, 5 + b, 2, 2, '#ff4f6d');
      R(6, 9 + b, 4, 1, '#3b2a5c');
      R(4, 3 + b, 1, 1, '#2df0ff'); R(11, 4 + b, 1, 1, '#ff3ad1'); R(8, 2 + b, 2, 1, '#2df0ff'); R(12, 9 + b, 1, 1, '#ff3ad1'); // glitch pixels
    });
  } else if (type === 'runner') { // Dasher: a small horned imp
    c = sprite(14, 14, (R) => {
      const body = '#e5533d';
      R(2, 0 + b, 2, 3, '#ffe0a3'); R(10, 0 + b, 2, 3, '#ffe0a3');
      R(2, 3 + b, 10, 7, body); R(4, 10, 6, 2, shade(body, -0.3));
      R(4, 5 + b, 2, 2, '#ffee55'); R(8, 5 + b, 2, 2, '#ffee55');
      R(5, 8 + b, 4, 1, '#5c1a12');
      R(3, 12, 2, 2, '#5c1a12'); R(9, 12, 2, 2, '#5c1a12');
      R(12, 7 + b, 2, 1, body); R(13, 6 + b, 1, 1, body);
    });
  } else if (type === 'brute') { // Brute: a mossy stone golem
    c = sprite(22, 22, (R) => {
      const body = boss ? '#8a7a9e' : '#8d949c';
      R(4, 3 + b, 14, 13, body); R(2, 6 + b, 18, 8, body);
      R(0, 7 + b, 3, 8, shade(body, -0.2)); R(19, 7 + b, 3, 8, shade(body, -0.2));
      R(5, 3 + b, 6, 2, '#6aa84f'); R(14, 4 + b, 3, 2, '#6aa84f');
      R(6, 7 + b, 3, 2, boss ? '#ff4040' : '#ffb03a'); R(13, 7 + b, 3, 2, boss ? '#ff4040' : '#ffb03a');
      R(8, 11 + b, 6, 2, '#4a4f55');
      R(4, 16, 5, 4, shade(body, -0.3)); R(13, 16, 5, 4, shade(body, -0.3));
      if (boss) { R(6, 0 + b, 2, 3, '#ffd23f'); R(10, 0 + b, 2, 3, '#ffd23f'); R(14, 0 + b, 2, 3, '#ffd23f'); R(6, 2 + b, 10, 1, '#ffd23f'); }
    });
  } else { // Spitter: a toxic slug
    c = sprite(18, 14, (R) => {
      const body = '#7bc043';
      R(1, 6 + b, 14, 6, body); R(3, 3 + b, 8, 4, body); R(12, 4 + b, 5, 6, shade(body, 0.15));
      R(3, 12, 12, 1, shade(body, -0.35));
      R(5, 0 + b, 1, 3, body); R(9, 0 + b, 1, 3, body); R(4, 0 + b, 3, 1, '#ffee55'); R(8, 0 + b, 3, 1, '#ffee55');
      R(14, 6 + b, 2, 2, '#25213a'); R(5, 8 + b, 2, 1, '#4c8a24'); R(9, 9 + b, 2, 1, '#4c8a24');
    });
  }
  enemyCache.set(key, c);
  return c;
}

// ---------------- cars ----------------
export const CAR_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#ecf0f1', '#9b59b6'];
const carCache = new Map();
export function carSprite(color) {
  let c = carCache.get(color);
  if (c) return c;
  c = sprite(30, 18, (R) => {
    const col = CAR_COLORS[color % CAR_COLORS.length];
    R(3, 0, 5, 2, '#222'); R(20, 0, 5, 2, '#222'); R(3, 16, 5, 2, '#222'); R(20, 16, 5, 2, '#222'); // wheels
    R(1, 2, 28, 14, col);
    R(1, 2, 28, 1, shade(col, 0.35)); R(1, 15, 28, 1, shade(col, -0.35));
    R(17, 4, 5, 10, '#9fd6ff'); R(7, 4, 3, 10, '#7fb6df'); // windshield + rear window
    R(10, 4, 7, 10, shade(col, -0.1));
    R(28, 3, 1, 3, '#fff6a8'); R(28, 12, 1, 3, '#fff6a8'); // headlights
    R(1, 3, 1, 2, '#ff4040'); R(1, 13, 1, 2, '#ff4040');
  });
  carCache.set(color, c);
  return c;
}

// ---------------- pickups ----------------
const pickCache = new Map();
export function pickupSprite(kind) {
  let c = pickCache.get(kind);
  if (c) return c;
  c = sprite(14, 14, (R) => {
    if (kind === 'health') {
      R(1, 1, 12, 12, '#ffffff'); R(5, 3, 4, 8, '#e84a5f'); R(3, 5, 8, 4, '#e84a5f');
    } else if (kind === 'ammo') {
      R(1, 3, 12, 10, '#c79a3a'); R(1, 3, 12, 2, '#e8c15a');
      R(3, 6, 2, 5, '#ffd23f'); R(6, 6, 2, 5, '#ffd23f'); R(9, 6, 2, 5, '#ffd23f');
    } else {
      R(1, 1, 12, 12, '#a0703a'); R(1, 1, 12, 1, '#c99558'); R(1, 6, 12, 2, '#7a5226'); R(6, 1, 2, 12, '#7a5226');
      R(6, 6, 2, 2, '#ffd23f');
    }
  });
  pickCache.set(kind, c);
  return c;
}

// ---------------- map ground (pre-rendered once per map) ----------------
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const ROOFS = ['#d95550', '#d95550', '#4f86c6', '#e3a33b', '#5aa86a', '#9a6bc4'];

// flat = true leaves out buildings, trees and walls (the 3D renderer builds them as meshes).
export function renderGround(map, flat = false) {
  const W = map.w * TILE, H = map.h * TILE;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const at = (x, y) => tileAt(map, x, y);
  const grass = (x, y, px, py) => {
    R(px, py, TILE, TILE, (x + y) % 2 ? '#7ccf5a' : '#76c955');
    for (let i = 0; i < 3; i++) {
      const hx = Math.floor(hash(x, y, i) * 28), hy = Math.floor(hash(y, x, i) * 26);
      R(px + hx, py + hy, 2, 3, '#5aa83d'); R(px + hx + 3, py + hy + 1, 2, 2, '#5aa83d');
    }
  };
  // Pass 1: ground
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = at(x, y), v = map.variant[y * map.w + x];
      const px = x * TILE, py = y * TILE;
      if (t === T.ROAD) {
        R(px, py, TILE, TILE, '#555a66');
        if (hash(x, y) < 0.15) R(px + 6, py + 20, 3, 2, '#4b505b');
        const cx = x % 12, cy = y % 12;
        const vert = cx < 2, horiz = cy < 2;
        if (vert && !horiz && cx === 0 && y % 2 === 0) R(px + TILE - 2, py + 6, 4, 18, '#f2c94c');
        if (horiz && !vert && cy === 0 && x % 2 === 0) R(px + 6, py + TILE - 2, 18, 4, '#f2c94c');
        // crosswalk stripes where a road meets an intersection
        if (vert && !horiz && (cy === 2 || cy === 11)) for (let i = 0; i < 4; i++) R(px + 3 + i * 7, py + 10, 4, 12, '#e8e8e8');
        if (horiz && !vert && (cx === 2 || cx === 11)) for (let i = 0; i < 4; i++) R(px + 10, py + 3 + i * 7, 12, 4, '#e8e8e8');
      } else if (t === T.WALK) {
        R(px, py, TILE, TILE, '#c9c4bb');
        R(px, py, TILE, 1, '#b3ada3'); R(px, py, 1, TILE, '#b3ada3');
        R(px + 16, py, 1, TILE, '#bdb7ad'); R(px, py + 16, TILE, 1, '#bdb7ad');
      } else if (t === T.PLAZA) {
        R(px, py, TILE, TILE, '#e3cfa6');
        R(px + 1, py + 1, 14, 14, '#ead8b4'); R(px + 17, py + 17, 14, 14, '#ead8b4');
        R(px + 17, py + 1, 14, 14, '#dcc69a'); R(px + 1, py + 17, 14, 14, '#dcc69a');
      } else if (t === T.FLOOR) {
        R(px, py, TILE, TILE, (x + y) % 2 ? '#3d4466' : '#394062');
        R(px, py, TILE, 1, '#454d74'); R(px, py, 1, TILE, '#454d74');
        if (v === 0) R(px + 10, py + 12, 4, 2, '#323858');
      } else if (t === T.WATER) {
        grass(x, y, px, py);
        R(px, py, TILE, TILE, '#4aa3df');
        // shoreline where neighbours are not water
        if (at(x, y - 1) !== T.WATER) R(px, py, TILE, 3, '#e8dca0');
        if (at(x, y + 1) !== T.WATER) R(px, py + TILE - 3, TILE, 3, '#3a83bd');
        if (at(x - 1, y) !== T.WATER) R(px, py, 3, TILE, '#e8dca0');
        if (at(x + 1, y) !== T.WATER) R(px + TILE - 3, py, 3, TILE, '#e8dca0');
        R(px + 6 + v * 3, py + 10, 8, 2, '#8fd0f5'); R(px + 16, py + 22 - v, 8, 2, '#8fd0f5');
      } else {
        grass(x, y, px, py);
      }
    }
  }
  // Pass 2: objects with height (flowers, trees, buildings, walls)
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = at(x, y), v = map.variant[y * map.w + x];
      const px = x * TILE, py = y * TILE;
      if (flat && (t === T.TREE || t === T.WALL)) continue;
      if (flat && t === T.BUILD) { // concrete footprint (visible when a building fades out)
        R(px, py, TILE, TILE, '#a8a198'); R(px, py, TILE, 1, '#9a9389'); R(px, py, 1, TILE, '#9a9389');
        continue;
      }
      if (t === T.FLOWER) {
        const cols = ['#ff6b8b', '#ffd23f', '#ffffff', '#b98cff'];
        for (let i = 0; i < 3; i++) {
          const fx = px + 5 + Math.floor(hash(x, y, i + 7) * 20), fy = py + 5 + Math.floor(hash(y, x, i + 9) * 20);
          R(fx, fy + 3, 1, 3, '#3d8b3d');
          R(fx - 1, fy, 3, 3, cols[(v + i) % 4]); R(fx, fy + 1, 1, 1, '#ffd23f');
        }
      } else if (t === T.TREE) {
        R(px + 6, py + 26, 20, 5, 'rgba(0,0,0,0.18)');
        R(px + 13, py + 20, 6, 9, '#7a5226');
        R(px + 3, py + 6, 26, 16, '#2f8a3e'); R(px + 6, py + 1, 20, 22, '#2f8a3e');
        R(px + 8, py + 3, 10, 6, '#4fb35a'); R(px + 5, py + 9, 6, 5, '#4fb35a');
        R(px + 3, py + 19, 26, 3, '#25702f');
      } else if (t === T.BUILD) {
        const roof = ROOFS[v & 7] || ROOFS[1];
        const front = at(x, y + 1) !== T.BUILD;
        if (front) {
          R(px, py, TILE, TILE, '#f2e6d0');
          R(px, py, TILE, 3, shade(roof, -0.35));
          if (v & 8) { R(px + 10, py + 12, 12, 20, '#7a5226'); R(px + 19, py + 21, 2, 2, '#ffd23f'); R(px + 8, py + 10, 16, 2, roof); }
          else { R(px + 7, py + 10, 18, 12, '#8ec9ef'); R(px + 7, py + 10, 18, 2, '#ffffff'); R(px + 15, py + 10, 2, 12, '#e0d6c4'); }
          R(px, py + TILE - 2, TILE, 2, '#cbbd9f');
        } else {
          R(px, py, TILE, TILE, roof);
          for (let i = 0; i < 4; i++) R(px, py + i * 8 + 6, TILE, 2, shade(roof, -0.15));
          if (at(x, y - 1) !== T.BUILD) R(px, py, TILE, 3, shade(roof, 0.35));
          if (at(x - 1, y) !== T.BUILD) R(px, py, 3, TILE, shade(roof, 0.2));
          if (at(x + 1, y) !== T.BUILD) R(px + TILE - 3, py, 3, TILE, shade(roof, -0.3));
        }
      } else if (t === T.WALL) {
        R(px, py, TILE, TILE, '#5b4b7a');
        const front = at(x, y + 1) === T.FLOOR;
        if (front) {
          R(px, py + 16, TILE, 16, '#463862');
          for (let i = 0; i < 2; i++) R(px + (i ? 0 : 8), py + 18 + i * 7, 16, 5, '#51416f');
        }
        R(px, py, TILE, 3, '#7a68a0');
      }
    }
  }
  return c;
}

// A tiny version of the map for the radar.
export function renderMini(map) {
  const c = canvas(map.w, map.h);
  const g = c.getContext('2d');
  const col = { [T.GRASS]: '#76c955', [T.ROAD]: '#555a66', [T.WALK]: '#c9c4bb', [T.BUILD]: '#d98a6a', [T.WATER]: '#4aa3df', [T.TREE]: '#2f8a3e', [T.FLOOR]: '#3d4466', [T.WALL]: '#5b4b7a', [T.PLAZA]: '#e3cfa6', [T.FLOWER]: '#8ad65f' };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) { g.fillStyle = col[tileAt(map, x, y)] || '#000'; g.fillRect(x, y, 1, 1); }
  return c;
}
