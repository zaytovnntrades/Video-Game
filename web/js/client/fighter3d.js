// Procedural, fully parametric fighter built from a fighter spec.
// One continuous skinned body (torso, arms, legs bend smoothly at every joint) with
// clothing regions baked in, plus rigid parts on the bones: a sculpted head with 3D
// eyes, lids, brows and lips, curved textured hair clumps, fists, footwear and gear.
// Two looks share the same rig: 'real' (physically based materials, default) and
// 'anime' (cel shading + outlines). Every dimension comes from the spec.
import * as THREE from '../../vendor/three/three.module.js';
import { mergeVertices } from '../../vendor/three/utils/BufferGeometryUtils.js';
import { OPTIONS } from '../sim/spec.js';
import { MELEE } from '../sim/data.js';
import { compactChildren } from './merge.js';
import { textures, cvs } from './textures.js';

export const RENDER = { style: 'real' }; // set from Settings before fighters are built

// ---------------------------------------------------------------- shared materials
let GRADIENT = null;
function gradient() {
  if (GRADIENT) return GRADIENT;
  const d = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  GRADIENT = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  GRADIENT.minFilter = GRADIENT.magFilter = THREE.NearestFilter;
  GRADIENT.needsUpdate = true;
  return GRADIENT;
}
export const OUTLINE = new THREE.ShaderMaterial({
  uniforms: { uThick: { value: 0.014 }, uColor: { value: new THREE.Color(0x15121c) } },
  vertexShader: 'uniform float uThick; void main(){ vec3 p = position + normal * uThick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }',
  side: THREE.BackSide,
});
// the same inverted-hull outline for the skinned body
const OUTLINE_SKIN = new THREE.ShaderMaterial({
  uniforms: { uThick: { value: 0.012 }, uColor: { value: new THREE.Color(0x15121c) } },
  vertexShader: `#include <common>
#include <skinning_pars_vertex>
uniform float uThick;
void main(){
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  transformed += normalize(objectNormal) * uThick;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}`,
  fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }',
  side: THREE.BackSide,
});

const AURA_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const AURA_FS = `uniform vec3 uColor; uniform float uTime; uniform float uPower; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  float rim = 1.0 - abs(dot(vN, vV));
  vec2 q = vec2(vUv.x * 9.0, vUv.y * 3.0 - uTime * 2.6);
  float fl = n(q) * 0.6 + n(q * 2.3 + 4.0) * 0.4;
  float tip = smoothstep(1.0, 0.3, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
  float edge = smoothstep(0.15, 0.75, rim) * smoothstep(1.0, 0.82, rim);
  float tongues = smoothstep(0.25 + vUv.y * 0.55, 0.9, fl);
  float a = tongues * tip * uPower * (0.12 + edge * 0.8);
  vec3 c = mix(uColor, vec3(1.0), smoothstep(0.8, 1.0, fl * tip) * 0.6);
  gl_FragColor = vec4(c * 0.95, clamp(a, 0.0, 0.85));
}`;

const hex = (c) => new THREE.Color(c);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const HEADK = 0.071; // the head is modelled in "head units"; this converts to metres

// ---------------------------------------------------------------- skinned tube builder
// Rings of vertices around an axis, each weighted to the skeleton, with a material per
// segment. Produces one BufferGeometry with draw groups per material.
class SkinBuilder {
  constructor(nMats) { this.p = []; this.uv = []; this.si = []; this.sw = []; this.tris = Array.from({ length: nMats }, () => []); }
  v(x, y, z, u, vv, w) {
    this.p.push(x, y, z); this.uv.push(u, vv);
    const ws = w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = ws.reduce((s, a) => s + a[1], 0) || 1;
    for (let i = 0; i < 4; i++) { this.si.push(ws[i] ? ws[i][0] : 0); this.sw.push(ws[i] ? ws[i][1] / tot : 0); }
    return this.p.length / 3 - 1;
  }
  // rings: [{c: [x,y,z], rx, rz, w: weights, mat, v}] in order along the tube
  tube(rings, seg, { capStart = false, capEnd = false } = {}) {
    const idx = rings.map((r) => {
      const out = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        out.push(this.v(r.c[0] + Math.sin(a) * r.rx, r.c[1], r.c[2] + Math.cos(a) * r.rz, j / seg, r.v ?? 0, r.w));
      }
      return out;
    });
    for (let i = 0; i < rings.length - 1; i++) {
      const T = this.tris[rings[i].mat], A = idx[i], B = idx[i + 1];
      const down = rings[i + 1].c[1] < rings[i].c[1];
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        if (down) T.push(A[j], B[j], A[j2], A[j2], B[j], B[j2]);
        else T.push(A[j], A[j2], B[j], A[j2], B[j2], B[j]);
      }
    }
    const cap = (ri, atTop) => { // close an end with a slightly domed fan
      const r = rings[ri], c = this.v(r.c[0], r.c[1] + (atTop ? 1 : -1) * Math.min(r.rx, r.rz) * 0.5, r.c[2], 0.5, r.v ?? 0, r.w);
      const T = this.tris[r.mat];
      for (let j = 0; j < seg; j++) { const a = idx[ri][j], b = idx[ri][(j + 1) % seg]; if (atTop) T.push(c, a, b); else T.push(c, b, a); }
    };
    const down = rings[rings.length - 1].c[1] < rings[0].c[1];
    if (capStart) cap(0, down);
    if (capEnd) cap(rings.length - 1, !down);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const all = []; let start = 0;
    this.tris.forEach((t, m) => { if (!t.length) return; all.push(...t); g.addGroup(start, t.length, m); start += t.length; });
    g.setIndex(all);
    g.computeVertexNormals();
    return g;
  }
}
// weights along a chain: joints = [{t, bone}] (t decreasing down the chain), blend half-width b
function chain(t, joints, b) {
  const s = joints.map((j, i) => (i === 0 ? 1 : sstep(j.t + b, j.t - b, t)));
  return joints.map((j, i) => [j.bone, Math.max(0, s[i] - (s[i + 1] ?? 0))]).filter((w) => w[1] > 0.001);
}

