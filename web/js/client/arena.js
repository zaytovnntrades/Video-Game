// The battlefield: open highlands with rock pillars (positions come from the sim),
// a stylised sky dome, distant mountains and cel-shaded ground. Craters stay where
// fighters slam into the ground.
import * as THREE from '../../vendor/three/three.module.js';
import { ARENA } from '../sim/data.js';
import { mulberry32 } from '../sim/rng.js';
import { bakeStatic } from './merge.js';

const SKY_VS = 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const SKY_FS = `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uSun; uniform vec3 uSunDir; varying vec3 vP;
void main(){ float y = vP.y; vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.7, y)); c = mix(uLow, c, smoothstep(-0.05, 0.12, y));
  float s = max(0.0, dot(vP, normalize(uSunDir))); c += uSun * (pow(s, 400.0) * 2.0 + pow(s, 12.0) * 0.25);
  gl_FragColor = vec4(c, 1.0); }`;

export const STAGES = {
  highlands: { name: 'Sunlit Highlands', top: '#3f7fd6', mid: '#9fd0ff', low: '#f7e7c6', sun: '#fff2c4', ground: ['#7cbf5a', '#6aa84d', '#8fcc68'], rock: '#b59a7a', rockTop: '#8fbf5e', fog: '#bfe0ff', light: 1.0 },
  dusk: { name: 'Crimson Dusk', top: '#2b1d4f', mid: '#d4607a', low: '#ffb070', sun: '#ffd0a0', ground: ['#a8784f', '#97683f', '#b88a5e'], rock: '#7d5547', rockTop: '#a3765a', fog: '#e48a80', light: 0.85 },
  glacier: { name: 'Frost Expanse', top: '#4a6fa8', mid: '#c5dcf2', low: '#ffffff', sun: '#ffffff', ground: ['#e6f0f8', '#d3e2ef', '#f4f8fc'], rock: '#7f97b3', rockTop: '#e9f2fa', fog: '#dbe8f5', light: 1.05 },
};

export class Arena {
  constructor(scene, pillars, stageKey = 'highlands', seed = 1) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const S = (this.stage = STAGES[stageKey] || STAGES.highlands);
    const grad = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
    this.grad = grad;
    const toon = (c) => new THREE.MeshToonMaterial({ color: new THREE.Color(c), gradientMap: grad });
    // lights
    const sunDir = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x6a5a40, 1.1 * S.light);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2 * S.light));
    sun.position.copy(sunDir).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -16; sc.right = sc.top = 16; sc.near = 1; sc.far = 140;
    sun.shadow.bias = -0.0008;
    this.group.add(this.hemi, sun, sun.target);
    scene.fog = new THREE.Fog(new THREE.Color(S.fog), 120, 420);
    // sky
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color(S.top) }, uMid: { value: new THREE.Color(S.mid) }, uLow: { value: new THREE.Color(S.low) }, uSun: { value: new THREE.Color(S.sun) }, uSunDir: { value: sunDir } },
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    sky.renderOrder = -10;
    this.group.add(sky);
    // ground: a big disc with painted patches
    const R = mulberry32(seed ^ 0x77);
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = S.ground[0]; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) { g.fillStyle = S.ground[1 + (i % 2)]; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(R() * 512, R() * 512, 8 + R() * 40, 6 + R() * 22, R() * 3, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(14, 14); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(520, 64), new THREE.MeshToonMaterial({ map: tex, gradientMap: grad }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.group.add(ground);
    // boundary ring of cliffs + distant mountains
    const rockMat = toon(S.rock), topMat = toon(S.rockTop);
    const statics = new THREE.Group(); // everything that never moves, baked below
    this.statics = statics;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + R() * 0.05, d = ARENA.radius + 18 + R() * 25, h = 25 + R() * 45, r = 14 + R() * 12;
      this.rock(a, d, h, r, rockMat, topMat, R);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + R(), d = 330 + R() * 120, h = 90 + R() * 120;
      this.mountainMat ||= new THREE.MeshBasicMaterial({ color: new THREE.Color(S.fog).lerp(new THREE.Color(S.top), 0.35), fog: true });
      const m = new THREE.Mesh(new THREE.ConeGeometry(70 + R() * 60, h, 7), this.mountainMat);
      m.position.set(Math.cos(a) * d, h / 2 - 5, Math.sin(a) * d);
      statics.add(m);
    }
    // the sim's pillars
    for (const p of pillars) {
      const a = Math.atan2(p.z, p.x), d = Math.hypot(p.x, p.z);
      this.rock(a, d, p.h, p.r, rockMat, topMat, R, true);
    }
    // scattered boulders + grass tufts (cosmetic)
    const boulder = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 40; i++) {
      const a = R() * Math.PI * 2, d = 10 + R() * (ARENA.radius - 10);
      const m = new THREE.Mesh(boulder, rockMat); const s = 0.3 + R() * 0.7; // low enough never to hide a fighter
      m.position.set(Math.cos(a) * d, s * 0.4, Math.sin(a) * d); m.scale.set(s, s * 0.7, s); m.rotation.set(R(), R() * 6, R());
      m.castShadow = true; statics.add(m);
    }
    bakeStatic(statics, this.group);
    // clouds
    this.clouds = [];
    const cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(6 + R() * 6, 10, 8), cloudMat); p.position.set(k * 8 - 16, R() * 3, R() * 6); p.scale.y = 0.6; c.add(p); }
      const a = R() * Math.PI * 2, d = 60 + R() * 250;
      c.position.set(Math.cos(a) * d, 85 + R() * 60, Math.sin(a) * d); c.rotation.y = R() * 6;
      cloudGroup.add(c);
    }
    this.cloudLayer = new THREE.Group(); this.group.add(this.cloudLayer);
    bakeStatic(cloudGroup, this.cloudLayer, { shadow: false }); // all clouds drift together
    this.craters = [];
    this.craterGeo = new THREE.CircleGeometry(1, 20);
    this.craterMat = new THREE.MeshBasicMaterial({ color: 0x3b2f22, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  rock(a, d, h, r, rockMat, topMat, R, solid = false) {
    const g = new THREE.Group();
    const layers = 3;
    let y = 0;
    for (let i = 0; i < layers; i++) {
      const lh = h / layers, r0 = r * (1 - i * 0.14), r1 = r * (1 - (i + 1) * 0.14) * (solid ? 1.0 : 0.95);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, lh, 9, 1), rockMat);
      m.position.y = y + lh / 2; m.rotation.y = R() * 3; m.castShadow = m.receiveShadow = true;
      g.add(m); y += lh;
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * (1 - layers * 0.14) * 1.04, r * (1 - layers * 0.14), 1.2, 9), topMat);
    top.position.y = y + 0.4; g.add(top);
    g.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    this.statics.add(g);
    return g;
  }

  crater(x, z, size = 1.5) {
    const m = new THREE.Mesh(this.craterGeo, this.craterMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04 + this.craters.length * 0.0005, z); m.scale.setScalar(size);
    this.group.add(m); this.craters.push(m);
    if (this.craters.length > 24) { const o = this.craters.shift(); o.removeFromParent(); }
  }

  update(dt, focus) {
    this.cloudLayer.position.x += dt * 1.5;
    if (focus) { // keep the shadow box around the action
      this.sun.target.position.set(focus.x, 0, focus.z);
      this.sun.position.set(focus.x + 30, 50, focus.z + 21);
    }
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    this.group.removeFromParent();
    this.scene.fog = null;
  }
}
