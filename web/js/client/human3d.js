// Realistic procedural human (hero, NPCs; low-detail variant for enemies).
// Real proportions (~7 heads tall, 26.5 world units ≈ 1.75 m), a sculpted head,
// eyes with lids, strand-textured hair, fabric/denim/skin textures with generated
// normal maps, hands with fingers, sneakers, five weapon models, a two-handed
// aiming stance solved with two-bone IK, and a walk cycle that handles strafing
// and backpedalling. Each body segment's parts are merged per material so a
// character costs ~25 draw calls.
//
// Model faces +x and stands on y = 0; +z is the character's right side.
import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries, mergeVertices } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { LOOK } from '../shared/data.js';

export const HUMAN_HEIGHT = 26.5;

// ---------------------------------------------------------------- textures
export function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Builds a tangent-space normal map from a grey height canvas (Sobel).
export function normalMap(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cvs(w, h), og = out.getContext('2d'), img = og.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}
export function tex(c, rx = 1, ry = 1, color = true) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

let TX = null;
export function textures() {
  if (TX) return TX;
  const r = rng(91);
  const make = (size, drawColor, drawHeight) => {
    const c = cvs(size, size), g = c.getContext('2d'); drawColor(g, size);
    const hgt = cvs(size, size), hg = hgt.getContext('2d'); drawHeight(hg, size);
    return { c, n: normalMap(hgt) };
  };
  // skin: soft colour variation + pores
  const skin = make(256, (g, s) => {
    g.fillStyle = '#f4ece8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${200 + r() * 40},${120 + r() * 40},${120 + r() * 30},0.05)`; g.beginPath(); g.arc(r() * s, r() * s, 6 + r() * 20, 0, 7); g.fill(); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(40,40,40,${0.25 + r() * 0.3})`; g.fillRect(r() * s, r() * s, 1, 1); }
  });
  // cotton tee: fine weave
  const cotton = make(128, (g, s) => {
    g.fillStyle = '#ececec'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * s, r() * s, 2, 1); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = y % 4 ? '#8a8a8a' : '#767676'; g.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, s); }
  });
  // denim: diagonal twill + wear
  const denim = make(128, (g, s) => {
    g.fillStyle = '#e6e6ea'; g.fillRect(0, 0, s, s);
    for (let i = -s; i < s; i += 3) { g.strokeStyle = 'rgba(0,0,30,0.12)'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.18})`; g.fillRect(r() * s, r() * s, 3, 1); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    g.lineWidth = 1.4;
    for (let i = -s; i < s; i += 3) { g.strokeStyle = '#a0a0a0'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); }
  });
  // hair: strands along v
  const hair = make(256, (g, s) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { const x = r() * s; g.strokeStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${0.06 + r() * 0.1})`; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, s); g.stroke(); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) { const x = r() * s; g.strokeStyle = r() < 0.5 ? '#b0b0b0' : '#505050'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, s); g.stroke(); }
  });
  // knit (beanie): vertical ribs
  const knit = make(64, (g, s) => { g.fillStyle = '#e0e0e0'; g.fillRect(0, 0, s, s); }, (g, s) => {
    for (let x = 0; x < s; x++) { const v = 128 + Math.sin((x / s) * Math.PI * 16) * 70; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, s); }
  });
  // iris: radial fibres around a pupil
  const iris = cvs(64, 64), ig = iris.getContext('2d');
  ig.fillStyle = '#ffffff'; ig.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 160; i++) { const a = r() * 6.283; ig.strokeStyle = `rgba(0,0,0,${0.1 + r() * 0.25})`; ig.beginPath(); ig.moveTo(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9); ig.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); ig.stroke(); }
  ig.strokeStyle = 'rgba(0,0,0,0.6)'; ig.lineWidth = 3; ig.beginPath(); ig.arc(32, 32, 30, 0, 7); ig.stroke();
  ig.fillStyle = '#0a0a0a'; ig.beginPath(); ig.arc(32, 32, 10, 0, 7); ig.fill();
  ig.fillStyle = 'rgba(255,255,255,0.9)'; ig.beginPath(); ig.arc(24, 24, 4, 0, 7); ig.fill(); // catch-light
  TX = {
    skin: [tex(skin.c, 2, 2), tex(skin.n, 2, 2, false)],
    cotton: [tex(cotton.c, 3, 3), tex(cotton.n, 3, 3, false)],
    denim: [tex(denim.c, 3, 3), tex(denim.n, 3, 3, false)],
    hair: [tex(hair.c, 2, 1), tex(hair.n, 2, 1, false)],
    knit: [tex(knit.c, 4, 1), tex(knit.n, 4, 1, false)],
    iris: new THREE.CanvasTexture(iris),
  };
  TX.iris.colorSpace = THREE.SRGBColorSpace;
  return TX;
}

