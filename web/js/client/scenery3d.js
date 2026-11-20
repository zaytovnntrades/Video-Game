// 3D scenery for a map. Two styles share one interface:
//  - 'classic': the bright overhead look (pixel-art ground texture, short buildings).
//  - 'ultra': PS3-era look for the street-level camera and Ultra graphics (tiling PBR
//    ground, lane markings, facades with lit windows, street lamps, glossy water).
// Both return { group, fadeables, waters, dispose() }.
import * as THREE from '../../vendor/three.module.min.js';
import { TILE } from '../shared/data.js';
import { T, tileAt } from '../shared/maps.js';
import { renderGround, ROOFS, shade } from './art.js';

const WALLS = ['#f2e6d0', '#ece0c8', '#f6efe4', '#eadcc6', '#f1e3cd', '#e9dfd2'];
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function pixelTex(cv, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function rects(map, type, skip) {
  const seen = new Uint8Array(map.w * map.h);
  const out = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (seen[y * map.w + x] || tileAt(map, x, y) !== type || (skip && skip(x, y))) continue;
      let x1 = x;
      while (tileAt(map, x1 + 1, y) === type && !seen[y * map.w + x1 + 1] && !(skip && skip(x1 + 1, y))) x1++;
      let y1 = y;
      for (;;) {
        let ok = true;
        for (let k = x; k <= x1; k++) if (tileAt(map, k, y1 + 1) !== type || seen[(y1 + 1) * map.w + k] || (skip && skip(k, y1 + 1))) { ok = false; break; }
        if (!ok) break;
        y1++;
      }
      for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) seen[yy * map.w + xx] = 1;
      out.push({ x0: x, y0: y, x1, y1, w: x1 - x + 1, h: y1 - y + 1 });
    }
  }
  return out;
}

