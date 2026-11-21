// Wind-blown grass: one instanced mesh of blades in a square that wraps around the
// camera on the GPU, so the field looks endless while drawing a fixed number of blades.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../sim/rng.js';

export class Grass {
  constructor(scene, { count = 8000, half = 22, arena = 140, base = '#3f6b25', tip = '#a8cf63', height = 0.5, seed = 3 } = {}) {
    // a blade: tapered strip, 4 rows, bent slightly
    const rows = 4, pos = [], col = [], nrm = [], idx = [];
    const cb = new THREE.Color(base), ct = new THREE.Color(tip);
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, w = 0.035 * (1 - t * 0.85), y = t, z = t * t * 0.12;
      const c = cb.clone().lerp(ct, t);
      pos.push(-w, y, z, w, y, z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); nrm.push(0, 1, 0.2, 0, 1, 0.2);
      if (i < rows) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.uniforms = { uCenter: { value: new THREE.Vector2() }, uHalf: { value: half }, uArena: { value: arena }, uTime: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = 'uniform vec2 uCenter; uniform float uHalf; uniform float uArena; uniform float uTime;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec3 ip = vec3(instanceMatrix[3]);
        vec2 rel = mod(ip.xz - uCenter + uHalf, 2.0 * uHalf) - uHalf;   // wrap around the camera
        vec2 world = uCenter + rel;
        float edge = 1.0 - smoothstep(uHalf * 0.7, uHalf, max(abs(rel.x), abs(rel.y)));
        float inside = 1.0 - smoothstep(uArena - 6.0, uArena, length(world)); // flat ground only
        vec3 local = (mat3(instanceMatrix) * transformed) * edge * inside;
        float h = transformed.y;
        float gust = sin(uTime * 1.6 + world.x * 0.31 + world.y * 0.17) + 0.5 * sin(uTime * 3.1 + world.x * 0.9);
        local.x += gust * 0.07 * h * h;
        local.z += cos(uTime * 1.2 + world.y * 0.23) * 0.05 * h * h;
        vec4 mvPosition = viewMatrix * vec4(world.x + local.x, local.y, world.y + local.z, 1.0);
        gl_Position = projectionMatrix * mvPosition;`);
    };
    const R = mulberry32(seed);
    const mesh = new THREE.InstancedMesh(g, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      p.set((R() * 2 - 1) * half, 0, (R() * 2 - 1) * half);
      e.set((R() - 0.5) * 0.3, R() * Math.PI * 2, (R() - 0.5) * 0.3); q.setFromEuler(e);
      const h = height * (0.55 + R() * 0.9); sc.set(0.8 + R() * 0.6, h, 1);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
    }
    mesh.frustumCulled = false;
    mesh.receiveShadow = false; mesh.castShadow = false;
    this.mesh = mesh;
    scene.add(mesh);
  }
  update(dt, camPos) { this.uniforms.uTime.value += dt; this.uniforms.uCenter.value.set(camPos.x, camPos.z); }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