// ---------------------------------------------------------------- geometry helpers
const V = (r, y) => new THREE.Vector2(r, y);
// Turned profile (r, y) around the y axis; sx/sz scale the cross-section into an ellipse.
export function lathe(pts, seg = 16, sx = 1, sz = 1) {
  // LatheGeometry wants the profile bottom-to-top, or its faces point inward
  if (pts[0][1] > pts[pts.length - 1][1]) pts = pts.slice().reverse();
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => V(r, y)), seg);
  g.scale(sx, 1, sz);
  return g;
}
// Collects parts per body segment and emits one merged mesh per material.
export class Parts {
  constructor() { this.byMat = new Map(); }
  add(geo, mat, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const g = geo.index ? geo.clone() : mergeVertices(geo.clone());
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.byMat.has(mat)) this.byMat.set(mat, []);
    this.byMat.get(mat).push(g);
    return this;
  }
  into(group, { cast = true } = {}) {
    for (const [mat, list] of this.byMat) {
      const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
      m.castShadow = cast; m.receiveShadow = true;
      group.add(m);
    }
    return group;
  }
}

// Sculpted head: an ellipsoid shaped into cranium, brow, eye sockets, cheekbones,
// jaw and chin. Normals are rebuilt after welding the sphere's seam (at the back).
let headGeo = null;
function headGeometry() {
  if (headGeo) return headGeo;
  const g = new THREE.SphereGeometry(1, 44, 30);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = x * 1.48, Y = y * 1.86, Z = z * 1.28;
    if (y < -0.12) { const t = (-y - 0.12) / 0.88; Z *= 1 - 0.36 * t; X *= x > 0 ? 1 - 0.1 * t : 1 - 0.4 * t; }
    if (y < -0.62 && x > 0.35) X += 0.16 * (x - 0.35); // chin
    if (x < 0 && y > -0.35) X *= 1.07; // cranium
    if (x > 0.55 && y > 0.12 && y < 0.38) X += 0.07 * (x - 0.55) * 3; // brow ridge
    if (x > 0.7 && y > -0.02 && y < 0.22 && Math.abs(z) > 0.16 && Math.abs(z) < 0.52) X -= 0.08; // eye sockets
    if (y > -0.38 && y < -0.05 && Math.abs(z) > 0.38 && x > 0.15) Z *= 1.04; // cheekbones
    if (y > 0.72) Y = 1.86 * (0.72 + (y - 0.72) * 0.86); // flatter crown
    p.setXYZ(i, X, Y, Z);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  const pp = m.attributes.position, uv = new Float32Array(pp.count * 2);
  for (let i = 0; i < pp.count; i++) { uv[i * 2] = Math.atan2(pp.getZ(i), pp.getX(i)) / (Math.PI * 2) + 0.5; uv[i * 2 + 1] = pp.getY(i) / 4 + 0.5; }
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  headGeo = m;
  return m;
}

// Hair cap sculpted on the head shape with a natural hairline: high on the forehead,
// dipping at the temples, low at the nape, slightly ragged. Vertices below the
// hairline are pulled inside the skull, so the edge follows the mesh.
let capGeoCache = null;
function hairCap() {
  if (capGeoCache) return capGeoCache;
  const g = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const p = g.attributes.position;
  const R = rng(17);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = Math.max(0, x), side = Math.abs(z);
    // hairline height (unit-sphere y) by direction: forehead 0.42, temples 0.1, ears -0.05, nape -0.42
    const line = x > 0 ? 0.42 * front * front + 0.1 * side - 0.05 * (1 - front) : -0.05 - 0.37 * (-x) * (1 - side * 0.5);
    const jag = (R() - 0.5) * 0.06;
    const k = y < line + jag ? 0.55 : 1.07 + (y > 0.3 ? 0.02 : 0); // below the hairline: pulled deep inside the skull
    p.setXYZ(i, x * 1.48 * k, y * 1.86 * k * (y > 0.72 ? 0.97 : 1), z * 1.3 * k);
  }
  g.computeVertexNormals();
  capGeoCache = g;
  return g;
}