// Gable roof prism, ridge along x. Origin at the base centre.
function gableGeometry(w, d, rh) {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const fbl = [x0, 0, z1], fbr = [x1, 0, z1], bbl = [x0, 0, z0], bbr = [x1, 0, z0], rl = [x0, rh, 0], rr = [x1, rh, 0];
  const slope = Math.hypot(rh, d / 2) / 8;
  const tris = [
    // front slope
    [fbl, 0, 0], [fbr, w / 32, 0], [rr, w / 32, slope], [fbl, 0, 0], [rr, w / 32, slope], [rl, 0, slope],
    // back slope
    [bbr, 0, 0], [bbl, w / 32, 0], [rl, w / 32, slope], [bbr, 0, 0], [rl, w / 32, slope], [rr, 0, slope],
    // gables
    [bbl, 0, 0], [fbl, 0, 0], [rl, 0, 0], [fbr, 0, 0], [bbr, 0, 0], [rr, 0, 0],
  ];
  const pos = [], uv = [];
  for (const [p, u, v] of tris) { pos.push(...p); uv.push(u, v); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export class MapScene {
  constructor(map, renderer) {
    this.map = map;
    this.group = new THREE.Group();
    this.disposables = [];
    this.fadeables = []; // { x0, x1, y0, height, mats, o }
    this.waters = [];
    const W = map.w * TILE, H = map.h * TILE;
    const city = map.kind === 'city';
    const keep = (o) => { this.disposables.push(o); return o; };

    // Ground: the pixel-art map texture laid flat.
    const gtex = keep(pixelTex(renderGround(map, true)));
    gtex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, H)), keep(new THREE.MeshLambertMaterial({ map: gtex })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
    const apron = new THREE.Mesh(keep(new THREE.PlaneGeometry(W + 6000, H + 6000)), keep(new THREE.MeshLambertMaterial({ color: city ? '#4f9a3c' : '#1b1730' })));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(W / 2, -0.5, H / 2);
    apron.receiveShadow = true;
    this.group.add(apron);

    if (city) this.buildCity(keep);
    else this.buildArena(keep);
  }

  buildCity(keep) {
    const map = this.map;
    const shared = new Map();
    const sideTex = (wall, hw) => {
      const key = `${wall}${hw}`;
      if (shared.has(key)) return shared.get(key);
      const c = canvas(32, hw);
      const g = c.getContext('2d');
      g.fillStyle = wall; g.fillRect(0, 0, 32, hw);
      g.fillStyle = shade(wall, -0.08); g.fillRect(0, hw - 4, 32, 4);
      for (let fy = 6; fy + 12 < hw - 4; fy += 18) {
        g.fillStyle = '#5e6f86'; g.fillRect(8, fy, 16, 12);
        g.fillStyle = '#8ec9ef'; g.fillRect(9, fy + 1, 14, 10);
        g.fillStyle = '#d6f0ff'; g.fillRect(9, fy + 1, 14, 3);
        g.fillStyle = shade(wall, -0.2); g.fillRect(7, fy + 12, 18, 2);
      }
      const t = keep(pixelTex(c, true));
      shared.set(key, t);
      return t;
    };
    const shingle = (roof) => {
      const key = 'r' + roof;
      if (shared.has(key)) return shared.get(key);
      const c = canvas(16, 16);
      const g = c.getContext('2d');
      g.fillStyle = roof; g.fillRect(0, 0, 16, 16);
      g.fillStyle = shade(roof, -0.18); g.fillRect(0, 6, 16, 2); g.fillRect(0, 14, 16, 2);
      g.fillStyle = shade(roof, 0.15); g.fillRect(0, 0, 16, 1); g.fillRect(0, 8, 16, 1);
      g.fillStyle = shade(roof, -0.1); g.fillRect(5, 0, 1, 6); g.fillRect(12, 8, 1, 6);
      const t = keep(pixelTex(c, true));
      shared.set(key, t);
      return t;
    };
    const boxGeo = new Map();
    const box = (w, h, d) => {
      const k = `${w},${h},${d}`;
      if (!boxGeo.has(k)) boxGeo.set(k, keep(new THREE.BoxGeometry(w, h, d)));
      return boxGeo.get(k);
    };

    for (const r of rects(map, T.BUILD)) {
      const v0 = map.variant[r.y0 * map.w + r.x0];
      const roof = ROOFS[v0 & 7] || ROOFS[1];
      const wall = WALLS[(r.x0 * 7 + r.y0 * 3) % WALLS.length];
      const big = r.w >= 5;
      const hw = big ? 60 : 40;
      const W = r.w * TILE, D = r.h * TILE;
      // front wall with the door
      let door = -1;
      for (let x = r.x0; x <= r.x1; x++) if (map.variant[r.y1 * map.w + x] & 8) door = x - r.x0;
      const fc = canvas(W, hw);
      const fg = fc.getContext('2d');
      fg.fillStyle = wall; fg.fillRect(0, 0, W, hw);
      fg.fillStyle = shade(wall, -0.08); fg.fillRect(0, hw - 4, W, 4);
      for (let col = 0; col < r.w; col++) {
        const px = col * 32;
        for (let fy = 6; fy + 12 < hw - 4; fy += 18) {
          if (col === door && fy + 30 > hw) continue;
          fg.fillStyle = '#5e6f86'; fg.fillRect(px + 8, fy, 16, 12);
          fg.fillStyle = '#8ec9ef'; fg.fillRect(px + 9, fy + 1, 14, 10);
          fg.fillStyle = '#d6f0ff'; fg.fillRect(px + 9, fy + 1, 14, 3);
          fg.fillStyle = shade(wall, -0.2); fg.fillRect(px + 7, fy + 12, 18, 2);
        }
        if (col === door) {
          fg.fillStyle = shade(roof, -0.1); fg.fillRect(px + 4, hw - 26, 24, 4); // awning
          fg.fillStyle = '#6b4423'; fg.fillRect(px + 9, hw - 22, 14, 22);
          fg.fillStyle = '#8a5a30'; fg.fillRect(px + 10, hw - 21, 12, 21);
          fg.fillStyle = '#ffd23f'; fg.fillRect(px + 19, hw - 11, 2, 2);
        }
      }
      const frontMat = keep(new THREE.MeshLambertMaterial({ map: keep(pixelTex(fc)), transparent: true }));
      const sTex = sideTex(wall, hw);
      const sideX = keep(new THREE.MeshLambertMaterial({ map: sTex.clone(), transparent: true }));
      sideX.map.repeat.set(r.h, 1); sideX.map.needsUpdate = true; keep(sideX.map);
      const backM = keep(new THREE.MeshLambertMaterial({ map: sTex.clone(), transparent: true }));
      backM.map.repeat.set(r.w, 1); backM.map.needsUpdate = true; keep(backM.map);
      const plain = keep(new THREE.MeshLambertMaterial({ color: wall, transparent: true }));
      const body = new THREE.Mesh(box(W, hw, D), [sideX, sideX, plain, plain, frontMat, backM]);
      body.position.set(r.x0 * TILE + W / 2, hw / 2, r.y0 * TILE + D / 2);
      body.castShadow = true; body.receiveShadow = true;
      this.group.add(body);
      const mats = [frontMat, sideX, backM, plain];
      let height = hw;
      const roofTex = shingle(roof).clone();
      keep(roofTex); roofTex.needsUpdate = true;
      if (big) {
        const slabMat = keep(new THREE.MeshLambertMaterial({ map: roofTex, transparent: true }));
        roofTex.repeat.set(W / 16, D / 16);
        const rimMat = keep(new THREE.MeshLambertMaterial({ color: shade(roof, -0.25), transparent: true }));
        const slab = new THREE.Mesh(box(W + 6, 6, D + 6), [rimMat, rimMat, slabMat, rimMat, rimMat, rimMat]);
        slab.position.set(body.position.x, hw + 3, body.position.z);
        slab.castShadow = true; slab.receiveShadow = true;
        this.group.add(slab);
        const unitMat = keep(new THREE.MeshLambertMaterial({ color: '#b9bec7', transparent: true }));
        const unit = new THREE.Mesh(box(26, 12, 18), unitMat);
        unit.position.set(body.position.x - W / 4, hw + 12, body.position.z - D / 5);
        unit.castShadow = true;
        this.group.add(unit);
        mats.push(slabMat, rimMat, unitMat);
        height = hw + 18;
      } else {
        const rh = 22;
        const roofMat = keep(new THREE.MeshLambertMaterial({ map: roofTex, transparent: true, side: THREE.DoubleSide }));
        const gm = new THREE.Mesh(keep(gableGeometry(W + 8, D + 8, rh)), roofMat);
        gm.position.set(body.position.x, hw, body.position.z);
        gm.castShadow = true; gm.receiveShadow = true;
        this.group.add(gm);
        mats.push(roofMat);
        height = hw + rh;
      }
      this.fadeables.push({ x0: r.x0 * TILE, x1: (r.x1 + 1) * TILE, y0: r.y0 * TILE, y1: (r.y1 + 1) * TILE, height, mats, o: 1 });
    }

    // Trees: low-poly trunks and canopies (instanced).
    const trees = [];
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === T.TREE) trees.push([x, y]);
    if (trees.length) {
      const trunkGeo = keep(new THREE.CylinderGeometry(3, 4.5, 16, 6)); trunkGeo.translate(0, 8, 0);
      const leafGeo = keep(new THREE.IcosahedronGeometry(13, 0)); leafGeo.translate(0, 22, 0);
      const topGeo = keep(new THREE.IcosahedronGeometry(8, 0)); topGeo.translate(0, 31, 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, keep(new THREE.MeshLambertMaterial({ color: '#7a5226', flatShading: true })), trees.length);
      const leafMat = keep(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, trees.length);
      const tops = new THREE.InstancedMesh(topGeo, leafMat, trees.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
      const greens = ['#2f8a3e', '#3a9a45', '#2c7f3a', '#46a64c'];
      trees.forEach(([x, y], i) => {
        const h = ((x * 928371 + y * 12377) % 100) / 100;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * 6.28);
        const sc = 0.9 + h * 0.25;
        s.set(sc, sc, sc);
        p.set((x + 0.5) * TILE, 0, (y + 0.5) * TILE);
        m.compose(p, q, s);
        trunks.setMatrixAt(i, m); leaves.setMatrixAt(i, m); tops.setMatrixAt(i, m);
        col.set(greens[Math.floor(h * 4) % 4]); leaves.setColorAt(i, col);
        col.set(greens[(Math.floor(h * 4) + 3) % 4]).offsetHSL(0, 0, 0.06); tops.setColorAt(i, col);
      });
      for (const im of [trunks, leaves, tops]) { im.castShadow = true; im.receiveShadow = true; this.group.add(im); }
    }

    // Ponds: a glossy translucent surface over the water tiles.
    for (const r of rects(map, T.WATER)) {
      const mat = keep(new THREE.MeshPhongMaterial({ color: '#4fb0ec', transparent: true, opacity: 0.55, shininess: 120, specular: '#ffffff' }));
      const plane = new THREE.Mesh(keep(new THREE.PlaneGeometry(r.w * TILE - 6, r.h * TILE - 6)), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(r.x0 * TILE + (r.w * TILE) / 2, 1.5, r.y0 * TILE + (r.h * TILE) / 2);
      plane.receiveShadow = true;
      this.group.add(plane);
      this.waters.push(mat);
    }
  }

  buildArena(keep) {
    const map = this.map;
    const c = canvas(32, 32);
    const g = c.getContext('2d');
    g.fillStyle = '#5b4b7a'; g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#51416f';
    for (let row = 0; row < 4; row++) for (let k = 0; k < 2; k++) g.fillRect(((row % 2) * 8 + k * 16) % 32, row * 8 + 1, 14, 6);
    g.fillStyle = '#7a68a0'; g.fillRect(0, 0, 32, 1);
    const brick = keep(pixelTex(c, true));
    const topMat = keep(new THREE.MeshLambertMaterial({ color: '#8a78b0' }));
    const make = (r, h, fade) => {
      const W = r.w * TILE, D = r.h * TILE;
      const side = (rep) => { const t = brick.clone(); t.repeat.set(rep, h / 32); t.needsUpdate = true; keep(t); return keep(new THREE.MeshLambertMaterial({ map: t, transparent: fade })); };
      const sx = side(r.h), sz = side(r.w);
      const top = fade ? keep(topMat.clone()) : topMat;
      if (fade) top.transparent = true;
      const m = new THREE.Mesh(keep(new THREE.BoxGeometry(W, h, D)), [sx, sx, top, top, sz, sz]);
      m.position.set(r.x0 * TILE + W / 2, h / 2, r.y0 * TILE + D / 2);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      if (fade) this.fadeables.push({ x0: r.x0 * TILE, x1: (r.x1 + 1) * TILE, y0: r.y0 * TILE, y1: (r.y1 + 1) * TILE, height: h, mats: [sx, sz, top], o: 1 });
    };
    const edge = (x, y) => x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
    // outer walls: tall at the back, low at the front so nothing hides behind them
    make({ x0: 0, y0: 0, x1: map.w - 1, y1: 0, w: map.w, h: 1 }, 44, false);
    make({ x0: 0, y0: 1, x1: 0, y1: map.h - 2, w: 1, h: map.h - 2 }, 36, false);
    make({ x0: map.w - 1, y0: 1, x1: map.w - 1, y1: map.h - 2, w: 1, h: map.h - 2 }, 36, false);
    make({ x0: 0, y0: map.h - 1, x1: map.w - 1, y1: map.h - 1, w: map.w, h: 1 }, 10, false);
    for (const r of rects(map, T.WALL, edge)) make(r, 40, true);
    // glowing floor runes for atmosphere
    const runeMat = keep(new THREE.MeshBasicMaterial({ color: '#7c4dff', transparent: true, opacity: 0.35 }));
    const ring = keep(new THREE.RingGeometry(70, 76, 40));
    const rune = new THREE.Mesh(ring, runeMat);
    rune.rotation.x = -Math.PI / 2;
    rune.position.set(map.spawn.x, 0.8, map.spawn.y);
    this.group.add(rune);
    this.waters.push(runeMat);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}


// ======================================================================
// Ultra style (PS3-era): tiling PBR ground, painted markings, facades with
// lit windows, street lamps, tree clusters, glossy water, sci-fi arena.
// tall = true for the street-level camera (real city heights); false keeps
// buildings short so the overhead camera can see the sidewalks behind them.
// ======================================================================
const UNIT = 64; // world units covered by one repeat of a ground texture

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothTex(cv, aniso, repeat = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speckle(g, w, h, n, cols, r, rand) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[Math.floor(rand() * cols.length)];
    g.globalAlpha = 0.25 + rand() * 0.5;
    g.fillRect(rand() * w, rand() * h, r * (0.5 + rand()), r * (0.5 + rand()));
  }
  g.globalAlpha = 1;
}

// Ground materials are shared by every Ultra map (built once).
let GROUND = null;
function groundMaterials(aniso) {
  if (GROUND) return GROUND;
  const rand = rng(7);
  const mk = (draw, opts = {}) => {
    const c = canvas(256, 256);
    const g = c.getContext('2d');
    draw(g);
    const m = new THREE.MeshStandardMaterial({ map: smoothTex(c, aniso), roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0 });
    if (opts.emissive) {
      const e = canvas(256, 256);
      const eg = e.getContext('2d');
      eg.fillStyle = '#000'; eg.fillRect(0, 0, 256, 256);
      opts.emissive(eg);
      m.emissiveMap = smoothTex(e, aniso);
      m.emissive = new THREE.Color('#ffffff');
      m.emissiveIntensity = 1.6;
    }
    return m;
  };
  GROUND = {
    asphalt: mk((g) => {
      g.fillStyle = '#3a3d44'; g.fillRect(0, 0, 256, 256);
      speckle(g, 256, 256, 9000, ['#2c2f35', '#4a4e57', '#55595f', '#33363c'], 2, rand);
      g.strokeStyle = 'rgba(20,20,24,0.5)'; g.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { g.beginPath(); let x = rand() * 256, y = rand() * 256; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
    }, { rough: 0.82 }),
    sidewalk: mk((g) => {
      g.fillStyle = '#8f8a82'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const v = 190 + Math.floor(rand() * 14);
        g.fillStyle = `rgb(${v},${v - 6},${v - 16})`; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
      }
      speckle(g, 256, 256, 5000, ['#a8a297', '#cfc9bd', '#9b968c'], 2, rand);
    }, { rough: 0.85 }),
    grass: mk((g) => {
      g.fillStyle = '#4a8a36'; g.fillRect(0, 0, 256, 256);
      speckle(g, 256, 256, 3000, ['#3f7a2e', '#5a9c42', '#6aac4c', '#3a6f2a'], 4, rand);
      for (let i = 0; i < 2600; i++) {
        g.strokeStyle = ['#5fa847', '#73b955', '#3d7a2c', '#86c862'][Math.floor(rand() * 4)];
        g.lineWidth = 1; const x = rand() * 256, y = rand() * 256;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4); g.stroke();
      }
    }, { rough: 0.95 }),
    plaza: mk((g) => {
      g.fillStyle = '#a89470'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const v = rand() * 18;
        g.fillStyle = `rgb(${222 - v},${200 - v},${158 - v})`; g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      }
      speckle(g, 256, 256, 3000, ['#c9b38a', '#e8d6b0', '#b8a27a'], 2, rand);
    }, { rough: 0.7 }),
    floor: mk((g) => {
      g.fillStyle = '#20232e'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        g.fillStyle = (x + y) % 2 ? '#2b2f3d' : '#292c3a'; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        g.fillStyle = '#4a4f62';
        for (const [rx, ry] of [[10, 10], [114, 10], [10, 114], [114, 114]]) g.fillRect(x * 128 + rx, y * 128 + ry, 4, 4);
      }
      speckle(g, 256, 256, 2500, ['#353a4a', '#1c1f29'], 2, rand);
    }, { rough: 0.35, metal: 0.6, emissive: (eg) => { eg.fillStyle = '#2bd4ff'; eg.fillRect(0, 127, 256, 2); eg.fillRect(127, 0, 2, 256); } }),
    marking: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    basin: new THREE.MeshStandardMaterial({ color: '#173b52', roughness: 0.9 }),
  };
  return GROUND;
}

