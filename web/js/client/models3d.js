// Procedural 3D models (no asset files): the hero and NPCs built from the
// player's look, the three companion creatures and their evolutions, the four
// enemy types, pickups and cars. Models face +x (the sim's angle 0) and stand
// on y = 0; sizes match the simulation's collision radii so what you see hit is
// what the game counts as a hit.
import * as THREE from '../../vendor/three.module.min.js';
import { LOOK } from '../shared/data.js';
import { CAR_COLORS } from './art.js';

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

// ---------- hero / NPC ----------
// Materials are per character (not cached) so the hero can flash red when hurt.
export function buildCharacter(look) {
  const own = (c, rough = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
  const skin = own(LOOK.skin[look.skin] || LOOK.skin[0], 0.6);
  const hair = own(LOOK.hair[look.hair] || LOOK.hair[0], 0.55);
  const shirt = own(LOOK.shirt[look.shirt] || LOOK.shirt[0], 0.8);
  const pants = own(LOOK.pants[look.pants] || LOOK.pants[0], 0.85);
  const shoe = M('#2c2833', { rough: 0.5 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legs = [], arms = [];
  for (const z of [-2.9, 2.9]) {
    const hip = new THREE.Group();
    hip.position.set(0, 11, z);
    hip.add(mesh(G.capsule(2.2, 5.5), pants, 0, -5, 0));
    hip.add(mesh(G.box(5.2, 2.6, 3.8), shoe, 1, -10.2, 0));
    body.add(hip);
    legs.push(hip);
  }
  const torso = mesh(G.capsule(5, 4.5, 14), shirt, 0, 16.5, 0);
  torso.scale.set(0.72, 0.78, 1);
  body.add(torso);
  for (const z of [-6.6, 6.6]) {
    const sh = new THREE.Group();
    sh.position.set(0, 20.2, z);
    sh.add(mesh(G.capsule(1.8, 5.5), shirt, 0, -4, 0));
    sh.add(mesh(G.sphere(2.1, 10, 8), skin, 0, -8.4, 0));
    body.add(sh);
    arms.push(sh);
  }
  const head = new THREE.Group();
  head.position.set(0, 28.5, 0);
  head.add(mesh(G.sphere(6.3, 22, 16), skin));
  const eye = M('#1d1a2b', { rough: 0.3 }), shine = M('#ffffff', { rough: 0.2 });
  for (const z of [-2.3, 2.3]) {
    head.add(mesh(G.sphere(1.05, 10, 8), eye, 5.55, 0.4, z));
    head.add(mesh(G.sphere(0.38, 6, 4), shine, 6.4, 0.9, z + 0.3));
  }
  head.add(mesh(G.sphere(0.8, 8, 6), M('#f39c9c', { rough: 0.6 }), 5.2, -2.2, 3.6));
  head.add(mesh(G.sphere(0.8, 8, 6), M('#f39c9c', { rough: 0.6 }), 5.2, -2.2, -3.6));
  // hair cap (tilted back so the face stays clear)
  const cap = mesh(G.hemi(6.75), hair, -0.4, 0.2, 0);
  cap.rotation.z = 0.32;
  head.add(cap);
  const back = mesh(G.sphere(6.4, 16, 12), hair, -1.2, -0.4, 0);
  back.scale.set(0.9, 0.95, 1.02);
  head.add(back);
  const style = look.style | 0, hat = look.hat | 0;
  if (style === 1 && hat === 0) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = mesh(G.cone(1.8, 5), hair, -0.6 + Math.cos(a) * 3.2, 6.2, Math.sin(a) * 3.2);
      s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      head.add(s);
    }
  } else if (style === 2) {
    head.add(mesh(G.box(3.6, 10, 11.5), hair, -4.6, -5, 0));
  }
  if (hat === 1) { // cap with a star badge
    const hc = new THREE.MeshStandardMaterial({ color: '#2bb3a3', roughness: 0.6 });
    const c = mesh(G.hemi(7), hc, 0, 1.4, 0);
    head.add(c);
    head.add(mesh(G.box(6.5, 0.9, 8.5), hc, 6, 1.8, 0));
    head.add(mesh(G.sphere(1, 6, 4), M('#ffd23f', { emissive: 0.4 }), 5.6, 4.5, 0));
  } else if (hat === 2) { // beanie with a pom-pom
    const bc = new THREE.MeshStandardMaterial({ color: '#3f7fd8', roughness: 0.9 });
    const b = mesh(G.hemi(7.1), bc, 0, 1.1, 0);
    b.scale.y = 1.12;
    head.add(b);
    const band = mesh(G.torus(6.6, 1.1), M('#7fb0f0', { rough: 0.9 }), 0, 1.4, 0);
    band.rotation.x = Math.PI / 2;
    head.add(band);
    head.add(mesh(G.sphere(1.7, 8, 6), M('#f5f5f5', { rough: 0.9 }), 0, 9.2, 0));
  }
  body.add(head);
  // gun held in the right hand
  const gun = new THREE.Group();
  gun.position.set(0, -8.4, 0);
  const gm = M('#2d323b', { rough: 0.35, metal: 0.7 });
  gun.add(mesh(G.box(1, 1, 1), gm));
  arms[1].add(gun);
  root.userData = { body, legs, arms, head, gun, gunMesh: gun.children[0], mats: [skin, hair, shirt, pants], torso };
  return root;
}

const GUN_SIZE = { pistol: [8, 2.4, 2], uzi: [10, 3, 2.2], shotgun: [15, 2.6, 2.4], rifle: [17, 2.4, 2.2], rocket: [17, 4.4, 4.4] };

// Animates a character: walk cycle, aim pose, idle bob, hurt flash.
export function poseCharacter(o, { phase, moving, wpn, hurt, t, armed = true }) {
  const u = o.userData;
  const swing = moving ? Math.sin(phase) * 0.75 : 0;
  u.legs[0].rotation.z = swing;
  u.legs[1].rotation.z = -swing;
  u.arms[0].rotation.z = moving ? -swing * 0.8 : 0.05 * Math.sin(t * 2);
  u.body.position.y = moving ? Math.abs(Math.cos(phase)) * 0.9 : Math.sin(t * 2.4) * 0.3;
  if (armed) {
    u.arms[1].rotation.set(0.12, 0, 1.38); // right arm raised, pointing forward
    const [l, h, w] = GUN_SIZE[wpn] || GUN_SIZE.pistol;
    u.gun.visible = true;
    u.gunMesh.scale.set(l, h, w);
    u.gunMesh.position.set(0, -l / 2 + 2, 0);
    u.gunMesh.material = wpn === 'rocket' ? M('#5a8a4a', { rough: 0.5, metal: 0.3 }) : M('#2d323b', { rough: 0.35, metal: 0.7 });
  } else {
    u.arms[1].rotation.set(0, 0, moving ? swing * 0.8 : -0.05 * Math.sin(t * 2));
    u.gun.visible = false;
  }
  const e = hurt > 0 ? Math.min(1, hurt * 3) : 0;
  for (const m of u.mats) { m.emissive.setRGB(e, 0.05 * e, 0.1 * e); }
}

// ---------- companion creatures ----------
export function buildCreature(type, evolved) {
  const root = new THREE.Group();
  const b = new THREE.Group();
  root.add(b);
  const add = (o) => { b.add(o); return o; };
  const dark = M('#1d1a2b', { rough: 0.3 }), white = M('#ffffff', { rough: 0.2 });
  const eyes = (x, y, zs, r = 0.95) => { for (const z of zs) { add(mesh(G.sphere(r, 10, 8), dark, x, y, z)); add(mesh(G.sphere(r * 0.4, 6, 4), white, x + r * 0.7, y + r * 0.4, z)); } };
  if (type === 'cindkit') {
    const fur = M(evolved ? '#e0632a' : '#f28a3a', { rough: 0.8 }), belly = M('#ffe1b0', { rough: 0.8 });
    add(mesh(G.sphere(6, 18, 14), fur, 0, 7, 0)).scale.set(1.25, 1, 0.95);
    add(mesh(G.sphere(4.2, 14, 10), belly, 2.6, 6.2, 0)).scale.set(0.8, 1, 1.05);
    add(mesh(G.sphere(5.2, 18, 14), fur, 5.8, 13, 0));
    for (const z of [-2.7, 2.7]) { const e = add(mesh(G.cone(1.9, 4.2), fur, 5.2, 18.4, z)); e.rotation.x = z > 0 ? 0.25 : -0.25; }
    eyes(10.2, 13.8, [-1.9, 1.9]);
    add(mesh(G.sphere(0.6, 6, 4), M('#ff8a9a'), 10.9, 12.3, 0));
    for (const [x, z] of [[3.5, 3.2], [3.5, -3.2], [-3.5, 3.2], [-3.5, -3.2]]) add(mesh(G.cyl(1.4, 1.4, 4, 8), fur, x, 2, z));
    // striped tail curling up
    const t1 = add(mesh(G.capsule(1.4, 5), fur, -8, 9, 0)); t1.rotation.z = 0.9;
    const t2 = add(mesh(G.capsule(1.3, 4), fur, -10.2, 13.2, 0)); t2.rotation.z = -0.2;
    add(mesh(G.torus(1.5, 0.45), M('#8a3b12'), -9.2, 10.6, 0)).rotation.y = Math.PI / 2;
    // ember tuft on the head (glows)
    add(mesh(G.cone(1.5, 3.6), M('#ffb02a', { emissive: 2.2 }), 5.6, 19.4, 0));
    add(mesh(G.sphere(0.7, 6, 4), M('#ff4a1f', { emissive: 3 }), 5.6, 21.4, 0));
    if (evolved) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const c = add(mesh(G.cone(1.6, 4.6), M('#ff6a1f', { emissive: 1.6 }), 4.2 + Math.cos(a) * 0.5, 13 + Math.sin(a) * 5.4, Math.cos(a) * 5.4));
        c.rotation.set(a, 0, 0);
      }
    }
  } else if (type === 'puddlo') {
    const skin = M(evolved ? '#2f7fd6' : '#58a9ef', { rough: 0.25, metal: 0.05 }), belly = M('#d4f1ff', { rough: 0.4 });
    add(mesh(G.sphere(7.5, 20, 16), skin, 0, 7, 0)).scale.set(1, 0.88, 1);
    add(mesh(G.sphere(5, 16, 12), belly, 3.6, 6, 0)).scale.set(0.7, 1, 1.05);
    for (const z of [-2.6, 2.6]) { add(mesh(G.sphere(1.7, 12, 10), white, 6.2, 9.4, z)); add(mesh(G.sphere(0.95, 10, 8), dark, 7.5, 9.4, z)); }
    add(mesh(G.cyl(0.4, 0.4, 4.2, 6), M('#2a5b9a'), 0, 14.2, 0));
    add(mesh(G.sphere(1.9, 12, 10), M('#bff0ff', { emissive: 0.9, rough: 0.1 }), 0, 17.4, 0));
    for (const z of [-4.3, 4.3]) add(mesh(G.sphere(0.9, 8, 6), M('#bff0ff', { rough: 0.2 }), 5.6, 7, z));
    for (const z of [-3.6, 3.6]) add(mesh(G.sphere(2, 10, 8), skin, 2, 1.3, z));
    if (evolved) {
      add(mesh(G.sphere(6.6, 18, 12), M('#7fc4f0', { rough: 0.3, metal: 0.2 }), -3.2, 10.6, 0)).scale.set(0.9, 0.75, 1.05);
      for (const z of [-8.2, 8.2]) add(mesh(G.sphere(2.5, 10, 8), skin, 1, 8, z));
    }
  } else { // thornub
    const leaf = M(evolved ? '#3f9a4a' : '#6cc46a', { rough: 0.6 }), belly = M('#e9f7c9', { rough: 0.7 });
    add(mesh(G.sphere(7, 20, 16), leaf, 0, 7.2, 0)).scale.set(1, 0.95, 1);
    add(mesh(G.sphere(4.8, 14, 10), belly, 3.6, 6.2, 0)).scale.set(0.7, 1, 1.05);
    eyes(6.5, 9, [-2.4, 2.4], 1.05);
    for (const z of [-4, 4]) add(mesh(G.sphere(0.9, 8, 6), M('#f7a8c4'), 6.1, 7.2, z));
    add(mesh(G.cyl(0.5, 0.5, 3.2, 6), M('#3d8b3d'), 0, 14.5, 0));
    const l1 = add(mesh(G.sphere(2.6, 12, 8), M('#8fe07a', { rough: 0.5 }), -2.1, 16.2, 0)); l1.scale.set(1.6, 0.35, 0.8); l1.rotation.z = 0.5;
    const l2 = add(mesh(G.sphere(2.6, 12, 8), M('#8fe07a', { rough: 0.5 }), 2.1, 16.6, 0)); l2.scale.set(1.6, 0.35, 0.8); l2.rotation.z = -0.5;
    for (const z of [-3.4, 3.4]) add(mesh(G.sphere(2, 10, 8), leaf, 2, 1.3, z));
    if (evolved) {
      const petal = M('#ff7fae', { emissive: 0.5, rough: 0.5 });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(mesh(G.sphere(1.8, 10, 8), petal, Math.cos(a) * 2.4, 19, Math.sin(a) * 2.4)).scale.set(1, 0.5, 1); }
      add(mesh(G.sphere(1.2, 8, 6), M('#ffd23f', { emissive: 1.5 }), 0, 19.6, 0));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const th = add(mesh(G.cone(1.1, 3.2), M('#8d6e4a'), Math.cos(a) * 6.8, 7, Math.sin(a) * 6.8)); th.rotation.set(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4); }
    }
  }
  root.scale.setScalar(evolved ? 1.45 : 1);
  root.userData = { body: b };
  return root;
}