// ---------------------------------------------------------------- weapons
// Built once per type, merged per material. Grip points are in weapon space (barrel along +x).
const WEAPON = {
  pistol: { anchor: [3.2, 3.1, 0.9], right: [0, -0.7, 0], left: [0.15, -0.85, -0.2] },
  uzi: { anchor: [3.0, 3.0, 1.0], right: [0, -0.8, 0], left: [1.6, -0.9, 0] },
  shotgun: { anchor: [2.2, 3.2, 1.2], right: [0, -0.7, 0], left: [3.6, -0.45, 0] },
  rifle: { anchor: [2.0, 3.4, 1.2], right: [0, -0.75, 0], left: [3.9, -0.45, 0] },
  rocket: { anchor: [0.8, 5.0, 1.5], right: [0.5, -1.2, 0], left: [3.0, -1.0, 0] },
};
const weaponGeoCache = new Map();
function weaponModel(type, mats) {
  const P = new Parts();
  const metal = mats.metal, dark = mats.dark, wood = mats.wood;
  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  const cyl = (r, l) => new THREE.CylinderGeometry(r, r, l, 12).rotateZ(Math.PI / 2);
  if (type === 'pistol') {
    P.add(box(3.2, 0.75, 0.55), metal, { p: [0.9, 0.3, 0] }).add(box(1.0, 1.7, 0.5), dark, { p: [-0.15, -0.6, 0], r: [0, 0, -0.25] })
      .add(new THREE.TorusGeometry(0.38, 0.07, 6, 12, Math.PI), metal, { p: [0.45, -0.35, 0], r: [0, 0, Math.PI] }).add(cyl(0.15, 0.4), metal, { p: [2.6, 0.38, 0] });
  } else if (type === 'uzi') {
    P.add(box(3.6, 1.1, 0.8), metal, { p: [1.1, 0.2, 0] }).add(box(0.7, 2.6, 0.55), dark, { p: [0.2, -1.2, 0] })
      .add(cyl(0.2, 1.2), metal, { p: [3.4, 0.3, 0] }).add(box(1.0, 0.7, 0.6), dark, { p: [1.7, -0.5, 0] });
  } else if (type === 'shotgun') {
    P.add(cyl(0.28, 7), metal, { p: [3.0, 0.35, 0] }).add(cyl(0.23, 5.5), metal, { p: [3.4, -0.15, 0] })
      .add(box(1.8, 0.75, 0.75), wood, { p: [3.6, -0.2, 0] }).add(box(1.6, 1.0, 0.7), metal, { p: [0.1, 0.15, 0] })
      .add(box(3.4, 1.0, 0.65), wood, { p: [-2.2, -0.35, 0], r: [0, 0, 0.12] }).add(box(0.7, 1.3, 0.6), wood, { p: [-0.2, -0.6, 0], r: [0, 0, -0.3] });
  } else if (type === 'rifle') {
    P.add(cyl(0.2, 6.5), metal, { p: [4.0, 0.35, 0] }).add(box(4.2, 1.2, 0.75), dark, { p: [1.2, 0.2, 0] })
      .add(box(0.8, 2.0, 0.6), metal, { p: [1.0, -1.1, 0], r: [0, 0, 0.15] }).add(cyl(0.38, 3.0), metal, { p: [1.3, 1.25, 0] })
      .add(box(2.8, 1.1, 0.6), dark, { p: [-2.1, -0.1, 0] }).add(box(0.7, 1.4, 0.55), dark, { p: [-0.2, -0.7, 0], r: [0, 0, -0.3] });
  } else {
    P.add(new THREE.CylinderGeometry(0.85, 0.85, 8.5, 16, 1, true).rotateZ(Math.PI / 2), mats.olive, { p: [1.6, 0, 0] })
      .add(new THREE.TorusGeometry(0.85, 0.12, 6, 16).rotateY(Math.PI / 2), dark, { p: [5.85, 0, 0] })
      .add(box(0.6, 1.4, 0.5), dark, { p: [0.5, -1.1, 0] }).add(box(0.6, 1.4, 0.5), dark, { p: [3.0, -1.1, 0] })
      .add(box(0.9, 0.7, 0.4), dark, { p: [2.0, 1.1, 0.4] });
  }
  return P.into(new THREE.Group());
}

// ---------------------------------------------------------------- the human
const EYE_COLORS = ['#5b3a24', '#3f6b3a', '#3a5f86', '#6b5134', '#2c2420'];
const sharedMats = {};
function shared(key, make) { return sharedMats[key] || (sharedMats[key] = make()); }

