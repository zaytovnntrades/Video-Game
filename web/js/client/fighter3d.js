// Procedural, fully parametric anime-toon fighter built from a fighter spec.
// Every dimension comes from the spec (height, build, shoulders), so any combination
// of options poses correctly. Poses are driven by the fight state + frame data.
import * as THREE from '../../vendor/three/three.module.js';
import { OPTIONS } from '../sim/spec.js';
import { MELEE } from '../sim/data.js';

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
  float edge = smoothstep(0.15, 0.75, rim) * smoothstep(1.0, 0.82, rim); // brightest just inside the silhouette
  float tongues = smoothstep(0.25 + vUv.y * 0.55, 0.9, fl);
  float a = tongues * tip * uPower * (0.12 + edge * 0.8);
  vec3 c = mix(uColor, vec3(1.0), smoothstep(0.8, 1.0, fl * tip) * 0.6);
  gl_FragColor = vec4(c * 0.95, clamp(a, 0.0, 0.85));
}`;

function hex(c) { return new THREE.Color(c); }

// ---------------------------------------------------------------- face texture
function drawFace(spec, expr, ascended, auraCol) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = spec.body.skin; g.fillRect(0, 0, W, H);
  const cx = W * 0.25, ey = 136;
  const iris = ascended ? auraCol : spec.face.eyeColor;
  const line = '#1a1420';
  const style = spec.face.eyes;
  // cheeks blush
  g.fillStyle = 'rgba(255,120,120,0.12)';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 34, ey + 24, 12, 6, 0, 0, 7); g.fill(); }
  for (const s of [-1, 1]) {
    const x = cx + s * 25;
    g.save(); g.translate(x, ey); g.scale(s * 1.3, 1.3); // draw the left eye, mirror for the right
    if (expr === 'hurt') {
      g.strokeStyle = line; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-10, -6); g.lineTo(4, 0); g.lineTo(-10, 6); g.stroke();
    } else {
      const w = [13, 12, 13, 13][style], hh = [8, 11, 5, 8][style];
      g.beginPath();
      if (style === 1) g.ellipse(0, 0, w * 0.8, hh, 0, 0, 7);
      else { g.moveTo(-w, 1); g.quadraticCurveTo(0, -hh * 1.4, w, style === 3 ? -4 : -1); g.quadraticCurveTo(0, hh * 1.2, -w, 1); }
      g.fillStyle = '#fbfbff'; g.fill();
      g.save(); g.clip();
      g.fillStyle = iris; g.beginPath(); g.ellipse(-2, 1, 7, style === 2 ? 6 : 9, 0, 0, 7); g.fill();
      g.fillStyle = ascended ? '#ffffff' : line; g.beginPath(); g.ellipse(-2, 1, 3, 4.5, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(-4, -3, 2.2, 0, 7); g.fill();
      g.restore();
      // upper lid line
      g.strokeStyle = line; g.lineWidth = style === 3 ? 5 : 3.5; g.lineCap = 'round';
      g.beginPath();
      if (style === 1) g.ellipse(0, 0, w * 0.8, hh, 0, Math.PI * 1.05, Math.PI * 1.95);
      else { g.moveTo(-w - 1, 1); g.quadraticCurveTo(0, -hh * 1.4, w + 2, style === 3 ? -5 : -2); }
      g.stroke();
    }
    // brows
    g.strokeStyle = spec.hair.color === '#e8e2d6' ? '#9a917f' : spec.hair.color; g.lineWidth = [5, 4, 6, 2.5][spec.face.brows] + 0; g.lineCap = 'round';
    g.beginPath();
    const b = spec.face.brows, by = -16 - (expr === 'shout' ? 2 : 0);
    if (b === 0) { g.moveTo(-14, by); g.lineTo(12, by); }
    else if (b === 1) { g.moveTo(-14, by + 2); g.quadraticCurveTo(0, by - 6, 12, by + 1); }
    else if (b === 2) { g.moveTo(-14, by - 4); g.lineTo(12, by + 3); }
    else { g.moveTo(-12, by); g.quadraticCurveTo(0, by - 3, 10, by); }
    g.stroke();
    g.restore();
  }
  // marks
  const m = spec.face.marks;
  if (m === 1) { g.strokeStyle = 'rgba(120,40,40,0.8)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx + 12, ey - 22); g.lineTo(cx + 30, ey + 20); g.stroke(); g.beginPath(); g.moveTo(cx + 16, ey - 6); g.lineTo(cx + 24, ey - 9); g.stroke(); }
  if (m === 2) { g.fillStyle = spec.outfit.topAccent; for (const s of [-1, 1]) { g.save(); g.translate(cx + s * 30, ey + 20); g.rotate(s * 0.25); g.fillRect(-2.5, -9, 5, 18); g.restore(); } }
  if (m === 3) { g.fillStyle = 'rgba(140,80,50,0.55)'; for (let i = 0; i < 14; i++) { const s = i % 2 ? 1 : -1; g.beginPath(); g.arc(cx + s * (18 + ((i * 7) % 16)), ey + 14 + ((i * 5) % 9), 1.5, 0, 7); g.fill(); } }
  if (m === 4) { g.fillStyle = spec.aura.color; for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(cx + i * 7, ey - 30 + Math.abs(i) * 2, 2.5, 0, 7); g.fill(); } }
  // nose + mouth
  g.strokeStyle = 'rgba(60,30,30,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 1, ey + 14); g.lineTo(cx - 2, ey + 22); g.lineTo(cx + 2, ey + 23); g.stroke();
  g.strokeStyle = line; g.lineWidth = 2.5;
  if (expr === 'shout') { g.fillStyle = '#5a1e26'; g.beginPath(); g.moveTo(cx - 9, ey + 32); g.quadraticCurveTo(cx, ey + 29, cx + 9, ey + 32); g.quadraticCurveTo(cx, ey + 48, cx - 9, ey + 32); g.fill(); g.stroke(); }
  else if (expr === 'hurt') { g.beginPath(); g.moveTo(cx - 7, ey + 36); g.quadraticCurveTo(cx, ey + 31, cx + 7, ey + 36); g.stroke(); }
  else { g.beginPath(); g.moveTo(cx - 6, ey + 34); g.quadraticCurveTo(cx, ey + 35, cx + 6, ey + 33); g.stroke(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- the rig
export class FighterModel {
  constructor(spec) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // pitched/rolled for flight, offset for bob
    this.root.add(this.body);
    this.mats = new Map();
    this.cur = {}; // current joint rotations, blended toward the target pose
    this.flash = 0; this.time = 0; this.phase = 0; this.ascended = false; this.lastExpr = '';
    this.build(spec);
  }

  mat(color, opts = {}) {
    const k = color + (opts.emissive ? '*' : '');
    if (this.mats.has(k)) return this.mats.get(k);
    const m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: gradient() });
    if (opts.emissive) { m.emissive = hex(color); m.emissiveIntensity = 0.6; }
    this.mats.set(k, m);
    return m;
  }

  part(geo, color, parent, { outline = true, pos, rot, scale, mat } = {}) {
    const m = new THREE.Mesh(geo, mat || this.mat(color));
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    if (outline) { const o = new THREE.Mesh(geo, OUTLINE); o.castShadow = false; m.add(o); }
    parent.add(m);
    return m;
  }

  joint(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

  limb(parent, len, r0, r1, color, opts) { // tapered limb hanging down from a joint
    const geo = new THREE.CylinderGeometry(r0, r1, len, 10, 1);
    geo.translate(0, -len / 2, 0);
    const m = this.part(geo, color, parent, opts);
    // round caps so bends don't show gaps
    this.part(new THREE.SphereGeometry(r0, 10, 8), color, parent, { outline: false });
    return m;
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats.values()) { m.map?.dispose?.(); m.dispose(); }
    for (const t of Object.values(this.faces || {})) t.dispose();
    this.aura?.material.dispose();
    this.root.removeFromParent();
  }

  build(spec) {
    this.spec = spec;
    const B = spec.body, O = spec.outfit;
    const S = 0.9 + B.height * 0.22; // overall scale
    const bw = 0.82 + B.build * 0.5; // limb/torso thickness
    const sw = 0.85 + B.shoulders * 0.4; // shoulder width
    this.scale = S;
    this.body.scale.setScalar(S);
    const skin = B.skin, top = OPTIONS.top[O.top], bottom = OPTIONS.bottom[O.bottom];
    const J = (this.J = {});
    const legLen = 0.9;
    J.hips = this.joint(this.body, 0, legLen, 0);
    // pelvis + belt/sash
    const pantsCol = O.bottomColor;
    this.part(new THREE.SphereGeometry(0.17, 14, 10), pantsCol, J.hips, { scale: [1.05 * bw, 0.75, 0.75 * bw], pos: [0, 0.02, 0] });
    this.part(new THREE.CylinderGeometry(0.168 * bw, 0.17 * bw, 0.07, 14), O.sash, J.hips, { pos: [0, 0.1, 0], scale: [1.08, 1, 0.8] });
    if (O.accessory === 5) this.part(new THREE.BoxGeometry(0.1, 0.09, 0.06), O.accessoryColor, J.hips, { pos: [0.16 * bw, 0.06, 0.06] });
    if (top === 'Wrap Gi' || top === 'Sleeveless Gi') { // sash tails
      this.part(new THREE.BoxGeometry(0.05, 0.22, 0.015), O.sash, J.hips, { pos: [0.08, -0.03, 0.135 * bw], rot: [0, 0, 0.15] });
      this.part(new THREE.BoxGeometry(0.05, 0.18, 0.015), O.sash, J.hips, { pos: [0.12, -0.01, 0.13 * bw], rot: [0, 0, 0.35] });
    }
    J.spine = this.joint(J.hips, 0, 0.12, 0);
    const torsoCol = top === 'Tank' || top === 'Sleeveless Gi' || top === 'Vest' ? O.topColor : O.topColor;
    this.part(new THREE.CylinderGeometry(0.15 * bw, 0.155 * bw, 0.2, 14), top === 'Vest' ? skin : torsoCol, J.spine, { pos: [0, 0.08, 0], scale: [1, 1, 0.72] });
    J.chest = this.joint(J.spine, 0, 0.18, 0);
    const chestGeo = new THREE.SphereGeometry(0.2, 16, 12);
    this.part(chestGeo, top === 'Vest' ? skin : torsoCol, J.chest, { pos: [0, 0.06, 0], scale: [sw * bw * 0.95, 0.9, 0.62 * bw] });
    if (top === 'Vest') { // open vest panels
      for (const s of [-1, 1]) this.part(new THREE.BoxGeometry(0.13 * sw * bw, 0.36, 0.04), O.topColor, J.chest, { pos: [s * 0.12 * sw * bw, 0.0, 0.1 * bw], rot: [0.1, 0, s * 0.05] });
      for (const s of [-1, 1]) this.part(new THREE.BoxGeometry(0.13 * sw * bw, 0.4, 0.04), O.topColor, J.chest, { pos: [s * 0.12 * sw * bw, 0.0, -0.11 * bw] });
    }
    if (top === 'Wrap Gi' || top === 'Sleeveless Gi' || top === 'Jacket') { // crossed lapels
      this.part(new THREE.BoxGeometry(0.06, 0.34, 0.03), O.topAccent, J.chest, { pos: [0.03, 0.05, 0.125 * bw], rot: [0.12, 0, -0.55] });
      this.part(new THREE.BoxGeometry(0.05, 0.3, 0.03), O.topAccent, J.chest, { pos: [-0.04, 0.06, 0.122 * bw], rot: [0.12, 0, 0.55] });
    }
    if (top === 'Tank') this.part(new THREE.BoxGeometry(0.12, 0.08, 0.03), O.topAccent, J.chest, { pos: [0, 0.03, 0.125 * bw] });
    if (top === 'Hoodie') this.part(new THREE.TorusGeometry(0.12, 0.05, 8, 14), O.topAccent, J.chest, { pos: [0, 0.2, -0.06], rot: [1.25, 0, 0], scale: [sw, 1, 1] });
    if (top === 'Armor') {
      this.part(new THREE.SphereGeometry(0.21, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), O.topAccent, J.chest, { pos: [0, -0.02, 0.01], scale: [sw * bw, 1.0, 0.68 * bw] });
    }
    J.neck = this.joint(J.chest, 0, 0.22, 0);
    this.part(new THREE.CylinderGeometry(0.05 * Math.sqrt(bw), 0.06 * Math.sqrt(bw), 0.12, 10), skin, J.neck, { pos: [0, 0.03, 0] });
    if (top === 'Jacket') this.part(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 12, 1, true), O.topColor, J.neck, { pos: [0, 0.0, 0] });
    J.head = this.joint(J.neck, 0, 0.1, 0.01);
    this.faces = {};
    this.headMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient() });
    this.mats.set('#head', this.headMat);
    this.setFace('normal', false);
    const hr = 0.135;
    this.headR = hr;
    const head = this.part(new THREE.SphereGeometry(hr, 24, 16), null, J.head, { pos: [0, hr, 0], scale: [0.94, 1.06, 1], mat: this.headMat });
    head.rotation.y = 0;
    for (const s of [-1, 1]) { // ears
      if (spec.face.ears === 1) this.part(new THREE.ConeGeometry(0.03, 0.11, 6), skin, J.head, { pos: [s * hr * 0.92, hr * 1.02, -0.01], rot: [0, 0, -s * 1.1] });
      else this.part(new THREE.SphereGeometry(0.03, 8, 6), skin, J.head, { pos: [s * hr * 0.93, hr * 0.98, -0.005], scale: [0.5, 1, 0.8] });
    }
    this.hair = new THREE.Group(); J.head.add(this.hair); this.hair.position.y = hr;
    this.buildHair(spec.hair.style, spec.hair.color);
    if (O.accessory === 4) { // cloth headband with tails (no plate)
      this.part(new THREE.TorusGeometry(hr * 0.98, 0.016, 6, 24), O.accessoryColor, J.head, { pos: [0, hr * 1.25, 0], rot: [Math.PI / 2 + 0.15, 0, 0], scale: [0.95, 1.02, 1] });
      for (const s of [-1, 1]) this.part(new THREE.BoxGeometry(0.03, 0.2, 0.01), O.accessoryColor, J.head, { pos: [s * 0.035, hr * 1.1, -hr * 1.05], rot: [0.5, 0, s * 0.3] });
    }
    if (O.accessory === 1) { // scarf
      this.part(new THREE.TorusGeometry(0.085, 0.04, 8, 16), O.accessoryColor, J.neck, { pos: [0, 0.0, 0], rot: [Math.PI / 2, 0, 0] });
      this.scarf = this.part(new THREE.BoxGeometry(0.08, 0.42, 0.02), O.accessoryColor, J.neck, { pos: [0.05, -0.18, -0.12], rot: [0.6, 0, 0.1] });
    }
    if (O.accessory === 2) { // cape
      const cg = new THREE.PlaneGeometry(0.5 * sw, 0.9, 1, 4); cg.translate(0, -0.45, 0);
      const cm = this.mat(O.accessoryColor); cm.side = THREE.DoubleSide;
      this.cape = this.part(cg, O.accessoryColor, J.chest, { pos: [0, 0.17, -0.14 * bw], outline: false });
    }
    // arms
    const sleeve = { 'Wrap Gi': 'short', 'Sleeveless Gi': 'none', Jacket: 'long', Vest: 'none', Tank: 'none', Hoodie: 'long', Armor: 'short' }[top];
    const hands = OPTIONS.hands[O.hands];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      const sh = this.joint(J.chest, s * 0.2 * sw * bw, 0.14, 0);
      J['up' + k] = sh;
      const shoulderCol = sleeve === 'none' ? skin : O.topColor;
      this.part(new THREE.SphereGeometry(0.075 * bw, 12, 8), shoulderCol, sh);
      if (O.accessory === 3 && s > 0 || top === 'Armor') this.part(new THREE.SphereGeometry(0.1 * bw, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), O.topAccent, sh, { pos: [0, 0.02, 0], scale: [1.2, 0.8, 1.1] });
      this.limb(sh, 0.28, 0.062 * bw, 0.052 * bw, sleeve === 'none' ? skin : O.topColor);
      if (sleeve === 'short') this.part(new THREE.CylinderGeometry(0.075 * bw, 0.07 * bw, 0.05, 10), O.topAccent, sh, { pos: [0, -0.2, 0] });
      const el = this.joint(sh, 0, -0.28, 0);
      J['fore' + k] = el;
      const foreCol = sleeve === 'long' ? O.topColor : hands === 'Wraps' ? O.handsColor : skin;
      this.limb(el, 0.25, 0.05 * bw, 0.043 * bw, foreCol);
      if (hands === 'Gauntlets') this.part(new THREE.CylinderGeometry(0.06 * bw, 0.065 * bw, 0.13, 10), O.handsColor, el, { pos: [0, -0.18, 0] });
      const hd = this.joint(el, 0, -0.27, 0);
      J['hand' + k] = hd;
      const handCol = hands === 'Bare' ? skin : O.handsColor;
      this.part(new THREE.SphereGeometry(0.052 * Math.sqrt(bw), 10, 8), handCol, hd, { scale: [1, 1.05, 1.05] });
    }
    // legs
    const wide = { 'Gi Pants': 1.15, Baggy: 1.35, Fitted: 0.95, Shorts: 1.0 }[bottom];
    const feet = OPTIONS.feet[O.feet];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      const th = this.joint(J.hips, s * 0.095 * bw, -0.02, 0);
      J['thigh' + k] = th;
      this.limb(th, 0.43, 0.085 * bw * wide, 0.068 * bw * wide, pantsCol);
      const kn = this.joint(th, 0, -0.43, 0);
      J['shin' + k] = kn;
      const shinCol = bottom === 'Shorts' ? skin : pantsCol;
      this.limb(kn, 0.42, 0.064 * bw * (bottom === 'Shorts' ? 1 : wide), 0.05 * bw * (bottom === 'Baggy' ? 1.25 : 1), shinCol);
      if (bottom === 'Gi Pants' || bottom === 'Baggy') this.part(new THREE.CylinderGeometry(0.06 * bw, 0.07 * bw, 0.05, 10), feet === 'Boots' ? O.feetColor : O.sash, kn, { pos: [0, -0.37, 0], outline: false });
      const an = this.joint(kn, 0, -0.42, 0);
      J['foot' + k] = an;
      if (feet === 'Boots') this.part(new THREE.CylinderGeometry(0.068 * bw, 0.062 * bw, 0.2, 10), O.feetColor, an, { pos: [0, 0.06, 0] });
      if (feet === 'Wraps') this.part(new THREE.CylinderGeometry(0.056 * bw, 0.056 * bw, 0.12, 10), O.feetColor, an, { pos: [0, 0.02, 0] });
      const footCol = feet === 'Sandals' ? skin : O.feetColor;
      this.part(new THREE.BoxGeometry(0.1, 0.07, 0.22), footCol, an, { pos: [0, -0.03, 0.05] });
      if (feet === 'Sneakers') this.part(new THREE.BoxGeometry(0.105, 0.025, 0.23), '#f2f2f2', an, { pos: [0, -0.065, 0.05], outline: false });
      if (feet === 'Sandals') this.part(new THREE.BoxGeometry(0.11, 0.02, 0.24), O.feetColor, an, { pos: [0, -0.07, 0.05], outline: false });
    }
    // aura shell
    const prof = [[0.2, -0.05], [0.48, 0.25], [0.62, 0.85], [0.58, 1.45], [0.42, 1.95], [0.2, 2.3], [0.02, 2.55]].map(([r, y]) => new THREE.Vector2(r, y));
    const ag = new THREE.LatheGeometry(prof, 28);
    this.aura = new THREE.Mesh(ag, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: hex(spec.aura.color) }, uTime: { value: 0 }, uPower: { value: 0 } },
      vertexShader: AURA_VS, fragmentShader: AURA_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.aura.renderOrder = 5;
    this.aura.frustumCulled = false;
    this.root.add(this.aura);
    this.auraPower = 0;
    // ground shadow blob
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    this.shadow = sh;
    this.mats.set('#shadow', sh.material);
    this.allToon = [...this.mats.values()].filter((m) => m.isMeshToonMaterial);
    // remember the rest rotations
    this.rest = {};
    for (const [k, j] of Object.entries(J)) this.rest[k] = j.rotation.clone();
  }

  setFace(expr, ascended) {
    const key = expr + (ascended ? '+' : '');
    if (this.lastExpr === key) return;
    this.lastExpr = key;
    if (!this.faces[key]) this.faces[key] = drawFace(this.spec, expr, ascended, this.spec.aura.ascend);
    this.headMat.map = this.faces[key];
    this.headMat.needsUpdate = true;
  }

  spike(dir, len, r, color, at = 1.0, roll = 0) {
    const hr = this.headR;
    const d = new THREE.Vector3(...dir).normalize();
    const geo = new THREE.ConeGeometry(r, len, 6);
    geo.translate(0, len / 2, 0);
    const m = this.part(geo, color, this.hair);
    const surf = d.clone().multiplyScalar(hr * at);
    m.position.copy(surf);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    if (roll) m.rotateY(roll);
    m.position.addScaledVector(d, -r * 0.6);
    return m;
  }

  buildHair(style, color) {
    const hr = this.headR, H = this.hair;
    while (H.children.length) { const c = H.children.pop(); c.traverse((o) => o.geometry?.dispose()); }
    const cap = (front = 0.42) => this.part(new THREE.SphereGeometry(hr * 1.07, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), color, H, { pos: [0, 0.008, -0.008], rot: [-front * 0.6, 0, 0] });
    const name = OPTIONS.hairStyle[style];
    const R = (i) => ((Math.sin(i * 91.7) * 43758.5) % 1 + 1) % 1; // fixed pseudo-random layout
    switch (name) {
      case 'Spiked Crown':
        cap();
        for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2; this.spike([Math.cos(a) * 0.7, 0.9 + R(i) * 0.3, Math.sin(a) * 0.7 - 0.15], 0.17 + R(i + 3) * 0.08, 0.05, color); }
        this.spike([0, 1, 0.1], 0.22, 0.06, color);
        for (let i = 0; i < 4; i++) this.spike([-0.3 + i * 0.2, 0.25, 1], 0.08, 0.035, color, 1.0);
        break;
      case 'Swept Back':
        cap();
        for (let i = 0; i < 7; i++) this.spike([-0.6 + i * 0.2, 0.55, -1], 0.2 + R(i) * 0.06, 0.055, color, 0.9);
        this.spike([0, 0.9, 0.35], 0.12, 0.06, color);
        break;
      case 'Long Spikes':
        cap();
        for (let i = 0; i < 9; i++) this.spike([-0.8 + i * 0.2, -0.6 - R(i) * 0.3, -1], 0.38 + R(i + 1) * 0.12, 0.06, color, 0.85);
        for (let i = 0; i < 5; i++) this.spike([-0.5 + i * 0.25, 0.4, 1], 0.1, 0.04, color);
        break;
      case 'Wild Mane':
        cap();
        for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; const y = -0.4 + R(i) * 1.2; this.spike([Math.cos(a), y, Math.sin(a) - 0.4], 0.16 + R(i + 9) * 0.12, 0.055, color, 0.95); }
        break;
      case 'Topknot':
        cap(0.3);
        this.part(new THREE.SphereGeometry(0.06, 10, 8), color, H, { pos: [0, hr * 1.15, -0.03] });
        this.part(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), this.spec.outfit.accessoryColor, H, { pos: [0, hr * 1.02, -0.025] });
        break;
      case 'Buzz Cut':
        this.part(new THREE.SphereGeometry(hr * 1.02, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), color, H, { pos: [0, 0.003, -0.005], rot: [-0.25, 0, 0], outline: false });
        break;
      case 'Side Fringe':
        cap();
        for (let i = 0; i < 5; i++) this.spike([0.7 - i * 0.18, 0.1 - i * 0.1, 1], 0.16 + i * 0.02, 0.05, color, 0.95, 0).rotateZ(0.9);
        for (let i = 0; i < 6; i++) this.spike([-0.6 + i * 0.24, -0.3, -1], 0.14, 0.06, color, 0.9);
        break;
      case 'Ponytail': {
        cap(0.35);
        let y = hr * 0.95, z = -hr * 0.95;
        for (let i = 0; i < 5; i++) { this.part(new THREE.SphereGeometry(0.06 - i * 0.008, 10, 8), color, H, { pos: [0, y, z] }); y -= 0.06; z -= 0.03 - i * 0.01; }
        break;
      }
      case 'Mohawk':
        this.part(new THREE.SphereGeometry(hr * 1.015, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), '#3a3036', H, { outline: false, rot: [-0.25, 0, 0] });
        for (let i = 0; i < 7; i++) { const a = -0.6 + i * 0.32; this.spike([0, Math.cos(a), Math.sin(a)], 0.15 + (i === 2 || i === 3 ? 0.04 : 0), 0.045, color); }
        break;
      case 'Twin Tails':
        cap(0.45);
        for (const s of [-1, 1]) for (let i = 0; i < 5; i++) this.part(new THREE.SphereGeometry(0.055 - i * 0.006, 10, 8), color, H, { pos: [s * (hr * 1.05 + i * 0.012), hr * 0.85 - i * 0.07, -0.04] });
        break;
      case 'Shaggy':
        cap(0.5);
        for (let i = 0; i < 16; i++) { const a = -Math.PI * 0.85 + (i / 15) * Math.PI * 1.7; this.spike([Math.sin(a), -0.55, Math.cos(a)], 0.13 + R(i) * 0.05, 0.05, color, 0.98); }
        break;
      default: // Bald
        break;
    }
    this.hairBase = color;
  }

  setColors(ascended) { // ascended swaps hair + aura colours
    const hc = ascended ? this.spec.hair.ascend : this.spec.hair.color;
    this.hair.traverse((o) => { if (o.isMesh && o.material !== OUTLINE && o.material.isMeshToonMaterial) { if (o.material.userData.hair !== hc) { o.material = this.mat(hc, { emissive: ascended }); } } });
    this.aura.material.uniforms.uColor.value.set(ascended ? this.spec.aura.ascend : this.spec.aura.color);
    this.allToon = [...this.mats.values()].filter((m) => m.isMeshToonMaterial);
  }

  // ---------------------------------------------------------------- posing
  // v: the fighter view from Fight.view(); dt seconds of real time
  update(v, dt, opts = {}) {
    this.time += dt;
    const T = this.time;
    this.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    const yaw = Math.atan2(v.face.x, v.face.z);
    let dy = yaw - this.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * Math.min(1, dt * 18);
    if (v.ascended !== this.ascended) { this.ascended = v.ascended; this.setColors(v.ascended); }
    // local velocity: forward along facing, right
    const fwd = v.vel.x * v.face.x + v.vel.z * v.face.z;
    const side = v.vel.x * -v.face.z + v.vel.z * v.face.x;
    const speed = Math.hypot(v.vel.x, v.vel.z);
    const P = this.targetPose(v, T, fwd, side, speed, dt);
    // blend
    const k = Math.min(1, dt * (P.snap || 14));
    for (const [name, j] of Object.entries(this.J)) {
      const t = P[name] || ZERO;
      const r = this.rest[name];
      j.rotation.x += (r.x + t[0] - j.rotation.x) * k;
      j.rotation.y += (r.y + t[1] - j.rotation.y) * k;
      j.rotation.z += (r.z + t[2] - j.rotation.z) * k;
    }
    const b = P.body || ZERO;
    this.body.rotation.x += (b[0] - this.body.rotation.x) * k;
    this.body.rotation.y += (b[1] - this.body.rotation.y) * k;
    this.body.rotation.z += (b[2] - this.body.rotation.z) * k;
    const by = (P.drop || 0);
    this.body.position.y += (by - this.body.position.y) * k;
    if (this.cape) this.cape.rotation.x = 0.15 + Math.min(1.2, speed * 0.04 + Math.abs(v.vel.y) * 0.03) + Math.sin(T * 6) * 0.05;
    if (this.scarf) this.scarf.rotation.x = 0.6 + Math.min(0.9, speed * 0.03) + Math.sin(T * 7) * 0.08;
    // face
    this.setFace(P.face || 'normal', v.ascended);
    // aura strength
    const want = P.aura ?? (v.ascended ? 0.55 : 0);
    this.auraPower += (want - this.auraPower) * Math.min(1, dt * 6);
    this.aura.material.uniforms.uPower.value = this.auraPower;
    this.aura.material.uniforms.uTime.value = T;
    this.aura.visible = this.auraPower > 0.02;
    this.aura.scale.set(this.scale * (1 + this.auraPower * 0.25), this.scale * (0.9 + this.auraPower * 0.3), this.scale * (1 + this.auraPower * 0.25));
    // hurt flash
    this.flash = Math.max(0, this.flash - dt * 5);
    const f = this.flash;
    for (const m of this.allToon) { if (!m.emissive) continue; if (!m.userData.e0) m.userData.e0 = m.emissive.clone(); m.emissive.copy(m.userData.e0).lerp(WHITE, f); }
    // blink: vanish with a flicker
    this.body.visible = !(v.state === 'blinking' && v.t < 7) && !(P.hide);
    // ground shadow
    if (this.shadow.parent) {
      this.shadow.position.set(v.pos.x, 0.03, v.pos.z);
      const hgt = v.pos.y;
      this.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.02));
      this.shadow.material.opacity = Math.max(0, 0.35 - hgt * 0.006);
    }
  }

  hit() { this.flash = 0.55; }

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
