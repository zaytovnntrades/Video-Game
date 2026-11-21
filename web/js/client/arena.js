// The battlefield. A physically based sky (which also lights everything through an
// environment map), textured ground that stays flat where the fight happens and rolls
// into hills beyond it, natural rock pillars (positions and sizes come from the sim),
// cliffs, distant mountains, trees, wind-blown grass and soft clouds.
import * as THREE from '../../vendor/three/three.module.js';
import { Sky } from '../../vendor/three/objects/Sky.js';
import { ARENA } from '../sim/data.js';
import { mulberry32 } from '../sim/rng.js';
import { bakeStatic } from './merge.js';
import { terrainTextures, noiseCanvas, cvs } from './textures.js';
import { Grass } from './grass.js';
import { RENDER } from './fighter3d.js';

export const STAGES = {
  highlands: { name: 'Sunlit Highlands', ground: 'grass', tint: ['#7aa24f', '#5d8a3c', '#9bb860'], rock: '#9c8a74', rockTop: '#6f9a45', hill: '#6c9446', sun: [42, 145], sunColor: '#fff1dc', turbidity: 5, rayleigh: 1.4, fog: '#bcd3e8', fogD: 0.0022, grass: ['#3d6a24', '#a6cf62', 0.5], trees: 'leafy', exposure: 0.55 },
  dusk: { name: 'Crimson Dusk', ground: 'dirt', tint: ['#b58a64', '#9c7150', '#c99c72'], rock: '#8a5e4a', rockTop: '#a77b58', hill: '#8c6446', sun: [5, 200], sunColor: '#ffb27a', turbidity: 9, rayleigh: 3.0, fog: '#c98a72', fogD: 0.0026, grass: ['#6b5a2e', '#c9a85d', 0.42], trees: 'dead', exposure: 0.7 },
  glacier: { name: 'Frost Expanse', ground: 'snow', tint: ['#eef3f8', '#dfe8f1', '#f7fbff'], rock: '#7d8ea5', rockTop: '#eef4fa', hill: '#e9f0f7', sun: [24, 120], sunColor: '#f4f8ff', turbidity: 2, rayleigh: 0.9, fog: '#d7e4f0', fogD: 0.0024, grass: null, trees: 'pine', exposure: 0.5 },
};

// smooth 2D noise for terrain shapes
function makeNoise(seed) {
  const R = mulberry32(seed), N = 256, perm = new Uint8Array(N * 2), grad = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { perm[i] = i; const a = R() * Math.PI * 2; grad[i * 2] = Math.cos(a); grad[i * 2 + 1] = Math.sin(a); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const dot = (h, x, y) => grad[h * 2] * x + grad[h * 2 + 1] * y;
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const n2 = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = f(x), v = f(y), a = perm[X] + Y, b = perm[X + 1] + Y;
    const l = (A, B, t) => A + (B - A) * t;
    return l(l(dot(perm[a], x, y), dot(perm[b], x - 1, y), u), l(dot(perm[a + 1], x, y - 1), dot(perm[b + 1], x - 1, y - 1), u), v);
  };
  return (x, y, oct = 4) => { let s = 0, a = 1, fr = 1, t = 0; for (let i = 0; i < oct; i++) { s += n2(x * fr, y * fr) * a; t += a; a *= 0.5; fr *= 2; } return s / t; };
}