// opts: { lod: 'high' | 'low', skinColor, eyeGlow, shirtColor, pantsColor, armed }
export function buildHuman(look, opts = {}) {
  const T = textures();
  const lod = opts.lod || 'high';
  const hi = lod === 'high';
  const seg = hi ? 16 : 9;
  const skinCol = opts.skinColor || LOOK.skin[look.skin] || LOOK.skin[0];
  const own = (color, extra) => new THREE.MeshStandardMaterial({ color, ...extra });
  // per-character materials (needed for the hurt flash)
  const skin = new THREE.MeshPhysicalMaterial({ color: skinCol, map: T.skin[0], normalMap: T.skin[1], normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.55, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffb59c') });
  const hair = own(LOOK.hair[look.hair] || LOOK.hair[0], { map: T.hair[0], normalMap: T.hair[1], normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.42 });
  const shirt = own(opts.shirtColor || LOOK.shirt[look.shirt] || LOOK.shirt[0], { map: T.cotton[0], normalMap: T.cotton[1], normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.9 });
  const pants = own(opts.pantsColor || LOOK.pants[look.pants] || LOOK.pants[0], { map: T.denim[0], normalMap: T.denim[1], normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.85 });
  const lips = own(new THREE.Color(skinCol).lerp(new THREE.Color('#9a4a48'), 0.35), { roughness: 0.45 });
  const shoe = shared('shoe', () => own('#2b2d33', { roughness: 0.55 }));
  const sole = shared('sole', () => own('#eeeae2', { roughness: 0.8 }));
  const belt = shared('belt', () => own('#3a2a1e', { roughness: 0.5, metalness: 0.1 }));
  const sclera = shared('sclera', () => own('#f1ede6', { roughness: 0.25 }));
  const irisM = opts.eyeGlow
    ? shared('eyeglow' + opts.eyeGlow, () => own(opts.eyeGlow, { emissive: new THREE.Color(opts.eyeGlow), emissiveIntensity: 3 }))
    : shared('iris' + (look.skin % EYE_COLORS.length), () => own(EYE_COLORS[look.skin % EYE_COLORS.length], { map: T.iris, roughness: 0.1 }));
  const wmats = shared('weapons', () => ({
    metal: own('#3b3f46', { metalness: 0.85, roughness: 0.32 }), dark: own('#1f2126', { roughness: 0.6 }),
    wood: own('#7a4a26', { roughness: 0.55 }), olive: own('#55623a', { roughness: 0.6, metalness: 0.2 }),
  }));

  const root = new THREE.Group();
  const pelvis = new THREE.Group(); pelvis.position.y = 14.4; root.add(pelvis);
  const spine = new THREE.Group(); spine.position.y = 0.8; pelvis.add(spine);
  const neck = new THREE.Group(); neck.position.y = 6.0; spine.add(neck);
  const head = new THREE.Group(); head.position.y = 0.85; neck.add(head);

  // torso: T-shirt with collar
  new Parts()
    .add(lathe([[0.1, -0.55], [2.2, -0.45], [2.22, 0], [2.36, 1.3], [2.6, 2.5], [2.76, 3.5], [2.78, 4.2], [2.55, 4.75], [2.1, 5.2], [1.45, 5.6], [1.05, 5.9], [0.88, 6.02]], seg, 0.68, 1), shirt)
    .add(new THREE.TorusGeometry(0.98, 0.17, 6, seg), shirt, { p: [0, 5.95, 0], r: [Math.PI / 2, 0, 0], s: [0.85, 1, 1] })
    .into(spine);
  // pelvis: jeans + belt
  new Parts()
    .add(lathe([[2.32, 1.1], [2.52, 0.2], [2.68, -0.6], [2.6, -1.3], [2.2, -1.85], [1.2, -2.15], [0.2, -2.2]], seg, 0.74, 1), pants)
    .add(new THREE.CylinderGeometry(2.5, 2.5, 0.42, seg, 1, true), belt, { p: [0, 0.25, 0], s: [0.75, 1, 1] })
    .into(pelvis);
  // neck
  new Parts().add(new THREE.CylinderGeometry(0.78, 0.92, 1.6, seg), skin, { p: [0, 0.5, 0] }).into(neck);

  // head
  const hp = new Parts();
  hp.add(headGeometry(), skin, { p: [0, 1.65, 0] });
  const eyeY = 1.65 + 0.3, eyeX = 1.15;
  for (const z of [-0.5, 0.5]) {
    hp.add(new THREE.SphereGeometry(0.42, 10, 8), skin, { p: [-0.25, 1.65 + 0.05, z * 2.55], s: [0.55, 1.05, 0.32] }); // ears
    hp.add(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), skin, { p: [eyeX + 0.05, eyeY + 0.02, z], r: [0, 0, -0.35], s: [1, 0.85, 1.12] }); // upper lid
  }
  hp.add(new THREE.ConeGeometry(0.27, 1.0, 10), skin, { p: [1.52, 1.65 - 0.18, 0], r: [0, 0, -2.45], s: [1, 1, 0.85] }); // nose bridge
  hp.add(new THREE.SphereGeometry(0.27, 10, 8), skin, { p: [1.66, 1.65 - 0.5, 0] }); // nose tip
  for (const z of [-0.2, 0.2]) hp.add(new THREE.SphereGeometry(0.17, 8, 6), skin, { p: [1.52, 1.65 - 0.55, z] }); // nostril wings
  hp.into(head);
  const eyes = new Parts();
  for (const z of [-0.5, 0.5]) eyes.add(new THREE.SphereGeometry(0.29, 14, 10), sclera, { p: [eyeX, eyeY, z] });
  eyes.into(head, { cast: false });
  const irises = new Parts();
  for (const z of [-0.5, 0.5]) irises.add(new THREE.CircleGeometry(0.17, 16), irisM, { p: [eyeX + 0.285, eyeY, z], r: [0, Math.PI / 2, 0] });
  irises.into(head, { cast: false });
  const mouth = new Parts();
  mouth.add(new THREE.CapsuleGeometry(0.11, 0.55, 3, 8), lips, { p: [1.43, 1.65 - 0.92, 0], r: [Math.PI / 2, 0, 0] });
  mouth.add(new THREE.CapsuleGeometry(0.13, 0.5, 3, 8), lips, { p: [1.4, 1.65 - 1.08, 0], r: [Math.PI / 2, 0, 0] });
  mouth.into(head, { cast: false });

  // hair + brows (+ hat)
  const hairP = new Parts();
  if (!opts.noHair) for (const z of [-0.5, 0.5]) hairP.add(new THREE.BoxGeometry(0.12, 0.085, 0.6), hair, { p: [1.36, eyeY + 0.38, z * 1.02], r: [z > 0 ? 0.12 : -0.12, 0, 0] });
  const style = look.style | 0, hat = opts.noHat ? 0 : look.hat | 0;
  if (!opts.noHair) hairP.add(hairCap(), hair, { p: [0, 1.65, 0] });
  if (opts.noHair) { /* bald */ } else if (style === 1 && hat === 0) {
    const R = rng(7);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, rr = 0.35 + R() * 0.75;
      hairP.add(new THREE.ConeGeometry(0.42, 1.5 + R() * 0.5, 6), hair, { p: [-0.25 + Math.cos(a) * rr * 0.95, 3.45 - rr * 0.35, Math.sin(a) * rr * 0.85], r: [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55 - 0.25] });
    }
  } else if (style === 2) {
    const back = new THREE.SphereGeometry(1, 26, 18);
    const bp = back.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const taper = y < 0 ? 1 - (-y) * 0.32 : 1; // narrower towards the ends
      const a = Math.atan2(z, x), wave = 1 + Math.sin(a * 11 + y * 3) * 0.025;
      bp.setXYZ(i, x * 1.15 * taper * wave, y * 2.35, z * 1.62 * taper * wave);
    }
    back.computeVertexNormals();
    hairP.add(back, hair, { p: [-0.75, 0.55, 0] });
    for (const z of [-1, 1]) hairP.add(new THREE.CapsuleGeometry(0.36, 2.2, 3, 8), hair, { p: [0.35, 0.75, z * 1.3], r: [z * 0.08, 0, 0.18], s: [0.8, 1, 0.75] });
  }
  hairP.into(head);
  if (hat === 1) { // baseball cap with a curved bill
    const capM = own('#2bb3a3', { map: T.cotton[0], normalMap: T.cotton[1], roughness: 0.75 });
    new Parts()
      .add(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), capM, { p: [0, 2.2, 0], s: [1.66, 1.35, 1.46] })
      .add(new THREE.CylinderGeometry(2.05, 2.05, 0.12, 24, 1, false, Math.PI / 2 - 0.72, 1.44), capM, { p: [0.2, 2.25, 0], r: [0, 0, -0.12] })
      .add(new THREE.SphereGeometry(0.2, 8, 6), capM, { p: [0, 3.55, 0] })
      .into(head);
    new Parts().add(new THREE.CircleGeometry(0.32, 5), shared('star', () => own('#ffd23f', { emissive: new THREE.Color('#ffd23f'), emissiveIntensity: 0.3 })), { p: [1.46, 2.75, 0], r: [0, Math.PI / 2, -0.5] }).into(head, { cast: false });
  } else if (hat === 2) { // knit beanie with a pom-pom
    const knit = own('#3f7fd8', { map: T.knit[0], normalMap: T.knit[1], normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95 });
    const pom = new THREE.IcosahedronGeometry(0.62, 2);
    const pp = pom.attributes.position, R = rng(3);
    for (let i = 0; i < pp.count; i++) { const k = 1 + (R() - 0.5) * 0.25; pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k, pp.getZ(i) * k); }
    pom.computeVertexNormals();
    new Parts()
      .add(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), knit, { p: [-0.05, 2.05, 0], r: [0, 0, -0.1], s: [1.68, 1.75, 1.48] })
      .add(new THREE.TorusGeometry(1, 0.3, 8, 28), knit, { p: [-0.05, 2.15, 0], r: [Math.PI / 2, 0.1, 0], s: [1.68, 1.48, 1] })
      .add(pom, own('#f2f2f2', { roughness: 1 }), { p: [-0.3, 3.95, 0] })
      .into(head);
  }

  // arms (shoulder -> elbow -> wrist); hanging down -y
  const arms = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0, 4.6, side * 2.72); spine.add(sh);
    new Parts()
      .add(new THREE.CapsuleGeometry(0.9, 1.4, 4, seg), shirt, { p: [0, -0.75, -side * 0.12], s: [1.05, 1, 0.92] })
      .add(lathe([[0.97, 0.0], [0.98, -1.3], [1.0, -2.2], [0.2, -2.22]], seg), shirt)
      .into(sh);
    new Parts().add(lathe([[0.82, -0.6], [0.86, -1.6], [0.8, -3.1], [0.7, -4.6], [0.66, -5.0]], seg), skin).into(sh);
    const el = new THREE.Group(); el.position.y = -4.6; sh.add(el);
    new Parts().add(new THREE.SphereGeometry(0.64, seg, 8), skin).add(lathe([[0.66, 0.4], [0.7, 0], [0.78, -0.9], [0.66, -2.4], [0.5, -3.9], [0.46, -4.05]], seg), skin).into(el);
    const wr = new THREE.Group(); wr.position.y = -4.0; el.add(wr);
    const hand = new Parts().add(new THREE.CapsuleGeometry(0.42, 0.75, 4, 10), skin, { p: [0, -0.75, 0], s: [1.25, 1, 0.55] }); // palm
    if (hi) {
      for (let f = 0; f < 4; f++) hand.add(new THREE.CapsuleGeometry(0.15, 0.78 + (f === 1 || f === 2 ? 0.16 : 0), 3, 6), skin, { p: [-0.42 + f * 0.28, -1.95 - (f === 1 || f === 2 ? 0.08 : 0), 0], r: [0, 0, (f - 1.5) * 0.06] });
      hand.add(new THREE.CapsuleGeometry(0.17, 0.62, 3, 6), skin, { p: [0.58, -0.75, -side * 0.12], r: [0, 0, 0.55] });
    } else hand.add(new THREE.CapsuleGeometry(0.4, 0.7, 3, 6), skin, { p: [0, -1.75, 0], s: [1.2, 1, 0.5] });
    hand.into(wr, { cast: hi });
    arms.push({ sh, el, wr, side });
  }

  // legs (hip -> knee -> ankle), jeans + sneakers
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, -0.8, side * 1.45); pelvis.add(hip);
    new Parts().add(lathe([[1.55, 0.6], [1.66, -0.4], [1.5, -3.0], [1.2, -5.6], [1.14, -6.4], [1.1, -6.9]], seg), pants).into(hip);
    const knee = new THREE.Group(); knee.position.y = -6.4; hip.add(knee);
    new Parts().add(new THREE.SphereGeometry(1.02, seg, 8), pants).add(lathe([[1.1, 0.5], [1.13, 0.05], [1.14, -1.4], [1.0, -3.6], [0.86, -5.6], [0.9, -6.05], [0.2, -6.1]], seg), pants).into(knee);
    const ankle = new THREE.Group(); ankle.position.y = -6.2; knee.add(ankle);
    const sp = new Parts()
      .add(new THREE.SphereGeometry(1, 16, 10), shoe, { p: [0.95, -0.1, 0], s: [2.05, 0.82, 0.95] })
      .add(new THREE.CylinderGeometry(0.72, 0.8, 0.9, 12), shoe, { p: [-0.2, 0.25, 0] });
    sp.into(ankle);
    const so = new Parts().add(new THREE.SphereGeometry(1, 16, 8), sole, { p: [0.95, -0.72, 0], s: [2.25, 0.32, 1.05] });
    if (hi) for (let k = 0; k < 3; k++) so.add(new THREE.BoxGeometry(0.12, 0.08, 0.8), sole, { p: [0.9 + k * 0.42, 0.62 - k * 0.12, 0], r: [0, 0, -0.35] });
    so.into(ankle, { cast: false });
    legs.push({ hip, knee, ankle, side });
  }

  // weapons (one group per type, shown as needed), held in front of the chest
  const guns = {};
  if (opts.armed !== false) {
    for (const k of Object.keys(WEAPON)) {
      let w = weaponGeoCache.get(k);
      if (!w) { w = weaponModel(k, wmats); weaponGeoCache.set(k, w); }
      const inst = w.clone();
      inst.position.set(...WEAPON[k].anchor);
      inst.visible = false;
      spine.add(inst);
      guns[k] = inst;
    }
  }
  root.userData = { pelvis, spine, neck, head, arms, legs, guns, mats: [skin, hair, shirt, pants], kind: 'human', irisMat: irisM };
  return root;
}

