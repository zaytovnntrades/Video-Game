// Draw-call reduction: bake many small static meshes into one mesh per material.
import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/utils/BufferGeometryUtils.js';

function prep(geo, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.morphAttributes = {};
  return g;
}

// Merge the direct mesh children of `group` (in its local space). Meshes with
// userData.keep stay as they are. Child outline meshes (material === outlineMat)
// are merged into a single outline mesh.
export function compactChildren(group, outlineMat) {
  const buckets = new Map(), outlines = [];
  for (const c of [...group.children]) {
    if (!c.isMesh || c.userData.keep) continue;
    c.updateMatrix();
    const g = prep(c.geometry, c.matrix);
    if (!buckets.has(c.material)) buckets.set(c.material, []);
    buckets.get(c.material).push(g);
    if (outlineMat && c.children.some((o) => o.material === outlineMat)) outlines.push(g.clone());
    group.remove(c);
    c.geometry.dispose();
  }
  for (const [mat, list] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = true;
    group.add(m);
    list.forEach((g) => g.dispose());
  }
  if (outlines.length) { const o = new THREE.Mesh(mergeGeometries(outlines), outlineMat); group.add(o); outlines.forEach((g) => g.dispose()); }
}

// Merge every static mesh under `root` (world space) by material into `target`.
export function bakeStatic(root, target, { shadow = true, filter = () => true } = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map(), victims = [];
  root.traverse((c) => { if (c.isMesh && filter(c)) victims.push(c); });
  for (const c of victims) {
    if (!buckets.has(c.material)) buckets.set(c.material, []);
    buckets.get(c.material).push(prep(c.geometry, c.matrixWorld));
  }
  for (const c of victims) { c.removeFromParent(); c.geometry.dispose(); }
  for (const [mat, list] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = shadow; m.receiveShadow = shadow;
    target.add(m);
    list.forEach((g) => g.dispose());
  }
}
