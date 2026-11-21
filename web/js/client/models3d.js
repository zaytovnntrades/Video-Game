// Procedural 3D models (no asset files): the hero and NPCs built from the
// player's look, the three companion creatures and their evolutions, the four
// enemy types, pickups and cars. Models face +x (the sim's angle 0) and stand
// on y = 0; sizes match the simulation's collision radii so what you see hit is
// what the game counts as a hit.
import * as THREE from '../../vendor/three.module.min.js';
import { LOOK } from '../shared/data.js';
import { CAR_COLORS } from './art.js';
import { buildHuman, poseHuman, bakeSkinned } from './human3d.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

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
// NPCs: same body, baked into one skinned mesh (cheaper; textures become flat colours)
export function buildNPC(look) { return bakeSkinned(buildHuman(look, { lod: 'high', armed: false })); }
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
// One mesh for the whole car (vertex colours, clear-coat) + one for the glowing lights.
const carBodyMat = () => new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
const carLightMat = () => new THREE.MeshBasicMaterial({ vertexColors: true });
let CAR_MATS = null;
function coloured(geo, hex, k = 1, m = null) {
  const g = geo.clone();
  if (m) g.applyMatrix4(m);
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal'].includes(key)) g.deleteAttribute(key);
  const c = new THREE.Color(hex).multiplyScalar(k), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const at = (x, y, z, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
const carGeoCache = new Map();
export function buildCar(color) {
  if (!CAR_MATS) CAR_MATS = { body: carBodyMat(), light: carLightMat() };
  let geos = carGeoCache.get(color);
  if (!geos) {
    const paint = CAR_COLORS[color % CAR_COLORS.length];
    const body = [
      coloured(G.box(30, 6.5, 16.5), paint, 1, at(0, 7.2, 0)), coloured(G.box(29.4, 2, 16), '#20232a', 1, at(0, 3.6, 0)),
      coloured(G.box(15, 6.5, 14.2), '#1c2636', 1, at(-1.5, 13.6, 0)), coloured(G.box(13.4, 1.4, 13.2), paint, 1, at(-1.8, 17.4, 0)),
      coloured(G.box(3, 1.2, 15.6), paint, 1, at(8.6, 10.8, 0)),
    ];
    for (const [x, z] of [[9.5, 8], [9.5, -8], [-9.5, 8], [-9.5, -8]]) {
      body.push(coloured(G.cyl(4, 4, 3, 16), '#18181c', 1, at(x, 4, z, Math.PI / 2)));
      body.push(coloured(G.cyl(2.3, 2.3, 3.2, 12), '#c9ced6', 1, at(x, 4, z, Math.PI / 2)));
    }
    const lights = [];
    for (const z of [5.2, -5.2]) {
      lights.push(coloured(G.box(0.8, 2.2, 3.6), '#fff3c4', 3, at(15.1, 8.4, z)));
      lights.push(coloured(G.box(0.8, 2, 3.6), '#ff2a2a', 2.5, at(-15.1, 8.4, z)));
    }
    geos = { body: mergeGeometries(body), lights: mergeGeometries(lights) };
    carGeoCache.set(color, geos);
  }
  const root = new THREE.Group();
  const b = new THREE.Mesh(geos.body, CAR_MATS.body); b.castShadow = true; b.receiveShadow = true;
  root.add(b, new THREE.Mesh(geos.lights, CAR_MATS.light));
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
      let obj = list && list.pop();
      if (!obj) { obj = build(); obj.userData.baseScale = obj.scale.x; }
      if (obj.parent !== this.parent) this.parent.add(obj);
      // per-model animation state lives here (models are pooled)
      e = { key, obj, phase: 0, lx: null, ly: null, mx: 0, my: 0, spd: 0, recoil: 0, flinch: 0, attack: 0, emote: 0 };
      this.live.set(id, e);
    }
    e.obj.visible = true;
    this.seen.add(id);
    return e;
  }
  // Advances the walk cycle by distance travelled: one full cycle (two steps) per
  // `stride` world units, so feet don't skate and cadence stays natural at any speed.
  step(e, x, y, dt, stride = 20) {
    let moving = false;
    e.mx = 0; e.my = 0;
    if (e.lx !== null) {
      const d = Math.hypot(x - e.lx, y - e.ly);
      if (d < 60) {
        e.phase += (d / stride) * Math.PI * 2;
        const v = d / Math.max(dt, 1e-3);
        e.spd += (v - e.spd) * Math.min(1, dt * 10);
        moving = e.spd > 10;
        e.mx = x - e.lx; e.my = y - e.ly;
      }
    }
    e.lx = x; e.ly = y;
    return moving;
  }
  // Decays one-shot animation timers.
  tick(e, dt) {
    e.recoil = Math.max(0, e.recoil - dt * 7);
    e.flinch = Math.max(0, e.flinch - dt * 4);
    e.attack = Math.max(0, e.attack - dt * 3);
    e.emote = Math.max(0, e.emote - dt);
  }
  // Hands a live model over (e.g. to a death animation) without returning it to the pool.
  detach(id) {
    const e = this.live.get(id);
    if (e) this.live.delete(id);
    return e || null;
  }
  // Back to the free list with a clean transform, so the next spawn isn't left mid-fall.
  release(id, e) {
    const o = e.obj;
    o.visible = false;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.setScalar(o.userData.baseScale || 1);
    const b = o.userData.body;
    if (b) { b.position.set(0, 0, 0); b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1); }
    if (!this.free.has(e.key)) this.free.set(e.key, []);
    this.free.get(e.key).push(o);
    if (id !== null) this.live.delete(id);
  }
  // Builds models ahead of time (hidden, on the free list) so a wave spawning does not stutter.
  prewarm(key, build, n) {
    const list = this.free.get(key) || [];
    while (list.length < n) { const o = build(); o.userData.baseScale = o.scale.x; o.visible = false; this.parent.add(o); list.push(o); }
    this.free.set(key, list);
  }
  end() { for (const [id, e] of this.live) if (!this.seen.has(id)) this.release(id, e); }
  clear() { for (const [id, e] of [...this.live]) this.release(id, e); }
}