// ---------------------------------------------------------------- skinned (enemies)
// Bakes a built human into ONE SkinnedMesh: every part is merged into a single
// geometry with per-vertex colours and rigidly bound to a bone that mirrors its
// joint group. poseHuman() drives the bones exactly like the groups, but an enemy
// costs one draw call (plus one for glowing eyes) instead of ~20.
export function bakeSkinned(rig, { glowMat = null } = {}) {
  const u = rig.userData;
  const joints = [u.pelvis, u.spine, u.neck, u.head, ...u.arms.flatMap((a) => [a.sh, a.el, a.wr]), ...u.legs.flatMap((l) => [l.hip, l.knee, l.ankle])];
  const { mesh, bone, mat } = bakeRig(rig, joints, { glowMat });
  const map = (j) => bone.get(j);
  const out = new THREE.Group();
  out.add(mesh);
  out.userData = {
    pelvis: map(u.pelvis), spine: map(u.spine), neck: map(u.neck), head: map(u.head),
    arms: u.arms.map((a) => ({ sh: map(a.sh), el: map(a.el), wr: map(a.wr), side: a.side })),
    legs: u.legs.map((l) => ({ hip: map(l.hip), knee: map(l.knee), ankle: map(l.ankle), side: l.side })),
    guns: {}, mats: [mat], kind: 'human',
  };
  return out;
}

