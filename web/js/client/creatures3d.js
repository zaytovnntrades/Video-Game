// Realistic procedural creatures and enemies (original designs).
//  Companions: Cindkit (fox-cat with an ember tuft) / Blazelynx, Puddlo (living water
//  slime) / Tidalor, Thornub (seed-bulb plant on root legs) / Briarok.
//  Enemies: Glitch (gaunt violet humanoid, glowing eyes, orbiting digital cubes),
//  Dasher (leathery imp), Brute (rock golem), Spitter (wet slug).
// Textured with generated colour + normal maps; four-legged creatures trot with a
// diagonal gait. Models face +x and stand on y = 0.
import * as THREE from '../../vendor/three.module.min.js';
import { cvs, rng, normalMap, tex, lathe, Parts, textures, buildHuman, poseHuman, bakeSkinned } from './human3d.js';

// ---------------------------------------------------------------- textures
let CT = null;
function ctex() {
  if (CT) return CT;
  const r = rng(404);
  const pair = (size, colorFn, heightFn, rep = 1) => {
    const c = cvs(size, size), g = c.getContext('2d'); colorFn(g, size);
    const h = cvs(size, size), hg = h.getContext('2d'); heightFn(hg, size);
    return [tex(c, rep, rep), tex(normalMap(h, 2.5), rep, rep, false)];
  };
  const strands = (g, s, n, len, cols) => { for (let i = 0; i < n; i++) { const x = r() * s, y = r() * s; g.strokeStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y + len * (0.6 + r() * 0.6)); g.stroke(); } };
  CT = {
    fur: pair(256, (g, s) => { g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s); strands(g, s, 5000, 7, ['rgba(255,255,255,0.4)', 'rgba(0,0,0,0.12)', 'rgba(120,80,40,0.12)']); },
      (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); strands(g, s, 4500, 7, ['#b0b0b0', '#505050']); }, 3),
    leather: pair(128, (g, s) => { g.fillStyle = '#e4e0e0'; g.fillRect(0, 0, s, s); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 6, 0, 7); g.fill(); } },
      (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); g.strokeStyle = '#4a4a4a'; for (let i = 0; i < 90; i++) { g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (r() - 0.5) * 18; y += (r() - 0.5) * 18; g.lineTo(x, y); } g.stroke(); } }, 2),
    rock: pair(256, (g, s) => { g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, s, s); for (let i = 0; i < 6000; i++) { const v = 150 + r() * 100; g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3); } },
      (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); for (let i = 0; i < 400; i++) { const v = 60 + r() * 140; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 10, 0, 7); g.fill(); } }, 2),
    bark: pair(128, (g, s) => { g.fillStyle = '#8a6a4a'; g.fillRect(0, 0, s, s); for (let x = 0; x < s; x += 3) { g.fillStyle = `rgba(40,25,10,${0.15 + r() * 0.3})`; g.fillRect(x, 0, 1 + r() * 2, s); } },
      (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); for (let x = 0; x < s; x += 3) { const v = 50 + r() * 150; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 2, s); } }, 2),
    leaf: pair(128, (g, s) => { g.fillStyle = '#e0f0d0'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(255,255,230,0.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke(); g.lineWidth = 1; for (let y = 8; y < s; y += 12) { g.beginPath(); g.moveTo(s / 2, y); g.lineTo(s * 0.1, y - 10); g.moveTo(s / 2, y); g.lineTo(s * 0.9, y - 10); g.stroke(); } },
      (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); g.strokeStyle = '#b8b8b8'; g.lineWidth = 3; g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke(); g.lineWidth = 1.5; for (let y = 8; y < s; y += 12) { g.beginPath(); g.moveTo(s / 2, y); g.lineTo(s * 0.1, y - 10); g.moveTo(s / 2, y); g.lineTo(s * 0.9, y - 10); g.stroke(); } }),
    slime: pair(128, (g, s) => { g.fillStyle = '#e8f0e0'; g.fillRect(0, 0, s, s); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(30,60,10,${r() * 0.18})`; g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 7, 0, 7); g.fill(); } },
      (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); for (let i = 0; i < 260; i++) { const v = 90 + r() * 90; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 5, 0, 7); g.fill(); } }, 2),
  };
  return CT;
}

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
const glow = (color, k = 3) => new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: k });
const mats = {};
const M = (key, make) => mats[key] || (mats[key] = make());

// Lumpy rock: an icosahedron with jittered vertices (rebuilt normals, welded).
function rockGeo(r, seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, R = rng(seed), seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 0.82 + R() * 0.32; seen.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// Eye: glossy sclera + textured iris on its front (+x).
function eye(P, white, irisM, x, y, z, r) {
  P.white.add(new THREE.SphereGeometry(r, 14, 10), white, { p: [x, y, z] });
  P.iris.add(new THREE.CircleGeometry(r * 0.62, 16), irisM, { p: [x + r * 0.97, y, z], r: [0, Math.PI / 2, 0] });
}

// Four-legged rig: each leg is hip -> knee -> paw groups (legs hang down -y).
function addLeg(parent, x, y, z, upper, lower, r1, r2, mat, pawMat, paw = [1.1, 0.45, 0.85]) {
  const hip = new THREE.Group(); hip.position.set(x, y, z); parent.add(hip);
  new Parts().add(lathe([[r1, 0.4], [r1 * 1.05, -0.5], [r2 * 1.1, -upper]], 10), mat).into(hip);
  const knee = new THREE.Group(); knee.position.y = -upper; hip.add(knee);
  new Parts().add(new THREE.SphereGeometry(r2 * 1.05, 10, 8), mat).add(lathe([[r2, 0], [r2 * 0.8, -lower]], 10), mat).into(knee);
  const foot = new THREE.Group(); foot.position.y = -lower; knee.add(foot);
  new Parts().add(new THREE.SphereGeometry(1, 12, 8), pawMat, { p: [0.4, -0.15, 0], s: paw }).into(foot);
  return { hip, knee, foot };
}

// ---------------------------------------------------------------- companions
export function buildCreature(type, evolved) {
  const T = ctex(), HT = textures();
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const P = { white: new Parts(), iris: new Parts() };
  const white = M('eyewhite', () => std('#f6f2ea', { roughness: 0.15 }));
  const legs = [], extra = [];
  let tail = null;
  if (type === 'cindkit') {
    const furM = M('fur' + evolved, () => std(evolved ? '#d65a24' : '#ea7f34', { map: T.fur[0], normalMap: T.fur[1], roughness: 0.85 }));
    const cream = M('furcream', () => std('#f6e6cc', { map: T.fur[0], normalMap: T.fur[1], roughness: 0.9 }));
    const dark = M('furdark', () => std('#2a1c16', { map: T.fur[0], roughness: 0.9 }));
    const amber = M('amber', () => std('#e8a020', { map: HT.iris, roughness: 0.1 }));
    const pb = new Parts();
    pb.add(lathe([[0.3, -6.4], [2.1, -5.7], [2.8, -3.6], [2.9, -1], [3.0, 1.6], [2.85, 3.8], [2.3, 5.5], [1.1, 6.6]], 16, 1, 0.82), furM, { p: [0, 8.6, 0], r: [0, 0, -Math.PI / 2] });
    pb.add(new THREE.SphereGeometry(1, 14, 10), cream, { p: [4.6, 7.4, 0], s: [1.9, 2.2, 1.9] });
    pb.add(new THREE.CapsuleGeometry(1.55, 2.6, 4, 12), furM, { p: [6.2, 10.4, 0], r: [0, 0, -0.75] });
    pb.add(new THREE.SphereGeometry(2.55, 18, 14), furM, { p: [8.3, 12.6, 0], s: [1.15, 0.95, 1.0] });
    pb.add(new THREE.ConeGeometry(1.25, 2.8, 14), cream, { p: [10.6, 11.85, 0], r: [0, 0, -Math.PI / 2 + 0.12], s: [1, 1, 0.9] });
    pb.add(new THREE.SphereGeometry(1.15, 12, 8), cream, { p: [9.6, 11.2, 0], s: [1.2, 0.8, 1.15] });
    for (const z of [-1, 1]) {
      pb.add(new THREE.ConeGeometry(1.15, 3.4, 10), furM, { p: [7.7, 15.4, z * 1.45], r: [z * 0.28, 0, 0.12] });
    }
    pb.into(body);
    const tips = new Parts(), nose = new Parts();
    for (const z of [-1, 1]) tips.add(new THREE.ConeGeometry(0.55, 1.1, 8), dark, { p: [7.85, 16.95, z * 1.88], r: [z * 0.28, 0, 0.12] });
    nose.add(new THREE.SphereGeometry(0.42, 10, 8), M('nose', () => std('#2b1d1d', { roughness: 0.25 })), { p: [11.95, 11.95, 0] });
    tips.into(body); nose.into(body, { cast: false });
    for (const z of [-1, 1]) eye(P, white, amber, 10.0, 13.05, z * 1.2, 0.5);
    // ember tuft (glows)
    new Parts().add(new THREE.ConeGeometry(0.55, 2.1, 8), M('ember1', () => glow('#ffb02a', 2.5)), { p: [8.1, 15.6, 0], r: [0, 0, 0.25] })
      .add(new THREE.ConeGeometry(0.4, 1.5, 8), M('ember2', () => glow('#ff5a1f', 3)), { p: [7.6, 15.3, 0.45], r: [0.3, 0, 0.4] })
      .into(body, { cast: false });
    for (const [x, z, back] of [[4.4, -1.7, 0], [4.4, 1.7, 0], [-4.3, -1.8, 1], [-4.3, 1.8, 1]]) legs.push(addLeg(body, x, 8.0, z, 3.7, 3.7, back ? 1.35 : 0.95, 0.6, furM, cream));
    // striped tail curling up (three swaying segments)
    let parent = body, tx = -6.2, ty = 9.3;
    tail = [];
    for (let k = 0; k < 3; k++) {
      const seg = new THREE.Group(); seg.position.set(tx, ty, 0); seg.rotation.z = k === 0 ? 0.9 : 0.45; parent.add(seg);
      new Parts().add(lathe([[1.05 - k * 0.2, 0], [0.95 - k * 0.2, 3]], 10), furM, { r: [0, 0, 0] })
        .add(new THREE.TorusGeometry(0.98 - k * 0.2, 0.18, 6, 14), dark, { p: [0, 1.6, 0], r: [Math.PI / 2, 0, 0] })
        .into(seg);
      tail.push(seg);
      parent = seg; tx = 0; ty = 3;
    }
    if (evolved) { // Blazelynx: flame mane + glowing tail tip
      const fm = M('mane', () => glow('#ff7a1f', 1.8));
      const mane = new Parts();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; mane.add(new THREE.ConeGeometry(0.6, 3.2, 8), fm, { p: [6.4 + Math.cos(a) * 0.4, 11.3 + Math.sin(a) * 2.3, Math.cos(a) * 2.3], r: [a, 0, -0.6] }); }
      mane.into(body, { cast: false });
      new Parts().add(new THREE.ConeGeometry(0.8, 2.4, 8), M('tailflame', () => glow('#ffcf3a', 2.5)), { p: [0, 3.6, 0] }).into(tail[2], { cast: false });
    }
  } else if (type === 'puddlo') { // living water slime
    const water = M('water' + evolved, () => new THREE.MeshPhysicalMaterial({ color: evolved ? '#2f86d6' : '#4aa8f0', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.82 }));
    const core = M('core', () => glow('#9fe4ff', 0.9));
    const blob = new THREE.SphereGeometry(1, 28, 20);
    const bp = blob.attributes.position, R = rng(5);
    for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); const k = 1 + Math.sin(i * 0.7) * 0.012 + R() * 0.008; bp.setXYZ(i, bp.getX(i) * 6.4 * k * (y < 0 ? 1.06 : 1), y * 5.4 * k * (y < -0.3 ? 0.85 : 1), bp.getZ(i) * 6.1 * k); }
    blob.computeVertexNormals();
    new Parts().add(blob, water, { p: [0, 5.6, 0] }).into(body);
    new Parts().add(new THREE.SphereGeometry(2.6, 16, 12), core, { p: [-0.5, 5.0, 0] }).into(body, { cast: false });
    const irisM = M('slimeiris', () => std('#14365c', { map: HT.iris, roughness: 0.08 }));
    for (const z of [-1, 1]) eye(P, white, irisM, 5.15, 7.6, z * 2.2, 1.15);
    new Parts().add(new THREE.TorusGeometry(0.9, 0.18, 6, 14, Math.PI), M('mouth', () => std('#13304f', { roughness: 0.3 })), { p: [6.1, 5.2, 0], r: [0, Math.PI / 2, Math.PI] }).into(body, { cast: false });
    const drop = new Parts().add(new THREE.CylinderGeometry(0.2, 0.25, 3, 8), water, { p: [0, 12.4, 0] })
      .add(new THREE.SphereGeometry(1.15, 14, 10), M('drop', () => glow('#bff0ff', 1.3)), { p: [0, 14.6, 0] })
      .add(new THREE.ConeGeometry(0.95, 1.6, 12), M('drop', () => glow('#bff0ff', 1.3)), { p: [0, 15.9, 0] });
    drop.into(body, { cast: false });
    for (const [x, z] of [[2.6, -3.4], [2.6, 3.4], [-2.6, -3.4], [-2.6, 3.4]]) new Parts().add(new THREE.SphereGeometry(1.5, 12, 8), water, { p: [x, 0.9, z], s: [1.2, 0.6, 1] }).into(body);
    if (evolved) { // Tidalor: wave crest + orbiting droplets
      const crest = new Parts();
      for (let i = 0; i < 3; i++) crest.add(new THREE.ConeGeometry(1.3 - i * 0.2, 4.2 - i * 0.8, 12), water, { p: [-1.2 - i * 2.4, 10.4 - i * 1.0, 0], r: [0, 0, 0.5 + i * 0.25] });
      crest.into(body);
      for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), M('drop', () => glow('#bff0ff', 1.3))); body.add(d); extra.push(d); }
    }
  } else { // thornub: seed bulb on root legs
    const leafSkin = M('bulb' + evolved, () => std(evolved ? '#3d8a3f' : '#5fb35a', { map: T.slime[0], normalMap: T.slime[1], roughness: 0.55 }));
    const belly = M('bulbbelly', () => std('#e6f2c8', { roughness: 0.6 }));
    const bark = M('bark', () => std('#ffffff', { map: T.bark[0], normalMap: T.bark[1], roughness: 0.9 }));
    const leafM = M('leaf', () => std('#7ccf5c', { map: T.leaf[0], normalMap: T.leaf[1], roughness: 0.55, side: THREE.DoubleSide }));
    new Parts().add(new THREE.SphereGeometry(1, 24, 18), leafSkin, { p: [0, 8.2, 0], s: [6.0, 5.6, 5.8] })
      .add(new THREE.SphereGeometry(1, 16, 12), belly, { p: [3.4, 7.4, 0], s: [3.0, 3.6, 3.9] }).into(body);
    const irisM = M('beadeye', () => std('#1d1a14', { roughness: 0.05 }));
    for (const z of [-1, 1]) eye(P, white, irisM, 5.15, 9.6, z * 2.1, 0.75);
    new Parts().add(new THREE.SphereGeometry(0.7, 10, 8), M('cheek', () => std('#f7a8c4', { roughness: 0.6 })), { p: [5.2, 8.1, -3.0], s: [0.5, 1, 1] }).add(new THREE.SphereGeometry(0.7, 10, 8), M('cheek', () => std('#f7a8c4')), { p: [5.2, 8.1, 3.0], s: [0.5, 1, 1] }).into(body, { cast: false });
    // sprout: stem + two veined leaves
    const leafShape = new THREE.Shape(); leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(1.6, 1.4, 0, 4.2); leafShape.quadraticCurveTo(-1.6, 1.4, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 8);
    const lp = leafGeo.attributes.position, luv = leafGeo.attributes.uv;
    for (let i = 0; i < lp.count; i++) { luv.setXY(i, lp.getX(i) / 3.2 + 0.5, lp.getY(i) / 4.2); lp.setZ(i, Math.abs(lp.getX(i)) * 0.35); }
    leafGeo.computeVertexNormals();
    new Parts().add(new THREE.CylinderGeometry(0.28, 0.4, 3.2, 8), M('stem', () => std('#3d8b3d')), { p: [-0.4, 15.0, 0] })
      .add(leafGeo, leafM, { p: [-0.4, 16.4, 0], r: [Math.PI / 2 - 0.4, 0, 0.9] })
      .add(leafGeo, leafM, { p: [-0.4, 16.4, 0], r: [Math.PI / 2 + 0.4, 0, -0.9] })
      .into(body);
    for (const [x, z] of [[3, -3.2], [3, 3.2], [-3, -3.2], [-3, 3.2]]) legs.push(addLeg(body, x, 5.0, z, 2.6, 2.4, 1.1, 0.75, bark, bark, [1.2, 0.5, 1.1]));
    if (evolved) { // Briarok: blossom + thorns
      const petal = M('petal', () => std('#ff7fae', { roughness: 0.5, side: THREE.DoubleSide, emissive: new THREE.Color('#ff7fae'), emissiveIntensity: 0.25 }));
      const bl = new Parts();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; bl.add(new THREE.SphereGeometry(1, 12, 8), petal, { p: [Math.cos(a) * 1.7, 14.2, Math.sin(a) * 1.7], s: [1.9, 0.45, 1.1], r: [0, -a, 0.3] }); }
      bl.into(body);
      new Parts().add(new THREE.SphereGeometry(0.9, 12, 8), M('pollen', () => glow('#ffd23f', 1.4)), { p: [0, 14.5, 0] }).into(body, { cast: false });
      const th = new Parts();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, yy = 6.5 + (i % 2) * 3; th.add(new THREE.ConeGeometry(0.5, 2.2, 6), bark, { p: [Math.cos(a) * 5.6, yy, Math.sin(a) * 5.6], r: [Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3] }); }
      th.into(body);
    }
  }
  P.white.into(body, { cast: false });
  P.iris.into(body, { cast: false });
  root.scale.setScalar(evolved ? 1.4 : 1);
  root.userData = { body, legs, tail, extra, type, kind: 'creature' };
  return root;
}

export function poseCreature(o, { phase, moving, t }) {
  const u = o.userData;
  const m = moving ? 1 : 0;
  if (u.type === 'puddlo') { // squash-and-stretch hop
    const h = m ? Math.abs(Math.sin(phase * 0.7)) : 0;
    u.body.position.y = h * 3;
    const sq = m ? 1 + Math.cos(phase * 1.4) * 0.08 : 1 + Math.sin(t * 2.5) * 0.03;
    u.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  } else {
    // diagonal trot: front-left + back-right together
    u.legs.forEach((L, i) => {
      const lp = phase * 1.3 + ((i === 0 || i === 3) ? 0 : Math.PI);
      const sw = Math.sin(lp) * 0.5 * m;
      L.hip.rotation.z = sw;
      L.knee.rotation.z = m ? -Math.max(0, Math.cos(lp)) * 0.7 : 0;
      L.foot.rotation.z = -sw * 0.4;
    });
    u.body.position.y = m ? Math.abs(Math.sin(phase * 1.3)) * 0.5 : Math.sin(t * 2) * 0.15;
  }
  if (u.tail) u.tail.forEach((s, k) => { s.rotation.x = Math.sin(t * 2.2 + k * 0.6) * (0.18 + k * 0.08); });
  u.extra.forEach((d, i) => { const a = t * 1.8 + (i * Math.PI * 2) / 3; d.position.set(Math.cos(a) * 8, 9 + Math.sin(t * 3 + i) * 1.5, Math.sin(a) * 8); });
}

// ---------------------------------------------------------------- enemies
export function buildEnemy(type, boss) {
  const T = ctex();
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const extra = [];
  const ud = { body, extra, type, kind: 'enemy' };
  if (type === 'zombie') { // Glitch
    const rig = buildHuman({ skin: 0, hair: 0, style: 0, hat: 0, shirt: 6, pants: 0 }, { lod: 'low', skinColor: '#7d6bb0', eyeGlow: '#ff3a5a', shirtColor: '#2a2438', pantsColor: '#1e1a2a', armed: false, noHair: true, noHat: true });
    const h = bakeSkinned(rig, { glowMat: rig.userData.irisMat }); // one skinned mesh: cheap for big waves
    body.add(h);
    ud.human = h;
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), M('glitch' + (i % 2), () => glow(i % 2 ? '#2df0ff' : '#ff3ad1', 2.6)));
      body.add(c); extra.push(c);
    }
  } else if (type === 'runner') { // Dasher: leathery imp
    const skin = M('imp', () => std('#b8402e', { map: T.leather[0], normalMap: T.leather[1], roughness: 0.5 }));
    const horn = M('horn', () => std('#e8d6b0', { roughness: 0.35 }));
    const P = new Parts();
    P.add(new THREE.SphereGeometry(1, 16, 12), skin, { p: [0, 8.5, 0], s: [3.4, 3.0, 2.6], r: [0, 0, -0.35] });
    P.add(new THREE.SphereGeometry(2.1, 16, 12), skin, { p: [3.4, 11.4, 0] });
    P.add(new THREE.ConeGeometry(0.9, 1.6, 10), skin, { p: [5.3, 11.0, 0], r: [0, 0, -Math.PI / 2] });
    for (const z of [-1, 1]) {
      P.add(new THREE.ConeGeometry(0.42, 2.6, 8), horn, { p: [2.9, 13.6, z * 1.1], r: [z * 0.35, 0, 0.55] });
      P.add(new THREE.ConeGeometry(0.5, 1.6, 6), skin, { p: [2.8, 12.2, z * 2.1], r: [z * 1.2, 0, 0] });
      P.add(new THREE.CapsuleGeometry(0.42, 3.6, 3, 8), skin, { p: [2.8, 7.6, z * 2.5], r: [z * 0.3, 0, 1.1] }); // arms reaching
      P.add(new THREE.ConeGeometry(0.25, 0.9, 5), horn, { p: [5.0, 6.4, z * 2.9], r: [0, 0, -1.9] }); // claws
    }
    P.into(body);
    new Parts().add(new THREE.SphereGeometry(0.42, 10, 8), M('impeye', () => glow('#ffee55', 3)), { p: [5.0, 12.0, -0.85] }).add(new THREE.SphereGeometry(0.42, 10, 8), M('impeye', () => glow('#ffee55', 3)), { p: [5.0, 12.0, 0.85] }).into(body, { cast: false });
    const legs = [];
    for (const z of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(-0.8, 6.6, z * 1.5); body.add(hip);
      new Parts().add(new THREE.CapsuleGeometry(0.75, 2.6, 3, 8), skin, { p: [0.6, -1.6, 0], r: [0, 0, -0.5] }).into(hip);
      const knee = new THREE.Group(); knee.position.set(1.3, -3.2, 0); hip.add(knee);
      new Parts().add(new THREE.CapsuleGeometry(0.55, 2.6, 3, 8), skin, { p: [-0.6, -1.6, 0], r: [0, 0, 0.45] }).add(new THREE.SphereGeometry(1, 8, 6), horn, { p: [-0.3, -3.2, 0], s: [1.0, 0.4, 0.6] }).into(knee);
      legs.push({ hip, knee });
    }
    ud.legs = legs;
    const tail = new Parts().add(new THREE.CylinderGeometry(0.18, 0.45, 7, 8), skin, { p: [-5.2, 9.2, 0], r: [0, 0, 1.0] }).add(new THREE.ConeGeometry(0.9, 1.4, 4), skin, { p: [-8.2, 11.4, 0], r: [0, 0, 1.0] });
    tail.into(body);
  } else if (type === 'brute') { // rock golem
    const rock = M('rock' + (boss ? 1 : 0), () => std(boss ? '#8f8199' : '#8d949c', { map: T.rock[0], normalMap: T.rock[1], roughness: 0.95, flatShading: true }));
    const moss = M('moss', () => std('#5f9a45', { map: T.fur[0], roughness: 1 }));
    const P = new Parts(), MP = new Parts();
    P.add(rockGeo(9.5, 1), rock, { p: [0, 20, 0], s: [1, 1.05, 1.1] });
    P.add(rockGeo(5.2, 2), rock, { p: [4, 31.5, 0] });
    for (const z of [-1, 1]) {
      P.add(rockGeo(4.6, 3 + z), rock, { p: [0.5, 26, z * 11] });
      P.add(rockGeo(3.6, 5 + z), rock, { p: [2, 18, z * 12.5] });
      P.add(rockGeo(4.2, 7 + z), rock, { p: [3.5, 9.5, z * 12.5], s: [1.1, 1, 1] }); // fists
      P.add(rockGeo(4.0, 9 + z), rock, { p: [0, 5.2, z * 4.8], s: [1, 1.3, 1] }); // legs
      MP.add(new THREE.SphereGeometry(1, 10, 6), moss, { p: [0, 30, z * 10.5], s: [3.6, 1.4, 3.2] });
    }
    MP.add(new THREE.SphereGeometry(1, 10, 6), moss, { p: [2, 36, 0], s: [3.5, 1.3, 3.3] });
    P.into(body); MP.into(body);
    const em = M('golemeye' + (boss ? 1 : 0), () => glow(boss ? '#ff3030' : '#ffb03a', 3));
    new Parts().add(new THREE.BoxGeometry(0.8, 0.9, 1.8), em, { p: [9.0, 32.2, -1.6] }).add(new THREE.BoxGeometry(0.8, 0.9, 1.8), em, { p: [9.0, 32.2, 1.6] }).into(body, { cast: false });
    if (boss) new Parts().add(new THREE.ConeGeometry(1.4, 4.4, 6), M('gold', () => std('#ffd23f', { metalness: 1, roughness: 0.25, emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.3 })), { p: [3, 37.5, -2.6] })
      .add(new THREE.ConeGeometry(1.4, 4.4, 6), M('gold', () => std('#ffd23f')), { p: [3, 38, 0] }).add(new THREE.ConeGeometry(1.4, 4.4, 6), M('gold', () => std('#ffd23f')), { p: [3, 37.5, 2.6] }).into(body);
    root.scale.setScalar(boss ? 1.25 : 0.85);
  } else { // Spitter: wet slug
    const slime = M('slug', () => new THREE.MeshPhysicalMaterial({ color: '#7bc043', map: T.slime[0], normalMap: T.slime[1], roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }));
    const g = new THREE.CapsuleGeometry(4.6, 11, 8, 18);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 + Math.sin(y * 1.3) * 0.05; p.setXYZ(i, p.getX(i) * k * (p.getX(i) < 0 ? 0.7 : 1), y, p.getZ(i) * k); }
    g.computeVertexNormals();
    const P = new Parts().add(g, slime, { p: [-1, 4.2, 0], r: [0, 0, Math.PI / 2] });
    P.add(new THREE.SphereGeometry(4.4, 16, 12), slime, { p: [6.2, 6.4, 0], s: [1, 1.05, 0.95] });
    for (const z of [-1, 1]) P.add(new THREE.CylinderGeometry(0.4, 0.6, 6, 8), slime, { p: [7.0, 12.4, z * 1.6], r: [z * 0.3, 0, -0.25] });
    P.into(body);
    new Parts().add(new THREE.SphereGeometry(1.05, 10, 8), M('slugeye', () => glow('#ffee55', 2.2)), { p: [7.8, 15.4, -2.5] }).add(new THREE.SphereGeometry(1.05, 10, 8), M('slugeye', () => glow('#ffee55', 2.2)), { p: [7.8, 15.4, 2.5] })
      .add(new THREE.SphereGeometry(1.4, 10, 8), M('slugmouth', () => std('#1d2a0c', { roughness: 0.2 })), { p: [10.4, 5.6, 0], s: [0.5, 1, 1.3] })
      .into(body, { cast: false });
  }
  root.userData = ud;
  return root;
}

export function poseEnemy(o, { phase, moving, t }) {
  const u = o.userData;
  if (u.type === 'zombie') {
    poseHuman(u.human, { phase, moving, t, armed: false, motion: [1, 0], ang: 0, hurt: 0 });
    const H = u.human.userData;
    H.spine.rotation.z -= 0.22; // hunched
    for (const A of H.arms) { A.sh.quaternion.setFromEuler(new THREE.Euler(-A.side * 0.15, 0, 1.25 + Math.sin(t * 2 + A.side) * 0.1)); A.el.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.2)); }
  } else if (u.type === 'runner') {
    const m = moving ? 1 : 0;
    u.legs.forEach((L, i) => { const s = Math.sin(phase * 1.6 + i * Math.PI) * 0.6 * m; L.hip.rotation.z = s; L.knee.rotation.z = m ? Math.max(0, -s) * 0.8 : 0; });
    u.body.position.y = m ? Math.abs(Math.sin(phase * 1.6)) * 1.2 : 0;
  } else if (u.type === 'spitter') {
    const w = Math.sin(t * 5) * 0.06;
    u.body.scale.set(1 + w, 1 - w, 1);
  } else if (u.type === 'brute') {
    u.body.rotation.x = moving ? Math.sin(phase * 0.5) * 0.06 : 0;
    u.body.position.y = moving ? Math.abs(Math.sin(phase * 0.5)) * 0.8 : 0;
  }
  u.extra.forEach((c, i) => { const a = t * 2.5 + (i * Math.PI) / 2; c.position.set(Math.cos(a) * 8, 16 + Math.sin(t * 4 + i) * 5, Math.sin(a) * 8); c.rotation.set(t * 3, t * 2, 0); });
}
