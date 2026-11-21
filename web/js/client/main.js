// App entry: menus, character creator, HUD and the main loop.
import { LOOK, LOOK_KEYS, CREATURES, CREATURE_ORDER, WEAPONS, WEAPON_ORDER, STAT_MAX, EVOLVE_LEVEL, xpNeed, MAX_LEVEL } from '../shared/data.js';
import { makeCity } from '../shared/maps.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';
import { buildCharacter, buildCreature } from './models3d.js';
import { Input } from './input.js';
import { charSprite, petSprite } from './art.js';
import { loadProfile, saveProfile, resetProfile, defaultProfile, canBuy, buy, spendPoint } from './save.js';
import { LocalGame, NetGame, ShowcaseGame } from './game.js';
import { sfx, unlock, setSound } from './audio.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tap = (node, fn) => node.addEventListener('click', (e) => { sfx.ui(); fn(e); });

// ---------------- HUD ----------------
class Hud {
  constructor() {
    this.cache = {};
    // weapon slots on the lower (touch) screen
    this.slots = WEAPON_ORDER.map((w, i) => {
      const b = el('button', '', `${WEAPONS[w].name}<small></small>`);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (!b.disabled) { app.input.wpnReq = i; } });
      $('p-slots').appendChild(b);
      return b;
    });
    this.bannerT = 0;
    this.dialogT = 0;
    tap($('dialog'), () => this.closeDialog());
  }
  set(id, v, prop = 'textContent') {
    if (this.cache[id + prop] === v) return;
    this.cache[id + prop] = v;
    if (prop === 'width') $(id).style.width = v; else $(id)[prop] = v;
  }
  toast(text) {
    const t = el('div', '', esc(text));
    $('toasts').appendChild(t);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 3000);
  }
  banner(title, sub) {
    const b = $('banner');
    $('ban-t').textContent = title; $('ban-s').textContent = sub || '';
    b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    this.bannerT = 2.6;
  }
  dialog(title, text) {
    $('dlg-t').textContent = title; $('dlg-x').textContent = text;
    $('dialog').classList.remove('hidden');
    $('help').classList.add('hidden');
    this.dialogT = 9;
  }
  closeDialog() { $('dialog').classList.add('hidden'); this.dialogT = 0; }
  clear() {
    $('toasts').innerHTML = ''; $('banner').classList.add('hidden'); this.closeDialog(); this.cache = {};
  }
  updatePanel(profile, st, hpf) {
    this.set('p-name', profile.name);
    this.set('p-lvl', `Lv ${profile.level}`);
    this.set('p-coins', `${profile.coins} coins${profile.points ? ` +${profile.points}pts` : ''}`);
    this.set('p-xp', profile.level >= MAX_LEVEL ? '100%' : `${Math.round((profile.xp / xpNeed(profile.level)) * 100)}%`, 'width');
    this.set('p-hp', `${Math.round(hpf * 100)}%`, 'width');
    this.set('p-hpt', `${Math.ceil(st.hp)}/${st.maxHp}`);
    $('p-hp').parentElement.classList.toggle('low', hpf < 0.3);
    this.set('p-qt', st.quest.title);
    this.set('p-qx', st.quest.text);
    this.set('p-hint', st.hint);
    $('pb-act').classList.toggle('hidden', !!st.noAction);
    WEAPON_ORDER.forEach((w, i) => {
      const a = st.slots ? st.slots[i] : -2;
      const key = `${a}|${st.wpn === w}`;
      if (this.cache['slot' + i] === key) return;
      this.cache['slot' + i] = key;
      const b = this.slots[i];
      b.disabled = a === -2 || a === 0;
      b.classList.toggle('on', st.wpn === w);
      b.querySelector('small').textContent = a === -2 ? '--' : a === -1 ? '\u221e' : String(a);
    });
  }

  update(dt, profile, st) {
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) $('banner').classList.add('hidden');
    if (this.dialogT > 0 && (this.dialogT -= dt) <= 0) this.closeDialog();
    this.set('h-name', profile.name);
    this.set('h-lvl', `Lv ${profile.level}`);
    const lvlMax = profile.level >= MAX_LEVEL;
    this.set('h-xp', lvlMax ? '100%' : `${Math.round((profile.xp / xpNeed(profile.level)) * 100)}%`, 'width');
    this.set('h-coins', `${profile.coins} coins`);
    this.set('h-pts', profile.points ? `+${profile.points} pts` : '');
    if (!st) return;
    const hpf = Math.max(0, st.hp / st.maxHp);
    this.set('h-hp', `${Math.round(hpf * 100)}%`, 'width');
    this.set('h-hpt', `${Math.ceil(st.hp)}/${st.maxHp}`);
    $('h-hp').parentElement.classList.toggle('low', hpf < 0.3);
    this.set('h-qt', st.quest.title);
    this.set('h-qx', st.quest.text);
    this.set('h-wpn', WEAPONS[st.wpn].name);
    this.set('h-ammo', st.ammo === Infinity ? '∞' : String(st.ammo));
    this.set('h-hint', st.hint);
    $('b-act').classList.toggle('hidden', !!st.noAction);
    if (document.body.classList.contains('dual')) this.updatePanel(profile, st, hpf);
    const deadText = st.dead ? (st.respawn < 0 ? 'KO! You revive when the wave is cleared.' : `KO! Back in ${st.respawn}...`) : '';
    this.set('dead', deadText);
    $('dead').classList.toggle('hidden', !st.dead);
  }
}