// Generic: merges every mesh under `rig` into one SkinnedMesh whose bones mirror
// `joints` (each part rigidly bound to its nearest joint). Meshes using glowMat stay
// separate (emissive) and ride on their bone. Returns { mesh, bone: Map(joint -> Bone), mat }.
export function bakeRig(rig, joints, { glowMat = null, roughness = 0.65 } = {}) {
  rig.updateMatrixWorld(true);
  const bone = new Map();
  const bones = joints.map((j) => { const b = new THREE.Bone(); b.position.copy(j.position); b.quaternion.copy(j.quaternion); b.scale.copy(j.scale); bone.set(j, b); return b; });
  for (const j of joints) { const pb = bone.get(j.parent); if (pb) pb.add(bone.get(j)); }
  const geos = [], glow = [];
  const inv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
  rig.traverse((o) => {
    if (!o.isMesh) return;
    let j = o.parent;
    while (j && !bone.has(j)) j = j.parent;
    if (!j) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (glowMat && o.material === glowMat) { // keep emissive parts (eyes) as a separate mesh on their bone
      const local = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(j.matrixWorld).invert(), o.matrixWorld);
      const g = o.geometry.clone().applyMatrix4(local);
      glow.push([bone.get(j), g]);
      return;
    }
    const g = o.geometry.clone().applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const c = o.material.color;
    const idx = joints.indexOf(j);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; si[i * 4] = idx; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geos.push(g);
  });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness });
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  for (const j of joints) if (!bone.get(j).parent) mesh.add(bone.get(j)); // root bones
  mesh.bind(new THREE.Skeleton(bones));
  if (glow.length) { // one merged emissive mesh per bone
    const byBone = new Map();
    for (const [b, g] of glow) { if (!byBone.has(b)) byBone.set(b, []); byBone.get(b).push(g); }
    for (const [b, list] of byBone) b.add(new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], glowMat));
  }
  return { mesh, bone, mat };
}

