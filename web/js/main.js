// Aura Ascendants: app shell. Screens, battle loop, HUD, saved fighters, settings.
import * as THREE from '../vendor/three/three.module.js';
import { EffectComposer } from '../vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/postprocessing/OutputPass.js';
import { Fight } from './sim/fight.js';
import { CPU } from './sim/ai.js';
import { DT, MAX_METER, ASCEND_COST, APEX_COST, MAX_BLINK, APEXES, STYLES } from './sim/data.js';
import { defaultSpec, randomSpec, sanitizeSpec } from './sim/spec.js';
import { FighterModel } from './client/fighter3d.js';
import { Arena, STAGES } from './client/arena.js';
import { FX } from './client/fx.js';
import { LockCam } from './client/camera.js';
import { Input } from './client/input.js';
import { Sfx } from './client/audio.js';
import { Creator } from './client/creator.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TEST = new URLSearchParams(location.search).has('test');

// ---------------------------------------------------------------- storage
const FKEY = 'aa.fighters.v1', SKEY = 'aa.settings.v1';
function load(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
export function encodeSpec(spec) { return btoa(unescape(encodeURIComponent(JSON.stringify(spec)))).replace(/=+$/, ''); }
export function decodeSpec(code) { try { return sanitizeSpec(JSON.parse(decodeURIComponent(escape(atob(code.trim()))))); } catch { return null; } }

class App {
  constructor() {
    this.canvas = $('#gl');
    const gl2 = this.canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
    if (!gl2) { $('#nogl').hidden = false; throw new Error('WebGL2 is required'); }
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl2, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);
    this.settings = { volume: 0.7, quality: 'high', cpu: 'normal', stage: 'highlands', hints: true, ...load(SKEY, {}) };
    this.fighters = load(FKEY, null);
    if (!Array.isArray(this.fighters) || !this.fighters.length) {
      this.fighters = [{ id: 'f1', spec: defaultSpec() }, { id: 'f2', spec: randomSpec(2024) }, { id: 'f3', spec: randomSpec(77) }];
      this.saveFighters();
    }
    this.fighters = this.fighters.map((f, i) => ({ id: f.id || 'f' + Date.now() + i, spec: sanitizeSpec(f.spec) }));
    this.sfx = new Sfx(); this.sfx.setVolume(this.settings.volume);
    this.input = new Input($('#ui'));
    this.input.show(false);
    this.preview = this.makePreviewScene();
    this.creator = new Creator(this);
    this.setupComposer();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.bindUI();
    this.pick = { me: this.fighters[0].id, foe: 'random', level: this.settings.cpu, stage: this.settings.stage };
    this.show('title');
    this.last = performance.now();
    this.acc = 0;
    if (!TEST) requestAnimationFrame((t) => this.loop(t));
    addEventListener('pointerdown', () => this.sfx.unlock(), { once: false });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'fight') this.pause(true); });
  }

  saveFighters() { store(FKEY, this.fighters); }
  saveSettings() { store(SKEY, this.settings); }
  fighterById(id) { return this.fighters.find((f) => f.id === id); }

  setupComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(this.preview.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const hi = this.settings.quality === 'high';
    const pr = Math.min(devicePixelRatio || 1, hi ? 2 : 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = hi;
  }

  // ---------------------------------------------------------------- preview scene (menus + creator)
  makePreviewScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#141225');
    const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x2a2238, 1.3);
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.6); rim.position.set(-4, 3, -4);
    scene.add(hemi, key, rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshToonMaterial({ color: 0x2a2645 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.62, 64), new THREE.MeshBasicMaterial({ color: 0x8a7dff }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; scene.add(ring);
    // floating particles
    const n = 220, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 16, Math.random() * 8, (Math.random() - 0.5) * 16 - 3], i * 3);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x8fa0ff, size: 0.05, transparent: true, opacity: 0.7 }));
    scene.add(pts);
    return { scene, model: null, yaw: 0.4, spin: true, pose: 'idle', t: 0, ascended: false, pts, offsetX: 0 };
  }

  setPreview(spec) {
    const P = this.preview;
    if (P.model) P.model.dispose();
    P.model = new FighterModel(spec);
    P.scene.add(P.model.root);
    P.model.shadow.removeFromParent();
  }

  updatePreview(dt) {
    const P = this.preview, m = P.model;
    if (!m) return;
    P.t++;
    if (P.spin) P.yaw += dt * 0.35;
    const state = P.pose === 'strike' ? 'attack' : P.pose;
    const moves = ['jab', 'cross', 'knee', 'roundhouse', 'axe', 'smash'];
    const mi = Math.floor(P.t / 34) % moves.length;
    const cycle = { charge: 9999, beamcharge: 60, beam: 9999, ascending: 50, apex: 9999, guard: 9999, idle: 9999 };
    let st = state, t = P.t;
    if (P.pose === 'beam') { st = P.t % 160 < 60 ? 'beamcharge' : 'beam'; t = P.t % 160; }
    if (P.pose === 'ascend') { st = 'ascending'; t = P.t % 90; if (t >= 50) st = 'idle'; }
    if (state === 'attack') t = P.t % 34;
    void cycle;
    m.update({ pos: { x: P.offsetX, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, face: { x: Math.sin(P.yaw), y: 0, z: Math.cos(P.yaw) }, state: st, t, move: moves[mi], ascended: P.ascended || (P.pose === 'ascend' && P.t % 90 >= 50), flying: false }, dt);
    m.root.rotation.y = P.yaw; // no smoothing in the preview
    P.pts.rotation.y += dt * 0.05;
    // camera: full-body framing, pushed left/right so the panel doesn't cover the fighter
    const s = m.scale;
    this.camera.position.set(P.camX ?? 0, 1.05 * s, 3.6 * (P.zoom || 1));
    this.camera.lookAt(P.camX ?? 0, 0.92 * s, 0);
    this.camera.fov = 40; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- screens
  show(name) {
    this.mode = name;
    for (const el of $$('.screen')) el.hidden = el.id !== name;
    const inFight = name === 'fight' || name === 'pause';
    this.input.show(name === 'fight');
    if (!inFight && this.battle && name !== 'results') this.endBattle();
    this.renderPass.scene = inFight || name === 'results' ? (this.battle ? this.battle.scene : this.preview.scene) : this.preview.scene;
    const P = this.preview;
    P.camX = 0; P.zoom = 1;
    if (name === 'title') { this.setPreview(randomSpec((Math.random() * 1e9) | 0)); P.pose = 'charge'; P.spin = true; P.ascended = Math.random() < 0.5; P.camX = 0; }
    if (name === 'menu') { this.setPreview(this.fighterById(this.pick.me)?.spec || defaultSpec()); P.pose = 'idle'; P.spin = true; P.ascended = false; P.camX = 0.55; }
    if (name === 'fighters') this.renderFighters();
    if (name === 'select') this.renderSelect();
    if (name === 'settings') this.renderSettings();
  }

  bindUI() {
    $('#title').addEventListener('click', () => { this.sfx.unlock(); this.sfx.play('go'); this.show('menu'); });
    for (const b of $$('[data-go]')) b.addEventListener('click', () => { this.sfx.play('ui'); this.show(b.dataset.go); });
    $('#btn-battle').addEventListener('click', () => { this.selectMode = 'battle'; this.show('select'); });
    $('#btn-training').addEventListener('click', () => { this.selectMode = 'training'; this.show('select'); });
    $('#btn-new').addEventListener('click', () => this.creator.open(null));
    $('#btn-import').addEventListener('click', () => {
      const code = prompt('Paste a fighter code:');
      if (!code) return;
      const spec = decodeSpec(code);
      if (!spec) { alert('That code could not be read.'); return; }
      this.fighters.push({ id: 'f' + Date.now(), spec }); this.saveFighters(); this.renderFighters();
    });
    $('#btn-start').addEventListener('click', () => this.startBattle());
    $('#btn-pause').addEventListener('click', () => this.pause(true));
    $('#btn-resume').addEventListener('click', () => this.pause(false));
    $('#btn-quit').addEventListener('click', () => { this.show('menu'); });
    $('#btn-rematch').addEventListener('click', () => this.startBattle());
    $('#btn-results-menu').addEventListener('click', () => this.show('menu'));
    addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') { if (this.mode === 'fight') this.pause(true); else if (this.mode === 'pause') this.pause(false); } });
  }

  renderFighters() {
    const list = $('#fighter-list');
    list.innerHTML = this.fighters.map((f) => `
      <div class="fcard" data-id="${f.id}">
        <div class="swatch" style="--a:${f.spec.aura.color};--h:${f.spec.hair.color};--t:${f.spec.outfit.topColor}"><span></span><span></span><span></span></div>
        <div class="fname">${esc(f.spec.name)}</div>
        <div class="fmeta">${STYLES[f.spec.style].name} · ${APEXES[f.spec.moves.apex].name}</div>
        <div class="frow"><button data-act="edit">Edit</button><button data-act="share">Share</button><button data-act="del" class="danger">Delete</button></div>
      </div>`).join('');
    for (const c of $$('.fcard', list)) {
      const id = c.dataset.id;
      c.addEventListener('click', (e) => {
        const act = e.target.dataset?.act;
        const f = this.fighterById(id);
        if (act === 'edit') this.creator.open(id);
        else if (act === 'del') {
          if (this.fighters.length <= 1) { alert('Keep at least one fighter.'); return; }
          if (!confirm(`Delete ${f.spec.name}?`)) return;
          this.fighters = this.fighters.filter((x) => x.id !== id); this.saveFighters();
          if (this.pick.me === id) this.pick.me = this.fighters[0].id;
          this.renderFighters();
        } else if (act === 'share') {
          const code = encodeSpec(f.spec);
          navigator.clipboard?.writeText(code).then(() => this.toast('Fighter code copied'), () => prompt('Fighter code:', code));
          if (!navigator.clipboard) prompt('Fighter code:', code);
        } else { this.setPreview(f.spec); this.preview.pose = 'idle'; }
      });
    }
    const first = this.fighters[0];
    if (first) { this.setPreview(first.spec); this.preview.pose = 'idle'; this.preview.camX = 0.6; }
  }

  renderSelect() {
    const p = this.pick;
    if (!this.fighterById(p.me)) p.me = this.fighters[0].id;
    $('#select-title').textContent = this.selectMode === 'training' ? 'Training' : 'Battle vs CPU';
    const card = (f, sel, side) => `<button class="pcard${sel ? ' sel' : ''}" data-side="${side}" data-id="${f.id}"><i style="background:${f.spec.aura.color}"></i>${esc(f.spec.name)}</button>`;
    $('#pick-me').innerHTML = this.fighters.map((f) => card(f, f.id === p.me, 'me')).join('');
    $('#pick-foe').innerHTML = `<button class="pcard${p.foe === 'random' ? ' sel' : ''}" data-side="foe" data-id="random"><i style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"></i>Random</button>` + this.fighters.map((f) => card(f, f.id === p.foe, 'foe')).join('');
    $('#pick-level').innerHTML = (this.selectMode === 'training' ? ['stand', 'guard', 'easy'] : ['easy', 'normal', 'hard']).map((l) => `<button class="chip${(this.selectMode === 'training' ? p.dummy || 'stand' : p.level) === l ? ' sel' : ''}" data-l="${l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('');
    $('#pick-stage').innerHTML = Object.entries(STAGES).map(([k, s]) => `<button class="chip${p.stage === k ? ' sel' : ''}" data-s="${k}">${s.name}</button>`).join('');
    $('#level-label').textContent = this.selectMode === 'training' ? 'Dummy' : 'CPU level';
    for (const b of $$('.pcard')) b.addEventListener('click', () => { this.sfx.play('ui'); if (b.dataset.side === 'me') p.me = b.dataset.id; else p.foe = b.dataset.id; this.renderSelect(); });
    for (const b of $$('#pick-level .chip')) b.addEventListener('click', () => { if (this.selectMode === 'training') p.dummy = b.dataset.l; else { p.level = b.dataset.l; this.settings.cpu = p.level; this.saveSettings(); } this.renderSelect(); });
    for (const b of $$('#pick-stage .chip')) b.addEventListener('click', () => { p.stage = b.dataset.s; this.settings.stage = p.stage; this.saveSettings(); this.renderSelect(); });
    this.setPreview(this.fighterById(p.me).spec); this.preview.pose = 'idle'; this.preview.camX = 0.65;
  }

  renderSettings() {
    const s = this.settings;
    $('#set-volume').value = s.volume;
    $('#set-volume').oninput = (e) => { s.volume = +e.target.value; this.sfx.setVolume(s.volume); this.saveSettings(); };
    $('#set-quality').innerHTML = ['high', 'low'].map((q) => `<button class="chip${s.quality === q ? ' sel' : ''}" data-q="${q}">${q === 'high' ? 'High (bloom + shadows)' : 'Battery saver'}</button>`).join('');
    for (const b of $$('#set-quality .chip')) b.onclick = () => { s.quality = b.dataset.q; this.saveSettings(); this.resize(); this.renderSettings(); };
    $('#set-hints').checked = s.hints;
    $('#set-hints').onchange = (e) => { s.hints = e.target.checked; this.saveSettings(); };
  }

  toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 1800);
  }

  // ---------------------------------------------------------------- battle
  startBattle() {
    if (this.battle) this.endBattle();
    const p = this.pick;
    const me = this.fighterById(p.me).spec;
    const foe = p.foe === 'random' ? randomSpec((Math.random() * 1e9) | 0) : this.fighterById(p.foe)?.spec || randomSpec(5);
    const training = this.selectMode === 'training';
    const seed = (Math.random() * 1e9) | 0;
    const fight = new Fight({ specs: [me, foe], seed, time: training ? 1e6 : undefined });
    const scene = new THREE.Scene();
    const arena = new Arena(scene, fight.pillars, p.stage, seed);
    const models = fight.f.map((f) => { const m = new FighterModel(f.spec); scene.add(m.root); scene.add(m.shadow); return m; });
    const fx = new FX(scene);
    const cam = new LockCam(this.camera);
    this.battle = {
      fight, scene, arena, models, fx, cam, training,
      cpu: new CPU(1, training ? 'easy' : p.level, seed),
      dummy: training ? p.dummy || 'stand' : null,
      intro: TEST ? 0 : 2.6, outro: 0, slow: 0, combo: [0, 0], comboT: [0, 0],
      stats: [{ dmg: 0, hits: 0, best: 0, blinks: 0 }, { dmg: 0, hits: 0, best: 0, blinks: 0 }],
      lastHit: [0, 0], ghostHp: fight.f.map((f) => f.hp),
    };
    this.camera.fov = 62;
    cam.snap(fight.view().f[0], fight.view().f[1], fight.pillars);
    this.renderPass.scene = scene;
    this.show('fight');
    this.renderPass.scene = scene;
    $('#hud-name0').textContent = fight.f[0].spec.name; $('#hud-name1').textContent = fight.f[1].spec.name;
    $('#hud-hint').hidden = !(this.settings.hints && training);
    $('#hud-timer').style.visibility = training ? 'hidden' : '';
    this.banner(training ? 'TRAINING' : 'READY…', 1.6);
    if (!TEST) setTimeout(() => { if (this.battle?.fight === fight && !training) { this.banner('FIGHT!', 0.9); this.sfx.play('go'); } }, 1700);
  }

  endBattle() {
    const b = this.battle; if (!b) return;
    b.fx.clear(); b.models.forEach((m) => m.dispose()); b.arena.dispose();
    b.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.battle = null;
  }

  pause(on) {
    if (!this.battle) return;
    if (on && this.mode === 'fight') { this.show('pause'); this.renderPass.scene = this.battle.scene; }
    else if (!on && this.mode === 'pause') { this.show('fight'); this.renderPass.scene = this.battle.scene; this.last = performance.now(); }
  }

  banner(text, secs = 1.2) {
    const el = $('#banner'); el.textContent = text; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(this.bannerT); this.bannerT = setTimeout(() => el.classList.remove('on'), secs * 1000);
  }

  auraColor(side, apex) { const f = this.battle.fight.f[side]; return f.ascended || apex ? f.spec.aura.ascend : f.spec.aura.color; }

  handleEvents() {
    const b = this.battle, F = b.fight;
    for (const e of F.events) {
      const m = b.models[e.who];
      switch (e.t) {
        case 'hit': {
          m.hit();
          b.fx.burst(e.x, e.y, e.z, this.auraColor(e.by, e.apex), { heavy: e.heavy, apex: e.apex, size: e.kind === 'blast' ? 1.4 : 1.6 });
          this.sfx.play(e.heavy || e.apex ? 'heavy' : 'hit');
          const s = b.stats[e.by]; s.dmg += e.dmg; s.hits++; s.best = Math.max(s.best, e.combo);
          b.combo[e.by] = e.combo; b.comboT[e.by] = 1.4;
          if (!TEST && e.heavy) navigator.vibrate?.(25);
          break;
        }
        case 'guard': b.fx.burst(e.x, e.y, e.z, '#bfe6ff', { size: 1.0 }); this.sfx.play('guard'); break;
        case 'guardbreak': b.fx.burst(e.x, e.y, e.z, '#ffd36e', { heavy: true }); this.sfx.play('break'); if (e.who === 0 || e.who === 1) this.callout(e.who === 0 ? 'GUARD BROKEN' : 'GUARD BREAK!'); break;
        case 'blink': b.fx.afterimage(m); this.sfx.play('blink'); b.stats[e.who].blinks++; if (e.breaker) this.callout(e.who === 0 ? 'BREAKOUT!' : 'ESCAPED'); break;
        case 'blast': this.sfx.play('blast'); break;
        case 'pop': b.fx.burst(e.x, e.y, e.z, '#ffffff', { size: e.apex ? 6 : 1.2, heavy: e.apex, apex: e.apex }); this.sfx.play('pop'); break;
        case 'beamCharge': case 'charge': this.sfx.play('charge'); break;
        case 'beam': this.sfx.play('beam'); break;
        case 'dash': this.sfx.play('dash'); { const f = F.f[e.who]; if (f.pos.y < 0.5) b.fx.dust(f.pos.x, f.pos.z); } break;
        case 'ascend': this.sfx.play('ascend'); if (e.who === 0) this.callout('ASCEND!'); break;
        case 'ascended': { const f = F.f[e.who]; b.fx.burst(f.pos.x, f.pos.y + 1, f.pos.z, f.spec.aura.ascend, { heavy: true, apex: true, size: 3 }); b.fx.dust(f.pos.x, f.pos.z, true); break; }
        case 'descend': if (e.who === 0) this.callout('Aura faded'); break;
        case 'apexStart': this.sfx.play('apex'); this.banner(APEXES[F.f[e.who].spec.moves.apex].name.toUpperCase(), 1.4); break;
        case 'apex': b.fx.flash = 0.8; b.fx.flashColor.set(this.auraColor(e.who, true)); b.fx.shake = 1; break;
        case 'land': if (e.hard) { b.fx.dust(e.x, e.z, true); b.arena.crater(e.x, e.z, 2.2); this.sfx.play('land'); } else b.fx.dust(e.x, e.z); break;
        case 'crash': b.fx.burst(e.x, e.y, e.z, '#e8d2b0', { heavy: true, size: 2.5 }); this.sfx.play('heavy'); break;
        case 'ko': this.sfx.play('ko'); this.banner('K.O.!', 2.2); b.slow = 1.6; break;
        case 'end': if (e.reason === 'time') { this.banner('TIME!', 2); b.slow = 0.6; } b.outro = (e.reason === 'ko' ? 2.6 : 1.8); break;
      }
    }
    F.events.length = 0;
  }

  callout(text) {
    const el = $('#callout'); el.textContent = text; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }

  dummyInput() {
    const b = this.battle, f = b.fight.f[1];
    if (b.dummy === 'easy') return b.cpu.think(b.fight);
    const inp = { mx: 0, my: 0, atk: false, blast: false, guard: b.dummy === 'guard', dash: false, jump: false, special: false };
    if (f.state === 'launched' && f.pos.y > 0.5) inp.jump = false;
    return inp;
  }

  stepBattle(dt) {
    const b = this.battle, F = b.fight;
    if (b.intro > 0) { b.intro -= dt; }
    // fixed 60 Hz simulation (slower right after a KO for drama)
    const rate = b.slow > 0 ? 0.35 : 1;
    b.slow = Math.max(0, b.slow - dt);
    this.acc += dt * rate;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      this.acc -= DT; steps++;
      const mine = b.intro > 0.9 ? { mx: 0, my: 0 } : this.input.read();
      const theirs = b.intro > 0.9 ? {} : b.training ? this.dummyInput() : b.cpu.think(F);
      F.step([mine, theirs]);
      if (b.training) { // refill after a pause in the action, infinite-ish meter
        for (const f of F.f) if (F.tick - (b.lastHit[f.side] || 0) > 150 && f.hp < f.maxHp) f.hp = Math.min(f.maxHp, f.hp + 12);
        if (F.f[0].meter < 30 && F.tick % 60 === 0) F.f[0].meter = Math.min(MAX_METER, F.f[0].meter + 8);
        for (const e of F.events) if (e.t === 'hit') b.lastHit[e.who] = F.tick;
        if (F.over) { // no KOs in training: reset instead
          F.over = false; F.winner = -1; F.events = F.events.filter((e) => e.t !== 'ko' && e.t !== 'end');
          for (const f of F.f) { f.hp = f.maxHp; if (f.state === 'ko') f.set('idle'); }
          this.callout('KO! (reset)');
        }
      }
      this.handleEvents();
    }
    if (steps === 5) this.acc = 0;
    const view = F.view();
    b.models.forEach((m, i) => m.update(view.f[i], dt));
    b.fx.camPos = this.camera.position;
    b.fx.sync(view, (o, apex) => this.auraColor(o, apex), dt, performance.now() / 1000);
    b.fx.update(dt);
    b.arena.update(dt, view.f[0].pos);
    b.cam.update(view.f[0], view.f[1], F.pillars, dt, b.fx.shake, b.intro > 1.2 ? 'intro' : 'fight');
    this.updateHUD(view, dt);
    if (b.outro > 0) { b.outro -= dt; if (b.outro <= 0) this.showResults(); }
  }

  updateHUD(view, dt) {
    const b = this.battle;
    for (let i = 0; i < 2; i++) {
      const f = view.f[i];
      const pct = (f.hp / f.maxHp) * 100;
      b.ghostHp[i] = b.ghostHp[i] > f.hp ? b.ghostHp[i] - (f.maxHp * dt * 0.35) : f.hp;
      $(`#hud-hp${i}`).style.width = pct + '%';
      $(`#hud-ghost${i}`).style.width = (Math.max(f.hp, b.ghostHp[i]) / f.maxHp) * 100 + '%';
      $(`#hud-meter${i}`).style.width = (f.meter / MAX_METER) * 100 + '%';
      $(`#hud-meter${i}`).classList.toggle('asc', f.ascended);
      $(`#hud-blink${i}`).innerHTML = '<i class="on"></i>'.repeat(f.blink) + '<i></i>'.repeat(MAX_BLINK - f.blink);
      b.comboT[i] -= dt;
      const c = $(`#hud-combo${i}`);
      if (b.comboT[i] > 0 && b.combo[i] >= 2) { c.textContent = `${b.combo[i]} HITS`; c.classList.add('on'); } else c.classList.remove('on');
    }
    $('#hud-timer').textContent = Math.ceil(view.timer);
    const me = view.f[0];
    if (me.ascended) this.input.setSpecial('APEX', me.meter >= APEX_COST - 1);
    else this.input.setSpecial('ASCEND', me.meter >= ASCEND_COST);
    const fl = $('#flash'); fl.style.opacity = b.fx.flash.toFixed(3); fl.style.background = '#' + b.fx.flashColor.getHexString();
  }

  showResults() {
    const b = this.battle, F = b.fight;
    const w = F.winner;
    $('#res-title').textContent = w === 0 ? 'VICTORY' : w === 1 ? 'DEFEAT' : 'DRAW';
    $('#res-title').className = w === 0 ? 'win' : w === 1 ? 'lose' : '';
    $('#res-sub').textContent = w >= 0 ? `${F.f[w].spec.name} wins by ${F.reason === 'ko' ? 'knockout' : 'time'}` : 'Dead even.';
    $('#res-stats').innerHTML = ['Damage dealt', 'Hits landed', 'Best combo', 'Blinks'].map((label, i) => {
      const k = ['dmg', 'hits', 'best', 'blinks'][i];
      return `<tr><td>${Math.round(b.stats[0][k])}</td><th>${label}</th><td>${Math.round(b.stats[1][k])}</td></tr>`;
    }).join('');
    $('#res-names').innerHTML = `<span>${esc(F.f[0].spec.name)}</span><span>${esc(F.f[1].spec.name)}</span>`;
    this.show('results');
    this.renderPass.scene = b.scene;
  }

  // ---------------------------------------------------------------- frame loop
  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.frame(dt);
    requestAnimationFrame((tt) => this.loop(tt));
  }

  frame(dt) {
    if (this.battle && this.mode === 'fight') this.stepBattle(dt);
    else if (this.battle && (this.mode === 'results' || this.mode === 'pause')) {
      const view = this.battle.fight.view();
      if (this.mode === 'results') { this.battle.fight.step([{}, {}]); this.battle.models.forEach((m, i) => m.update(view.f[i], dt)); this.battle.fx.update(dt); this.battle.cam.update(view.f[0], view.f[1], this.battle.fight.pillars, dt, 0); }
    } else {
      this.updatePreview(dt);
      if (this.mode === 'creator') this.creator.frame(dt);
    }
    if (this.settings.quality === 'high') this.composer.render(dt);
    else this.renderer.render(this.renderPass.scene, this.camera);
  }

  // test hook: advance exactly dt seconds of game time
  stepFrame(dt = 1 / 60) { this.frame(dt); }
}

try { window.app = new App(); } catch (e) { console.error(e); if (!$('#nogl').hidden) { /* message shown */ } else { $('#nogl').hidden = false; $('#nogl p').textContent = String(e.message || e); } }