// ---------------- app ----------------
const app = {
  profile: loadProfile(),
  session: null,
  dirty: false,
  lastSave: 0,
  hud: new Hud(),
  save(force) {
    const now = performance.now();
    if (!force && (!this.dirty || now - this.lastSave < 2000)) return;
    this.dirty = false; this.lastSave = now;
    saveProfile(this.profile);
  },
  onDisconnect(msg) { endSession(); show('s-multi'); $('mp-status').textContent = msg; },
};
setSound(app.profile.settings.sound);

const cv = $('game');
const sticks = $('sticks');
const GFX = { ultra: 'Ultra (bloom, sky, 3D models)', high: '3D High', fast: '3D Fast', classic: 'Classic 2D' };
const CAMS = { street: 'Street level (behind the shoulder)', overhead: 'Overhead' };
const renderers = {};
// Picks the renderer for a graphics setting. 3D needs WebGL2; without it we fall back to 2D.
function useGfx(mode) {
  if (!GFX[mode]) mode = 'ultra';
  let r = null;
  if (mode !== 'classic') {
    try {
      // one WebGL renderer for the whole app; High/Fast just change its quality
      if (!renderers.gl) renderers.gl = new Renderer3D($('game3d'), cv, { quality: mode, camera: camMode() });
      r = renderers.gl;
      r.setQuality(mode);
      r.setCamera(camMode());
    } catch (e) {
      console.warn('3D graphics unavailable, using Classic 2D', e);
      mode = 'classic';
    }
  }
  if (!r) r = renderers.classic || (renderers.classic = new Renderer(cv));
  document.body.classList.toggle('gfx-3d', mode !== 'classic');
  document.body.classList.toggle('gfx-high', mode === 'high');
  document.body.classList.toggle('gfx-ultra', mode === 'ultra');
  app.renderer = r;
  app.gfx = mode;
  // Street level needs the 3D renderer; Classic 2D always plays from overhead.
  const street = r.kind === '3d' && camMode() === 'street';
  app.input.mode = street ? 'street' : 'overhead';
  document.body.classList.toggle('cam-street', street);
  $('help').innerHTML = street ? 'Left thumb: move &nbsp; Right thumb: look &nbsp; FIRE: shoot' : 'Left thumb: move &nbsp; Right thumb: aim + shoot';
  $('zone-aim').innerHTML = street ? 'FIRE<br><small>drag to aim</small>' : 'AIM';
  r.resize(app.viewRect);
  r.setMap(backdrop);
  return mode;
}

app.input = new Input($('touch'));
app.input.onPause = () => togglePause();
app.input.bindFire($('b-fire'));
app.input.bindFire($('pb-fire'));
app.input.bindFire($('zone-fire')); // lower screen's right ring: hold to fire, drag to aim (street level)
function camMode() { if (app.camOverride) return app.camOverride; return CAMS[app.profile.settings.camera] ? app.profile.settings.camera : 'street'; }