// ---------------------------------------------------------------- posing
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _D = new THREE.Vector3(), _P = new THREE.Vector3();
const _Q = new THREE.Quaternion(), _Q2 = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0);
const L1 = 4.6, L2 = 4.6; // shoulder->elbow, elbow->palm

// Two-bone IK in spine space: points the upper arm at the elbow and the forearm at the target.
function reach(arm, tx, ty, tz) {
  _S.copy(arm.sh.position);
  _T.set(tx, ty, tz);
  _D.subVectors(_T, _S);
  const d = Math.min(L1 + L2 - 0.05, Math.max(0.6, _D.length()));
  _D.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  // elbow points down and out: the pole direction with its component along the reach removed
  _P.set(0, -1, arm.side * 0.7);
  _P.addScaledVector(_D, -_D.dot(_P)).normalize();
  _E.copy(_S).addScaledVector(_D, a).addScaledVector(_P, h);
  _Q.setFromUnitVectors(DOWN, _E.clone().sub(_S).normalize());
  arm.sh.quaternion.copy(_Q);
  _Q2.setFromUnitVectors(DOWN, _T.clone().sub(_E).normalize());
  arm.el.quaternion.copy(_Q.invert()).multiply(_Q2);
  arm.wr.quaternion.set(0, 0, 0, 1);
}