function vcolor(geo, fn) { // per-vertex colour from position
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

export class Arena {
  constructor(scene, pillars, stageKey = 'highlands', seed = 1, pmrem = null) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const S = (this.stage = STAGES[stageKey] || STAGES.highlands);
    const q = RENDER.quality || 'high';
    const R = mulberry32(seed ^ 0x77), noise = makeNoise(seed);
    const TT = terrainTextures();
    this.exposure = S.exposure;

    // ---- sky + sun
    const sky = new Sky(); sky.scale.setScalar(1400);
    const u = sky.material.uniforms;
    u.turbidity.value = S.turbidity; u.rayleigh.value = S.rayleigh; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - S.sun[0]), THREE.MathUtils.degToRad(S.sun[1]));
    u.sunPosition.value.copy(sun);
    this.sunDir = sun.clone();
    if (pmrem) { // the sky lights the scene: ambient light and reflections that match it
      const envScene = new THREE.Scene(), s2 = new Sky(); s2.scale.setScalar(1400);
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = u[k].value;
      s2.material.uniforms.sunPosition.value.copy(sun); envScene.add(s2);
      this.envRT = pmrem.fromScene(envScene, 0, 0.1, 2000);
      scene.environment = this.envRT.texture;
      scene.environmentIntensity = 0.85;
    }
    this.group.add(sky);
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a4a35, 0.35);
    const sunL = (this.sun = new THREE.DirectionalLight(new THREE.Color(S.sunColor), S.sun[0] < 10 ? 2.2 : 3.0));
    sunL.castShadow = q !== 'low';
    const sm = q === 'ultra' ? 2048 : 1024; sunL.shadow.mapSize.set(sm, sm);
    const sc = sunL.shadow.camera; sc.left = sc.bottom = -18; sc.right = sc.top = 18; sc.near = 1; sc.far = 220;
    sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.03;
    this.group.add(this.hemi, sunL, sunL.target);
    scene.fog = new THREE.FogExp2(new THREE.Color(S.fog), S.fogD);

    // ---- ground: flat inside the arena, hills beyond
    const tset = TT[S.ground];
    const gmap = tset[0].clone(), gnrm = tset[1].clone();
    for (const t of [gmap, gnrm]) { t.needsUpdate = true; t.repeat.set(150, 150); }
    const G = new THREE.PlaneGeometry(1200, 1200, 160, 160); G.rotateX(-Math.PI / 2);
    const gp = G.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x, z);
      const k = THREE.MathUtils.smoothstep(d, ARENA.radius + 8, ARENA.radius + 90);
      gp.setY(i, k * (12 + noise(x * 0.008, z * 0.008, 5) * 60 + (d - ARENA.radius) * 0.18) * Math.max(0, k));
    }
    G.computeVertexNormals();
    const tints = S.tint.map((c) => new THREE.Color(c)), hillC = new THREE.Color(S.hill), rockC = new THREE.Color(S.rock);
    vcolor(G, (x, y, z, col) => {
      const n = noise(x * 0.03 + 40, z * 0.03, 3) * 0.5 + 0.5, m = noise(x * 0.18, z * 0.18, 2) * 0.5 + 0.5;
      col.copy(tints[0]).lerp(tints[1], n).lerp(tints[2], m * 0.35);
      if (y > 1) col.lerp(hillC, Math.min(1, y / 30)).lerp(rockC, Math.max(0, Math.min(1, (y - 40) / 40)));
      col.multiplyScalar(1.35); // texture is mid-grey; vertex colour carries the tone
    });
    const groundMat = new THREE.MeshStandardMaterial({ map: gmap, normalMap: gnrm, normalScale: new THREE.Vector2(0.8, 0.8), vertexColors: true, roughness: S.ground === 'snow' ? 0.55 : 0.95 });
    const ground = new THREE.Mesh(G, groundMat); ground.receiveShadow = true;
    this.group.add(ground);

    // ---- rocks share one material with strata texture
    const rmap = TT.rock[0].clone(), rnrm = TT.rock[1].clone();
    for (const t of [rmap, rnrm]) { t.needsUpdate = true; t.repeat.set(3, 2); }
    const rockMat = new THREE.MeshStandardMaterial({ map: rmap, normalMap: rnrm, normalScale: new THREE.Vector2(1.4, 1.4), vertexColors: true, roughness: 0.92 });
    const statics = new THREE.Group();
    const rockColumn = (x, z, r, h, solid) => {
      const geo = new THREE.CylinderGeometry(r, r, h, 40, 24, false);
      const p = geo.attributes.position, sd = R() * 100;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), a = Math.atan2(pz, px), t = (py + h / 2) / h;
        // carve inward only, so the rock never pokes past what the sim collides with
        const big = noise(Math.cos(a) * 1.1 + sd, Math.sin(a) * 1.1 + t * 1.8, 4) * 0.5 + 0.5;
        const ridge = Math.abs(noise(a * 2.2 + sd, t * 6, 2)); // vertical cracks and ribs
        const carve = 0.7 + 0.22 * big + 0.08 * (1 - ridge * 2.2) - (t > 0.97 ? 0.08 : 0);
        const ledge = Math.sin(t * 7 + sd + big * 3) > 0.8 ? 0.94 : 1; // weathered bands
        const k = Math.min(1, carve * ledge) * (1 - t * 0.12);
        const len = Math.hypot(px, pz) || 1;
        p.setXYZ(i, (px / len) * r * k, py, (pz / len) * r * k);
      }
      geo.computeVertexNormals();
      vcolor(geo, (px, y, pz, col) => col.copy(rockC).multiplyScalar(1.3 + noise(y * 0.12 + sd, Math.atan2(pz, px), 3) * 0.35).lerp(new THREE.Color(S.rockTop), y > h * 0.38 ? 0.12 : 0));
      const m = new THREE.Mesh(geo, rockMat); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
      statics.add(m);
      // grassy / snowy crown
      const capG = new THREE.CylinderGeometry(r * 0.78, r * 0.8, Math.max(0.6, h * 0.02), 20);
      vcolor(capG, (a, b, c, col) => col.set(S.rockTop).multiplyScalar(1.1));
      const cap = new THREE.Mesh(capG, groundMat); cap.position.set(x, h - 0.1, z); statics.add(cap);
    };
    for (const p of pillars) rockColumn(p.x, p.z, p.r, p.h, true);
    // cliffs just outside the arena edge
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + R() * 0.06, d = ARENA.radius + 22 + R() * 30;
      rockColumn(Math.cos(a) * d, Math.sin(a) * d, 12 + R() * 14, 28 + R() * 55, false);
    }
    // small boulders inside (never taller than ~0.7 m: they must not hide fighters)
    for (let i = 0; i < 45; i++) {
      const a = R() * Math.PI * 2, d = 8 + R() * (ARENA.radius - 12), s = 0.25 + R() * 0.55;
      const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) { const f = 0.8 + noise(p.getX(k) * 1.7 + i, p.getY(k) * 1.7 + p.getZ(k), 3) * 0.35; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.7, p.getZ(k) * f); }
      geo.computeVertexNormals();
      vcolor(geo, (x, y, z, col) => col.copy(rockC).multiplyScalar(1.2));
      const m = new THREE.Mesh(geo, rockMat); m.position.set(Math.cos(a) * d, s * 0.25, Math.sin(a) * d); m.scale.setScalar(s); m.rotation.y = R() * 6;
      m.castShadow = true; statics.add(m);
    }
    // distant mountains with snowy tops, fading into the haze
    const mtnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + R() * 0.3, d = 480 + R() * 120, h = 110 + R() * 160, w = 120 + R() * 110;
      const geo = new THREE.ConeGeometry(w, h, 40, 14), p = geo.attributes.position, sd = R() * 50;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k), t = (y + h / 2) / h;
        const f = 1 + noise(x * 0.012 + sd, z * 0.012 + y * 0.01, 5) * 0.45 * (1 - t * 0.5);
        p.setXYZ(k, x * f, y + noise(x * 0.02, z * 0.02 + sd, 3) * 12 * (1 - t), z * f);
      }
      geo.computeVertexNormals();
      const snowLine = S.ground === 'snow' ? 0.15 : 0.6 + R() * 0.15;
      vcolor(geo, (x, y, z, col) => { const t = (y + h / 2) / h; col.copy(rockC).multiplyScalar(0.9); if (t > snowLine + noise(x * 0.05, z * 0.05, 2) * 0.08) col.set('#f2f5f8'); });
      const m = new THREE.Mesh(geo, mtnMat); m.position.set(Math.cos(a) * d, h / 2 - 8, Math.sin(a) * d);
      statics.add(m);
    }
    // trees beyond the arena edge
    if (S.trees) this.trees(statics, S.trees, R, noise);
    bakeStatic(statics, this.group);

    // ---- grass (not in battery saver)
    this.grass = null;
    if (S.grass && q !== 'low') this.grass = new Grass(this.group, { count: q === 'ultra' ? 16000 : 7000, half: q === 'ultra' ? 26 : 20, arena: ARENA.radius, base: S.grass[0], tip: S.grass[1], height: S.grass[2], seed });

    // ---- clouds: soft billboards
    this.clouds = new THREE.Group(); this.group.add(this.clouds);
    const ctex = this.cloudTexture(seed);
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, color: new THREE.Color(S.ground === 'dirt' ? '#ffd8c0' : '#ffffff'), transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      const a = R() * Math.PI * 2, d = 150 + R() * 400, sz = 80 + R() * 120;
      m.position.set(Math.cos(a) * d, 120 + R() * 90, Math.sin(a) * d); m.scale.set(sz, sz * 0.45, 1);
      this.clouds.add(m);
    }

    // impact craters
    this.craters = [];
    this.craterGeo = new THREE.CircleGeometry(1, 24);
    const ct = cvs(64), cg = ct.getContext('2d'), gr = cg.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(40,30,20,0.75)'); gr.addColorStop(0.6, 'rgba(60,45,30,0.45)'); gr.addColorStop(1, 'rgba(60,45,30,0)');
    cg.fillStyle = gr; cg.fillRect(0, 0, 64, 64);
    const ctx2 = new THREE.CanvasTexture(ct);
    this.craterMat = new THREE.MeshBasicMaterial({ map: ctx2, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  cloudTexture(seed) {
    const n = noiseCanvas(128, { base: 4, octaves: 5, seed: seed + 5, contrast: 1.6 });
    const c = cvs(128), g = c.getContext('2d'), img = n.getContext('2d').getImageData(0, 0, 128, 128), out = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4, dx = (x - 64) / 64, dy = (y - 70) / 50, fall = Math.max(0, 1 - Math.hypot(dx, dy));
      const v = img.data[i] / 255, a = Math.max(0, Math.min(1, (v * 1.3 - 0.35) * fall * 2.2));
      const shade = 200 + 55 * Math.max(0, 1 - (y / 128) * 0.9);
      out.data[i] = out.data[i + 1] = shade; out.data[i + 2] = Math.min(255, shade + 8); out.data[i + 3] = a * 255;
    }
    g.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  trees(statics, kind, R, noise) {
    const bark = new THREE.MeshStandardMaterial({ color: kind === 'dead' ? '#5a4535' : '#5b4331', roughness: 0.95 });
    const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    for (let i = 0; i < 70; i++) {
      const a = R() * Math.PI * 2, d = ARENA.radius + 12 + R() * 120;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.8 + R() * 0.7;
      const k = THREE.MathUtils.smoothstep(d, ARENA.radius + 8, ARENA.radius + 90);
      const y = k * (12 + noise(x * 0.008, z * 0.008, 5) * 60 + (d - ARENA.radius) * 0.18) - 0.3;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.32 * s, 5 * s, 8), bark); trunk.position.set(x, y + 2.5 * s, z); statics.add(trunk);
      if (kind === 'leafy') for (let b = 0; b < 4; b++) {
        const geo = new THREE.IcosahedronGeometry(1.8 * s * (0.7 + R() * 0.5), 1), p = geo.attributes.position, sd = R() * 9;
        for (let j = 0; j < p.count; j++) { const f = 0.85 + noise(p.getX(j) + sd, p.getY(j) + p.getZ(j), 3) * 0.35; p.setXYZ(j, p.getX(j) * f, p.getY(j) * f, p.getZ(j) * f); }
        geo.computeVertexNormals();
        vcolor(geo, (px, py, pz, col) => col.set('#3e6b2a').lerp(new THREE.Color('#79a64a'), Math.max(0, py / 3 + 0.4)));
        const m = new THREE.Mesh(geo, leaf); m.position.set(x + (R() - 0.5) * 2 * s, y + 5 * s + b * 0.9 * s, z + (R() - 0.5) * 2 * s); statics.add(m);
      } else if (kind === 'pine') for (let b = 0; b < 3; b++) {
        const geo = new THREE.ConeGeometry((2.4 - b * 0.6) * s, 3 * s, 10);
        vcolor(geo, (px, py, pz, col) => col.set('#2d4b3a').lerp(new THREE.Color('#f4f8fb'), py > 0.6 * s ? 0.8 : 0.1));
        const m = new THREE.Mesh(geo, leaf); m.position.set(x, y + (3.2 + b * 1.6) * s, z); statics.add(m);
      } else { // bare branches
        for (let b = 0; b < 3; b++) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.12 * s, 2.4 * s, 6), bark); br.position.set(x, y + (4 + b * 0.6) * s, z); br.rotation.set((R() - 0.5) * 1.6, R() * 6, (R() - 0.5) * 1.6); statics.add(br); }
      }
    }
  }

  crater(x, z, size = 1.5) {
    const m = new THREE.Mesh(this.craterGeo, this.craterMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04 + this.craters.length * 0.0005, z); m.scale.setScalar(size * 1.3);
    this.group.add(m); this.craters.push(m);
    if (this.craters.length > 24) { const o = this.craters.shift(); o.removeFromParent(); }
  }

  update(dt, focus, camPos) {
    this.clouds.position.x += dt * 1.2;
    if (focus) { // keep the sharp shadow box around the action
      this.sun.target.position.set(focus.x, 0, focus.z);
      this.sun.position.set(focus.x + this.sunDir.x * 100, this.sunDir.y * 100, focus.z + this.sunDir.z * 100);
    }
    if (this.grass && camPos) this.grass.update(dt, camPos);
  }

  dispose() {
    this.grass?.dispose();
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    this.envRT?.dispose();
    this.group.removeFromParent();
    this.scene.fog = null; this.scene.environment = null;
  }
}
