// 3D renderer (WebGL via three.js). Draws the same "scene" lists as the classic
// 2D renderer, so game logic and multiplayer do not change.
//
// Settings:
//  quality: 'ultra' | 'high' | 'fast'
//    ultra = PS3-era look: 3D models, golden-hour sky + reflections, ACES tone
//            mapping, bloom, colour grade, FXAA, soft shadows.
//    high  = bright handheld look (pixel sprites) with shadows; fast = no shadows.
//  camera: 'overhead' (tilted view from above) | 'street' (third-person, behind
//    the hero's shoulder). Street level always uses 3D models and the detailed city.
import * as THREE from '../../vendor/three.module.min.js';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from '../../vendor/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from '../../vendor/jsm/shaders/FXAAShader.js';
import { Sky } from '../../vendor/jsm/objects/Sky.js';
import { TILE } from '../shared/data.js';
import { T, tileAt } from '../shared/maps.js';
import { charSprite, petSprite, enemySprite, pickupSprite, renderMini, CAR_COLORS } from './art.js';
import { MapScene, UltraScene } from './scenery3d.js';
import { ModelKit, buildCharacter, poseCharacter, buildCreature, poseCreature, buildEnemy, poseEnemy, buildPickup, posePickup, buildCar } from './models3d.js';

const PITCH = (54 * Math.PI) / 180; // overhead camera looks down at 54 degrees
const FOV = 34;
const STREET_FOV = 60;
const PUSH = 26; // overhead sprites are slid toward the camera so they never clip into walls
const SUN = new THREE.Vector3(-170, 420, 230); // overhead: sun offset from the camera target
const SUN_LOW = new THREE.Vector3(-620, 330, 420).normalize(); // detailed city: golden-hour sun direction

const BULLET_COLORS = {
  pistol: ['#fff3a0', 3], uzi: ['#ffe066', 2.5], shotgun: ['#ffcf70', 2.5], rifle: ['#ffffff', 3], rocket: ['#ff7a3a', 5],
  fire: ['#ff8a2a', 4], water: ['#6cc8ff', 4], grass: ['#7ee06a', 4], spit: ['#a6e22e', 4.5],
};

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

function wrap(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }

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