// Menu backdrop: the city, slowly panning.
const backdrop = makeCity(20260);
useGfx(app.profile.settings.gfx);
let pan = 0;

// ---------------- layout ----------------
// Dual screen: the game gets the top screen (or the left one when held sideways)
// and the touch panel takes the rest. Menus always use the full screen.
const LAYOUTS = { auto: 'Auto (two screens when upright)', dual: 'Two screens', full: 'Full screen' };
function applyLayout() {
  const W = window.innerWidth, H = window.innerHeight;
  const pref = LAYOUTS[app.profile.settings.layout] ? app.profile.settings.layout : 'auto';
  const portrait = H > W;
  const dual = !!app.session && !app.session.cinematic && (pref === 'dual' || (pref === 'auto' && portrait));
  const b = document.body;
  b.classList.toggle('dual', dual);
  b.classList.toggle('dual-v', dual && portrait);
  b.classList.toggle('dual-h', dual && !portrait);
  let rect = { x: 0, y: 0, w: W, h: H };
  if (dual && portrait) rect = { x: 0, y: 0, w: W, h: Math.round(Math.min(H * 0.55, W * 1.2)) };
  else if (dual) rect = { x: 0, y: 0, w: Math.round(W * 0.63), h: H };
  b.style.setProperty('--gw', rect.w + 'px');
  b.style.setProperty('--gh', rect.h + 'px');
  app.dual = dual;
  app.viewRect = rect;
  return rect;
}

