// Visual effects: energy blasts, beams, impact bursts, shockwaves, sparks, dust,
// speed lines and screen flashes. Everything is additive and pooled-ish (short lived).
import * as THREE from '../../vendor/three/three.module.js';
import { clone as cloneSkinned } from '../../vendor/three/utils/SkeletonUtils.js';

function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function starTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); g.translate(64, 64); g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 18 : 62 - (i % 4) * 10; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const BEAM_VS = 'varying vec2 vUv; varying float vDepth; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }';
const BEAM_FS = `uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying float vDepth;
void main(){ float r = abs(vUv.x - 0.5) * 2.0; /* ribbon: x across, y along */ float wob = sin(vUv.y * 60.0 - uTime * 40.0) * 0.08 + sin(vUv.y * 23.0 - uTime * 25.0) * 0.06;
  float core = smoothstep(0.55 + wob, 0.0, r); float glow = smoothstep(1.0, 0.2, r);
  vec3 c = mix(uColor, vec3(1.0), core); gl_FragColor = vec4(c * 1.5, max(core, glow * 0.6) * smoothstep(1.0, 8.0, vDepth)); }`; // fade right in front of the lens

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.glow = glowTexture(); this.star = starTexture();
    this.items = []; // {obj, life, max, update}
    this.proj = new Map(); // projectile id -> mesh
    this.beams = new Map();
    this.sparkGeo = new THREE.BufferGeometry();
    this.shake = 0; this.flash = 0; this.flashColor = new THREE.Color(1, 1, 1);
  }

  sprite(color, size, tex = this.glow) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.scale.setScalar(size);
    m.renderOrder = 6;
    return m;
  }

  add(obj, life, update, keepGeo = false) { this.scene.add(obj); this.items.push({ obj, life, max: life, update, keepGeo }); }

  burst(x, y, z, color, { size = 1.0, heavy = false, apex = false } = {}) {
    size *= 0.6;
    const s = this.sprite('#ffffff', size * (heavy ? 1.6 : 1), this.star);
    s.position.set(x, y, z); s.material.rotation = Math.random() * 6;
    this.add(s, heavy ? 0.22 : 0.14, (o, k) => { o.scale.setScalar(size * (heavy ? 1.6 : 1) * (1 + (1 - k) * 0.8)); o.material.opacity = k; });
    const g = this.sprite(color, size * 2); g.position.set(x, y, z);
    this.add(g, 0.22, (o, k) => { o.material.opacity = k * 0.7; o.scale.setScalar(size * 2 * (1.4 - k * 0.4)); });
    if (heavy || apex) this.ring(x, y, z, color, apex ? 10 : 3);
    this.sparks(x, y, z, color, heavy ? 22 : 10, heavy ? 16 : 10);
    if (heavy) this.shake = Math.max(this.shake, apex ? 1.0 : 0.45);
    if (apex) { this.flash = Math.max(this.flash, 0.3); this.flashColor.set(color); }
  }

  ring(x, y, z, color, size, flat = false) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(x, y, z);
    if (flat) m.rotation.x = -Math.PI / 2; else m.lookAt(this.camPos || new THREE.Vector3(0, 0, 0));
    this.add(m, 0.4, (o, k) => { o.scale.setScalar(size * (1.2 - k)); o.material.opacity = k; });
  }

  sparks(x, y, z, color, n = 10, speed = 10) {
    const pos = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      pos.set([x, y, z], i * 3);
      const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), s = speed * (0.4 + Math.random() * 0.8);
      vel.push([Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(color), size: 0.35, map: this.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    this.add(pts, 0.5, (o, k, dt) => {
      const p = o.geometry.attributes.position;
      for (let i = 0; i < n; i++) { p.array[i * 3] += vel[i][0] * dt; p.array[i * 3 + 1] += vel[i][1] * dt; p.array[i * 3 + 2] += vel[i][2] * dt; vel[i][1] -= 12 * dt; vel[i][0] *= 0.94; vel[i][2] *= 0.94; }
      p.needsUpdate = true; o.material.opacity = k;
    });
  }

  dust(x, z, big = false) {
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xd8c8a8, transparent: true, depthWrite: false, opacity: 0.7 }));
      const a = Math.random() * 6.28, sp = big ? 7 : 4;
      s.position.set(x, 0.4, z); s.scale.setScalar(1.2);
      const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp;
      this.add(s, 0.7, (o, k, dt) => { o.position.x += vx * dt * k; o.position.z += vz * dt * k; o.position.y += dt * 0.8; o.scale.setScalar(1.2 + (1 - k) * (big ? 4 : 2.5)); o.material.opacity = 0.7 * k; });
    }
    if (big) { this.ring(x, 0.15, z, '#fff3d6', 7, true); this.shake = Math.max(this.shake, 0.35); }
  }

  afterimage(model) { // blink: a fading coloured silhouette at the old spot
    const ghost = cloneSkinned(model.body); // keeps the pose at the moment of the blink
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(model.spec.aura.color), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    ghost.traverse((o) => { if (o.isMesh) o.material = mat; });
    const holder = new THREE.Group(); holder.position.copy(model.root.position); holder.rotation.copy(model.root.rotation); holder.add(ghost);
    this.add(holder, 0.35, (o, k) => { mat.opacity = 0.35 * k; o.scale.setScalar(1 + (1 - k) * 0.15); }, true); // geometry is the live model's
  }

  nearFade(p) { return this.camPos ? Math.max(0.08, Math.min(1, (this.camPos.distanceTo(p) - 2) / 7)) : 1; }

  // projectiles/beams follow the sim view every frame
  sync(view, colorOf, dt, time) {
    const seen = new Set();
    for (const p of view.projectiles) {
      seen.add(p.id);
      let m = this.proj.get(p.id);
      if (!m) {
        const col = colorOf(p.owner, p.apex);
        m = new THREE.Group();
        const core = this.sprite('#ffffff', Math.min(p.radius * 2.2, 3)); const halo = this.sprite(col, Math.min(p.radius * 5.5, 7));
        m.add(halo, core);
        if (p.apex) { const sph = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 0.9, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).lerp(new THREE.Color(1, 1, 1), 0.4), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); m.add(sph); }
        m.userData = { halo, col, trail: 0 };
        this.scene.add(m); this.proj.set(p.id, m);
      }
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      m.userData.halo.material.rotation += dt * 4;
      m.userData.halo.material.opacity = this.nearFade(m.position);
      m.userData.halo.scale.setScalar(Math.min(p.radius * 5, 6.5) + Math.sin(time * 30) * 0.4);
      if ((m.userData.trail += dt) > 0.03) { m.userData.trail = 0; const tr = Math.min(p.radius * 3, 3.5); const t = this.sprite(m.userData.col, tr); t.position.copy(m.position); this.add(t, 0.2, (o, k) => { o.material.opacity = k * 0.5; o.scale.setScalar(tr * k); }); }
    }
    for (const [id, m] of this.proj) if (!seen.has(id)) { m.removeFromParent(); m.traverse((o) => o.material?.dispose()); this.proj.delete(id); }
    const seenB = new Set();
    for (const b of view.beams) {
      seenB.add(b.id);
      let m = this.beams.get(b.id);
      const col = colorOf(b.owner, b.apex);
      if (!m) {
        const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(col) }, uTime: { value: 0 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        // camera-facing ribbon along +z (rolled toward the camera every frame), 2 units wide
        const geo = new THREE.PlaneGeometry(2, 1); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 0.5);
        const rib = new THREE.Mesh(geo, mat); rib.frustumCulled = false;
        const cyl = new THREE.Group(); cyl.add(rib);
        const head = this.sprite(col, b.width * 6); const tip = this.sprite('#ffffff', b.width * 3);
        const muzzle = this.sprite(col, b.width * 5);
        m = new THREE.Group(); m.add(cyl, head, tip, muzzle);
        m.userData = { cyl, head, tip, muzzle, mat };
        this.scene.add(m); this.beams.set(b.id, m);
        if (b.kind === 'twin') { const c2 = cyl.clone(); m.add(c2); m.userData.c2 = c2; }
      }
      const u = m.userData;
      m.position.set(b.origin.x, b.origin.y, b.origin.z);
      m.lookAt(b.origin.x + b.dir.x, b.origin.y + b.dir.y, b.origin.z + b.dir.z);
      m.updateMatrixWorld();
      if (this.camPos) { // roll the ribbon(s) to face the camera
        const c = m.worldToLocal(this.camPos.clone());
        const roll = Math.atan2(-c.x, c.y);
        u.cyl.rotation.z = roll; if (u.c2) u.c2.rotation.z = roll;
      }
      const w = b.width * (b.apex ? 0.6 : 1) * (1 + Math.sin(time * 50) * 0.08);
      u.cyl.scale.set(w, w, Math.max(0.01, b.len));
      if (u.c2) { const s = Math.sin(time * 12) * w * 0.9, c = Math.cos(time * 12) * w * 0.9; u.cyl.position.set(s, c, 0); u.c2.position.set(-s, -c, 0); u.cyl.scale.set(w * 0.6, w * 0.6, b.len); u.c2.scale.set(w * 0.6, w * 0.6, b.len); }
      u.head.position.set(0, 0, b.len); u.tip.position.set(0, 0, b.len);
      const hs = Math.min(b.width, 1.6); u.head.scale.setScalar(hs * (4.5 + Math.sin(time * 40))); u.muzzle.scale.setScalar(hs * 3);
      if (this.camPos) { // glows right at the camera would white out the screen
        const tipW = new THREE.Vector3(0, 0, b.len).applyMatrix4(m.matrixWorld);
        u.head.material.opacity = u.tip.material.opacity = this.nearFade(tipW);
        u.muzzle.material.opacity = this.nearFade(m.position);
      }
      u.mat.uniforms.uTime.value = time;
      if (Math.random() < 0.5) this.sparks(b.origin.x + b.dir.x * b.len, b.origin.y + b.dir.y * b.len, b.origin.z + b.dir.z * b.len, col, 3, 8);
      this.shake = Math.max(this.shake, b.apex ? 0.5 : 0.12);
    }
    for (const [id, m] of this.beams) if (!seenB.has(id)) {
      const holder = m; const u = m.userData;
      this.beams.delete(id);
      this.add(holder, 0.18, (o, k) => { u.cyl.scale.x *= 0.85; u.cyl.scale.y *= 0.85; if (u.c2) { u.c2.scale.x *= 0.85; u.c2.scale.y *= 0.85; } u.head.material.opacity = k; });
    }
  }

  update(dt) {
    for (const it of this.items) {
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      it.update?.(it.obj, k, dt);
    }
    const keep = [];
    for (const it of this.items) {
      if (it.life > 0) keep.push(it);
      else { it.obj.removeFromParent(); it.obj.traverse((o) => { if (!it.keepGeo && !o.isSprite) o.geometry?.dispose(); o.material?.dispose?.(); }); }
    }
    this.items = keep;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  clear() {
    for (const it of this.items) it.obj.removeFromParent();
    for (const m of this.proj.values()) m.removeFromParent();
    for (const m of this.beams.values()) m.removeFromParent();
    this.items = []; this.proj.clear(); this.beams.clear(); this.shake = 0; this.flash = 0;
  }
}