// state: { phase, moving, wpn, hurt, t, armed, motion: [dx, dy], ang }
export function poseHuman(o, s) {
  const u = o.userData;
  // movement relative to facing: forward / sideways share of the step
  let fwd = 1, side = 0, speed = s.moving ? 1 : 0;
  if (s.motion && s.moving) {
    const [dx, dy] = s.motion, l = Math.hypot(dx, dy);
    if (l > 1e-4) { const c = Math.cos(s.ang || 0), n = Math.sin(s.ang || 0); fwd = (dx * c + dy * n) / l; side = (-dx * n + dy * c) / l; }
  }
  const ph = s.phase;
  for (const L of u.legs) {
    const lp = ph + (L.side > 0 ? Math.PI : 0);
    const sw = Math.sin(lp) * 0.55 * speed;
    L.hip.rotation.set(sw * side * 0.7 * L.side, 0, sw * fwd);
    const bend = speed * (0.12 + Math.max(0, -Math.cos(lp)) * 0.95);
    L.knee.rotation.set(0, 0, -bend);
    L.ankle.rotation.set(0, 0, bend * 0.45 - sw * fwd * 0.4);
  }
  const t = s.t;
  u.pelvis.position.y = 14.4 - (speed ? Math.abs(Math.sin(ph)) * 0.35 : 0);
  u.spine.rotation.set(speed ? Math.sin(ph) * 0.06 : 0, speed ? -Math.sin(ph) * 0.08 : 0, speed ? -0.06 * fwd : 0);
  const breath = 1 + Math.sin(t * 1.7) * 0.012;
  u.spine.scale.set(breath, 1, breath);
  u.head.rotation.set(0, 0, speed ? 0.04 : Math.sin(t * 0.6) * 0.03);

  const armed = s.armed !== false && Object.keys(u.guns).length;
  for (const k in u.guns) u.guns[k].visible = armed && k === (s.wpn || 'pistol');
  if (armed) {
    const W = WEAPON[s.wpn] || WEAPON.pistol;
    const [ax, ay, az] = W.anchor;
    reach(u.arms[1], ax + W.right[0], ay + W.right[1], az + W.right[2]);
    reach(u.arms[0], ax + W.left[0], ay + W.left[1], az + W.left[2]);
  } else {
    for (const A of u.arms) {
      const sw = speed ? Math.sin(ph + (A.side > 0 ? 0 : Math.PI)) * 0.45 * fwd : Math.sin(t * 1.3 + A.side) * 0.03;
      A.sh.quaternion.setFromEuler(new THREE.Euler(-A.side * 0.09, 0, sw)); // arms hang slightly away from the body
      A.el.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.25 + (speed ? Math.max(0, sw) * 0.5 : 0)));
      A.wr.quaternion.set(0, 0, 0, 1);
    }
  }
  const e = s.hurt > 0 ? Math.min(0.5, s.hurt * 1.5) : 0;
  for (const m of u.mats) m.emissive.setRGB(e, 0.05 * e, 0.1 * e);
}