// ---------------------------------------------------------------- sculpted head (head units, faces +x)
let HEADGEO = null;
function headGeometry() {
  if (HEADGEO) return HEADGEO;
  const g = new THREE.SphereGeometry(1, 44, 30);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = x * 1.48, Y = y * 1.86, Z = z * 1.28;
    if (y < -0.12) { const t = (-y - 0.12) / 0.88; Z *= 1 - 0.36 * t; X *= x > 0 ? 1 - 0.1 * t : 1 - 0.4 * t; }
    if (y < -0.62 && x > 0.35) X += 0.16 * (x - 0.35);
    if (x < 0 && y > -0.35) X *= 1.07;
    if (x > 0.55 && y > 0.12 && y < 0.38) X += 0.07 * (x - 0.55) * 3;
    if (x > 0.7 && y > -0.02 && y < 0.22 && Math.abs(z) > 0.16 && Math.abs(z) < 0.52) X -= 0.08;
    if (y > -0.38 && y < -0.05 && Math.abs(z) > 0.38 && x > 0.15) Z *= 1.04;
    if (y > 0.72) Y = 1.86 * (0.72 + (y - 0.72) * 0.86);
    p.setXYZ(i, X, Y, Z);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  const pp = m.attributes.position, uv = new Float32Array(pp.count * 2);
  for (let i = 0; i < pp.count; i++) { uv[i * 2] = Math.atan2(pp.getZ(i), pp.getX(i)) / (Math.PI * 2) + 0.5; uv[i * 2 + 1] = pp.getY(i) / 4 + 0.5; }
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  HEADGEO = m;
  return m;
}
let CAPGEO = null;
function hairCap() {
  if (CAPGEO) return CAPGEO;
  const g = new THREE.SphereGeometry(1, 56, 36, 0, Math.PI * 2, 0, Math.PI * 0.72);
  const p = g.attributes.position;
  let seed = 17; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = Math.max(0, x), side = Math.abs(z);
    const line = x > 0 ? 0.42 * front * front + 0.1 * side - 0.05 * (1 - front) : -0.05 - 0.37 * (-x) * (1 - side * 0.5);
    const edge = line + Math.sin(Math.atan2(z, x) * 9) * 0.018 + (R() - 0.5) * 0.004; // soft, natural hairline
    const k = 0.55 + (1.07 + (y > 0.3 ? 0.02 : 0) - 0.55) * sstep(edge - 0.06, edge + 0.05, y);
    p.setXYZ(i, x * 1.48 * k, y * 1.86 * k * (y > 0.72 ? 0.97 : 1), z * 1.3 * k);
  }
  g.computeVertexNormals();
  CAPGEO = g;
  return g;
}
// a curved, tapering clump of hair along p(t) = p0 + d*L*t + droop*L*t^2 (head units)
function clumpGeometry(p0, d, L, r0, droop, flat = 0.7) {
  const rings = 7, seg = 7, pos = [], uv = [], idx = [];
  const P = (t) => new THREE.Vector3().copy(p0).addScaledVector(d, L * t).addScaledVector(droop, L * t * t);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, c = P(t), tan = P(Math.min(1, t + 0.02)).sub(P(Math.max(0, t - 0.02))).normalize();
    const a = new THREE.Vector3(0, 1, 0); if (Math.abs(tan.dot(a)) > 0.9) a.set(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(tan, a).normalize(), w = new THREE.Vector3().crossVectors(tan, u);
    const r = r0 * Math.pow(1 - t, 0.85) + 0.004;
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      const q = c.clone().addScaledVector(u, Math.cos(ang) * r).addScaledVector(w, Math.sin(ang) * r * flat);
      pos.push(q.x, q.y, q.z); uv.push(j / seg, t);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, e = b + seg;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// per-fighter head texture: skin tone, mottling and face marks (u around, v up)
function headTexture(spec) {
  const W = 512, H = 256, c = cvs(W, H), g = c.getContext('2d');
  g.fillStyle = spec.body.skin; g.fillRect(0, 0, W, H);
  let s = 9; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '120,50,40' : '255,230,210'},0.035)`; g.beginPath(); g.arc(R() * W, R() * H, 6 + R() * 18, 0, 7); g.fill(); }
  const U = (z, x) => (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * W; // head-unit direction -> canvas x
  const Y = (y) => (1 - (y / 4 + 0.5)) * H; // head-unit height -> canvas y
  // cheek warmth
  for (const z of [-0.85, 0.85]) { const gr = g.createRadialGradient(U(z, 1.1), Y(-0.45), 0, U(z, 1.1), Y(-0.45), 22); gr.addColorStop(0, 'rgba(220,90,90,0.16)'); gr.addColorStop(1, 'rgba(220,90,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  const m = spec.face.marks;
  if (m === 1) { g.strokeStyle = 'rgba(110,40,40,0.75)'; g.lineWidth = 3; g.beginPath(); g.moveTo(U(-0.3, 1.35), Y(0.75)); g.lineTo(U(-0.75, 1.2), Y(-0.55)); g.stroke(); }
  if (m === 2) { g.fillStyle = spec.outfit.topAccent; for (const z of [-0.85, 0.85]) { g.save(); g.translate(U(z, 1.05), Y(-0.4)); g.rotate(z > 0 ? -0.3 : 0.3); g.fillRect(-3, -14, 6, 28); g.restore(); } }
  if (m === 3) { g.fillStyle = 'rgba(130,70,45,0.6)'; for (let i = 0; i < 26; i++) { const z = (R() - 0.5) * 1.6; g.beginPath(); g.arc(U(z, 1.3), Y(-0.15 - R() * 0.4), 1.3, 0, 7); g.fill(); } }
  if (m === 4) { g.fillStyle = spec.aura.color; for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(U(i * 0.18, 1.4), Y(1.05 - Math.abs(i) * 0.06), 3, 0, 7); g.fill(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- the fighter
export class FighterModel {
  constructor(spec) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // pitched/rolled for flight, offset for bob
    this.root.add(this.body);
    this.mats = new Map();
    this.flash = 0; this.time = 0; this.phase = 0; this.ascended = false;
    this.blinkT = 2 + Math.random() * 3; this.expr = { lid: 0, brow: 0, mouth: 0 };
    this.anime = RENDER.style === 'anime';
    this.build(spec);
  }

  // kind: skin | cloth | canvas | leather | metal | hair | plain
  mat(kind, color, opts = {}) {
    const key = kind + color + (opts.emissive ? '*' + opts.emissive : '') + (opts.side || '') + (opts.map ? '#map' : '');
    if (this.mats.has(key)) return this.mats.get(key);
    let m;
    if (this.anime) m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: gradient(), map: opts.map || null });
    else {
      const T = textures();
      const P = {
        skin: () => new THREE.MeshPhysicalMaterial({ color: hex(color), map: opts.map || T.skin[0], normalMap: T.skin[1], normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.52, sheen: 0.35, sheenRoughness: 0.6, sheenColor: hex('#ffb59c') }),
        cloth: () => new THREE.MeshStandardMaterial({ color: hex(color), map: T.cotton[0], normalMap: T.cotton[1], normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.9 }),
        canvas: () => new THREE.MeshStandardMaterial({ color: hex(color), map: T.canvas[0], normalMap: T.canvas[1], normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.92 }),
        leather: () => new THREE.MeshStandardMaterial({ color: hex(color), map: T.leather[0], normalMap: T.leather[1], normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.45 }),
        metal: () => new THREE.MeshStandardMaterial({ color: hex(color), map: T.leather[0], normalMap: T.leather[1], normalScale: new THREE.Vector2(0.15, 0.15), roughness: 0.32, metalness: 0.75 }),
        hair: () => new THREE.MeshStandardMaterial({ color: hex(color), map: T.hair[0], normalMap: T.hair[1], normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.42 }),
        plain: () => new THREE.MeshStandardMaterial({ color: hex(color), roughness: opts.rough ?? 0.5 }),
      };
      m = (P[kind] || P.plain)();
    }
    if (opts.side) m.side = opts.side;
    if (opts.emissive) { m.emissive = hex(color); m.emissiveIntensity = opts.emissive === true ? 0.6 : opts.emissive; }
    this.mats.set(key, m);
    return m;
  }

  part(geo, mat, parent, { outline = true, pos, rot, scale, keep = false } = {}) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    m.userData.keep = keep;
    if (outline && this.anime) { const o = new THREE.Mesh(geo, OUTLINE); o.castShadow = false; m.add(o); }
    parent.add(m);
    return m;
  }

  joint(parent, x, y, z) { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); return b; }

  dispose() {
    this.root.traverse((o) => { if (o.geometry && o.geometry !== HEADGEO && o.geometry !== CAPGEO) o.geometry.dispose(); });
    for (const m of this.mats.values()) { if (m.map && m.map.userData?.own) m.map.dispose(); m.dispose(); }
    this.headTex?.dispose();
    this.aura?.material.dispose();
    this.root.removeFromParent();
  }

  // clothing material for a top/bottom style
  clothKind(name) {
    if (['Wrap Gi', 'Sleeveless Gi', 'Gi Pants'].includes(name)) return 'canvas';
    if (name === 'Armor') return 'metal';
    return 'cloth';
  }

  build(spec) {
    this.spec = spec;
    const B = spec.body, O = spec.outfit;
    const S = 0.9 + B.height * 0.22; // overall scale
    const bw = 0.85 + B.build * 0.45; // limb/torso thickness
    const sw = 0.88 + B.shoulders * 0.34; // shoulder width
    this.scale = S;
    this.body.scale.setScalar(S);
    const top = OPTIONS.top[O.top], bottom = OPTIONS.bottom[O.bottom], feet = OPTIONS.feet[O.feet], hands = OPTIONS.hands[O.hands];
    const skinM = this.mat('skin', B.skin);
    const topM = this.mat(this.clothKind(top), O.topColor), botM = this.mat(this.clothKind(bottom), O.bottomColor);
    const handM = this.mat(hands === 'Wraps' ? 'cloth' : 'leather', O.handsColor), feetM = this.mat(feet === 'Wraps' ? 'cloth' : 'leather', O.feetColor);
    const MATS = [skinM, topM, botM, handM, feetM]; // body material slots
    const [SKIN, TOP, BOT, HAND, FEET] = [0, 1, 2, 3, 4];

    // ---- skeleton (same joints as the pose tables)
    const J = (this.J = {});
    J.hips = this.joint(this.body, 0, 0.9, 0);
    J.spine = this.joint(J.hips, 0, 0.12, 0);
    J.chest = this.joint(J.spine, 0, 0.18, 0);
    J.neck = this.joint(J.chest, 0, 0.22, 0);
    J.head = this.joint(J.neck, 0, 0.1, 0.01);
    const shX = 0.19 * sw * Math.sqrt(bw);
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      J['up' + k] = this.joint(J.chest, s * shX, 0.14, -0.005);
      J['fore' + k] = this.joint(J['up' + k], 0, -0.28, 0);
      J['hand' + k] = this.joint(J['fore' + k], 0, -0.27, 0);
      J['thigh' + k] = this.joint(J.hips, s * 0.092 * bw, -0.02, 0);
      J['shin' + k] = this.joint(J['thigh' + k], 0, -0.43, 0);
      J['foot' + k] = this.joint(J['shin' + k], 0, -0.42, 0);
    }
    const bones = Object.values(J);
    const BI = (name) => bones.indexOf(J[name]);

    // ---- continuous skinned body
    const SB = new SkinBuilder(MATS.length);
    const seg = 18;
    const topCovers = top !== 'Vest';
    const topWide = { 'Wrap Gi': 1.1, 'Sleeveless Gi': 1.08, Jacket: 1.08, Vest: 1, Tank: 1.03, Hoodie: 1.12, Armor: 1.06 }[top];
    // torso profile: y -> [rx, rz, cz] (body-local metres at bind pose)
    const prof = [
      [0.81, 0.1, 0.075, 0.0], [0.835, 0.15, 0.1, -0.005], [0.86, 0.168, 0.112, -0.01], [0.93, 0.16, 0.105, 0], [1.0, 0.142, 0.098, 0.005],
      [1.06, 0.145, 0.1, 0.008], [1.13, 0.158, 0.108, 0.012], [1.2, 0.175 * sw, 0.118, 0.018], [1.27, 0.186 * sw, 0.12, 0.016], [1.33, 0.18 * sw, 0.108, 0.006],
      [1.37, 0.15 * sw, 0.09, 0], [1.405, 0.075, 0.062, 0], [1.45, 0.056, 0.056, 0.004], [1.53, 0.052, 0.054, 0.008], [1.57, 0.045, 0.05, 0.01],
    ];
    // t = -y so the chain runs up the body: hips, then spine, chest, neck, head
    const torsoJ = [{ t: 0, bone: BI('hips') }, { t: -1.04, bone: BI('spine') }, { t: -1.2, bone: BI('chest') }, { t: -1.42, bone: BI('neck') }, { t: -1.53, bone: BI('head') }];
    const waist = 1.0; // trousers below, top above
    const torsoRings = [];
    for (const [y, rx, rz, cz] of prof) {
      let mat = y < waist ? BOT : y < 1.4 ? (topCovers ? TOP : SKIN) : SKIN;
      if (top === 'Tank' && y > 1.35) mat = SKIN;
      if ((top === 'Jacket' || top === 'Hoodie') && y >= 1.4 && y < 1.45) mat = TOP;
      const clothK = mat === BOT ? ({ Baggy: 1.08, 'Gi Pants': 1.06 }[bottom] || 1.02) : mat === TOP ? topWide : 1;
      const k = (y < 1.4 ? bw : Math.sqrt(bw)) * clothK;
      torsoRings.push({ c: [0, y, cz], rx: rx * k, rz: rz * k * (y > 1.15 && y < 1.34 ? 1 + B.build * 0.1 : 1), w: chain(-y, torsoJ, 0.05), mat, v: y * 3 });
    }
    SB.tube(torsoRings, seg, { capStart: true, capEnd: true });

    // arms: shoulder (t=0) -> elbow (-0.28) -> wrist (-0.55); hanging straight down at bind
    const sleeve = { 'Wrap Gi': -0.3, 'Sleeveless Gi': 0.1, Jacket: -0.53, Vest: 0.1, Tank: 0.1, Hoodie: -0.53, Armor: -0.2 }[top];
    const sleeveW = { 'Wrap Gi': 1.35, Jacket: 1.12, Hoodie: 1.15, Armor: 1.1 }[top] || 1;
    const armProf = [[0.06, 0.035], [0.035, 0.062], [0.0, 0.07], [-0.07, 0.066], [-0.15, 0.06], [-0.23, 0.052], [-0.28, 0.046], [-0.33, 0.05], [-0.4, 0.047], [-0.48, 0.038], [-0.54, 0.033], [-0.57, 0.03]];
    const wrap = hands === 'Wraps' ? -0.42 : hands === 'Gauntlets' ? -0.34 : 0;
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R', sh = J['up' + k];
      const sx = sh.position.x, sy = J.chest.position.y + J.spine.position.y + J.hips.position.y + sh.position.y;
      const armJ = [{ t: 0.2, bone: BI('chest') }, { t: 0.02, bone: BI('up' + k) }, { t: -0.28, bone: BI('fore' + k) }, { t: -0.55, bone: BI('hand' + k) }];
      const rings = [];
      for (const [t, r] of armProf) {
        let mat = SKIN, kk = 1;
        if (t > sleeve) { mat = TOP; kk = 1 + (sleeveW - 1) * sstep(0.0, sleeve, t) + 0.05; }
        if (wrap && t <= wrap) { mat = HAND; kk = hands === 'Gauntlets' ? 1.3 : 1.08; }
        rings.push({ c: [sx + (t > 0 ? -s * 0.012 : 0), sy + t, sh.position.z], rx: r * bw * kk * 1.04, rz: r * bw * kk, w: chain(t, armJ, 0.045), mat, v: t * 4 });
      }
      SB.tube(rings, 14, { capStart: true, capEnd: true });
    }
    // legs: hip (t=0) -> knee (-0.43) -> ankle (-0.85)
    const legWide = { 'Gi Pants': 1.28, Baggy: 1.5, Fitted: 1.05, Shorts: 1.12 }[bottom];
    const legProf = [[0.08, 0.088], [0.0, 0.094], [-0.1, 0.09], [-0.22, 0.08], [-0.34, 0.066], [-0.43, 0.058], [-0.5, 0.06], [-0.58, 0.062], [-0.68, 0.052], [-0.78, 0.04], [-0.85, 0.037], [-0.87, 0.034]];
    const shortsEnd = -0.3, bootTop = feet === 'Boots' ? -0.6 : feet === 'Wraps' ? -0.74 : -9;
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R', th = J['thigh' + k];
      const hx = th.position.x, hy = J.hips.position.y + th.position.y;
      const legJ = [{ t: 0.3, bone: BI('hips') }, { t: 0.03, bone: BI('thigh' + k) }, { t: -0.43, bone: BI('shin' + k) }, { t: -0.85, bone: BI('foot' + k) }];
      const rings = [];
      for (const [t, r] of legProf) {
        let mat = BOT, kk = 1 + (legWide - 1) * sstep(0.05, -0.5, t);
        if (bottom === 'Baggy' && t < -0.78) kk = 1.15; // gathered cuff
        if (bottom === 'Shorts' && t < shortsEnd) { mat = SKIN; kk = 1; }
        if (t <= bootTop) { mat = FEET; kk = feet === 'Boots' ? 1.35 : 1.1; }
        rings.push({ c: [hx, hy + t, 0.004], rx: r * bw * kk, rz: r * bw * kk * 1.04, w: chain(t, legJ, 0.05), mat, v: t * 3 });
      }
      SB.tube(rings, 14, { capStart: true, capEnd: true });
    }
    const bodyGeo = SB.build();
    const skinned = new THREE.SkinnedMesh(bodyGeo, MATS);
    skinned.castShadow = true; skinned.receiveShadow = true; skinned.frustumCulled = false;
    this.body.add(skinned);
    this.skinned = skinned;
    let outline = null;
    if (this.anime) { outline = new THREE.SkinnedMesh(bodyGeo, OUTLINE_SKIN); outline.frustumCulled = false; this.body.add(outline); }

    // ---- rigid parts on bones
    this.buildHead(spec, J.head, skinM, bw);
    this.buildHands(J, hands, skinM, handM, bw);
    this.buildFeet(J, feet, skinM, feetM, bw);
    this.buildGear(spec, J, top, prof, bw, sw, topM, botM);

    // bind the skin at the rest pose
    this.root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    skinned.bind(skeleton);
    if (outline) outline.bind(skeleton, skinned.bindMatrix);

    // ---- aura shell
    const aprof = [[0.2, -0.05], [0.48, 0.25], [0.62, 0.85], [0.58, 1.45], [0.42, 1.95], [0.2, 2.3], [0.02, 2.55]].map(([r, y]) => new THREE.Vector2(r, y));
    this.aura = new THREE.Mesh(new THREE.LatheGeometry(aprof, 28), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: hex(spec.aura.color) }, uTime: { value: 0 }, uPower: { value: 0 } },
      vertexShader: AURA_VS, fragmentShader: AURA_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.aura.renderOrder = 5; this.aura.frustumCulled = false;
    this.root.add(this.aura);
    this.auraPower = 0;
    // soft contact shadow
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    this.shadow = sh; this.mats.set('#shadow', sh.material);

    // fewer draw calls: merge each bone's rigid parts per material
    for (const j of [...Object.values(J), this.headFrame, this.hair]) compactChildren(j, OUTLINE);
    this.flashMats = [...this.mats.values()].filter((m) => m.emissive && !m.userData.iris);
    this.rest = {};
    for (const [k, j] of Object.entries(J)) this.rest[k] = j.rotation.clone();
  }

  // ---------------------------------------------------------------- head & face
  buildHead(spec, headBone, skinM, bw) {
    // all head parts are modelled in "head units" facing +x, inside a frame turned to face +z
    const F = (this.headFrame = new THREE.Group());
    F.position.set(0, 0.108, 0.014); F.rotation.y = -Math.PI / 2; F.scale.setScalar(HEADK * (0.96 + bw * 0.04));
    headBone.add(F);
    this.headTex = headTexture(spec);
    const headM = this.anime ? this.mat('skin', '#ffffff', { map: this.headTex }) : this.mat('skin', '#ffffff', { map: this.headTex });
    this.part(headGeometry(), headM, F);
    const eyeY = 0.3, eyeX = 1.15;
    const es = spec.face.eyes; // Sharp, Round, Narrow, Fierce
    this.eyeOpen = [0.26, 0.45, 0.12, 0.18][es]; // lid edge elevation (radians above the eye's centre line)
    const eyeScale = [1, 1.1, 0.95, 1][es];
    const sclera = this.mat('plain', '#f1ede6', { rough: 0.25 });
    const iris = this.mat('plain', spec.face.eyeColor, { rough: 0.1 });
    iris.userData.iris = true;
    this.irisMat = iris;
    const lipsM = this.mat('plain', '#' + hex(spec.body.skin).lerp(hex('#9a4a48'), 0.35).getHexString(), { rough: 0.45 });
    const browM = this.mat('hair', spec.hair.color === '#e8e2d6' ? '#9a917f' : spec.hair.color);
    this.lids = []; this.brows = [];
    for (const z of [-0.5, 0.5]) {
      // ears (pointed option)
      if (spec.face.ears === 1) this.part(new THREE.ConeGeometry(0.3, 1.5, 8), skinM, F, { pos: [-0.25, 0.4, z * 2.5], rot: [Math.sign(z) * 1.0, 0, 0.45], scale: [0.45, 1, 1] });
      else this.part(new THREE.SphereGeometry(0.42, 10, 8), skinM, F, { pos: [-0.25, 0.05, z * 2.55], scale: [0.55, 1.05, 0.32] });
      const er = 0.245 * eyeScale;
      this.part(new THREE.SphereGeometry(er, 18, 14), sclera, F, { pos: [eyeX, eyeY, z], outline: false });
      // iris and pupil: thin caps on the eyeball's front, so they curve with it
      this.part(new THREE.SphereGeometry(er * 1.012, 20, 6, 0, Math.PI * 2, 0, 0.62), iris, F, { pos: [eyeX, eyeY, z], rot: [0, 0, -Math.PI / 2], outline: false });
      this.part(new THREE.SphereGeometry(er * 1.02, 16, 4, 0, Math.PI * 2, 0, 0.26), this.mat('plain', '#050505', { rough: 0.05 }), F, { pos: [eyeX, eyeY, z], rot: [0, 0, -Math.PI / 2], outline: false });
      // upper lid: a skin cap that rotates down over the eye (blinks, pain, effort)
      const lid = this.part(new THREE.SphereGeometry(0.27 * eyeScale, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), skinM, F, { pos: [eyeX + 0.005, eyeY, z], keep: true, outline: false });
      lid.rotation.z = this.eyeOpen; this.lids.push(lid);
      const lower = this.part(new THREE.SphereGeometry(0.265 * eyeScale, 16, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), skinM, F, { pos: [eyeX + 0.005, eyeY, z], outline: false });
      lower.rotation.z = 0.12;
      // brows
      const bs = spec.face.brows; // Straight, Arched, Angry, Thin
      const brow = this.part(new THREE.CapsuleGeometry([0.065, 0.058, 0.07, 0.038][bs], 0.5, 3, 8), browM, F, { pos: [1.4, eyeY + 0.36, z * 1.04], rot: [Math.PI / 2 + z * [0, 0.35, -0.45, 0.2][bs], 0, 0], scale: [0.55, 1, 1], keep: true, outline: false });
      brow.userData.baseRot = brow.rotation.x; brow.userData.side = z; brow.userData.baseY = brow.position.y;
      this.brows.push(brow);
    }
    // nose
    this.part(new THREE.ConeGeometry(0.17, 0.82, 12), skinM, F, { pos: [1.5, -0.16, 0], rot: [0, 0, -2.55], scale: [1, 1, 0.8], outline: false });
    this.part(new THREE.SphereGeometry(0.125, 12, 10), skinM, F, { pos: [1.56, -0.46, 0], scale: [1, 0.9, 1.05], outline: false });
    for (const z of [-0.13, 0.13]) this.part(new THREE.SphereGeometry(0.085, 10, 8), skinM, F, { pos: [1.47, -0.5, z], outline: false });
    // mouth: lips + a dark opening that shows when shouting
    this.mouthDark = this.part(new THREE.SphereGeometry(0.26, 12, 8), this.mat('plain', '#3a1418', { rough: 0.8 }), F, { pos: [1.3, -0.97, 0], scale: [0.4, 0.05, 1.1], keep: true, outline: false });
    this.upperLip = this.part(new THREE.CapsuleGeometry(0.055, 0.36, 3, 10), lipsM, F, { pos: [1.41, -0.92, 0], rot: [Math.PI / 2, 0, 0], scale: [0.8, 1, 1], keep: true, outline: false });
    this.lowerLip = this.part(new THREE.CapsuleGeometry(0.068, 0.3, 3, 10), lipsM, F, { pos: [1.385, -1.03, 0], rot: [Math.PI / 2, 0, 0], scale: [0.8, 1, 1], keep: true, outline: false });
    // hair
    this.hair = new THREE.Group(); F.add(this.hair);
    this.buildHair(spec.hair.style, spec.hair.color);
    if (spec.outfit.accessory === 4) { // cloth headband with tails
      const bandM = this.mat('cloth', spec.outfit.accessoryColor);
      this.part(new THREE.TorusGeometry(1, 0.1, 8, 32), bandM, F, { pos: [-0.05, 1.05, 0], rot: [Math.PI / 2, 0.12, 0], scale: [1.56, 1.38, 1] });
      for (const z of [-0.25, 0.25]) this.part(new THREE.BoxGeometry(0.06, 2.2, 0.42), bandM, F, { pos: [-1.75, 0.2, z], rot: [z * 1.2, 0, -0.45] });
    }
  }

  // ---------------------------------------------------------------- hair (head units)
  clump(dir, lenM, rM, { droop = 0.35, at = 1, back = 0 } = {}) {
    // dir uses fighter axes [x right, y up, z forward] -> head frame (x forward, z = -right)
    const d = new THREE.Vector3(dir[2], dir[1], -dir[0]).normalize();
    const p0 = new THREE.Vector3(d.x * 1.48, d.y * 1.86, d.z * 1.3).multiplyScalar(at * 0.97);
    const out = d.clone().lerp(new THREE.Vector3(-1, 0, 0), back).normalize();
    const g = clumpGeometry(p0, out, lenM / HEADK, rM / HEADK, new THREE.Vector3(-0.35, -droop, 0));
    return this.part(g, this.hairMat, this.hair);
  }

  buildHair(style, color) {
    const H = this.hair;
    while (H.children.length) { const c = H.children.pop(); c.traverse((o) => { if (o.geometry !== CAPGEO) o.geometry?.dispose(); }); }
    this.hairMat = this.mat('hair', color);
    const cap = (k = 1) => this.part(hairCap(), this.hairMat, H, { scale: [k, k, k] });
    const name = OPTIONS.hairStyle[style];
    const R = (i) => ((Math.sin(i * 91.7) * 43758.5) % 1 + 1) % 1;
    switch (name) {
      case 'Spiked Crown':
        cap();
        for (let i = 0; i < 13; i++) { const a = (i / 13) * Math.PI * 2; this.clump([Math.cos(a) * 0.6, 0.85 + R(i) * 0.3, Math.sin(a) * 0.6 - 0.2], 0.15 + R(i + 3) * 0.07, 0.035, { droop: -0.05 }); }
        for (let i = 0; i < 4; i++) this.clump([-0.3 + i * 0.2, 0.5, 1], 0.07, 0.025, { droop: 0.3 });
        break;
      case 'Swept Back':
        cap();
        for (let i = 0; i < 9; i++) this.clump([-0.6 + i * 0.15, 0.75, 0.3], 0.18 + R(i) * 0.05, 0.04, { droop: 0.2, back: 0.75 });
        break;
      case 'Long Spikes':
        cap();
        for (let i = 0; i < 11; i++) this.clump([-0.8 + i * 0.16, 0.1 - R(i) * 0.3, -1], 0.34 + R(i + 1) * 0.12, 0.045, { droop: 0.55, back: 0.3 });
        for (let i = 0; i < 5; i++) this.clump([-0.5 + i * 0.25, 0.55, 1], 0.09, 0.03, { droop: 0.4 });
        break;
      case 'Wild Mane':
        cap(1.03);
        for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; this.clump([Math.cos(a), -0.2 + R(i) * 1.1, Math.sin(a) - 0.35], 0.15 + R(i + 9) * 0.1, 0.042, { droop: 0.15 }); }
        break;
      case 'Topknot': {
        cap(1.0);
        const bun = new THREE.IcosahedronGeometry(0.9, 2);
        this.part(bun, this.hairMat, H, { pos: [-0.5, 2.15, 0] });
        this.part(new THREE.TorusGeometry(0.45, 0.14, 6, 16), this.mat('cloth', this.spec.outfit.accessoryColor), H, { pos: [-0.45, 1.65, 0], rot: [Math.PI / 2, 0, 0] });
        break;
      }
      case 'Buzz Cut':
        this.part(hairCap(), this.hairMat, H, { scale: [0.985, 0.985, 0.985] });
        break;
      case 'Side Fringe':
        cap();
        for (let i = 0; i < 6; i++) this.clump([0.55 - i * 0.16, 0.55 - i * 0.04, 1], 0.16 + i * 0.015, 0.035, { droop: 0.25 }).rotateX(0.35);
        for (let i = 0; i < 7; i++) this.clump([-0.6 + i * 0.2, 0.1, -1], 0.13, 0.045, { droop: 0.5 });
        break;
      case 'Ponytail':
        cap();
        this.part(new THREE.TorusGeometry(0.35, 0.12, 6, 14), this.mat('cloth', this.spec.outfit.accessoryColor), H, { pos: [-1.7, 0.3, 0], rot: [0, Math.PI / 2, 0] });
        this.part(clumpGeometry(new THREE.Vector3(-1.7, 0.3, 0), new THREE.Vector3(-0.6, -0.2, 0).normalize(), 0.42 / HEADK, 0.06 / HEADK, new THREE.Vector3(0.2, -1.2, 0)), this.hairMat, H);
        break;
      case 'Mohawk':
        this.part(hairCap(), this.mat('hair', '#3a3036'), H, { scale: [0.98, 0.98, 0.98] });
        for (let i = 0; i < 8; i++) { const a = -0.7 + i * 0.3; this.clump([0, Math.cos(a), Math.sin(a)], 0.13 + (i === 3 || i === 4 ? 0.04 : 0), 0.04, { droop: -0.02 }); }
        break;
      case 'Twin Tails':
        cap();
        for (const s of [-1, 1]) this.part(clumpGeometry(new THREE.Vector3(-0.5, 0.9, -s * 1.3), new THREE.Vector3(-0.3, -0.4, -s * 0.8).normalize(), 0.45 / HEADK, 0.055 / HEADK, new THREE.Vector3(0, -1.0, 0)), this.hairMat, H);
        break;
      case 'Shaggy':
        cap(1.02);
        for (let i = 0; i < 20; i++) { const a = -Math.PI * 0.9 + (i / 19) * Math.PI * 1.8; this.clump([Math.sin(a), 0.1, Math.cos(a)], 0.12 + R(i) * 0.05, 0.04, { droop: 0.8 }); }
        break;
      default: break; // Bald
    }
  }

  // ---------------------------------------------------------------- hands, feet, gear
  buildHands(J, hands, skinM, handM, bw) {
    const gl = hands === 'Gloves' || hands === 'Gauntlets';
    const palmM = gl ? handM : skinM;
    for (const k of ['L', 'R']) {
      const hb = J['hand' + k], s = k === 'L' ? 1 : -1, w = Math.sqrt(bw);
      this.part(new THREE.SphereGeometry(0.038, 14, 10), palmM, hb, { pos: [0, -0.04, 0.002], scale: [1.0 * w, 1.1, 0.62 * w] }); // fist body
      for (let f = 0; f < 4; f++) this.part(new THREE.CapsuleGeometry(0.0095 * w, 0.018, 3, 8), palmM, hb, { pos: [(-0.022 + f * 0.0147) * s, -0.068 + (f === 1 || f === 2 ? -0.002 : 0), 0.012], rot: [Math.PI / 2, 0, 0] }); // curled fingers
      this.part(new THREE.CapsuleGeometry(0.009 * w, 0.026, 3, 8), palmM, hb, { pos: [-0.025 * s, -0.052, 0.022], rot: [0, 0, s * 1.2] }); // thumb across
      if (hands === 'Gauntlets') this.part(new THREE.CylinderGeometry(0.052 * w, 0.058 * w, 0.07, 12), this.mat('metal', this.spec.outfit.handsColor), hb, { pos: [0, 0.03, 0] });
    }
  }

  buildFeet(J, feet, skinM, feetM, bw) {
    const sole = this.mat('plain', feet === 'Sneakers' ? '#eeeae2' : '#2a2420', { rough: 0.8 });
    for (const k of ['L', 'R']) {
      const fb = J['foot' + k];
      const shoeM = feet === 'Sandals' || feet === 'Wraps' ? skinM : feetM;
      this.part(new THREE.SphereGeometry(0.05, 16, 10), shoeM, fb, { pos: [0, -0.04, 0.055], scale: [1.0 * Math.sqrt(bw), 0.85, 2.3] });
      this.part(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 12), shoeM, fb, { pos: [0, -0.02, 0] });
      this.part(new THREE.BoxGeometry(0.1 * Math.sqrt(bw), 0.022, 0.25), sole, fb, { pos: [0, -0.075, 0.05], outline: false });
      if (feet === 'Sandals') for (const z of [0, 0.08]) this.part(new THREE.TorusGeometry(0.045, 0.008, 6, 14, Math.PI), feetM, fb, { pos: [0, -0.06, z], scale: [1.05, 0.7, 1] });
      if (feet === 'Wraps') this.part(new THREE.CylinderGeometry(0.048, 0.05, 0.05, 12), feetM, fb, { pos: [0, -0.03, 0.03] });
    }
  }

  buildGear(spec, J, top, prof, bw, sw, topM, botM) {
    const O = spec.outfit;
    const at = (y) => { // torso radii at height y (body-local)
      for (let i = 0; i < prof.length - 1; i++) if (y >= prof[i][0] && y <= prof[i + 1][0]) { const t = (y - prof[i][0]) / (prof[i + 1][0] - prof[i][0]); return [0, 1, 2, 3].map((k) => prof[i][k] + (prof[i + 1][k] - prof[i][k]) * t); }
      return prof[0];
    };
    const chestY = J.hips.position.y + J.spine.position.y + J.chest.position.y; // 1.2
    const hipsY = J.hips.position.y;
    const accM = this.mat('cloth', O.accessoryColor), sashM = this.mat(top.includes('Gi') ? 'canvas' : 'leather', O.sash), trimM = this.mat('canvas', O.topAccent);
    // belt / sash at the waist
    const [, wrx, wrz, wcz] = at(1.0);
    this.part(new THREE.TorusGeometry(1, 0.22, 8, 36), sashM, J.hips, { pos: [0, 1.0 - hipsY, wcz], rot: [Math.PI / 2, 0, 0], scale: [wrx * bw * 1.12, wrz * bw * 1.12, 0.12] });
    if (top.includes('Gi')) for (const [x, r] of [[0.07, 0.15], [0.11, 0.4]]) this.part(new THREE.BoxGeometry(0.045, 0.2, 0.012), sashM, J.hips, { pos: [x, 0.0, wrz * bw * 1.1 + wcz], rot: [0.05, 0, r] });
    if (O.accessory === 5) this.part(new THREE.BoxGeometry(0.1, 0.085, 0.055), this.mat('leather', O.accessoryColor), J.hips, { pos: [0.15 * bw, 0.06, 0.05] });
    // lapels / trims on the chest
    const cy = (y) => y - chestY;
    if (top === 'Wrap Gi' || top === 'Sleeveless Gi' || top === 'Jacket') {
      const [, , rz, cz] = at(1.26);
      // collar bands run from each shoulder down to the belt, crossing into a V
      for (const s of [1, -1]) this.part(new THREE.BoxGeometry(0.04, 0.34, 0.01), trimM, J.chest, { pos: [s * 0.03 - 0.004, cy(1.2), rz * bw * 1.1 + cz + 0.006 + (s > 0 ? 0.004 : 0)], rot: [0.12, 0, -s * 0.36] });
    }
    if (top === 'Vest') for (const s of [1, -1]) {
      const [, rx, rz, cz] = at(1.2);
      this.part(new THREE.BoxGeometry(0.11 * sw, 0.4, 0.016), topM, J.chest, { pos: [s * rx * 0.55 * bw, cy(1.18), rz * bw + cz + 0.01], rot: [0.1, s * 0.25, 0] });
      this.part(new THREE.BoxGeometry(rx * 1.6 * bw, 0.42, 0.016), topM, J.chest, { pos: [0, cy(1.18), -(rz * bw) + cz - 0.005] });
    }
    if (top === 'Hoodie') this.part(new THREE.TorusGeometry(0.1, 0.045, 8, 18), topM, J.chest, { pos: [0, cy(1.41), -0.05], rot: [1.2, 0, 0], scale: [1.3, 1, 1] });
    if (top === 'Jacket') this.part(new THREE.CylinderGeometry(0.075, 0.09, 0.06, 16, 1, true), topM, J.neck, { pos: [0, 0.0, 0], outline: false });
    if (top === 'Armor') {
      const [, rx, rz, cz] = at(1.24);
      const plate = this.mat('metal', O.topAccent);
      this.part(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), plate, J.chest, { pos: [0, cy(1.12), cz], scale: [rx * bw * 1.18, 0.24, rz * bw * 1.25] });
    }
    for (const k of ['L', 'R']) if (top === 'Armor' || (O.accessory === 3 && k === 'L')) {
      this.part(new THREE.SphereGeometry(0.1 * bw, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('metal', O.accessory === 3 && top !== 'Armor' ? O.accessoryColor : O.topAccent), J['up' + k], { pos: [0, 0.015, 0], scale: [1.15, 0.85, 1.1] });
    }
    if (O.accessory === 1) { // scarf
      this.part(new THREE.TorusGeometry(0.075, 0.035, 8, 18), accM, J.neck, { pos: [0, -0.02, 0], rot: [Math.PI / 2, 0, 0] });
      this.scarf = this.part(new THREE.BoxGeometry(0.075, 0.42, 0.016), accM, J.neck, { pos: [0.05, -0.18, -0.11], rot: [0.6, 0, 0.1], keep: true });
    }
    if (O.accessory === 2) { // cape
      const cg = new THREE.PlaneGeometry(0.5 * sw, 0.95, 2, 6); cg.translate(0, -0.475, 0);
      this.cape = this.part(cg, this.mat('cloth', O.accessoryColor, { side: THREE.DoubleSide }), J.chest, { pos: [0, 0.16, -0.13 * bw], outline: false, keep: true });
    }
  }

  // ---------------------------------------------------------------- transformation look
  setColors(ascended) {
    const hc = ascended ? this.spec.hair.ascend : this.spec.hair.color;
    const next = this.mat('hair', hc, { emissive: ascended ? 0.35 : 0 });
    this.hair.traverse((o) => { if (o.isMesh && o.material === this.hairMat) o.material = next; });
    this.hairMat = next;
    this.aura.material.uniforms.uColor.value.set(ascended ? this.spec.aura.ascend : this.spec.aura.color);
    // glowing eyes while ascended
    this.irisMat.emissive = hex(ascended ? this.spec.aura.ascend : '#000000');
    this.irisMat.emissiveIntensity = ascended ? 1.4 : 0;
    this.irisMat.userData.glow = true;
    this.flashMats = [...this.mats.values()].filter((m) => m.emissive && !m.userData.iris);
  }

  // facial expression: 'normal' | 'shout' | 'hurt'
  face(expr, dt) {
    this.blinkT -= dt;
    let lid = this.eyeOpen;
    if (this.blinkT < 0) { lid = -1.2; if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 4; }
    if (expr === 'hurt') lid = -1.25;
    if (expr === 'shout') lid = this.eyeOpen + 0.18;
    const k = Math.min(1, dt * 22);
    for (const l of this.lids) l.rotation.z += (lid - l.rotation.z) * k;
    for (const b of this.brows) {
      const tilt = expr === 'shout' ? -0.35 : expr === 'hurt' ? 0.35 : 0;
      b.rotation.x += (b.userData.baseRot + b.userData.side * tilt * 2 - b.rotation.x) * k;
      b.position.y += (b.userData.baseY + (expr === 'hurt' ? 0.08 : expr === 'shout' ? -0.08 : 0) - b.position.y) * k;
    }
    const open = expr === 'shout' ? 1 : expr === 'hurt' ? 0.35 : 0;
    this.expr.mouth += (open - this.expr.mouth) * k;
    const m = this.expr.mouth;
    this.lowerLip.position.y = -1.03 - m * 0.26;
    this.mouthDark.scale.y = 0.05 + m * 0.65;
    this.mouthDark.position.y = -0.97 - m * 0.13;
  }

  // ---------------------------------------------------------------- per frame
  // v: the fighter view from Fight.view(); dt seconds of real time
  update(v, dt) {
    this.time += dt;
    const T = this.time;
    this.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    const yaw = Math.atan2(v.face.x, v.face.z);
    let dy = yaw - this.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * Math.min(1, dt * 18);
    if (v.ascended !== this.ascended) { this.ascended = v.ascended; this.setColors(v.ascended); }
    const fwd = v.vel.x * v.face.x + v.vel.z * v.face.z;
    const side = v.vel.x * -v.face.z + v.vel.z * v.face.x;
    const speed = Math.hypot(v.vel.x, v.vel.z);
    const P = this.targetPose(v, T, fwd, side, speed, dt);
    const k = Math.min(1, dt * (P.snap || 14));
    for (const [name, j] of Object.entries(this.J)) {
      const t = P[name] || ZERO, r = this.rest[name];
      j.rotation.x += (r.x + t[0] - j.rotation.x) * k;
      j.rotation.y += (r.y + t[1] - j.rotation.y) * k;
      j.rotation.z += (r.z + t[2] - j.rotation.z) * k;
    }
    const b = P.body || ZERO;
    this.body.rotation.x += (b[0] - this.body.rotation.x) * k;
    this.body.rotation.y += (b[1] - this.body.rotation.y) * k;
    this.body.rotation.z += (b[2] - this.body.rotation.z) * k;
    this.body.position.y += ((P.drop || 0) - this.body.position.y) * k;
    if (this.cape) this.cape.rotation.x = 0.15 + Math.min(1.2, speed * 0.04 + Math.abs(v.vel.y) * 0.03) + Math.sin(T * 6) * 0.05;
    if (this.scarf) this.scarf.rotation.x = 0.6 + Math.min(0.9, speed * 0.03) + Math.sin(T * 7) * 0.08;
    this.face(P.face || 'normal', dt);
    const want = P.aura ?? (v.ascended ? 0.55 : 0);
    this.auraPower += (want - this.auraPower) * Math.min(1, dt * 6);
    this.aura.material.uniforms.uPower.value = this.auraPower;
    this.aura.material.uniforms.uTime.value = T;
    this.aura.visible = this.auraPower > 0.02;
    this.aura.scale.set(this.scale * (1 + this.auraPower * 0.25), this.scale * (0.9 + this.auraPower * 0.3), this.scale * (1 + this.auraPower * 0.25));
    // hurt flash
    this.flash = Math.max(0, this.flash - dt * 5);
    for (const m of this.flashMats) { if (!m.userData.e0) { m.userData.e0 = m.emissive.clone(); m.userData.i0 = m.emissiveIntensity; } m.emissive.copy(m.userData.e0).lerp(WHITE, this.flash); m.emissiveIntensity = Math.max(m.userData.i0, this.flash); }
    this.body.visible = !(v.state === 'blinking' && v.t < 7) && !P.hide;
    if (this.shadow.parent) {
      this.shadow.position.set(v.pos.x, 0.03, v.pos.z);
      this.shadow.scale.setScalar(Math.max(0.3, 1 - v.pos.y * 0.02));
      this.shadow.material.opacity = Math.max(0, (this.anime ? 0.35 : 0.22) - v.pos.y * 0.006);
    }
  }

  hit() { this.flash = 0.5; }

  targetPose(v, T, fwd, side, speed, dt) {
    const st = v.state, t = v.t;
    const air = v.flying || v.pos.y > 0.3;
    const P = {};
    const stance = () => {
      const br = Math.sin(T * 3.2) * 0.04;
      Object.assign(P, {
        hips: [0, -0.35, 0], spine: [0.05, 0.12, 0], chest: [0.06 + br * 0.5, 0.18, 0], neck: [0, 0.05, 0], head: [0.05, 0.1, 0],
        upL: [-0.95, 0.1, 0.35], foreL: [-1.85, 0, 0], upR: [-0.6, -0.2, -0.45], foreR: [-2.2, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0],
      });
      if (air) {
        Object.assign(P, { thighL: [-0.45, 0, 0.08], shinL: [0.7, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [1.0, 0, 0], footL: [0.4, 0, 0], footR: [0.5, 0, 0] });
        P.drop = Math.sin(T * 2.4) * 0.04;
      } else {
        Object.assign(P, { thighL: [-0.45, -0.2, 0.12], shinL: [0.55, 0, 0], thighR: [0.15, -0.3, -0.12], shinR: [0.45, 0, 0], footL: [-0.05, 0, 0], footR: [-0.4, 0, 0] });
        P.drop = -0.07 + br * 0.3;
      }
    };
    stance();
    const lean = (pitch, roll) => { P.body = [pitch, 0, roll]; };
    switch (st) {
      case 'idle': case 'blastrec': {
        if (st === 'blastrec') Object.assign(P, { upR: [-1.55, 0, 0.05], foreR: [-0.1, 0, 0], chest: [0, 0.55, 0], snap: 30 });
        if (!air && speed > 1) { // run, phase from stride so it never strobes
          this.phase += speed * dt * 0.9;
          const p = this.phase, sw = Math.min(1, speed / 9);
          const dir = Math.atan2(side, fwd);
          P.hips = [0, dir * 0.4, 0]; P.spine = [0.15 * sw, 0, 0];
          P.thighL = [-Math.sin(p) * 0.9 * sw - 0.15, 0, 0]; P.shinL = [Math.max(0, Math.cos(p)) * 1.3 * sw + 0.2, 0, 0];
          P.thighR = [Math.sin(p) * 0.9 * sw - 0.15, 0, 0]; P.shinR = [Math.max(0, -Math.cos(p)) * 1.3 * sw + 0.2, 0, 0];
          P.footL = [0, 0, 0]; P.footR = [0, 0, 0];
          if (st !== 'blastrec') { P.upL = [Math.sin(p) * 0.7 * sw - 0.3, 0, 0.2]; P.foreL = [-1.5, 0, 0]; P.upR = [-Math.sin(p) * 0.7 * sw - 0.3, 0, -0.2]; P.foreR = [-1.5, 0, 0]; }
          P.drop = -Math.abs(Math.sin(p)) * 0.06; lean(0.12 * sw, 0);
        } else if (air && (speed > 2 || Math.abs(v.vel.y) > 3)) { // flying
          const f = Math.max(-1, Math.min(1, fwd / 10)), s = Math.max(-1, Math.min(1, side / 10));
          const vy = Math.max(-1, Math.min(1, v.vel.y / 12));
          lean(f * 0.9 - vy * 0.3, -s * 0.5);
          Object.assign(P, { thighL: [0.1, 0, 0.06], shinL: [0.5, 0, 0], thighR: [0.25, 0, -0.06], shinR: [0.7, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0] });
          if (f > 0.4 && st !== 'blastrec') Object.assign(P, { upL: [0.4, 0, 0.35], foreL: [-0.4, 0, 0], upR: [0.4, 0, -0.35], foreR: [-0.4, 0, 0] });
        } else lean(0, 0);
        break;
      }
      case 'dash': case 'dashin': {
        const f = st === 'dashin' ? 1 : Math.max(-1, Math.min(1, fwd / 20)), s = Math.max(-1, Math.min(1, side / 20));
        lean(f * 0.75 + (st === 'dashin' ? 0.3 : 0), -s * 0.6);
        Object.assign(P, { upL: [0.7, 0, 0.45], foreL: [-0.3, 0, 0], upR: [0.7, 0, -0.45], foreR: [-0.3, 0, 0], thighL: [0.2, 0, 0], shinL: [0.8, 0, 0], thighR: [0.4, 0, 0], shinR: [0.9, 0, 0], head: [-0.3, 0, 0], snap: 20 });
        P.aura = 0.45;
        break;
      }
      case 'guard': case 'guardstun':
        Object.assign(P, { upL: [-1.35, 0.3, -0.25], foreL: [-1.9, 0, 0], upR: [-1.25, -0.3, 0.2], foreR: [-1.95, 0, 0], chest: [0.25, 0, 0], head: [0.25, 0, 0], snap: 30 });
        if (!air) { P.drop = -0.14; P.thighL = [-0.6, -0.2, 0.15]; P.shinL = [0.9, 0, 0]; P.thighR = [0.0, -0.2, -0.15]; P.shinR = [0.8, 0, 0]; }
        if (st === 'guardstun') { P.body = [-0.12, 0, 0]; P.face = 'hurt'; }
        break;
      case 'charge':
        Object.assign(P, { hips: [0, 0, 0], spine: [-0.1, 0, 0], chest: [-0.3, 0, 0], head: [-0.35, 0, 0], neck: [-0.1, 0, 0], upL: [0.1, 0, 0.45], foreL: [-0.5, 0, 0], upR: [0.1, 0, -0.45], foreR: [-0.5, 0, 0], face: 'shout', aura: 1.0, snap: 10 });
        if (!air) Object.assign(P, { thighL: [-0.3, 0, 0.35], shinL: [0.6, 0, 0], thighR: [-0.3, 0, -0.35], shinR: [0.6, 0, 0], footL: [-0.3, 0, -0.3], footR: [-0.3, 0, 0.3], drop: -0.16 });
        P.drop = (P.drop || 0) + Math.sin(T * 40) * 0.008;
        break;
      case 'attack': this.attackPose(P, v, air); break;
      case 'rush': {
        const k = Math.floor(t / 3) % 2;
        if (t < 18) { lean(0.6, 0); Object.assign(P, { upL: [0.7, 0, 0.4], upR: [0.7, 0, -0.4], foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0], snap: 20 }); }
        else if (this.spec.moves.rush === 'cyclone') { P.body = [0, (t * 0.7) % (Math.PI * 2), 0]; Object.assign(P, { thighL: [-1.3, 0, 0.9], shinL: [0.1, 0, 0], upL: [0, 0, 1.3], upR: [0, 0, -1.3], foreL: [0, 0, 0], foreR: [0, 0, 0], snap: 40 }); }
        else Object.assign(P, { chest: [0.1, k ? 0.45 : -0.45, 0], upL: k ? [-1.55, 0, 0.05] : [-0.9, 0, 0.3], foreL: k ? [-0.05, 0, 0] : [-1.9, 0, 0], upR: k ? [-0.7, 0, -0.3] : [-1.55, 0, -0.05], foreR: k ? [-2.0, 0, 0] : [-0.05, 0, 0], face: 'shout', snap: 45 });
        P.aura = 0.6;
        break;
      }
      case 'beamcharge': // cocked palm, other arm aims
        Object.assign(P, { hips: [0, -0.6, 0], chest: [0, -0.6, 0], head: [0, 0.6, 0], upL: [-1.5, 0.1, 0.1], foreL: [-0.2, 0, 0], upR: [0.9, 0, -0.55], foreR: [-1.7, 0, 0], face: 'shout', aura: 0.8, snap: 12 });
        if (!air) Object.assign(P, { thighL: [-0.5, 0, 0.3], shinL: [0.7, 0, 0], thighR: [0.2, 0, -0.3], shinR: [0.5, 0, 0], drop: -0.15 });
        break;
      case 'beam':
        Object.assign(P, { hips: [0, 0.2, 0], chest: [0.05, 0.35, 0], head: [0, -0.4, 0], upR: [-1.6, 0, 0.1], foreR: [-0.05, 0, 0], upL: [0.5, 0, 0.6], foreL: [-0.4, 0, 0], face: 'shout', aura: 1.0, snap: 30 });
        if (!air) Object.assign(P, { thighL: [-0.6, 0, 0.3], shinL: [0.7, 0, 0], thighR: [0.4, 0, -0.3], shinR: [0.3, 0, 0], drop: -0.15 });
        P.body = [0, 0, 0]; P.drop = (P.drop || 0) + Math.sin(T * 50) * 0.01;
        break;
      case 'stun':
        Object.assign(P, { chest: [-0.35, 0, 0.1], head: [-0.5, 0.2, 0], upL: [-0.3, 0, 0.7], foreL: [-0.6, 0, 0], upR: [-0.2, 0, -0.6], foreR: [-0.5, 0, 0], face: 'hurt', snap: 35 });
        P.body = [-0.25, 0, 0];
        break;
      case 'launched': {
        const s = Math.min(1, t / 10);
        P.body = [-1.2 * s - t * 0.12, 0, 0.3 * s];
        Object.assign(P, { upL: [-2.4, 0, 0.6], foreL: [-0.2, 0, 0], upR: [-2.4, 0, -0.6], foreR: [-0.2, 0, 0], thighL: [-0.4, 0, 0.3], shinL: [0.8, 0, 0], thighR: [0.2, 0, -0.3], shinR: [0.4, 0, 0], head: [-0.6, 0, 0], face: 'hurt', snap: 20 });
        break;
      }
      case 'down': case 'ko':
        P.body = [-Math.PI / 2, 0, 0.1];
        Object.assign(P, { upL: [-2.8, 0, 0.5], foreL: [-0.3, 0, 0], upR: [-0.2, 0, -0.9], foreR: [-0.6, 0, 0], thighL: [-0.3, 0, 0.2], shinL: [0.5, 0, 0], thighR: [0, 0, -0.15], shinR: [0.1, 0, 0], head: [0.2, 0.5, 0], face: 'hurt', snap: 10 });
        P.drop = 0.14; // the body pivots at the feet, so lying back puts it flat on the ground
        break;
      case 'blinking': P.hide = v.t < 7; break;
      case 'ascending': {
        if (t < 26) Object.assign(P, { chest: [0.45, 0, 0], head: [0.3, 0, 0], upL: [-0.4, 0.4, -0.3], foreL: [-2.2, 0, 0], upR: [-0.4, -0.4, 0.3], foreR: [-2.2, 0, 0], drop: -0.25, thighL: [-0.9, 0, 0.35], shinL: [1.3, 0, 0], thighR: [-0.9, 0, -0.35], shinR: [1.3, 0, 0], face: 'shout', aura: 0.5 + t / 40, snap: 10 });
        else Object.assign(P, { chest: [-0.4, 0, 0], head: [-0.6, 0, 0], upL: [-0.4, 0, 1.4], foreL: [-0.1, 0, 0], upR: [-0.4, 0, -1.4], foreR: [-0.1, 0, 0], thighL: [-0.2, 0, 0.3], shinL: [0.3, 0, 0], thighR: [-0.2, 0, -0.3], shinR: [0.3, 0, 0], face: 'shout', aura: 1.4, snap: 25 });
        P.body = [0, 0, 0]; P.drop = (P.drop || 0) + Math.sin(T * 60) * 0.012;
        break;
      }
      case 'apex':
        if (t < 40) Object.assign(P, { hips: [0, 0, 0], chest: [-0.25, 0, 0], head: [-0.6, 0, 0], upR: [-3.0, 0, -0.15], foreR: [-0.05, 0, 0], upL: [0.1, 0, 0.5], foreL: [-1.0, 0, 0], face: 'shout', aura: 1.5, snap: 12 });
        else Object.assign(P, { chest: [0.25, 0.4, 0], head: [0.1, -0.3, 0], upR: [-1.5, 0, 0.1], foreR: [-0.05, 0, 0], upL: [0.6, 0, 0.6], foreL: [-0.4, 0, 0], face: 'shout', aura: 1.5, snap: 35 });
        P.body = [0, 0, 0];
        break;
      default: break;
    }
    if (v.ascended && P.aura === undefined) P.aura = 0.5;
    return P;
  }

  attackPose(P, v, air) {
    const m = MELEE[v.move], t = v.t;
    const phase = t < m.startup ? 'wind' : t < m.startup + m.active + m.recovery * 0.4 ? 'hit' : 'back';
    if (phase === 'back') return;
    const W = phase === 'wind';
    P.snap = W ? 22 : 50;
    P.face = 'shout';
    switch (v.move) {
      case 'jab':
        Object.assign(P, W ? { upL: [-1.0, 0, 0.3], foreL: [-2.0, 0, 0], chest: [0, 0.3, 0] } : { upL: [-1.57, 0.05, 0.02], foreL: [-0.05, 0, 0], chest: [0.05, -0.15, 0], hips: [0, -0.15, 0], head: [0, 0.15, 0] });
        break;
      case 'cross':
        Object.assign(P, W ? { upR: [-0.4, 0, -0.5], foreR: [-2.2, 0, 0], chest: [0, -0.2, 0] } : { upR: [-1.57, -0.05, -0.02], foreR: [-0.05, 0, 0], chest: [0.1, 0.65, 0], hips: [0, 0.3, 0], head: [0, -0.4, 0], upL: [-0.7, 0, 0.3], foreL: [-2.2, 0, 0] });
        break;
      case 'knee':
        Object.assign(P, W ? { thighR: [-0.6, 0, 0], shinR: [1.4, 0, 0] } : { thighR: [-1.7, 0, 0], shinR: [2.0, 0, 0], chest: [0.3, 0, 0], upL: [-1.0, 0, 0.3], upR: [-1.0, 0, -0.3], foreL: [-1.2, 0, 0], foreR: [-1.2, 0, 0], drop: 0.05 });
        break;
      case 'roundhouse':
        Object.assign(P, W ? { hips: [0, -0.8, 0], thighL: [-0.4, 0, 0.4], shinL: [1.2, 0, 0] } : { hips: [0, -1.2, 0], spine: [0, -0.3, 0], chest: [0, 0.5, -0.4], thighL: [-0.25, 0, 1.45], shinL: [0.15, 0, 0], footL: [0.3, 0, 0], upL: [-0.5, 0, 0.9], upR: [-0.8, 0, -0.6], head: [0, 1.0, 0.3] });
        P.body = [0, 0, -0.35];
        break;
      case 'axe':
        Object.assign(P, W ? { thighR: [-2.5, 0, -0.1], shinR: [0.15, 0, 0], chest: [-0.3, 0, 0], upL: [-0.2, 0, 0.8], upR: [-0.2, 0, -0.8] } : { thighR: [-0.9, 0, 0], shinR: [0.2, 0, 0], chest: [0.5, 0, 0], head: [0.3, 0, 0], upL: [0.3, 0, 0.7], upR: [0.3, 0, -0.7] });
        P.body = W ? [-0.2, 0, 0] : [0.35, 0, 0];
        break;
      case 'smash':
        Object.assign(P, W ? { upR: [0.9, 0, -0.5], foreR: [-2.1, 0, 0], chest: [-0.1, -0.8, 0], hips: [0, -0.5, 0], upL: [-1.3, 0, 0.3], foreL: [-1.0, 0, 0], aura: 0.9, snap: 9 } : { upR: [-1.6, 0, -0.05], foreR: [-0.05, 0, 0], chest: [0.3, 0.8, 0], hips: [0, 0.5, 0], upL: [0.4, 0, 0.6], foreL: [-0.8, 0, 0], head: [0.1, -0.5, 0], aura: 0.9 });
        P.body = W ? [-0.1, 0, 0] : [0.35, 0, 0];
        if (!air) Object.assign(P, { thighL: [-0.9, 0, 0.1], shinL: [0.6, 0, 0], thighR: [0.5, 0, -0.1], shinR: [0.2, 0, 0], drop: -0.18 });
        break;
    }
  }
}
const ZERO = [0, 0, 0];
const WHITE = new THREE.Color(1, 1, 1);
