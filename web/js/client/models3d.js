// Procedural 3D models (no asset files): the hero and NPCs built from the
// player's look, the three companion creatures and their evolutions, the four
// enemy types, pickups and cars. Models face +x (the sim's angle 0) and stand
// on y = 0; sizes match the simulation's collision radii so what you see hit is
// what the game counts as a hit.
import * as THREE from '../../vendor/three.module.min.js';
import { LOOK } from '../shared/data.js';
import { CAR_COLORS } from './art.js';
import { buildHuman, poseHuman } from './human3d.js';

// ---------- shared geometry / material caches ----------
const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const G = {
  sphere: (r, w = 16, h = 12) => geo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  hemi: (r) => geo(`h${r}`, () => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
  capsule: (r, l, s = 10) => geo(`c${r},${l},${s}`, () => new THREE.CapsuleGeometry(r, l, 4, s)),
  box: (x, y, z) => geo(`b${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z)),
  cyl: (a, b, h, s = 12) => geo(`y${a},${b},${h},${s}`, () => new THREE.CylinderGeometry(a, b, h, s)),
  cone: (r, h, s = 8) => geo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  torus: (r, t) => geo(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 8, 20)),
};
const matCache = new Map();
// Shared PBR material. emissive > 0 makes it glow (bloom picks it up in Ultra).
function M(color, { rough = 0.7, metal = 0, emissive = 0, flat = false } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${flat}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat });
    if (emissive) { m.emissive = new THREE.Color(color); m.emissiveIntensity = emissive; }
    matCache.set(key, m);
  }
  return m;
}
function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// ---------- hero / NPC: realistic human (see human3d.js) ----------
export function buildCharacter(look) { return buildHuman(look, { lod: 'high' }); }
export function poseCharacter(o, state) { poseHuman(o, state); }

// ---------- companions and enemies: realistic models (see creatures3d.js) ----------
export { buildCreature, poseCreature, buildEnemy, poseEnemy } from './creatures3d.js';

// ---------- pickups ----------
export function buildPickup(kind) {
  const root = new THREE.Group();
  const b = new THREE.Group();
  root.add(b);
  if (kind === 'health') {
    b.add(mesh(G.box(10, 10, 10), M('#f4f4f4', { rough: 0.4 })));
    const red = M('#e84a5f', { emissive: 0.6 });
    b.add(mesh(G.box(7.4, 0.6, 2.4), red, 0, 5.2, 0));
    b.add(mesh(G.box(2.4, 0.6, 7.4), red, 0, 5.2, 0));
    b.add(mesh(G.box(0.6, 7.4, 2.4), red, 5.2, 0, 0));
    b.add(mesh(G.box(0.6, 2.4, 7.4), red, 5.2, 0, 0));
  } else if (kind === 'ammo') {
    b.add(mesh(G.box(12, 6, 8), M('#6d6a3a', { rough: 0.8 })));
    const brass = M('#e8c15a', { metal: 0.9, rough: 0.25 });
    for (const z of [-2.5, 0, 2.5]) b.add(mesh(G.cyl(1, 1, 5, 8), brass, 0, 5, z));
  } else {
    b.add(mesh(G.box(11, 11, 11), M('#a0703a', { rough: 0.9 })));
    const band = M('#6b4423', { rough: 0.9 });
    b.add(mesh(G.box(11.6, 2, 11.6), band));
    b.add(mesh(G.box(2, 11.6, 11.6), band));
    b.add(mesh(G.sphere(1.3, 8, 6), M('#ffd23f', { emissive: 1.5 }), 0, 6, 0));
  }
  const ring = new THREE.Mesh(G.torus(9, 0.7), M(kind === 'health' ? '#ff6b8b' : kind === 'ammo' ? '#ffd23f' : '#ffb35a', { emissive: 2.5 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.6;
  root.add(ring);
  root.userData = { body: b };
  return root;
}

export function posePickup(o, { t, id }) {
  const b = o.userData.body;
  b.position.y = 9 + Math.sin(t * 3 + id) * 2;
  b.rotation.y = t * 1.6 + id;
}

// ---------- cars (glossy clear-coat paint) ----------
const paintCache = new Map();
function paint(color) {
  let m = paintCache.get(color);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: CAR_COLORS[color % CAR_COLORS.length], metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    paintCache.set(color, m);
  }
  return m;
}
export function buildCar(color) {
  const root = new THREE.Group();
  const p = paint(color);
  const glass = M('#1c2636', { rough: 0.05, metal: 0.9 });
  const trim = M('#20232a', { rough: 0.6 });
  root.add(mesh(G.box(30, 6.5, 16.5), p, 0, 7.2, 0));
  root.add(mesh(G.box(29.4, 2, 16), trim, 0, 3.6, 0));
  root.add(mesh(G.box(15, 6.5, 14.2), glass, -1.5, 13.6, 0));
  root.add(mesh(G.box(13.4, 1.4, 13.2), p, -1.8, 17.4, 0));
  root.add(mesh(G.box(3, 1.2, 15.6), p, 8.6, 10.8, 0)); // hood lip
  const tire = M('#18181c', { rough: 0.8 }), rim = M('#c9ced6', { metal: 1, rough: 0.25 });
  for (const [x, z] of [[9.5, 8], [9.5, -8], [-9.5, 8], [-9.5, -8]]) {
    const w = mesh(G.cyl(4, 4, 3, 16), tire, x, 4, z); w.rotation.x = Math.PI / 2; root.add(w);
    const r = mesh(G.cyl(2.3, 2.3, 3.2, 12), rim, x, 4, z); r.rotation.x = Math.PI / 2; root.add(r);
  }
  const head = M('#fff3c4', { emissive: 4 }), tail = M('#ff2a2a', { emissive: 3 });
  for (const z of [5.2, -5.2]) {
    root.add(mesh(G.box(0.8, 2.2, 3.6), head, 15.1, 8.4, z));
    root.add(mesh(G.box(0.8, 2, 3.6), tail, -15.1, 8.4, z));
  }
  root.scale.setScalar(1.3); // car-sized next to a realistic 26.5-unit person
  return root;
}

// ---------- pooling ----------
// Keeps one model per live entity id; models of entities that disappear go to a
// free list (by model key) and are reused, so nothing is rebuilt every frame.
export class ModelKit {
  constructor(parent) {
    this.parent = parent;
    this.live = new Map();
    this.free = new Map();
    this.seen = new Set();
  }
  begin() { this.seen.clear(); }
  get(id, key, build) {
    let e = this.live.get(id);
    if (e && e.key !== key) { this.release(id, e); e = null; }
    if (!e) {
      const list = this.free.get(key);
      const obj = (list && list.pop()) || build();
      if (obj.parent !== this.parent) this.parent.add(obj);
      e = { key, obj, phase: 0, lx: null, ly: null };
      this.live.set(id, e);
    }
    e.obj.visible = true;
    this.seen.add(id);
    return e;
  }
  // Tracks movement between frames to drive walk cycles (works for interpolated
  // multiplayer positions too).
  step(e, x, y, dt) {
    let moving = false;
    e.mx = 0; e.my = 0;
    if (e.lx !== null) {
      const d = Math.hypot(x - e.lx, y - e.ly);
      if (d < 60) { e.phase += d * 0.32; moving = d / Math.max(dt, 1e-3) > 8; e.mx = x - e.lx; e.my = y - e.ly; }
    }
    e.lx = x; e.ly = y;
    return moving;
  }
  release(id, e) {
    e.obj.visible = false;
    if (!this.free.has(e.key)) this.free.set(e.key, []);
    this.free.get(e.key).push(e.obj);
    this.live.delete(id);
  }
  end() { for (const [id, e] of this.live) if (!this.seen.has(id)) this.release(id, e); }
  // Builds models ahead of time (hidden, on the free list) so a wave spawning does not stutter.
  prewarm(key, build, n) {
    const list = this.free.get(key) || [];
    while (list.length < n) { const o = build(); o.visible = false; this.parent.add(o); list.push(o); }
    this.free.set(key, list);
  }
  clear() { for (const [id, e] of [...this.live]) this.release(id, e); }
}
