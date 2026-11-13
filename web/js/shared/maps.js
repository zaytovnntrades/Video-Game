// Deterministic map generation (same seed => same map on client and server).
import { TILE } from './data.js';
import { mulberry32 } from './rng.js';

export const T = { GRASS: 0, ROAD: 1, WALK: 2, BUILD: 3, WATER: 4, TREE: 5, FLOOR: 6, WALL: 7, PLAZA: 8, FLOWER: 9 };
const SOLID = [0, 0, 0, 1, 1, 1, 0, 1, 0, 0];
const BLOCKS_SHOTS = [0, 0, 0, 1, 0, 1, 0, 1, 0, 0]; // bullets fly over water

export function tileAt(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return -1;
  return map.tiles[ty * map.w + tx];
}
export function solidAt(map, tx, ty) {
  const t = tileAt(map, tx, ty);
  return t < 0 || SOLID[t] === 1;
}
export function shotBlockedAt(map, x, y) {
  const t = tileAt(map, Math.floor(x / TILE), Math.floor(y / TILE));
  return t < 0 || BLOCKS_SHOTS[t] === 1;
}

const BLOCK = 12; // 2 road + 1 sidewalk + 8 interior + 1 sidewalk
const CITY_BLOCKS = 5;

export function makeCity(seed) {
  const rng = mulberry32(seed);
  const w = BLOCK * CITY_BLOCKS + 2;
  const h = w;
  const tiles = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  const set = (x, y, t, v = 0) => { tiles[y * w + x] = t; variant[y * w + x] = v; };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x % BLOCK, cy = y % BLOCK;
      if (cx < 2 || cy < 2) set(x, y, T.ROAD);
      else set(x, y, T.WALK);
    }
  }
  const building = (x0, y0, x1, y1) => {
    const color = 1 + Math.floor(rng() * 5);
    const door = Math.floor((x0 + x1) / 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, T.BUILD, color + (y === y1 && x === door ? 8 : 0));
  };
  for (let by = 0; by < CITY_BLOCKS; by++) {
    for (let bx = 0; bx < CITY_BLOCKS; bx++) {
      const ox = bx * BLOCK + 3, oy = by * BLOCK + 3; // interior origin (8x8)
      const r = rng();
      const center = bx === 2 && by === 2;
      const fill = (t) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set(ox + x, oy + y, t, Math.floor(rng() * 4)); };
      if (center || r > 0.9) {
        fill(T.PLAZA);
      } else if (r < 0.3) {
        building(ox + 1, oy + 1, ox + 6, oy + 6);
      } else if (r < 0.55) {
        building(ox, oy, ox + 2, oy + 2); building(ox + 5, oy, ox + 7, oy + 2);
        building(ox, oy + 5, ox + 2, oy + 7); building(ox + 5, oy + 5, ox + 7, oy + 7);
      } else if (r < 0.8) {
        fill(T.GRASS);
        for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) {
          const q = rng();
          if (q < 0.14) set(ox + x, oy + y, T.TREE);
          else if (q < 0.26) set(ox + x, oy + y, T.FLOWER, Math.floor(rng() * 4));
        }
      } else {
        fill(T.GRASS);
        for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) set(ox + x, oy + y, T.WATER);
        for (const [x, y] of [[0, 0], [7, 0], [0, 7], [7, 7]]) if (rng() < 0.7) set(ox + x, oy + y, T.TREE);
      }
    }
  }
  const mid = (2 * BLOCK + 7) * TILE; // centre of the middle plaza
  const npcs = [
    { id: 1, name: 'Mayor Pix', x: (2 * BLOCK + 5.5) * TILE, y: (2 * BLOCK + 5.5) * TILE, look: { skin: 1, hair: 4, style: 0, hat: 0, shirt: 4, pants: 0 } },
    { id: 2, name: 'Mechanic Jo', x: 11.5 * TILE, y: 6.5 * TILE, look: { skin: 3, hair: 0, style: 1, hat: 1, shirt: 7, pants: 1 } },
    { id: 3, name: 'Ranger Fern', x: 50.5 * TILE, y: 47.5 * TILE, look: { skin: 0, hair: 3, style: 2, hat: 2, shirt: 2, pants: 2 } },
    { id: 4, name: 'Courier Dash', x: 47.5 * TILE, y: 14.5 * TILE, look: { skin: 2, hair: 2, style: 1, hat: 1, shirt: 3, pants: 5 } },
  ];
  // Parking spots on the road lanes (also used as drive-quest destinations).
  const carSpots = [];
  for (let k = 0; k <= CITY_BLOCKS; k++) {
    for (let i = 0; i < CITY_BLOCKS; i++) {
      const along = (i * BLOCK + 7) * TILE;
      const lane = k * BLOCK * TILE;
      const up = rng() < 0.5;
      carSpots.push({ x: along, y: lane + (up ? 16 : 48), ang: up ? 0 : Math.PI });
      const left = rng() < 0.5;
      carSpots.push({ x: lane + (left ? 16 : 48), y: along, ang: left ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  const cars = [{ x: mid, y: 2 * BLOCK * TILE + 48, ang: 0, color: 0 }];
  for (const s of carSpots) if (rng() < 0.3 && Math.hypot(s.x - cars[0].x, s.y - cars[0].y) > 80) cars.push({ ...s, color: Math.floor(rng() * 6) });
  return { kind: 'city', seed, w, h, tiles, variant, spawn: { x: mid, y: mid }, npcs, carSpots, cars };
}

export function makeArena(seed) {
  const rng = mulberry32(seed);
  const w = 32, h = 22;
  const tiles = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = edge ? T.WALL : T.FLOOR;
      variant[y * w + x] = Math.floor(rng() * 4);
    }
  }
  // 2x2 pillars on a coarse grid: gaps are always wide enough to walk through.
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 5; i++) {
      const keep = rng() < 0.6;
      if (!keep || (i === 2 && j === 1)) continue;
      const px = 4 + 6 * i, py = 4 + 5 * j;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) tiles[(py + y) * w + px + x] = T.WALL;
    }
  }
  return { kind: 'arena', seed, w, h, tiles, variant, spawn: { x: 16.5 * TILE, y: 11.5 * TILE }, npcs: [], carSpots: [], cars: [] };
}