// Radar on the lower screen: whole map, enemies, allies, objective.
function drawRadar(scene) {
  const c = $('p-radar'), r = app.renderer;
  if (!r.mini || !r.map) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const css = c.clientWidth || 150;
  if (c.width !== Math.round(css * dpr)) { c.width = Math.round(css * dpr); c.height = Math.round(css * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0f0d18'; g.fillRect(0, 0, css, css);
  const map = r.map, k = css / Math.max(map.w, map.h);
  const ox = (css - map.w * k) / 2, oy = (css - map.h * k) / 2;
  g.globalAlpha = 0.85; g.drawImage(r.mini, ox, oy, map.w * k, map.h * k); g.globalAlpha = 1;
  const dot = (x, y, col, s) => { g.fillStyle = col; g.fillRect(ox + (x / 32) * k - s / 2, oy + (y / 32) * k - s / 2, s, s); };
  const t = performance.now() / 1000;
  for (const e of scene.enemies) dot(e.x, e.y, e.boss ? '#ffd23f' : '#ff4f6d', e.boss ? 6 : 3);
  for (const n of scene.npcs) dot(n.x, n.y, '#ffe066', 5);
  for (const p of scene.pickups) if (p.kind === 'crate') dot(p.x, p.y, '#c99558', 5);
  for (const p of scene.players) if (p !== scene.me && !p.dead) dot(p.x, p.y, '#ffffff', 5);
  if (scene.questTarget) dot(scene.questTarget.x, scene.questTarget.y, Math.floor(t * 4) % 2 ? '#ffd23f' : '#ffffff', 6);
  if (scene.me) {
    dot(scene.me.x, scene.me.y, '#5bd8ff', 6);
    if (app.input.mode === 'street') { // facing line
      const mx = ox + (scene.me.x / 32) * k, my = oy + (scene.me.y / 32) * k, yaw = app.input.yaw;
      g.strokeStyle = '#5bd8ff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(yaw) * 12, my + Math.sin(yaw) * 12); g.stroke();
    }
  }
}

function resize() {
  app.renderer.resize(applyLayout());
  const dpr = app.renderer.dpr;
  sticks.width = Math.round(window.innerWidth * dpr); sticks.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// iOS needs a gesture before audio can play.
const unlockOnce = () => { unlock(); };
window.addEventListener('pointerdown', unlockOnce, { capture: true });
window.addEventListener('touchend', unlockOnce, { capture: true });

// ---------------- screens ----------------
let current = 's-title';
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  current = id;
  if (pending && id !== 's-multi') { pending.close(); pending = null; $('mp-go').disabled = false; $('mp-status').textContent = ''; }
  if (id === 's-menu') renderMenu();
  if (id === 's-shop') renderShop();
  if (id === 's-train') renderTrain();
  if (id === 's-set') renderSettings();
  if (id === 's-multi') renderMulti();
}
for (const b of document.querySelectorAll('.back')) tap(b, () => show('s-menu'));

function drawSprite(canvas, img, scale) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const w = img.width * scale, h = img.height * scale;
  g.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

// Title
(function titlePets() {
  const c = $('title-pets'), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  CREATURE_ORDER.forEach((t, i) => g.drawImage(petSprite(t, false, 0), 8 + i * 32, 8));
})();
$('t-start').textContent = app.profile.created ? 'Continue' : 'Press Start';
tap($('t-start'), () => {
  if (app.profile.created) show('s-menu');
  else { draft = structuredClone(app.profile); draft.name = ''; openCreator(); }
});

// Character creator
let draft = null;
let previewDir = 0;
function openCreator() {
  if (!draft) draft = structuredClone(app.profile);
  $('c-name').value = draft.name;
  const opts = $('c-opts');
  opts.innerHTML = '';
  const labels = { skin: 'Skin', hair: 'Hair', style: 'Style', hat: 'Hat', shirt: 'Shirt', pants: 'Pants' };
  for (const k of LOOK_KEYS) {
    const row = el('div', 'opt');
    row.appendChild(el('span', '', labels[k]));
    LOOK[k].forEach((v, i) => {
      const b = el('button', draft.look[k] === i ? 'on' : '', v.startsWith('#') ? '' : esc(v));
      if (v.startsWith('#')) b.style.background = v;
      b.setAttribute('aria-label', `${labels[k]} ${i + 1}`);
      tap(b, () => { draft.look[k] = i; for (const o of row.querySelectorAll('button')) o.classList.toggle('on', o === b); });
      row.appendChild(b);
    });
    opts.appendChild(row);
  }
  const pets = $('c-pets');
  pets.innerHTML = '';
  for (const t of CREATURE_ORDER) {
    const C = CREATURES[t];
    const b = el('button', draft.companion === t ? 'on' : '');
    const c = el('canvas'); c.width = 16; c.height = 16;
    drawSprite(c, petSprite(t, false, 0), 1);
    b.appendChild(c);
    b.appendChild(el('b', '', esc(C.name)));
    b.appendChild(el('small', '', `${esc(C.blurb)} Evolves at Lv ${EVOLVE_LEVEL}.`));
    tap(b, () => { draft.companion = t; for (const o of pets.querySelectorAll('button')) o.classList.toggle('on', o === b); });
    pets.appendChild(b);
  }
  $('c-back').classList.toggle('hidden', !app.profile.created);
  show('s-creator');
}
tap($('c-prev'), () => { previewDir = (previewDir + 1) % 4; });
tap($('c-back'), () => { draft = null; show('s-menu'); });
tap($('c-done'), () => {
  const name = $('c-name').value.replace(/[^\w \-]/g, '').trim().slice(0, 12);
  if (!name) { $('c-name').focus(); $('c-name').placeholder = 'Type a name!'; return; }
  Object.assign(app.profile, { name, look: draft.look, companion: draft.companion, created: true });
  draft = null;
  app.save(true);
  $('t-start').textContent = 'Continue';
  show('s-menu');
});

// Main menu
function renderMenu() {
  const p = app.profile;
  const box = $('m-prof');
  box.innerHTML = '';
  const c = el('canvas'); c.width = 16; c.height = 22;
  drawSprite(c, charSprite(p.look, 0, 0), 1);
  const pc = el('canvas'); pc.width = 22; pc.height = 22; pc.style.width = '44px'; pc.style.height = '44px';
  drawSprite(pc, petSprite(p.companion, p.level >= EVOLVE_LEVEL, 0), 1);
  const C = CREATURES[p.companion];
  const info = el('div', 'info', `<b>${esc(p.name)}</b><span>Lv ${p.level} &middot; ${p.coins} coins${p.points ? ` &middot; <span style="color:var(--gold)">${p.points} stat pts!</span>` : ''}</span>
    <div class="bar xp"><i style="width:${p.level >= MAX_LEVEL ? 100 : Math.round((p.xp / xpNeed(p.level)) * 100)}%"></i></div>
    <span class="small">Partner: ${esc(p.level >= EVOLVE_LEVEL ? C.evo : C.name)} &middot; Best wave ${p.best.wave} &middot; PvP wins ${p.best.pvpWins}</span>`);
  box.append(c, pc, info);
  $('m-train').querySelector('span').textContent = p.points ? `${p.points} points to spend!` : 'Spend stat points';
}
tap($('m-story'), () => startLocal());
tap($('m-show'), () => startShowcase());
tap($('sc-shuffle'), () => startShowcase());
tap($('sc-exit'), () => { endSession(); show('s-menu'); });

// "Surprise Me": a random seeded cinematic. Plays in Ultra at street level without
// changing the player's saved settings, then restores them on exit.
function startShowcase(seed = Math.floor(Math.random() * 1e9)) {
  if (app.session) endSession();
  app.camOverride = 'street';
  useGfx(app.gfx === 'classic' && app.profile.settings.gfx === 'classic' ? 'classic' : 'ultra');
  const g = new ShowcaseGame(app, seed);
  begin(g);
  app.input.enabled = false;
  $('hud').classList.add('hidden');
  $('showcase').classList.remove('hidden');
  $('sc-title').textContent = g.title;
  $('sc-seed').textContent = `Seed #${g.seed}`;
  const card = document.querySelector('.sc-card');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  return g;
}
tap($('m-multi'), () => show('s-multi'));
tap($('m-char'), () => { draft = structuredClone(app.profile); openCreator(); });
tap($('m-shop'), () => show('s-shop'));
tap($('m-train'), () => show('s-train'));
tap($('m-set'), () => show('s-set'));

// Shop
function renderShop() {
  const p = app.profile;
  $('sh-coins').textContent = `${p.coins} coins`;
  const list = $('sh-list');
  list.innerHTML = '';
  for (const w of WEAPON_ORDER) {
    const W = WEAPONS[w];
    const owned = p.weapons.includes(w);
    const c = canBuy(p, w);
    const stats = `DMG ${W.dmg}${W.pellets > 1 ? 'x' + W.pellets : ''} &middot; ${(1 / W.rate).toFixed(1)}/s${W.pierce ? ' &middot; pierces' : ''}${W.aoe ? ' &middot; splash' : ''}`;
    const b = el('button', 'item', `<span>${W.name}<span class="d">${stats}</span></span><span>${owned ? 'Owned' : c.why}</span>`);
    if (!c.ok) b.disabled = true;
    tap(b, () => { if (buy(p, w)) { sfx.pick(); app.save(true); renderShop(); } });
    list.appendChild(b);
  }
}

// Training
const STAT_INFO = { pow: ['Power', '+8% damage per point'], vit: ['Vitality', '+15 max HP per point'], agi: ['Agility', '+4% move speed per point'] };
function renderTrain() {
  const p = app.profile;
  $('tr-pts').textContent = `${p.points} point${p.points === 1 ? '' : 's'} to spend (earn 1 per level)`;
  const list = $('tr-list');
  list.innerHTML = '';
  for (const k of Object.keys(STAT_INFO)) {
    const [n, d] = STAT_INFO[k];
    const b = el('button', 'item', `<span>${n} ${p.stats[k]}/${STAT_MAX}<span class="d">${d}</span></span><span>+1</span>`);
    if (!p.points || p.stats[k] >= STAT_MAX) b.disabled = true;
    tap(b, () => { if (spendPoint(p, k)) { app.save(true); renderTrain(); } });
    list.appendChild(b);
  }
}

// Settings
function renderSettings() {
  $('st-sound').innerHTML = `<span>Sound</span><span>${app.profile.settings.sound ? 'ON' : 'OFF'}</span>`;
  const fell = app.profile.settings.gfx !== 'classic' && app.gfx === 'classic';
  const lay = LAYOUTS[app.profile.settings.layout] ? app.profile.settings.layout : 'auto';
  $('st-layout').innerHTML = `<span>Layout<span class="d">Two screens: game on top, touch panel below</span></span><span>${LAYOUTS[lay]}</span>`;
  $('st-gfx').innerHTML = `<span>Graphics<span class="d">${fell ? '3D is not supported on this device' : 'Lower it if the game feels slow'}</span></span><span>${GFX[app.gfx]}</span>`;
  const cam = app.gfx === 'classic' ? 'overhead' : camMode();
  $('st-cam').innerHTML = `<span>Camera<span class="d">${app.gfx === 'classic' ? 'Classic 2D plays from overhead' : 'Street level: drag the right side to look'}</span></span><span>${CAMS[cam]}</span>`;
}
tap($('st-cam'), () => {
  if (app.gfx === 'classic') return;
  app.profile.settings.camera = camMode() === 'street' ? 'overhead' : 'street';
  useGfx(app.gfx);
  app.save(true);
  renderSettings();
});
tap($('st-layout'), () => {
  const order = ['auto', 'dual', 'full'];
  const cur = LAYOUTS[app.profile.settings.layout] ? app.profile.settings.layout : 'auto';
  app.profile.settings.layout = order[(order.indexOf(cur) + 1) % order.length];
  app.save(true);
  renderSettings();
});
tap($('st-gfx'), () => {
  const order = ['ultra', 'high', 'fast', 'classic'];
  const next = order[(order.indexOf(app.gfx) + 1) % order.length];
  app.profile.settings.gfx = next;
  useGfx(next);
  app.save(true);
  renderSettings();
});
tap($('st-sound'), () => { app.profile.settings.sound = !app.profile.settings.sound; setSound(app.profile.settings.sound); app.save(true); renderSettings(); });
tap($('st-reset'), () => {
  if (!window.confirm('Delete your hero and all progress?')) return;
  resetProfile();
  app.profile = defaultProfile();
  $('t-start').textContent = 'Press Start';
  show('s-title');
});

// Multiplayer lobby
let mpMode = 'coop';
let pending = null;
function defaultServer() {
  const l = window.location;
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!native && (l.protocol === 'http:' || l.protocol === 'https:') && l.host) return `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/ws`;
  return '';
}
function renderMulti() {
  $('mp-server').value = app.profile.settings.server || defaultServer();
  for (const b of $('mp-mode').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mpMode);
}
for (const b of $('mp-mode').querySelectorAll('button')) tap(b, () => { mpMode = b.dataset.mode; renderMulti(); });
$('mp-room').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
tap($('mp-go'), () => {
  let url = $('mp-server').value.trim();
  if (url && !/^wss?:\/\//.test(url)) url = `ws://${url}`;
  if (url && !/\/ws$/.test(url)) url = url.replace(/\/$/, '') + '/ws';
  const room = $('mp-room').value;
  if (!url) { $('mp-status').textContent = 'Enter the server address first.'; return; }
  if (room && room.length !== 4) { $('mp-status').textContent = 'Room codes are 4 letters.'; return; }
  app.profile.settings.server = url === defaultServer() ? '' : url;
  app.save(true);
  $('mp-status').textContent = 'Connecting...';
  $('mp-go').disabled = true;
  const s = new NetGame(app, {
    url, mode: mpMode, room,
    onReady: (g) => { $('mp-go').disabled = false; $('mp-status').textContent = ''; begin(g); app.hud.toast(`Room ${g.room}: share this code with friends!`); },
    onFail: (msg) => { $('mp-go').disabled = false; $('mp-status').textContent = msg; },
  });
  pending = s;
});

// Pause
function togglePause() {
  const s = app.session;
  if (!s) return;
  if (current === 's-pause') { resume(); return; }
  if (s instanceof LocalGame) s.paused = true;
  app.input.reset();
  app.input.enabled = false;
  show('s-pause');
}
function resume() {
  for (const sc of document.querySelectorAll('.screen')) sc.classList.add('hidden');
  current = '';
  if (app.session instanceof LocalGame) app.session.paused = false;
  app.input.enabled = true;
}
tap($('b-pause'), togglePause);
tap($('p-resume'), resume);
tap($('p-quit'), () => { endSession(); show('s-menu'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { app.save(true); if (app.session && current !== 's-pause') togglePause(); }
});
window.addEventListener('pagehide', () => app.save(true));

// HUD buttons (pointerdown for instant response; stop the touch layer from seeing them)
const hold = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
hold('b-act', () => { app.input.act++; });
hold('b-wpn', () => { app.input.wpnReq = 'next'; });
hold('pb-act', () => { app.input.act++; });
$('pb-pause').addEventListener('click', () => { sfx.ui(); togglePause(); });

// ---------------- sessions ----------------
function begin(session) {
  pending = null;
  app.session = session;
  app.hud.clear();
  for (const sc of document.querySelectorAll('.screen')) sc.classList.add('hidden');
  current = '';
  $('hud').classList.remove('hidden');
  app.input.reset();
  app.input.enabled = true;
  helpT = 8;
  $('help').classList.remove('hidden');
  resize(); // switch to the dual-screen layout if it applies
}
function startLocal() {
  const g = new LocalGame(app);
  begin(g);
  if (app.profile.questNum === 0) app.hud.dialog('Mayor Pix', `Welcome to Monstreets, ${app.profile.name}! Glitches are taking over the city. Walk up to me and press A for your first job.`);
}
function endSession() {
  const wasShow = app.session && app.session.cinematic;
  if (app.session) app.session.close();
  $('showcase').classList.add('hidden');
  if (wasShow) { app.camOverride = null; useGfx(app.profile.settings.gfx); }
  if (pending) { pending.close(); pending = null; }
  app.session = null;
  app.input.enabled = false;
  app.input.reset();
  $('hud').classList.add('hidden');
  app.hud.clear();
  app.save(true);
  resize(); // menus use the full screen
  app.renderer.setMap(backdrop);
}

// ---------------- loop ----------------
let last = performance.now();
let helpT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!app.manual) tick(dt, now);
  requestAnimationFrame(frame);
}
// Recording hook: pause the real-time loop and advance exactly dt per call,
// so a slow machine still produces a smooth fixed-rate video.
let manualClock = 0;
app.stepFrame = (dt) => { app.manual = true; manualClock += dt * 1000; tick(dt, manualClock); };
function tick(dt, now) {
  const s = app.session;
  const r = app.renderer;
  if (s) {
    s.update(dt);
    const sc = s.scene();
    if (app.dual) sc.showMini = false; // the radar lives on the lower screen
    r.draw(sc, dt);
    if (app.dual) drawRadar(sc);
    app.hud.update(dt, app.profile, s.hudState());
    app.save(false);
    if (helpT > 0 && (helpT -= dt) <= 0) $('help').classList.add('hidden');
  } else {
    pan += dt;
    const cx = (backdrop.w * 32) / 2 + Math.cos(pan * 0.05) * 500, cy = (backdrop.h * 32) / 2 + Math.sin(pan * 0.07) * 400;
    r.cam.x = cx; r.cam.y = cy;
    r.draw({ me: null, players: [], enemies: [], bullets: [], pickups: [], cars: backdrop.cars.map((c, i) => ({ ...c, id: i })), npcs: backdrop.npcs }, dt);
    if (current === 's-creator' && draft) {
      const prev = $('c-prev'), pet = $('c-pet');
      if (r.kind === '3d') { // realistic 3D preview of the actual model
        const hi = 2;
        if (prev.width !== 120 * hi) { prev.width = 120 * hi; prev.height = 150 * hi; pet.width = 88 * hi; pet.height = 88 * hi; prev.style.imageRendering = pet.style.imageRendering = 'auto'; }
        const lk = { ...draft.look };
        r.renderPortrait(prev, 'human', JSON.stringify(lk), () => buildCharacter(lk), now / 1000);
        if (pet.offsetWidth) r.renderPortrait(pet, 'pet', draft.companion, () => buildCreature(draft.companion, false), now / 1000);
      } else {
        if (prev.width !== 120) { prev.width = 120; prev.height = 150; pet.width = 88; pet.height = 88; prev.style.imageRendering = pet.style.imageRendering = ''; }
        drawSprite(prev, charSprite(draft.look, previewDir, Math.floor(now / 160) % 3), 6);
        drawSprite(pet, petSprite(draft.companion, false, Math.floor(now / 330) % 2), 4);
      }
    }
  }
  const g = sticks.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, sticks.width, sticks.height);
  if (s && app.input.enabled) { g.setTransform(r.dpr, 0, 0, r.dpr, 0, 0); app.input.draw(g); }
}
requestAnimationFrame(frame);

// Exposed for automated tests only.
window.__monstreets = app;
app.startShowcase = startShowcase;