// One merged mesh per ground type: a quad per tile, UVs in world units.
function quadGeometry(quads, colors) {
  const pos = [], uv = [], nrm = [], col = [];
  quads.forEach(([x0, y0, x1, y1], i) => {
    const v = [[x0, y0], [x0, y1], [x1, y1], [x0, y0], [x1, y1], [x1, y0]];
    for (const [x, y] of v) {
      pos.push(x, 0, y); nrm.push(0, 1, 0); uv.push(x / UNIT, -y / UNIT);
      if (colors) col.push(...colors[i]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Facade textures: 512x384 px covering 128 x 96 world units (8 windows x 4 floors).
const FACADES = [
  { wall: '#9a5240', frame: '#e8dcc8', glass: '#28324a', rough: 0.85, metal: 0, brick: true },
  { wall: '#b8b2a6', frame: '#8a857c', glass: '#2c3a52', rough: 0.8, metal: 0 },
  { wall: '#4f6f8f', frame: '#9fb4c8', glass: '#1e2c40', rough: 0.25, metal: 0.55, curtain: true },
  { wall: '#e9dcc4', frame: '#7a5a3a', glass: '#2a3346', rough: 0.85, metal: 0, shutters: true },
  { wall: '#5a606c', frame: '#c9ced6', glass: '#202838', rough: 0.6, metal: 0.2 },
];
const facadeCache = new Map();
function facade(i, aniso) {
  if (facadeCache.has(i)) return facadeCache.get(i);
  const f = FACADES[i];
  const rand = rng(100 + i);
  const c = canvas(512, 384), g = c.getContext('2d');
  const e = canvas(512, 384), eg = e.getContext('2d');
  eg.fillStyle = '#000'; eg.fillRect(0, 0, 512, 384);
  g.fillStyle = f.wall; g.fillRect(0, 0, 512, 384);
  if (f.brick) {
    g.fillStyle = shade(f.wall, -0.18);
    for (let y = 0; y < 384; y += 8) { g.fillRect(0, y, 512, 1); for (let x = (y / 8) % 2 ? 0 : 12; x < 512; x += 24) g.fillRect(x, y, 1, 8); }
  } else speckle(g, 512, 384, 4000, [shade(f.wall, -0.08), shade(f.wall, 0.06)], 2, rand);
  for (let fl = 0; fl < 4; fl++) {
    const y = fl * 96;
    g.fillStyle = shade(f.wall, -0.25); g.fillRect(0, y + 92, 512, 4); // floor ledge
    for (let wx = 0; wx < 8; wx++) {
      const x = wx * 64;
      const [ww, wh, ox, oy] = f.curtain ? [56, 80, 4, 8] : [32, 50, 16, 22];
      g.fillStyle = f.frame; g.fillRect(x + ox - 3, y + oy - 3, ww + 6, wh + 6);
      g.fillStyle = f.glass; g.fillRect(x + ox, y + oy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + ox, y + oy, ww, wh * 0.35);
      if (!f.curtain) { g.fillStyle = f.frame; g.fillRect(x + ox + ww / 2 - 1, y + oy, 2, wh); }
      if (f.shutters) { g.fillStyle = '#5e7f5a'; g.fillRect(x + ox - 10, y + oy - 3, 7, wh + 6); g.fillRect(x + ox + ww + 3, y + oy - 3, 7, wh + 6); }
      if (rand() < 0.38) {
        eg.fillStyle = rand() < 0.75 ? '#ffc874' : '#bfe0ff';
        eg.fillRect(x + ox, y + oy, ww, wh);
        g.fillStyle = 'rgba(255,214,140,0.55)'; g.fillRect(x + ox, y + oy, ww, wh);
      }
    }
  }
  const out = { map: smoothTex(c, aniso), emissive: smoothTex(e, aniso), rough: f.rough, metal: f.metal };
  facadeCache.set(i, out);
  return out;
}

export class UltraScene {
  constructor(map, renderer, { tall }) {
    this.map = map;
    this.group = new THREE.Group();
    this.disposables = [];
    this.fadeables = [];
    this.waters = [];
    this.beacons = [];
    this.tall = tall;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const keep = (o) => { this.disposables.push(o); return o; };
    this.keep = keep;
    const W = map.w * TILE, H = map.h * TILE;
    const city = map.kind === 'city';
    const GM = groundMaterials(this.aniso);

    // ground: one merged mesh per surface type
    const by = { asphalt: [], sidewalk: [], grass: [], plaza: [], floor: [] };
    const waterQuads = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = tileAt(map, x, y);
        const q = [x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE];
        if (t === T.ROAD) by.asphalt.push(q);
        else if (t === T.WALK || t === T.BUILD) by.sidewalk.push(q);
        else if (t === T.PLAZA) by.plaza.push(q);
        else if (t === T.FLOOR || t === T.WALL) by.floor.push(q);
        else if (t === T.WATER) waterQuads.push(q);
        else by.grass.push(q);
      }
    }
    for (const [k, quads] of Object.entries(by)) {
      if (!quads.length) continue;
      const m = new THREE.Mesh(keep(quadGeometry(quads)), GM[k]);
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (waterQuads.length) {
      const basin = new THREE.Mesh(keep(quadGeometry(waterQuads)), GM.basin);
      basin.position.y = -0.2;
      this.group.add(basin);
    }
    const apron = new THREE.Mesh(keep(new THREE.PlaneGeometry(W + 8000, H + 8000)), keep(new THREE.MeshStandardMaterial({ color: city ? '#3f6f32' : '#15131f', roughness: 1 })));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(W / 2, -0.6, H / 2);
    apron.receiveShadow = true;
    this.group.add(apron);

    if (city) this.buildCity(GM);
    else this.buildArena();
  }

  buildCity(GM) {
    const map = this.map, keep = this.keep;
    // painted road markings (dashes + crosswalks)
    const quads = [], cols = [];
    const yellow = [0.95, 0.72, 0.2], white = [0.9, 0.9, 0.88];
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (tileAt(map, x, y) !== T.ROAD) continue;
      const px = x * TILE, py = y * TILE, cx = x % 12, cy = y % 12;
      const vert = cx < 2, horiz = cy < 2;
      if (vert && !horiz && cx === 0 && y % 2 === 0) { quads.push([px + 30.5, py + 6, px + 33.5, py + 26]); cols.push(yellow); }
      if (horiz && !vert && cy === 0 && x % 2 === 0) { quads.push([px + 6, py + 30.5, px + 26, py + 33.5]); cols.push(yellow); }
      if (vert && !horiz && (cy === 2 || cy === 11)) for (let i = 0; i < 4; i++) { quads.push([px + 3 + i * 7, py + 8, px + 7 + i * 7, py + 24]); cols.push(white); }
      if (horiz && !vert && (cx === 2 || cx === 11)) for (let i = 0; i < 4; i++) { quads.push([px + 8, py + 3 + i * 7, px + 24, py + 7 + i * 7]); cols.push(white); }
    }
    const marks = new THREE.Mesh(keep(quadGeometry(quads, cols)), GM.marking);
    marks.position.y = 0.15;
    marks.receiveShadow = true;
    this.group.add(marks);

    // flowers
    const flowers = [];
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === T.FLOWER) flowers.push([x, y]);
    if (flowers.length) {
      const fm = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(1.6, 0)), keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })), flowers.length * 4);
      const m = new THREE.Matrix4(), col = new THREE.Color();
      const pal = ['#ff6b8b', '#ffd23f', '#ffffff', '#b98cff'];
      const r = rng(31);
      let i = 0;
      for (const [x, y] of flowers) for (let k = 0; k < 4; k++) {
        m.makeTranslation((x + 0.15 + r() * 0.7) * TILE, 2.2 + r(), (y + 0.15 + r() * 0.7) * TILE);
        fm.setMatrixAt(i, m); fm.setColorAt(i, col.set(pal[Math.floor(r() * 4)])); i++;
      }
      this.group.add(fm);
    }

    this.buildBuildings();
    this.buildTrees();
    this.buildLamps();

    // ponds: glossy surface over a dark basin
    for (const r of rects(map, T.WATER)) {
      const mat = keep(new THREE.MeshStandardMaterial({ color: '#2a6f9e', roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.86 }));
      const plane = new THREE.Mesh(keep(new THREE.PlaneGeometry(r.w * TILE, r.h * TILE)), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(r.x0 * TILE + (r.w * TILE) / 2, 0.8, r.y0 * TILE + (r.h * TILE) / 2);
      plane.receiveShadow = true;
      this.group.add(plane);
      this.waters.push(mat);
      // stone rim
      const rim = keep(new THREE.MeshStandardMaterial({ color: '#9a958c', roughness: 0.9 }));
      const W = r.w * TILE, D = r.h * TILE, cx = r.x0 * TILE + W / 2, cz = r.y0 * TILE + D / 2;
      for (const [w, d, x, z] of [[W + 4, 3, cx, r.y0 * TILE], [W + 4, 3, cx, r.y0 * TILE + D], [3, D, r.x0 * TILE, cz], [3, D, r.x0 * TILE + W, cz]]) {
        const b = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 2.4, d)), rim);
        b.position.set(x, 1.2, z); b.receiveShadow = true;
        this.group.add(b);
      }
    }
  }

  buildBuildings() {
    const map = this.map, keep = this.keep;
    const box = new Map();
    const boxG = (w, h, d) => { const k = `${w},${h},${d}`; if (!box.has(k)) box.set(k, keep(new THREE.BoxGeometry(w, h, d))); return box.get(k); };
    const roofTop = keep(new THREE.MeshStandardMaterial({ color: '#3d3f45', roughness: 0.9 }));
    for (const r of rects(map, T.BUILD)) {
      const rand = rng(r.x0 * 131 + r.y0 * 977);
      const big = r.w >= 5;
      const W = r.w * TILE, D = r.h * TILE;
      const floors = this.tall ? (big ? 5 + Math.floor(rand() * 7) : 2) : 0;
      const hw = this.tall ? floors * 24 : big ? 60 : 40;
      const style = big ? Math.floor(rand() * FACADES.length) : [0, 3, 1][Math.floor(rand() * 3)];
      const fac = facade(style, this.aniso);
      const side = (faceW) => {
        const m = keep(new THREE.MeshStandardMaterial({ roughness: fac.rough, metalness: fac.metal, transparent: true }));
        m.map = keep(fac.map.clone()); m.map.repeat.set(faceW / 128, hw / 96); m.map.needsUpdate = true;
        m.emissiveMap = keep(fac.emissive.clone()); m.emissiveMap.repeat.copy(m.map.repeat); m.emissiveMap.needsUpdate = true;
        m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = 1.5;
        return m;
      };
      const sx = side(D), sz = side(W);
      const top = keep(roofTop.clone());
      const body = new THREE.Mesh(boxG(W, hw, D), [sx, sx, top, top, sz, sz]);
      body.position.set(r.x0 * TILE + W / 2, hw / 2, r.y0 * TILE + D / 2);
      body.castShadow = true; body.receiveShadow = true;
      this.group.add(body);
      const mats = [sx, sz, top];
      let height = hw;
      const v0 = map.variant[r.y0 * map.w + r.x0];
      const roofCol = ROOFS[v0 & 7] || ROOFS[1];
      // front door with an awning and a warm light
      let door = -1;
      for (let x = r.x0; x <= r.x1; x++) if (map.variant[r.y1 * map.w + x] & 8) door = x;
      if (door >= 0) {
        const fz = (r.y1 + 1) * TILE, dx = (door + 0.5) * TILE;
        const dm = keep(new THREE.MeshStandardMaterial({ color: '#4a2f1a', roughness: 0.6, transparent: true }));
        const aw = keep(new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.7, transparent: true }));
        const lm = keep(new THREE.MeshStandardMaterial({ color: '#ffd28a', emissive: new THREE.Color('#ffc46a'), emissiveIntensity: 3, transparent: true }));
        const d1 = new THREE.Mesh(boxG(14, 20, 1.2), dm); d1.position.set(dx, 10, fz + 0.4);
        const a1 = new THREE.Mesh(boxG(22, 1.6, 7), aw); a1.position.set(dx, 22.5, fz + 3.4); a1.castShadow = true;
        const l1 = new THREE.Mesh(boxG(6, 1.4, 1.2), lm); l1.position.set(dx, 25.5, fz + 0.6);
        this.group.add(d1, a1, l1);
        mats.push(dm, aw, lm);
      }
      if (big) {
        const pm = keep(new THREE.MeshStandardMaterial({ color: '#6b6e76', roughness: 0.8, transparent: true }));
        for (const [w, d, x, z] of [[W, 2, 0, -D / 2 + 1], [W, 2, 0, D / 2 - 1], [2, D, -W / 2 + 1, 0], [2, D, W / 2 - 1, 0]]) {
          const p = new THREE.Mesh(boxG(w, 5, d), pm);
          p.position.set(body.position.x + x, hw + 2.5, body.position.z + z);
          p.castShadow = true;
          this.group.add(p);
        }
        const unit = new THREE.Mesh(boxG(28, 14, 20), pm);
        unit.position.set(body.position.x - W / 5, hw + 7, body.position.z - D / 6);
        unit.castShadow = true;
        this.group.add(unit);
        mats.push(pm);
        height = hw + 14;
        if (this.tall && hw > 150) {
          const bm = keep(new THREE.MeshStandardMaterial({ color: '#ff3030', emissive: new THREE.Color('#ff2020'), emissiveIntensity: 4 }));
          const b = new THREE.Mesh(keep(new THREE.SphereGeometry(2.2, 10, 8)), bm);
          b.position.set(body.position.x + W / 4, hw + 9, body.position.z + D / 4);
          this.group.add(b);
          this.beacons.push(bm);
        }
      } else {
        const rh = 22;
        const tex = keep(new THREE.CanvasTexture((() => {
          const c = canvas(16, 16), g = c.getContext('2d');
          g.fillStyle = roofCol; g.fillRect(0, 0, 16, 16);
          g.fillStyle = shade(roofCol, -0.2); g.fillRect(0, 6, 16, 2); g.fillRect(0, 14, 16, 2);
          return c;
        })()));
        tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const rm = keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide, transparent: true }));
        const g = new THREE.Mesh(keep(gableGeometry(W + 8, D + 8, rh)), rm);
        g.position.set(body.position.x, hw, body.position.z);
        g.castShadow = true; g.receiveShadow = true;
        this.group.add(g);
        mats.push(rm);
        height = hw + rh;
      }
      this.fadeables.push({ x0: r.x0 * TILE, x1: (r.x1 + 1) * TILE, y0: r.y0 * TILE, y1: (r.y1 + 1) * TILE, height, mats, o: 1 });
    }
  }

  buildTrees() {
    const map = this.map, keep = this.keep;
    const trees = [];
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === T.TREE) trees.push([x, y]);
    if (!trees.length) return;
    const trunkGeo = keep(new THREE.CylinderGeometry(2.6, 4, 20, 8)); trunkGeo.translate(0, 10, 0);
    const parts = [[0, 26, 0, 12], [-6, 21, 4, 9], [5, 22, -5, 9.5]];
    const leafMat = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }));
    const trunks = new THREE.InstancedMesh(trunkGeo, keep(new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.95 })), trees.length);
    const leaves = parts.map(([x, y, z, r]) => { const g = keep(new THREE.IcosahedronGeometry(r, 1)); g.translate(x, y, z); return new THREE.InstancedMesh(g, leafMat, trees.length); });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const greens = ['#2f7a34', '#3a8a3c', '#2a6e30', '#4a9a44', '#5aa04a'];
    const r = rng(55);
    trees.forEach(([x, y], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const sc = 0.9 + r() * 0.3;
      s.set(sc, sc * (0.95 + r() * 0.2), sc);
      p.set((x + 0.5) * TILE, 0, (y + 0.5) * TILE);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      leaves.forEach((l, k) => { l.setMatrixAt(i, m); l.setColorAt(i, col.set(greens[Math.floor(r() * greens.length)]).offsetHSL(0, 0, k * 0.03)); });
    });
    for (const im of [trunks, ...leaves]) { im.castShadow = true; im.receiveShadow = true; this.group.add(im); }
  }

  // Street lamps at every block corner: glowing bulbs (bloom) and a pool of light.
  buildLamps() {
    const keep = this.keep;
    const spots = [];
    const blocks = Math.floor(this.map.w / 12);
    for (let by = 0; by < blocks; by++) for (let bx = 0; bx < blocks; bx++) {
      const x0 = bx * 12 * TILE, y0 = by * 12 * TILE;
      spots.push([x0 + 2 * TILE + 5, y0 + 2 * TILE + 5, -1, -1], [x0 + 12 * TILE - 5, y0 + 2 * TILE + 5, 1, -1],
        [x0 + 2 * TILE + 5, y0 + 12 * TILE - 5, -1, 1], [x0 + 12 * TILE - 5, y0 + 12 * TILE - 5, 1, 1]);
    }
    const n = spots.length;
    const metal = keep(new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.7 }));
    const poleG = keep(new THREE.CylinderGeometry(0.9, 1.3, 54, 8)); poleG.translate(0, 27, 0);
    const armG = keep(new THREE.BoxGeometry(12, 1.4, 1.4)); armG.translate(6, 53, 0);
    const headG = keep(new THREE.BoxGeometry(6, 2.4, 4)); headG.translate(11, 52, 0);
    const bulbG = keep(new THREE.BoxGeometry(4.4, 0.8, 3)); bulbG.translate(11, 50.6, 0);
    const bulbM = keep(new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: new THREE.Color('#ffd28a'), emissiveIntensity: 5 }));
    const pc = canvas(64, 64), pg = pc.getContext('2d');
    const grad = pg.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,200,130,0.55)'); grad.addColorStop(1, 'rgba(255,200,130,0)');
    pg.fillStyle = grad; pg.fillRect(0, 0, 64, 64);
    const poolM = keep(new THREE.MeshBasicMaterial({ map: keep(new THREE.CanvasTexture(pc)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const poolG = keep(new THREE.PlaneGeometry(76, 76)); poolG.rotateX(-Math.PI / 2); poolG.translate(11, 0.4, 0);
    const meshes = [[poleG, metal, true], [armG, metal, true], [headG, metal, true], [bulbG, bulbM, false], [poolG, poolM, false]].map(([g, m, cast]) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.castShadow = cast;
      this.group.add(im);
      return im;
    });
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    spots.forEach(([x, z, dx, dz], i) => {
      q.setFromAxisAngle(up, -Math.atan2(dz, dx)); // arm reaches out over the road corner
      p.set(x, 0, z);
      mat.compose(p, q, s);
      for (const im of meshes) im.setMatrixAt(i, mat);
    });
    meshes[4].renderOrder = 2;
  }

  buildArena() {
    const map = this.map, keep = this.keep;
    const wallM = keep(new THREE.MeshStandardMaterial({ color: '#3a3352', roughness: 0.5, metalness: 0.4 }));
    const glow = keep(new THREE.MeshStandardMaterial({ color: '#46e0ff', emissive: new THREE.Color('#46e0ff'), emissiveIntensity: 2.6 }));
    const pink = keep(new THREE.MeshStandardMaterial({ color: '#ff4fd8', emissive: new THREE.Color('#ff4fd8'), emissiveIntensity: 2.4 }));
    const block = (r, h, fade) => {
      const W = r.w * TILE, D = r.h * TILE;
      const wm = fade ? keep(wallM.clone()) : wallM; if (fade) wm.transparent = true;
      const gm = fade ? keep(glow.clone()) : glow; if (fade) gm.transparent = true;
      const b = new THREE.Mesh(keep(new THREE.BoxGeometry(W, h, D)), wm);
      b.position.set(r.x0 * TILE + W / 2, h / 2, r.y0 * TILE + D / 2);
      b.castShadow = true; b.receiveShadow = true;
      const strip = new THREE.Mesh(keep(new THREE.BoxGeometry(W + 0.6, 1.6, D + 0.6)), gm);
      strip.position.set(b.position.x, h - 3, b.position.z);
      this.group.add(b, strip);
      if (fade) {
        const s2 = new THREE.Mesh(keep(new THREE.BoxGeometry(W + 0.6, 1.2, D + 0.6)), gm);
        s2.position.set(b.position.x, h * 0.45, b.position.z);
        this.group.add(s2);
        this.fadeables.push({ x0: r.x0 * TILE, x1: (r.x1 + 1) * TILE, y0: r.y0 * TILE, y1: (r.y1 + 1) * TILE, height: h, mats: [wm, gm], o: 1 });
      }
    };
    const back = this.tall ? 70 : 44, sides = this.tall ? 70 : 36, front = this.tall ? 40 : 10;
    block({ x0: 0, y0: 0, x1: map.w - 1, y1: 0, w: map.w, h: 1 }, back, false);
    block({ x0: 0, y0: 1, x1: 0, y1: map.h - 2, w: 1, h: map.h - 2 }, sides, false);
    block({ x0: map.w - 1, y0: 1, x1: map.w - 1, y1: map.h - 2, w: 1, h: map.h - 2 }, sides, false);
    block({ x0: 0, y0: map.h - 1, x1: map.w - 1, y1: map.h - 1, w: map.w, h: 1 }, front, false);
    const edge = (x, y) => x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
    for (const r of rects(map, T.WALL, edge)) block(r, this.tall ? 56 : 40, !this.tall);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(70, 75, 48)), pink);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(map.spawn.x, 0.6, map.spawn.y);
    this.group.add(ring);
    for (const [x, z] of [[1, 1], [map.w - 1, 1], [1, map.h - 1], [map.w - 1, map.h - 1]]) {
      const b = new THREE.Mesh(keep(new THREE.SphereGeometry(4, 12, 8)), pink);
      b.position.set(x * TILE, (this.tall ? 70 : 44) + 6, z * TILE);
      this.group.add(b);
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
