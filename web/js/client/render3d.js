// 3D "handheld console" renderer (WebGL via three.js).
// Tilted perspective camera, extruded buildings with pitched roofs, low-poly
// trees and cars, sunlight with real shadows, fog, and the game's pixel-art
// characters standing in the world as camera-facing sprites.
// It draws the same "scene" lists as the classic 2D renderer, so the game
// logic and multiplayer code do not change.
import * as THREE from '../../vendor/three.module.min.js';
import { TILE } from '../shared/data.js';
import { T, tileAt } from '../shared/maps.js';
import { charSprite, petSprite, enemySprite, pickupSprite, renderGround, renderMini, CAR_COLORS, ROOFS, shade } from './art.js';

const PITCH = (54 * Math.PI) / 180; // camera looks down at 54 degrees
const FOV = 34;
const PUSH = 26; // sprites are slid toward the camera so they never clip into walls
const SUN = new THREE.Vector3(-170, 420, 230); // sun offset from the camera target (south-west, high)

const BULLET_COLORS = {
  pistol: ['#fff3a0', 3], uzi: ['#ffe066', 2.5], shotgun: ['#ffcf70', 2.5], rifle: ['#ffffff', 3], rocket: ['#ff7a3a', 5],
  fire: ['#ff8a2a', 4], water: ['#6cc8ff', 4], grass: ['#7ee06a', 4], spit: ['#a6e22e', 4.5],
};
const WALLS = ['#f2e6d0', '#ece0c8', '#f6efe4', '#eadcc6', '#f1e3cd', '#e9dfd2'];

function facing(ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  if (Math.abs(c) > Math.abs(s)) return c > 0 ? 2 : 1;
  return s > 0 ? 0 : 3;
}

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

// ---------- shared sprite textures/materials (sprites are cached canvases) ----------
const spriteMats = new Map();
function spriteMat(cv) {
  let m = spriteMats.get(cv);
  if (!m) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    m = new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
    spriteMats.set(cv, m);
  }
  return m;
}

// Reusable mesh pool: begin() each frame, next() per object, end() hides the rest.
class Pool {
  constructor(parent, make) { this.parent = parent; this.make = make; this.items = []; this.i = 0; }
  begin() { this.i = 0; }
  next() {
    let m = this.items[this.i];
    if (!m) { m = this.make(); this.parent.add(m); this.items.push(m); }
    m.visible = true;
    this.i++;
    return m;
  }
  end() { for (let k = this.i; k < this.items.length; k++) this.items[k].visible = false; }
}