export function poseCreature(o, { phase, moving, t }) {
  o.userData.body.position.y = moving ? Math.abs(Math.sin(phase * 0.8)) * 2.4 : Math.sin(t * 3) * 0.5;
}

// ---------- enemies ----------
export function buildEnemy(type, boss) {
  const root = new THREE.Group();
  const b = new THREE.Group();
  root.add(b);
  const add = (o) => { b.add(o); return o; };
  const extra = [];
  if (type === 'zombie') { // Glitch: corrupted ghoul with orbiting glitch cubes
    const body = M('#8e6bd1', { rough: 0.6 });
    const torso = add(mesh(G.capsule(6, 7, 14), body, 0, 11, 0)); torso.rotation.z = -0.18;
    for (const z of [-2.3, 2.3]) add(mesh(G.sphere(1.3, 8, 6), M('#ff3a5a', { emissive: 3 }), 5.2, 16.5, z));
    add(mesh(G.box(1.2, 1, 4.5), M('#3b2a5c'), 5.6, 12.8, 0));
    for (const z of [-6.5, 6.5]) { const a = add(mesh(G.capsule(1.7, 7), body, 4, 12.5, z)); a.rotation.z = 1.35; }
    for (const z of [-2.8, 2.8]) add(mesh(G.capsule(1.9, 3), M('#4b3a73'), 0, 2.6, z));
    for (let i = 0; i < 4; i++) {
      const c = mesh(G.box(1.6, 1.6, 1.6), M(i % 2 ? '#2df0ff' : '#ff3ad1', { emissive: 2.5 }));
      c.castShadow = false;
      b.add(c);
      extra.push(c);
    }
  } else if (type === 'runner') { // Dasher: little horned imp
    const red = M('#e5533d', { rough: 0.5 });
    add(mesh(G.sphere(5.6, 16, 12), red, 0, 7.2, 0));
    for (const z of [-2.6, 2.6]) { const h = add(mesh(G.cone(1.2, 4.4), M('#ffe0a3', { rough: 0.4 }), 1, 12.6, z)); h.rotation.x = z > 0 ? 0.4 : -0.4; }
    for (const z of [-1.9, 1.9]) add(mesh(G.sphere(1.05, 8, 6), M('#ffee55', { emissive: 3 }), 4.9, 8.6, z));
    const tail = add(mesh(G.capsule(0.7, 6), red, -6.5, 6, 0)); tail.rotation.z = 1.1;
    add(mesh(G.cone(1.4, 2.6), red, -9.6, 7.4, 0)).rotation.z = 1.1;
    for (const z of [-2.5, 2.5]) add(mesh(G.sphere(1.7, 8, 6), M('#5c1a12'), 1, 1.4, z));
  } else if (type === 'brute') { // Brute: mossy stone golem
    const stone = M(boss ? '#8a7a9e' : '#8d949c', { rough: 0.95, flat: true });
    const moss = M('#6aa84f', { rough: 0.9, flat: true });
    add(mesh(G.box(17, 17, 19), stone, 0, 19, 0));
    add(mesh(G.box(11, 9, 11), stone, 3, 32, 0));
    const eyeM = M(boss ? '#ff3030' : '#ffb03a', { emissive: 3 });
    for (const z of [-2.6, 2.6]) add(mesh(G.box(1.2, 1.6, 2.4), eyeM, 8.7, 33, z));
    for (const z of [-12, 12]) { add(mesh(G.box(6.5, 18, 6.5), stone, 1, 17, z)); add(mesh(G.box(7, 4, 7), moss, 0, 26.5, z)); }
    for (const z of [-4.6, 4.6]) add(mesh(G.box(7, 10, 7), stone, 0, 5, z));
    add(mesh(G.box(9, 3, 9), moss, -2, 37.6, 0));
    if (boss) for (const z of [-3.5, 0, 3.5]) add(mesh(G.cone(1.6, 5, 6), M('#ffd23f', { metal: 0.9, rough: 0.25, emissive: 0.5 }), 3, 38.5, z));
    root.scale.setScalar(boss ? 1.3 : 1);
  } else { // Spitter: toxic slug
    const slime = M('#7bc043', { rough: 0.2, metal: 0.05 });
    const body = add(mesh(G.capsule(5, 12, 14), slime, -1, 5, 0)); body.rotation.z = Math.PI / 2;
    add(mesh(G.sphere(4.6, 14, 10), M('#94d860', { rough: 0.25 }), 6, 7, 0));
    for (const z of [-2.2, 2.2]) {
      const st = add(mesh(G.cyl(0.6, 0.6, 6.5, 6), slime, 6.6, 12.6, z)); st.rotation.x = z > 0 ? 0.25 : -0.25;
      add(mesh(G.sphere(1.3, 8, 6), M('#ffee55', { emissive: 2 }), 6.6, 16, z * 1.5));
    }
    add(mesh(G.sphere(1.6, 8, 6), M('#2c3a10'), 10.3, 5.6, 0));
  }
  root.userData = { body: b, extra, type };
  return root;
}

export function poseEnemy(o, { phase, moving, t }) {
  const u = o.userData;
  if (u.type === 'runner') u.body.position.y = moving ? Math.abs(Math.sin(phase * 1.4)) * 2.2 : 0;
  else if (u.type === 'spitter') u.body.scale.set(1 + Math.sin(t * 6) * 0.06, 1 - Math.sin(t * 6) * 0.06, 1);
  else if (u.type === 'brute') u.body.rotation.x = moving ? Math.sin(phase * 0.5) * 0.06 : 0;
  else u.body.rotation.x = Math.sin(t * 3) * 0.08;
  u.extra.forEach((c, i) => {
    const a = t * 2.5 + (i * Math.PI) / 2;
    c.position.set(Math.cos(a) * 9, 12 + Math.sin(t * 4 + i) * 4, Math.sin(a) * 9);
    c.rotation.set(t * 3, t * 2, 0);
  });
}

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
    if (e.lx !== null) {
      const d = Math.hypot(x - e.lx, y - e.ly);
      if (d < 60) { e.phase += d * 0.32; moving = d / Math.max(dt, 1e-3) > 8; }
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
  clear() { for (const [id, e] of [...this.live]) this.release(id, e); }
}
