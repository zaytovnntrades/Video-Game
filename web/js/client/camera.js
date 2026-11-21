// Lock-on chase camera: sits behind your fighter, over the shoulder, always framing
// the rival. Handles rivals straight above/below, point-blank range and pillars.
import * as THREE from '../../vendor/three/three.module.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class LockCam {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 3, -20);
    this.look = new THREE.Vector3();
    this.flat = new THREE.Vector3(0, 0, 1); // last good horizontal direction
    this.shoulder = 1;
    this.cinema = null; // {t, from, to} for KO / apex shots
  }

  // me/them: fighter views, pillars from the sim, dt seconds, shake 0..1
  update(me, them, pillars, dt, shake = 0, mode = 'fight') {
    const a = tmp.set(me.pos.x, me.pos.y + 1.3, me.pos.z);
    const b = tmp2.set(them.pos.x, them.pos.y + 1.1, them.pos.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const dist = d.length();
    const h = Math.hypot(d.x, d.z);
    if (h > 0.4) this.flat.set(d.x / h, 0, d.z / h);
    const right = new THREE.Vector3(-this.flat.z, 0, this.flat.x);
    // pitch toward the rival, but cap it so a rival directly above/below stays in frame
    const pitch = Math.atan2(d.y, Math.max(h, 0.001));
    const cp = Math.max(-0.95, Math.min(0.95, pitch));
    const back = 4.6 + Math.min(4, dist * 0.06);
    const want = new THREE.Vector3().copy(a)
      .addScaledVector(this.flat, -back * Math.cos(cp))
      .addScaledVector(right, 1.15 * this.shoulder)
      .add(new THREE.Vector3(0, 1.0 - back * Math.sin(cp) * 0.85, 0));
    if (mode === 'intro') want.copy(a).addScaledVector(this.flat, 3.2).add(new THREE.Vector3(0, 0.4, 0)).addScaledVector(right, 1.2);
    // pillars: pull the camera in front of any rock between it and the player
    for (const p of pillars) {
      if (want.y > p.h + 0.5) continue;
      const dx = want.x - p.x, dz = want.z - p.z;
      if (Math.hypot(dx, dz) < p.r + 0.8) { const k = (p.r + 0.8) / Math.hypot(dx, dz); want.x = p.x + dx * k; want.z = p.z + dz * k; }
    }
    want.y = Math.max(0.5, want.y);
    const lookWant = new THREE.Vector3().lerpVectors(a, b, dist < 6 ? 0.5 : 0.62);
    if (mode === 'intro') lookWant.copy(a);
    const k = 1 - Math.exp(-dt * (mode === 'intro' ? 3 : 7));
    this.pos.lerp(want, k);
    this.look.lerp(lookWant, 1 - Math.exp(-dt * 10));
    this.cam.position.copy(this.pos);
    if (shake > 0) this.cam.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake).multiplyScalar(0.6));
    this.cam.lookAt(this.look);
    // widen the lens for fast action
    const fov = 62 + Math.min(10, dist * 0.08);
    this.cam.fov += (fov - this.cam.fov) * k;
    this.cam.updateProjectionMatrix();
  }

  snap(me, them, pillars) { for (let i = 0; i < 60; i++) this.update(me, them, pillars, 0.1); }
}