// Colour grade + vignette, applied after tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.12 }, contrast: { value: 1.06 }, vig: { value: 0.32 }, tint: { value: new THREE.Vector3(1.03, 1.0, 0.96) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat; uniform float contrast; uniform float vig; uniform vec3 tint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb *= tint;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vig * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export class Renderer3D {
  constructor(glCanvas, overlayCanvas, { quality = 'high', camera = 'overhead' } = {}) {
    this.kind = '3d';
    this.quality = quality;
    this.cameraMode = camera;
    this.glCv = glCanvas;
    this.cv = overlayCanvas;
    this.g = overlayCanvas.getContext('2d');
    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 20, 4000);
    this.cam = { x: 0, y: 0 };
    this.street = { x: 0, y: 0, z: 0, ready: false }; // smoothed street camera position
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
    this.sun.shadow.mapSize.set(2048, 2048);
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
    const ball = new THREE.SphereGeometry(1, 10, 8);
    this.bulletMats = {};
    // bullets glow: colours above 1.0 are picked up by bloom in Ultra
    for (const [k, [col]] of Object.entries(BULLET_COLORS)) this.bulletMats[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.6) });
    this.bullets = new Pool(this.dyn, () => new THREE.Mesh(ball, this.bulletMats.pistol));
    const gunGeo = new THREE.BoxGeometry(1, 1, 1);
    gunGeo.translate(0.5, 0, 0);
    this.gunMats = { dark: new THREE.MeshLambertMaterial({ color: '#3a3f4a' }), rocket: new THREE.MeshLambertMaterial({ color: '#5a8a4a' }) };
    this.guns = new Pool(this.dyn, () => { const m = new THREE.Mesh(gunGeo, this.gunMats.dark); m.castShadow = true; return m; });
    this.carPool = new Pool(this.dyn, () => this.makeCar());
    this.models = new ModelKit(this.dyn);
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
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(18, 22, 220, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 110;
    mk.add(mring, beam);
    mk.visible = false;
    this.marker = mk;
    this.scene.add(mk);
    this.applySettings();
  }

  // ---------- settings ----------
  get ultra() { return this.quality === 'ultra'; }
  // Detailed city + 3D models: Ultra, or the street-level camera at any quality.
  get detailed() { return this.ultra || this.cameraMode === 'street'; }

  setQuality(q) { if (q !== this.quality) { this.quality = q; this.applySettings(); } }
  setCamera(c) { if (c !== this.cameraMode) { this.cameraMode = c; this.applySettings(); } }

  applySettings() {
    const shadows = this.quality !== 'fast';
    this.gl.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.gl.toneMapping = this.ultra ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.gl.toneMappingExposure = 0.78;
    if (this.ultra && !this.composer) this.buildComposer();
    // materials must recompile when shadows or tone mapping change
    const touch = (root) => root.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    touch(this.scene);
    for (const ms of this.sceneCache.values()) touch(ms.group);
    this.models.clear();
    this.resize();
    if (this.map) this.setMap(this.map, true);
  }

  buildComposer() {
    const c = new EffectComposer(this.gl);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.5, 0.95);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    c.addPass(new ShaderPass(GradeShader));
    this.fxaa = new ShaderPass(FXAAShader);
    c.addPass(this.fxaa);
    this.composer = c;
  }

  // Sky rendered once into a cube map: the background and the reflections on
  // paint, glass and water (PBR environment). City = golden hour; arena = neon dusk.
  skyEnvironment(city) {
    const key = city ? 'city' : 'arena';
    this.envCache = this.envCache || {};
    if (this.envCache[key]) return this.envCache[key];
    const skyScene = new THREE.Scene();
    if (city) {
      const sky = new Sky();
      sky.scale.setScalar(1000);
      const u = sky.material.uniforms;
      u.turbidity.value = 3.2; u.rayleigh.value = 2.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(SUN_LOW).multiplyScalar(1000);
      skyScene.add(sky);
    } else {
      const m = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 top = vec3(0.05,0.03,0.12); vec3 mid = vec3(0.32,0.12,0.42); vec3 c = mix(mid, top, smoothstep(0.0,0.6,h)); c += vec3(0.1,0.5,0.7) * pow(max(0.0, 1.0 - abs(h)*4.0), 3.0); gl_FragColor = vec4(c,1.0); }',
      });
      skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), m));
    }
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(1, 2000, rt);
    cubeCam.update(this.gl, skyScene);
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const env = pmrem.fromCubemap(rt.texture).texture;
    pmrem.dispose();
    this.envCache[key] = { background: rt.texture, env };
    return this.envCache[key];
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
    const pr = Math.min(dpr, this.quality === 'fast' ? 1.5 : 2);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, true);
    Object.assign(this.glCv.style, { left: rect.x + 'px', top: rect.y + 'px' });
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    }
    this.camera.aspect = w / h;
    // Overhead: frame about 9 tiles vertically in landscape; ~7.5 tiles across in portrait.
    const tiles = h > w ? (7.5 * h) / w : 9;
    this.dist = (tiles * TILE * Math.sin(PITCH)) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180));
    this.camera.updateProjectionMatrix();
  }

  setMap(map, force = false) {
    const changed = this.map !== map;
    this.map = map;
    const street = this.cameraMode === 'street';
    const style = this.detailed ? 'ultra' : 'classic';
    const key = `${map.kind}:${map.seed}:${style}:${street ? 'tall' : 'low'}`;
    let ms = this.sceneCache.get(key);
    if (!ms) {
      ms = style === 'ultra' ? new UltraScene(map, this.gl, { tall: street }) : new MapScene(map, this.gl);
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
    this.setLighting(map.kind === 'city');
    if (changed || !force) { this.parts = []; this.texts = []; this.rings = []; }
    this.street.ready = false;
  }

  setLighting(city) {
    const s = this.scene;
    if (this.detailed) {
      const sky = this.skyEnvironment(city);
      s.background = sky.background;
      s.environment = sky.env;
      s.environmentIntensity = city ? 0.4 : 0.7;
      const fogCol = city ? '#a8836f' : '#2a1b3a';
      const street = this.cameraMode === 'street';
      s.fog = street ? new THREE.Fog(fogCol, 750, 2800) : new THREE.Fog(fogCol, this.dist * 1.4, this.dist * 3.4);
      this.hemi.color.set(city ? '#a9c0ea' : '#8e7fd8');
      this.hemi.groundColor.set(city ? '#6b4a3a' : '#2a2140');
      this.hemi.intensity = city ? 0.55 : 0.7;
      this.sun.color.set(city ? '#ffc98e' : '#c6b6ff');
      this.sun.intensity = city ? 2.4 : 1.5;
      if (!this.ultra) { this.hemi.intensity *= 1.4; this.sun.intensity *= 0.85; } // no tone mapping: keep it bright
    } else {
      const sky = city ? '#a9dcf5' : '#2a2342';
      s.background = new THREE.Color(sky);
      s.environment = null;
      s.fog = new THREE.Fog(sky, this.dist * 1.15, this.dist * 2.8);
      this.hemi.color.set(city ? '#ffffff' : '#d9d0ff');
      this.hemi.groundColor.set(city ? '#b8a888' : '#4a3f6a');
      this.hemi.intensity = city ? 1.9 : 1.7;
      this.sun.color.set(city ? '#fff4dc' : '#e6d8ff');
      this.sun.intensity = 2.1;
    }
  }

  snapCamera(x, y) { this.cam.x = x; this.cam.y = y; this.street.ready = false; }

  // ---------- projection helpers (canvas-local CSS px) ----------
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
    if (this.ultra) col.multiplyScalar(1.8); // sparks glow under bloom
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
      case 'shot': this.parts.push({ x: e.x, y: e.y, h: 14, vx: 0, vy: 0, vh: 0, life: 0.06, max: 0.06, col: new THREE.Color('#fff0aa').multiplyScalar(this.ultra ? 3 : 1), size: 7, still: true }); break;
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

  // Overhead sprites: a camera-facing pixel sprite with its feet at world (x, y).
  placeSprite(cv, x, y, scale, flip = false, lift = 0) {
    const m = this.sprites.next();
    m.material = spriteMat(cv);
    const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
    const dx = cx - x, dy = cy - lift, dz = cz - y;
    const d = Math.hypot(dx, dy, dz);
    const f = (d - PUSH) / d;
    m.position.set(x + dx * (PUSH / d), lift + dy * (PUSH / d), y + dz * (PUSH / d));
    m.rotation.set(-PITCH, 0, 0); // perpendicular to the camera's view
    m.scale.set(cv.width * scale * f * (flip ? -1 : 1), cv.height * scale * f, 1);
    return m;
  }

  blob(x, y, w) {
    const b = this.blobs.next();
    b.position.set(x, 0.7, y);
    b.scale.set(w, 1, w * 0.62);
  }

  // ---------- cameras ----------
  overheadCamera(scene, dt) {
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
    if (this.shake > 0) { tx += (Math.random() - 0.5) * 12 * this.shake; tz += (Math.random() - 0.5) * 12 * this.shake; }
    const D = this.dist;
    if (this.camera.fov !== FOV) { this.camera.fov = FOV; this.camera.near = 20; this.camera.far = 4000; this.camera.updateProjectionMatrix(); }
    this.camera.position.set(tx, D * Math.sin(PITCH), tz + D * Math.cos(PITCH));
    this.camera.lookAt(tx, 0, tz);
    this.camera.updateMatrixWorld();
    this.placeSun(tx, tz, this.detailed ? SUN_LOW.clone().multiplyScalar(700) : SUN, 520);
    return { x0: tx - D * 1.2, x1: tx + D * 1.2, y0: tz - D * 1.6, y1: tz + D * 0.8 };
  }

  // Third-person: behind the hero's shoulder, looking where they aim. The camera
  // is pulled in so it never ends up inside a building or wall.
  streetCamera(scene, dt) {
    const me = scene.me;
    const yaw = scene.camYaw || 0;
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const inCar = !!me.car;
    const back = inCar ? 96 : 74, up = inCar ? 46 : 38;
    let px = me.x, pz = me.y;
    if (inCar && scene.carPos) { px = scene.carPos.x; pz = scene.carPos.y; }
    this.cam.x = px; this.cam.y = pz;
    // march back from the hero until a building or wall would be hit
    let dist = back;
    for (let d = 6; d <= back; d += 4) {
      const t = tileAt(this.map, Math.floor((px - fx * d) / TILE), Math.floor((pz - fz * d) / TILE));
      if (t === T.BUILD || t === T.WALL) { dist = Math.max(10, d - 8); break; }
    }
    // over the right shoulder, so the hero sits left of the crosshair
    const sx = -fz * 13, sz = fx * 13;
    const wx = px - fx * dist + sx, wy = up * (0.55 + 0.45 * (dist / back)), wz = pz - fz * dist + sz;
    const S = this.street;
    if (!S.ready) { S.x = wx; S.y = wy; S.z = wz; S.ready = true; }
    const k = Math.min(1, dt * 12);
    S.x += (wx - S.x) * k; S.y += (wy - S.y) * k; S.z += (wz - S.z) * k;
    let shx = 0, shz = 0;
    if (this.shake > 0) { shx = (Math.random() - 0.5) * 6 * this.shake; shz = (Math.random() - 0.5) * 6 * this.shake; }
    if (this.camera.fov !== STREET_FOV) { this.camera.fov = STREET_FOV; this.camera.near = 2; this.camera.far = 4000; this.camera.updateProjectionMatrix(); }
    this.camera.position.set(S.x + shx, S.y, S.z + shz);
    this.camera.lookAt(px + fx * 90 + sx * 0.6, 26, pz + fz * 90 + sz * 0.6);
    this.camera.updateMatrixWorld();
    this.placeSun(px + fx * 220, pz + fz * 220, SUN_LOW.clone().multiplyScalar(900), 620);
    return { street: true, px, pz, r: 1500 };
  }

  placeSun(tx, tz, off, box) {
    const sc = this.sun.shadow.camera;
    if (sc.right !== box) { sc.left = -box; sc.right = box; sc.top = box; sc.bottom = -box; sc.near = 10; sc.far = 2600; sc.updateProjectionMatrix(); }
    this.sun.position.set(tx + off.x, off.y, tz + off.z);
    this.sun.target.position.set(tx, 0, tz);
    this.sun.target.updateMatrixWorld();
  }

  // ---------- main draw ----------
  draw(scene, dt) {
    this.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    const me = scene.me;
    const street = this.cameraMode === 'street' && !!me;
    if (street && me.car) {
      const c = scene.cars.find((k) => k.id === me.car);
      scene.carPos = c ? { x: c.x, y: c.y } : null;
    }
    const view = street ? this.streetCamera(scene, dt) : this.overheadCamera(scene, dt);
    const vis = view.street
      ? (o) => Math.abs(o.x - view.px) < view.r && Math.abs(o.y - view.pz) < view.r
      : (o) => o.x > view.x0 && o.x < view.x1 && o.y > view.y0 && o.y < view.y1;

    // fade buildings and pillars standing between the overhead camera and the hero
    const ms = this.mapScene;
    for (const f of ms.fadeables) {
      let target = 1;
      if (!street && me && !me.dead) {
        const reach = f.height / Math.tan(PITCH) + 24;
        if (me.x > f.x0 - 14 && me.x < f.x1 + 14 && me.y < f.y0 + 6 && me.y > f.y0 - reach) target = 0.3;
      }
      if (f.o === target && f.done) continue;
      f.o += (target - f.o) * Math.min(1, dt * 8);
      if (Math.abs(f.o - target) < 0.01) f.o = target;
      f.done = f.o === target;
      for (const m of f.mats) { m.opacity = f.o; m.depthWrite = f.o > 0.95; }
    }
    for (const w of ms.waters) {
      if (w.isMeshPhongMaterial) w.opacity = 0.55 + 0.08 * Math.sin(this.time * 2);
      else if (w.isMeshBasicMaterial) w.opacity = 0.3 + 0.08 * Math.sin(this.time * 2);
    }
    if (ms.beacons) for (const b of ms.beacons) b.emissiveIntensity = Math.sin(this.time * 3) > 0.3 ? 5 : 0.2;

    this.sprites.begin(); this.blobs.begin(); this.bullets.begin(); this.guns.begin(); this.carPool.begin(); this.ringPool.begin(); this.models.begin();
    if (this.detailed) this.drawModels(scene, dt, vis);
    else this.drawSprites(scene, vis);

    for (const b of scene.bullets) {
      if (!vis(b)) continue;
      const m = this.bullets.next();
      const [, r] = BULLET_COLORS[b.kind] || BULLET_COLORS.pistol;
      m.material = this.bulletMats[b.kind] || this.bulletMats.pistol;
      m.position.set(b.x, 14, b.y);
      m.scale.setScalar(r * (street ? 0.8 : 1.1));
      if (b.kind === 'rocket') this.parts.push({ x: b.x, y: b.y, h: 14, vx: 0, vy: 0, vh: 20, life: 0.3, max: 0.3, col: new THREE.Color('#9a9a9a'), size: 4 });
    }
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
    this.updateParticles(dt);

    if (scene.questDest) {
      this.marker.visible = true;
      this.marker.position.set(scene.questDest.x, 0, scene.questDest.y);
      this.marker.children[0].material.opacity = 0.6 + 0.4 * Math.sin(this.time * 5);
      this.marker.children[1].material.opacity = 0.14 + 0.06 * Math.sin(this.time * 3);
    } else this.marker.visible = false;

    this.sprites.end(); this.blobs.end(); this.bullets.end(); this.guns.end(); this.carPool.end(); this.ringPool.end(); this.models.end();
    if (this.ultra && this.composer) this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
    this.drawOverlay(scene, dt, street);
  }

  drawModels(scene, dt, vis) {
    const K = this.models, t = this.time;
    for (const c of scene.cars) {
      if (!vis(c)) continue;
      const e = K.get('c' + c.id, 'car' + c.color, () => buildCar(c.color));
      e.obj.position.set(c.x, 0, c.y);
      e.obj.rotation.y = -c.ang;
    }
    for (const n of scene.npcs) {
      if (!vis(n)) continue;
      const e = K.get('n' + n.id, 'ch' + JSON.stringify(n.look), () => buildCharacter(n.look));
      e.obj.position.set(n.x, 0, n.y);
      e.obj.rotation.y = -(n.ang ?? Math.PI / 2);
      poseCharacter(e.obj, { phase: 0, moving: false, wpn: 'pistol', hurt: 0, t: t + n.id, armed: false });
    }
    for (const k of scene.pickups) {
      if (!vis(k)) continue;
      const e = K.get('k' + k.id, 'pk' + k.kind, () => buildPickup(k.kind));
      e.obj.position.set(k.x, 0, k.y);
      posePickup(e.obj, { t, id: k.id });
    }
    for (const en of scene.enemies) {
      if (!vis(en)) continue;
      const e = K.get('e' + en.id, `en${en.type}${en.boss ? 1 : 0}`, () => buildEnemy(en.type, en.boss));
      const moving = K.step(e, en.x, en.y, dt);
      e.obj.position.set(en.x, 0, en.y);
      e.obj.rotation.y = -en.ang;
      poseEnemy(e.obj, { phase: e.phase, moving, t: t + en.id });
    }
    for (const p of scene.players) {
      if (p.dead) continue;
      if (p.pet && !p.car && vis(p.pet)) { // the companion rides along (hidden) while you drive
        const e = K.get('pet' + p.id, `cr${p.petType}${p.evolved ? 1 : 0}`, () => buildCreature(p.petType, p.evolved));
        const moving = K.step(e, p.pet.x, p.pet.y, dt);
        e.obj.position.set(p.pet.x, 0, p.pet.y);
        e.obj.rotation.y = -p.ang;
        poseCreature(e.obj, { phase: e.phase, moving, t: t + p.id });
      }
      if (p.car || !vis(p)) continue;
      const e = K.get('p' + p.id, 'ch' + JSON.stringify(p.look), () => buildCharacter(p.look));
      const moving = K.step(e, p.x, p.y, dt) || p.moving;
      e.obj.position.set(p.x, 0, p.y);
      e.obj.rotation.y = -p.ang;
      poseCharacter(e.obj, { phase: e.phase, moving, wpn: p.wpn, hurt: p.hurtFlash || 0, t: t + p.id });
    }
  }

  drawSprites(scene, vis) {
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
      if (p.pet && !p.car && vis(p.pet)) {
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
  }

  updateParticles(dt) {
    const pm = this.partMesh, mat = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), eul = new THREE.Euler();
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
      quat.setFromEuler(eul.set(p.life * 9, p.life * 7, 0));
      mat.compose(pos, quat, scl);
      pm.setMatrixAt(n, mat); pm.setColorAt(n, p.col);
      n++;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    pm.count = n;
    pm.instanceMatrix.needsUpdate = true;
    if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
  }

  // ---------- 2D overlay: names, health bars, damage numbers, radar ----------
  drawOverlay(scene, dt, street) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    const me = scene.me;
    const Wc = this.cv.width / this.dpr, Hc = this.cv.height / this.dpr;
    // street level: only label things nearby, so names don't show through the far city
    const near = (o) => !street || !me || Math.hypot(o.x - me.x, o.y - me.y) < 520;
    const onScreen = (s) => !s.behind && s.x > -40 && s.x < Wc + 40 && s.y > -40 && s.y < Hc + 40;
    for (const n of scene.npcs) {
      if (!near(n)) continue;
      const s = this.project(n.x, n.y, 52);
      if (!onScreen(s)) continue;
      const bob = Math.sin(this.time * 3) * 2;
      g.font = '14px "Press Start 2P", monospace'; g.textAlign = 'center';
      g.fillStyle = '#1d1a2b'; g.fillText('!', s.x + 1, s.y + bob + 1);
      g.fillStyle = '#ffd23f'; g.fillText('!', s.x, s.y + bob);
      this.label(n.name, s.x, s.y - 18, '#ffe9a0');
    }
    for (const e of scene.enemies) {
      if (e.hpPct >= 100 || !near(e)) continue;
      const s = this.project(e.x, e.y, e.boss ? 62 : 36);
      if (onScreen(s)) this.bar(s.x, s.y, e.boss ? 46 : 26, e.hpPct / 100, e.boss ? '#ffd23f' : '#ff5d6c');
    }
    for (const p of scene.players) {
      if (p.dead || p.car || !near(p)) continue;
      const isMe = p === me;
      if (isMe && (!scene.multi || street)) continue;
      const s = this.project(p.x, p.y, 46);
      if (!onScreen(s)) continue;
      this.label(`${p.name}${scene.pvp ? '' : ' Lv' + p.level}`, s.x, s.y - 8, isMe ? '#9fe8ff' : '#ffffff');
      if (!isMe) this.bar(s.x, s.y, 30, p.hp / p.maxHp, '#5be37a');
    }
    g.textAlign = 'center';
    for (const t of this.texts) {
      t.life -= dt;
      const a = Math.max(0, t.life / t.max);
      if (!near(t)) continue;
      const s = this.project(t.x, t.y, 30 + (1 - a) * 26);
      if (s.behind) continue;
      g.globalAlpha = Math.min(1, a * 2);
      g.font = `${t.big ? 18 : 11}px "Press Start 2P", monospace`;
      g.fillStyle = '#1d1a2b'; g.fillText(t.text, s.x + 1.5, s.y + 1.5);
      g.fillStyle = t.color; g.fillText(t.text, s.x, s.y);
      g.globalAlpha = 1;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    if (street && me && !me.car && !me.dead) this.crosshair(me);
    if (scene.questTarget && me) this.drawArrow(scene.questTarget, me, street ? scene.camYaw || 0 : null);
    if (scene.showMini && me) this.drawMini(scene, me, street ? scene.camYaw || 0 : null);
    if (me && me.hurtFlash > 0) {
      g.fillStyle = `rgba(255,40,60,${me.hurtFlash * 0.35})`;
      g.fillRect(0, 0, Wc, Hc);
    }
  }

  // Street level: a small reticle where shots go (chest height, ahead of the hero).
  crosshair(me) {
    const s = this.project(me.x + Math.cos(me.ang) * 280, me.y + Math.sin(me.ang) * 280, 14);
    if (s.behind) return;
    const g = this.g;
    g.strokeStyle = 'rgba(29,26,43,0.9)'; g.lineWidth = 4;
    g.beginPath(); g.arc(s.x, s.y, 8, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.arc(s.x, s.y, 8, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffd23f'; g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
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
  // delta (projected points behind the camera would flip). With a street camera
  // (yaw given), "up" on screen is the way the camera faces.
  drawArrow(t, me, yaw) {
    const g = this.g;
    const s = this.project(t.x, t.y, 0);
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    if (!s.behind && s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) return;
    const world = Math.atan2(t.y - me.y, t.x - me.x);
    const a = yaw === null ? Math.atan2((t.y - me.y) / this.aimYScale, t.x - me.x) : wrap(world - yaw) - Math.PI / 2;
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

  drawMini(scene, me, yaw) {
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
    if (yaw !== null) { // facing line
      const mx = x0 + (me.x / TILE) * k, my = y0 + (me.y / TILE) * k;
      g.strokeStyle = '#5bd8ff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(yaw) * 9, my + Math.sin(yaw) * 9); g.stroke();
    }
  }
}