// Finds solid rectangles of one tile type (buildings, pillars, ponds are rectangles).
function rects(map, type, skip) {
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

// ---------- per-map 3D scenery (cached; at most the city and one arena) ----------
class MapScene {
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

export class Renderer3D {
  constructor(glCanvas, overlayCanvas, { quality = 'high' } = {}) {
    this.kind = '3d';
    this.quality = quality;
    this.glCv = glCanvas;
    this.cv = overlayCanvas;
    this.g = overlayCanvas.getContext('2d');
    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = quality === 'high';
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 20, 4000);
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.time = 0;
    this.aimYScale = 1 / Math.sin(PITCH);
    this.texts = [];
    this.parts = [];
    this.rings = [];
    this.sceneCache = new Map();
    this.v = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // lights
    this.hemi = new THREE.HemisphereLight('#ffffff', '#b8a888', 1.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4dc', 2.1);
    this.sun.castShadow = quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -520; sc.right = 520; sc.top = 520; sc.bottom = -520; sc.near = 10; sc.far = 1400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // dynamic objects
    this.dyn = new THREE.Group();
    this.scene.add(this.dyn);
    const unitPlane = new THREE.PlaneGeometry(1, 1);
    unitPlane.translate(0, 0.5, 0);
    this.sprites = new Pool(this.dyn, () => new THREE.Mesh(unitPlane, spriteMat(pickupSprite('ammo'))));
    const sh = canvas(32, 32);
    const sg = sh.getContext('2d');
    const grad = sg.createRadialGradient(16, 16, 2, 16, 16, 16);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 32, 32);
    const shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false });
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.blobs = new Pool(this.dyn, () => { const m = new THREE.Mesh(flat, shadowMat); m.renderOrder = 1; return m; });
    const ball = new THREE.SphereGeometry(1, 8, 6);
    this.bulletMats = {};
    for (const [k, [col]] of Object.entries(BULLET_COLORS)) this.bulletMats[k] = new THREE.MeshBasicMaterial({ color: col });
    this.bullets = new Pool(this.dyn, () => new THREE.Mesh(ball, this.bulletMats.pistol));
    const gunGeo = new THREE.BoxGeometry(1, 1, 1);
    gunGeo.translate(0.5, 0, 0);
    this.gunMats = { dark: new THREE.MeshLambertMaterial({ color: '#3a3f4a' }), rocket: new THREE.MeshLambertMaterial({ color: '#5a8a4a' }) };
    this.guns = new Pool(this.dyn, () => { const m = new THREE.Mesh(gunGeo, this.gunMats.dark); m.castShadow = true; return m; });
    this.carPool = new Pool(this.dyn, () => this.makeCar());
    // voxel particles
    this.maxParts = 700;
    this.partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), this.maxParts);
    this.partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.partMesh.setColorAt(0, new THREE.Color());
    this.partMesh.count = 0;
    this.partMesh.frustumCulled = false;
    this.scene.add(this.partMesh);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringPool = new Pool(this.dyn, () => new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffc85a', transparent: true, depthWrite: false })));
    // quest marker: ground ring + light beam
    const mk = new THREE.Group();
    const mring = new THREE.Mesh(new THREE.RingGeometry(20, 26, 32), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    mring.rotation.x = -Math.PI / 2; mring.position.y = 1;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(18, 22, 160, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 80;
    mk.add(mring, beam);
    mk.visible = false;
    this.marker = mk;
    this.scene.add(mk);
    this.resize();
  }

  // ---------- setup ----------
  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const shadows = q === 'high';
    this.gl.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    for (const ms of this.sceneCache.values()) if (ms !== this.mapScene) ms.group.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    this.resize();
  }

  // rect: where the game view sits on the page (CSS px); see the 2D renderer.
  resize(rect) {
    rect = rect || this.rect || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    this.rect = rect;
    this.ox = rect.x; this.oy = rect.y;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = rect.w, h = rect.h;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    Object.assign(this.cv.style, { left: rect.x + 'px', top: rect.y + 'px', width: w + 'px', height: h + 'px' });
    this.gl.setPixelRatio(Math.min(dpr, this.quality === 'high' ? 2 : 1.5));
    this.gl.setSize(w, h, true);
    Object.assign(this.glCv.style, { left: rect.x + 'px', top: rect.y + 'px' });
    this.camera.aspect = w / h;
    // Frame about 9 tiles of ground vertically in landscape; in portrait keep ~7.5 tiles across.
    const tiles = h > w ? (7.5 * h) / w : 9;
    this.dist = (tiles * TILE * Math.sin(PITCH)) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    this.camera.updateProjectionMatrix();
  }

  setMap(map) {
    this.map = map;
    const key = `${map.kind}:${map.seed}`;
    let ms = this.sceneCache.get(key);
    if (!ms) {
      ms = new MapScene(map, this.gl);
      ms.mini = renderMini(map);
      this.sceneCache.set(key, ms);
      if (this.sceneCache.size > 2) {
        const oldKey = this.sceneCache.keys().next().value;
        const old = this.sceneCache.get(oldKey);
        if (this.mapScene === old) this.scene.remove(old.group);
        old.dispose();
        this.sceneCache.delete(oldKey);
      }
    }
    if (this.mapScene && this.mapScene !== ms) this.scene.remove(this.mapScene.group);
    this.mapScene = ms;
    this.scene.add(ms.group);
    this.mini = ms.mini;
    const city = map.kind === 'city';
    const sky = city ? '#a9dcf5' : '#2a2342';
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, this.dist * 1.15, this.dist * 2.8);
    this.hemi.color.set(city ? '#ffffff' : '#d9d0ff');
    this.hemi.groundColor.set(city ? '#b8a888' : '#4a3f6a');
    this.hemi.intensity = city ? 1.9 : 1.7;
    this.sun.color.set(city ? '#fff4dc' : '#e6d8ff');
    this.parts = []; this.texts = []; this.rings = [];
  }

  snapCamera(x, y) { this.cam.x = x; this.cam.y = y; }

  // ---------- projection helpers ----------
  project(x, y, h = 0) {
    this.v.set(x, h, y).project(this.camera);
    const w = this.cv.width / this.dpr, hh = this.cv.height / this.dpr;
    return { x: ((this.v.x + 1) / 2) * w, y: ((1 - this.v.y) / 2) * hh, behind: this.v.z > 1 };
  }
  toScreen(x, y) { return this.project(x, y, 10); }
  screenToWorld(sx, sy) {
    const w = this.cv.width / this.dpr, h = this.cv.height / this.dpr;
    this.ray.setFromCamera({ x: (sx / w) * 2 - 1, y: -(sy / h) * 2 + 1 }, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.v2);
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  // ---------- effects ----------
  burst(x, y, color, n, speed = 120, life = 0.4, size = 3) {
    const col = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, h: 8 + Math.random() * 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: 60 + Math.random() * speed, life, max: life, col, size: size * 1.2 });
    }
    if (this.parts.length > this.maxParts) this.parts.splice(0, this.parts.length - this.maxParts);
  }
  floatText(x, y, text, color = '#fff', big = false) {
    this.texts.push({ x, y, text, color, life: big ? 1.4 : 0.8, max: big ? 1.4 : 0.8, big });
    if (this.texts.length > 80) this.texts.shift();
  }
  effect(e, meId) {
    switch (e.t) {
      case 'hit': this.burst(e.x, e.y, '#ffffff', 4, 90, 0.3, 2); this.floatText(e.x, e.y, String(e.d), '#ffe066'); break;
      case 'die': this.burst(e.x, e.y, e.boss ? '#ffd23f' : '#b48cff', e.boss ? 40 : 14, e.boss ? 220 : 140, 0.7, 4); if (e.boss) this.shake = 0.5; break;
      case 'boom': this.burst(e.x, e.y, '#ff9a3a', 30, 260, 0.6, 5); this.burst(e.x, e.y, '#fff2a0', 14, 120, 0.4, 4); this.rings.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35 }); this.shake = Math.max(this.shake, 0.3); break;
      case 'spark': this.burst(e.x, e.y, '#ffe9a0', 3, 70, 0.2, 2); break;
      case 'hurt': this.burst(e.x, e.y, '#ff4f6d', 6, 100, 0.35, 3); if (e.pid === meId) this.shake = Math.max(this.shake, 0.15); break;
      case 'pdie': this.burst(e.x, e.y, '#ffffff', 24, 180, 0.8, 4); break;
      case 'pick': this.burst(e.x, e.y, e.k === 'health' ? '#ff6b8b' : e.k === 'ammo' ? '#ffd23f' : '#c99558', 10, 90, 0.5, 3); this.floatText(e.x, e.y, e.k === 'health' ? '+HP' : e.k === 'ammo' ? '+AMMO' : '+CRATE', '#ffffff'); break;
      case 'spawn': this.burst(e.x, e.y, '#7c4dff', 10, 60, 0.6, 3); this.rings.push({ x: e.x, y: e.y, r: 18, life: 0.4, max: 0.4, col: '#9a6bff' }); break;
      case 'shot': this.parts.push({ x: e.x, y: e.y, h: 12, vx: 0, vy: 0, vh: 0, life: 0.06, max: 0.06, col: new THREE.Color('#fff0aa'), size: 7, still: true }); break;
      default:
    }
  }

  makeCar() {
    if (!this.carGeo) {
      this.carGeo = {
        body: new THREE.BoxGeometry(30, 8, 17), cabin: new THREE.BoxGeometry(15, 7, 14), roof: new THREE.BoxGeometry(13, 2, 13),
        wheel: new THREE.CylinderGeometry(4, 4, 3, 10).rotateX(Math.PI / 2), light: new THREE.BoxGeometry(1, 2.5, 3.5),
      };
      this.carMats = {
        glass: new THREE.MeshLambertMaterial({ color: '#28374f' }), tire: new THREE.MeshLambertMaterial({ color: '#202024' }),
        head: new THREE.MeshBasicMaterial({ color: '#fff6a8' }), tail: new THREE.MeshBasicMaterial({ color: '#ff4040' }),
        paint: CAR_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c })),
      };
    }
    const G = this.carGeo, M = this.carMats;
    const car = new THREE.Group();
    const body = new THREE.Mesh(G.body, M.paint[0]); body.position.y = 8;
    const cabin = new THREE.Mesh(G.cabin, M.glass); cabin.position.set(-1, 15.5, 0);
    const roof = new THREE.Mesh(G.roof, M.paint[0]); roof.position.set(-1, 20, 0);
    car.add(body, cabin, roof);
    for (const [x, z] of [[9, 8], [9, -8], [-9, 8], [-9, -8]]) { const w = new THREE.Mesh(G.wheel, M.tire); w.position.set(x, 4, z); car.add(w); }
    for (const z of [5, -5]) {
      const h = new THREE.Mesh(G.light, M.head); h.position.set(15, 9, z); car.add(h);
      const t = new THREE.Mesh(G.light, M.tail); t.position.set(-15, 9, z); car.add(t);
    }
    car.traverse((o) => { o.castShadow = true; });
    car.userData = { body, roof };
    return car;
  }

  // Places a camera-facing pixel sprite with its feet at world (x, y).
  placeSprite(cv, x, y, scale, flip = false, lift = 0, alpha = 1) {
    const m = this.sprites.next();
    m.material = spriteMat(cv);
    const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
    const dx = cx - x, dy = cy - lift, dz = cz - y;
    const d = Math.hypot(dx, dy, dz);
    const f = (d - PUSH) / d;
    m.position.set(x + dx * (PUSH / d), lift + dy * (PUSH / d), y + dz * (PUSH / d));
    m.rotation.set(-PITCH, 0, 0); // perpendicular to the camera's view
    m.scale.set(cv.width * scale * f * (flip ? -1 : 1), cv.height * scale * f, 1);
    m.visible = alpha > 0;
    return m;
  }

  blob(x, y, w) {
    const b = this.blobs.next();
    b.position.set(x, 0.7, y);
    b.scale.set(w, 1, w * 0.62);
  }

  // ---------- main draw ----------
  draw(scene, dt) {
    this.time += dt;
    const me = scene.me;
    if (me) {
      const k = Math.min(1, dt * 7);
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - this.cam.y) * k;
    }
    const W = this.map.w * TILE, H = this.map.h * TILE;
    const mx = Math.min(W / 2, 4 * TILE), my = Math.min(H / 2, 3 * TILE);
    this.cam.x = Math.max(mx, Math.min(W - mx, this.cam.x));
    this.cam.y = Math.max(my, Math.min(H - my, this.cam.y));
    let tx = this.cam.x, tz = this.cam.y;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      tx += (Math.random() - 0.5) * 12 * this.shake; tz += (Math.random() - 0.5) * 12 * this.shake;
    }
    const D = this.dist;
    this.camera.position.set(tx, D * Math.sin(PITCH), tz + D * Math.cos(PITCH));
    this.camera.lookAt(tx, 0, tz);
    this.camera.updateMatrixWorld();
    this.sun.position.set(tx + SUN.x, SUN.y, tz + SUN.z);
    this.sun.target.position.set(tx, 0, tz);
    this.sun.target.updateMatrixWorld();

    // fade any building, tree-line or pillar standing between the camera and the player
    const ms = this.mapScene;
    for (const f of ms.fadeables) {
      let target = 1;
      if (me && !me.dead) {
        const reach = f.height / Math.tan(PITCH) + 24;
        if (me.x > f.x0 - 14 && me.x < f.x1 + 14 && me.y < f.y0 + 6 && me.y > f.y0 - reach) target = 0.3;
      }
      f.o += (target - f.o) * Math.min(1, dt * 8);
      if (Math.abs(f.o - target) < 0.01) f.o = target;
      for (const m of f.mats) { m.opacity = f.o; m.depthWrite = f.o > 0.95; }
    }
    for (const w of ms.waters) w.opacity = (w.isMeshPhongMaterial ? 0.55 : 0.3) + 0.08 * Math.sin(this.time * 2);

    this.sprites.begin(); this.blobs.begin(); this.bullets.begin(); this.guns.begin(); this.carPool.begin(); this.ringPool.begin();
    const view = { x0: tx - D * 1.2, x1: tx + D * 1.2, y0: tz - D * 1.6, y1: tz + D * 0.8 };
    const vis = (o) => o.x > view.x0 && o.x < view.x1 && o.y > view.y0 && o.y < view.y1;

    for (const c of scene.cars) {
      if (!vis(c)) continue;
      const car = this.carPool.next();
      const paint = this.carMats.paint[c.color % this.carMats.paint.length];
      car.userData.body.material = paint; car.userData.roof.material = paint;
      car.position.set(c.x, 0, c.y);
      car.rotation.y = -c.ang;
    }
    for (const n of scene.npcs) {
      if (!vis(n)) continue;
      this.placeSprite(charSprite(n.look, facing(n.ang ?? Math.PI / 2), 0), n.x, n.y + 8, 1.5);
      this.blob(n.x, n.y + 7, 16);
    }
    for (const k of scene.pickups) {
      if (!vis(k)) continue;
      const bob = 3 + Math.sin(this.time * 4 + k.id) * 2.5;
      this.placeSprite(pickupSprite(k.kind), k.x, k.y + 4, 1.4, Math.sin(this.time * 3 + k.id) < 0, bob);
      this.blob(k.x, k.y + 4, 14);
    }
    for (const e of scene.enemies) {
      if (!vis(e)) continue;
      const cv = enemySprite(e.type, Math.floor(this.time * 4 + e.id) % 2, e.boss);
      const s = e.boss ? 2.3 : 1.45;
      this.placeSprite(cv, e.x, e.y + cv.height * 0.35, s, Math.cos(e.ang) < 0);
      this.blob(e.x, e.y + cv.height * 0.3, cv.width * s * 0.7);
    }
    for (const p of scene.players) {
      if (p.dead) continue;
      if (p.pet && !p.car && vis(p.pet)) { // the companion rides along (hidden) while you drive
        const cv = petSprite(p.petType, p.evolved, Math.floor(this.time * 3) % 2);
        this.placeSprite(cv, p.pet.x, p.pet.y + cv.height * 0.4, 1.4, Math.cos(p.ang) < 0);
        this.blob(p.pet.x, p.pet.y + cv.height * 0.35, cv.width);
      }
      if (p.car || !vis(p)) continue;
      const fr = p.moving ? [1, 0, 2, 0][Math.floor(this.time * 8 + p.id) % 4] : 0;
      const blink = p.hurtFlash > 0 && Math.floor(this.time * 20) % 2;
      if (!blink) this.placeSprite(charSprite(p.look, facing(p.ang), fr), p.x, p.y + 8, 1.5);
      this.blob(p.x, p.y + 7, 18);
      const gun = this.guns.next();
      const len = p.wpn === 'rocket' ? 16 : p.wpn === 'shotgun' || p.wpn === 'rifle' ? 15 : 10;
      gun.material = p.wpn === 'rocket' ? this.gunMats.rocket : this.gunMats.dark;
      gun.scale.set(len, p.wpn === 'rocket' ? 5 : 3.5, p.wpn === 'rocket' ? 5 : 3.5);
      // slide the gun toward the camera like the sprite: in front of it, or behind when facing away
      const gx = p.x + Math.cos(p.ang) * 5, gz = p.y + 8 + Math.sin(p.ang) * 5;
      const push = facing(p.ang) === 3 ? PUSH - 4 : PUSH + 2;
      const cp = this.camera.position, ddx = cp.x - gx, ddy = cp.y - 14, ddz = cp.z - gz, dd = Math.hypot(ddx, ddy, ddz);
      gun.position.set(gx + (ddx * push) / dd, 14 + (ddy * push) / dd, gz + (ddz * push) / dd);
      gun.scale.multiplyScalar((dd - push) / dd);
      gun.rotation.set(0, -p.ang, 0);
    }
    for (const b of scene.bullets) {
      if (!vis(b)) continue;
      const m = this.bullets.next();
      const [, r] = BULLET_COLORS[b.kind] || BULLET_COLORS.pistol;
      m.material = this.bulletMats[b.kind] || this.bulletMats.pistol;
      m.position.set(b.x, 12, b.y);
      m.scale.setScalar(r * 1.1);
      if (b.kind === 'rocket') this.parts.push({ x: b.x, y: b.y, h: 12, vx: 0, vy: 0, vh: 20, life: 0.3, max: 0.3, col: new THREE.Color('#9a9a9a'), size: 4 });
    }
    // explosion / spawn rings
    for (const r of this.rings) {
      r.life -= dt;
      const a = Math.max(0, r.life / r.max);
      const m = this.ringPool.next();
      m.material.color.set(r.col || '#ffc85a');
      m.material.opacity = a;
      m.position.set(r.x, 2, r.y);
      m.scale.setScalar(r.r * (1.25 - a * 0.7));
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    // voxel particles
    const pm = this.partMesh, mat = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    let n = 0;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (!p.still) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
        p.vh -= 520 * dt; p.h += p.vh * dt;
        if (p.h < 1) { p.h = 1; p.vh *= -0.35; }
      }
      const s = p.size * Math.max(0.2, p.life / p.max);
      pos.set(p.x, p.h, p.y); scl.set(s, s, s);
      quat.setFromEuler(new THREE.Euler(p.life * 9, p.life * 7, 0));
      mat.compose(pos, quat, scl);
      pm.setMatrixAt(n, mat); pm.setColorAt(n, p.col);
      n++;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    pm.count = n;
    pm.instanceMatrix.needsUpdate = true;
    if (pm.instanceColor) pm.instanceColor.needsUpdate = true;

    // quest destination marker
    if (scene.questDest) {
      this.marker.visible = true;
      this.marker.position.set(scene.questDest.x, 0, scene.questDest.y);
      this.marker.children[0].material.opacity = 0.6 + 0.4 * Math.sin(this.time * 5);
      this.marker.children[1].material.opacity = 0.14 + 0.06 * Math.sin(this.time * 3);
    } else this.marker.visible = false;

    this.sprites.end(); this.blobs.end(); this.bullets.end(); this.guns.end(); this.carPool.end(); this.ringPool.end();
    this.gl.render(this.scene, this.camera);
    this.drawOverlay(scene, dt);
  }

  // ---------- 2D overlay: names, health bars, damage numbers, radar ----------
  drawOverlay(scene, dt) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    const me = scene.me;
    const Wc = this.cv.width / this.dpr, Hc = this.cv.height / this.dpr;
    const onScreen = (s) => !s.behind && s.x > -40 && s.x < Wc + 40 && s.y > -40 && s.y < Hc + 40;
    for (const n of scene.npcs) {
      const s = this.project(n.x, n.y, 52);
      if (!onScreen(s)) continue;
      const bob = Math.sin(this.time * 3) * 2;
      g.font = '14px "Press Start 2P", monospace'; g.textAlign = 'center';
      g.fillStyle = '#1d1a2b'; g.fillText('!', s.x + 1, s.y + bob + 1);
      g.fillStyle = '#ffd23f'; g.fillText('!', s.x, s.y + bob);
      this.label(n.name, s.x, s.y - 18, '#ffe9a0');
    }
    for (const e of scene.enemies) {
      if (e.hpPct >= 100) continue;
      const s = this.project(e.x, e.y, e.boss ? 62 : 36);
      if (onScreen(s)) this.bar(s.x, s.y, e.boss ? 46 : 26, e.hpPct / 100, e.boss ? '#ffd23f' : '#ff5d6c');
    }
    for (const p of scene.players) {
      if (p.dead || p.car) continue;
      const isMe = p === me;
      if (isMe && !scene.multi) continue;
      const s = this.project(p.x, p.y, 46);
      if (!onScreen(s)) continue;
      this.label(`${p.name}${scene.pvp ? '' : ' Lv' + p.level}`, s.x, s.y - 8, isMe ? '#9fe8ff' : '#ffffff');
      if (!isMe) this.bar(s.x, s.y, 30, p.hp / p.maxHp, '#5be37a');
    }
    for (const c of scene.cars) {
      if (!c.driver || !c.driverName) continue;
      const s = this.project(c.x, c.y, 30);
      if (onScreen(s)) this.label(c.driverName, s.x, s.y, '#ffffff');
    }
    g.textAlign = 'center';
    for (const t of this.texts) {
      t.life -= dt;
      const a = Math.max(0, t.life / t.max);
      const s = this.project(t.x, t.y, 30 + (1 - a) * 26);
      if (s.behind) continue;
      g.globalAlpha = Math.min(1, a * 2);
      g.font = `${t.big ? 18 : 11}px "Press Start 2P", monospace`;
      g.fillStyle = '#1d1a2b'; g.fillText(t.text, s.x + 1.5, s.y + 1.5);
      g.fillStyle = t.color; g.fillText(t.text, s.x, s.y);
      g.globalAlpha = 1;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    if (scene.questTarget && me) this.drawArrow(scene.questTarget, me);
    if (scene.showMini && me) this.drawMini(scene, me);
    if (me && me.hurtFlash > 0) {
      g.fillStyle = `rgba(255,40,60,${me.hurtFlash * 0.35})`;
      g.fillRect(0, 0, Wc, Hc);
    }
  }

  label(text, x, y, color) {
    const g = this.g;
    g.font = '8px "Press Start 2P", monospace'; g.textAlign = 'center';
    const w = g.measureText(text).width;
    g.fillStyle = 'rgba(29,26,43,0.85)';
    g.fillRect(x - w / 2 - 3, y - 9, w + 6, 12);
    g.fillStyle = color; g.fillText(text, x, y);
  }

  bar(x, y, w, f, color) {
    const g = this.g;
    g.fillStyle = '#1d1a2b'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    g.fillStyle = '#4a4458'; g.fillRect(x - w / 2, y, w, 4);
    g.fillStyle = color; g.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, f)), 4);
  }

  // Edge arrow toward an off-screen objective. Direction comes from the world-space
  // delta (projected points behind the camera would flip).
  drawArrow(t, me) {
    const g = this.g;
    const s = this.project(t.x, t.y, 0);
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    if (!s.behind && s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) return;
    const a = Math.atan2((t.y - me.y) / this.aimYScale, t.x - me.x);
    const m = 46;
    const k = Math.min(Math.abs((W / 2 - m) / (Math.cos(a) || 1e-6)), Math.abs((H / 2 - m) / (Math.sin(a) || 1e-6)));
    const x = W / 2 + Math.cos(a) * k, y = H / 2 + Math.sin(a) * k;
    g.save();
    g.translate(x, y); g.rotate(a);
    const p = 1 + 0.15 * Math.sin(this.time * 6);
    g.scale(p, p);
    g.fillStyle = '#1d1a2b'; g.beginPath(); g.moveTo(16, 0); g.lineTo(-10, -12); g.lineTo(-4, 0); g.lineTo(-10, 12); g.closePath(); g.fill();
    g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(12, 0); g.lineTo(-7, -9); g.lineTo(-2, 0); g.lineTo(-7, 9); g.closePath(); g.fill();
    g.restore();
  }

  drawMini(scene, me) {
    const g = this.g;
    const size = 92;
    const W = this.cv.width / this.dpr;
    const x0 = W - size - 12, y0 = 12 + (scene.miniTop || 0);
    const k = size / Math.max(this.map.w, this.map.h);
    g.fillStyle = '#1d1a2b'; g.fillRect(x0 - 3, y0 - 3, size + 6, size + 6);
    g.globalAlpha = 0.9; g.drawImage(this.mini, x0, y0, this.map.w * k, this.map.h * k); g.globalAlpha = 1;
    const dot = (x, y, col, r) => { g.fillStyle = col; g.fillRect(x0 + (x / TILE) * k - r / 2, y0 + (y / TILE) * k - r / 2, r, r); };
    for (const e of scene.enemies) dot(e.x, e.y, e.boss ? '#ffd23f' : '#ff4f6d', e.boss ? 5 : 2);
    for (const n of scene.npcs) dot(n.x, n.y, '#ffe066', 4);
    for (const p of scene.pickups) if (p.kind === 'crate') dot(p.x, p.y, '#c99558', 4);
    if (scene.questTarget) dot(scene.questTarget.x, scene.questTarget.y, Math.floor(this.time * 4) % 2 ? '#ffd23f' : '#ffffff', 5);
    dot(me.x, me.y, '#5bd8ff', 4);
  }
}
