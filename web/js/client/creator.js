// Character creator: every part of the fighter spec is editable, with a live 3D preview.
import { OPTIONS, PALETTE, UNLOCKS, STAGE_NAMES, sanitizeSpec, defaultSpec, randomSpec } from '../sim/spec.js';
import { STYLES, BLASTS, BEAMS, RUSHES, APEXES } from '../sim/data.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const get = (o, path) => path.split('.').reduce((a, k) => a[k], o);
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

// Each tab is a list of controls: [kind, path, label, extra]
const TABS = {
  Body: [['slider', 'body.height', 'Height'], ['slider', 'body.build', 'Build'], ['slider', 'body.shoulders', 'Shoulders'], ['color', 'body.skin', 'Skin', 'skin']],
  Face: [['option', 'face.eyes', 'Eyes', 'eyes'], ['color', 'face.eyeColor', 'Eye colour', 'eye'], ['option', 'face.brows', 'Brows', 'brows'], ['option', 'face.marks', 'Marks', 'marks'], ['option', 'face.facialHair', 'Facial hair', 'facialHair'], ['option', 'face.ears', 'Ears', 'ears']],
  Hair: [['option', 'hair.style', 'Style', 'hairStyle'], ['color', 'hair.color', 'Colour', 'hair']],
  Creature: [
    ['option', 'creature.animalEars', 'Animal ears', 'animalEars'], ['option', 'creature.tail', 'Tail', 'tail'], ['color', 'creature.fur', 'Fur / feathers', 'fur'],
    ['option', 'creature.pattern', 'Skin pattern', 'pattern'], ['option', 'creature.snout', 'Snout', 'snout'],
    ['option', 'creature.horns', 'Horns', 'horns'], ['option', 'creature.fangs', 'Fangs', 'fangs'],
    ['option', 'creature.wings', 'Wings', 'wings'], ['option', 'creature.claws', 'Claws', 'claws'], ['color', 'creature.markColor', 'Pattern / wing colour', 'fur'],
  ],
  Outfit: [
    ['option', 'outfit.top', 'Top', 'top'], ['color', 'outfit.topColor', 'Top colour', 'cloth'], ['color', 'outfit.topAccent', 'Trim', 'cloth'],
    ['option', 'outfit.bottom', 'Bottom', 'bottom'], ['color', 'outfit.bottomColor', 'Bottom colour', 'cloth'], ['color', 'outfit.sash', 'Belt / sash', 'cloth'],
    ['option', 'outfit.feet', 'Feet', 'feet'], ['color', 'outfit.feetColor', 'Feet colour', 'cloth'],
    ['option', 'outfit.hands', 'Hands', 'hands'], ['color', 'outfit.handsColor', 'Hands colour', 'cloth'],
    ['option', 'outfit.accessory', 'Accessory', 'accessory'], ['color', 'outfit.accessoryColor', 'Accessory colour', 'cloth'],
  ],
  Aura: [['color', 'aura.color', 'Aura', 'aura']],
  Ascend: [1, 2, 3].flatMap((n) => [
    ['head', '', STAGE_NAMES[n]], ['color', `transforms.${n - 1}.hair`, 'Hair', 'hair'], ['color', `transforms.${n - 1}.aura`, 'Aura', 'aura'], ['color', `transforms.${n - 1}.eyes`, 'Eye glow', 'aura'],
  ]),
  Moves: [['cards', 'style', 'Fighting style', STYLES], ['cards', 'moves.blast', 'Blast', BLASTS], ['cards', 'moves.beam', 'Beam', BEAMS], ['cards', 'moves.rush', 'Rush special', RUSHES], ['cards', 'moves.apex', 'Apex finisher', APEXES]],
};
const PREVIEW = { Body: 'idle', Face: 'idle', Hair: 'idle', Creature: 'idle', Outfit: 'idle', Aura: 'charge', Ascend: 'charge', Moves: 'strike' };

export class Creator {
  constructor(app) {
    this.app = app;
    this.el = $('#creator');
    this.tab = 'Body';
    this.dirty = false;
    this.el.querySelector('.ctabs').innerHTML = Object.keys(TABS).map((t) => `<button data-tab="${t}">${t}</button>`).join('');
    this.el.querySelector('.ctabs').addEventListener('click', (e) => { const t = e.target.dataset.tab; if (t) { this.tab = t; this.app.preview.pose = PREVIEW[t]; if (t === 'Ascend' && !this.app.preview.stage) this.setStage(1); this.render(); } });
    $('#c-name').addEventListener('input', (e) => { this.spec.name = e.target.value; });
    $('#c-random').addEventListener('click', () => {
      const keep = this.spec.name; this.spec = randomSpec((Math.random() * 1e9) | 0, { creatures: 0.5 });
      for (const [k, lv] of Object.entries(UNLOCKS)) if (this.app.level() < lv) this.spec.creature[k] = 0; // only parts you've unlocked
      if (this.id) this.spec.name = keep; this.rebuild(); this.render();
    });
    $('#c-save').addEventListener('click', () => this.save());
    $('#c-cancel').addEventListener('click', () => this.app.show('fighters'));
    for (const b of this.el.querySelectorAll('[data-pose]')) b.addEventListener('click', () => { const p = b.dataset.pose; if (p === 'asc') this.setStage((this.app.preview.stage + 1) % 4); else this.app.preview.pose = p; this.app.preview.t = 0; });
    // drag the preview to turn the fighter, pinch/scroll to zoom
    const area = $('#c-drag');
    let drag = null;
    area.addEventListener('pointerdown', (e) => { drag = e.clientX; this.app.preview.spin = false; area.setPointerCapture(e.pointerId); });
    area.addEventListener('pointermove', (e) => { if (drag == null) return; this.app.preview.yaw += (e.clientX - drag) * 0.012; drag = e.clientX; });
    area.addEventListener('pointerup', () => { drag = null; });
    area.addEventListener('wheel', (e) => { const P = this.app.preview; P.zoom = Math.max(0.45, Math.min(1.3, (P.zoom || 1) * (1 + e.deltaY * 0.001))); }, { passive: true });
    $('#c-zoom').addEventListener('click', () => { const P = this.app.preview; P.zoom = (P.zoom || 1) > 0.7 ? 0.42 : 1; P.face = true; });
  }

  open(id) {
    this.id = id;
    const f = id && this.app.fighterById(id);
    this.spec = sanitizeSpec(f ? JSON.parse(JSON.stringify(f.spec)) : { ...defaultSpec(), name: 'New Fighter' });
    this.tab = 'Body';
    this.app.show('creator');
    const P = this.app.preview;
    P.pose = 'idle'; P.spin = true; P.zoom = 1; P.yaw = 0.5; this.setStage(0);
    this.rebuild();
    this.render();
  }

  rebuild() { this.app.setPreview(this.spec); this.pending = false; }
  setStage(n) { this.app.preview.stage = n; $('#c-stage').textContent = 'Stage: ' + STAGE_NAMES[n]; }
  change(path, v) {
    set(this.spec, path, v);
    this.spec = sanitizeSpec(this.spec);
    this.pending = true; // rebuilt on the next frame (sliders fire fast)
    this.dirty = true;
  }

  frame() {
    if (this.pending) this.rebuild();
    const P = this.app.preview;
    P.camX = innerWidth > innerHeight ? 0.55 * (P.zoom || 1) : 0;
    if ((P.zoom || 1) < 0.6) { this.app.camera.position.y = 1.55 * this.app.preview.model.scale; this.app.camera.lookAt(P.camX, 1.55 * this.app.preview.model.scale, 0); }
  }

  render() {
    $('#c-name').value = this.spec.name;
    for (const b of this.el.querySelectorAll('.ctabs button')) b.classList.toggle('sel', b.dataset.tab === this.tab);
    const body = this.el.querySelector('.cbody');
    body.innerHTML = TABS[this.tab].map(([kind, path, label, extra], i) => {
      const v = get(this.spec, path);
      if (kind === 'slider') return `<label class="crow"><span>${label}</span><input type="range" min="0" max="1" step="0.01" value="${v}" data-i="${i}"></label>`;
      if (kind === 'head') return `<h3>${esc(label)}</h3>`;
      if (kind === 'option') {
        const list = OPTIONS[extra], need = UNLOCKS[extra], locked = need && this.app.level() < need;
        if (locked) return `<div class="crow"><span>${label}<span class="lock">🔒 Lv ${need}</span></span><div class="opt locked"><b>${esc(list[v])}</b>${v ? `<button data-i="${i}" data-d="clear">Remove</button>` : ''}</div></div>`;
        return `<div class="crow"><span>${label}</span><div class="opt"><button data-i="${i}" data-d="-1">‹</button><b>${esc(list[v])}</b><button data-i="${i}" data-d="1">›</button></div></div>`;
      }
      if (kind === 'color') {
        const sw = PALETTE[extra].map((c) => `<button class="sw${c === v ? ' sel' : ''}" style="background:${c}" data-i="${i}" data-c="${c}" aria-label="${c}"></button>`).join('');
        return `<div class="crow col"><span>${label}</span><div class="sws">${sw}<label class="sw any" title="Any colour" style="background:${v}"><input type="color" value="${v}" data-i="${i}"></label></div></div>`;
      }
      if (kind === 'cards') {
        const cards = Object.entries(extra).map(([k, d]) => {
          const stats = path === 'style' ? `<small>Melee ${pct(d.melee)} · Blast ${pct(d.blast)} · Speed ${pct(d.speed)} · Health ${pct(d.hp)}</small>` : '';
          return `<button class="mcard${k === v ? ' sel' : ''}" data-i="${i}" data-k="${k}"><b>${esc(d.name)}</b><span>${esc(d.blurb)}</span>${stats}</button>`;
        }).join('');
        return `<div class="crow col"><span>${label}</span><div class="mcards">${cards}</div></div>`;
      }
      return '';
    }).join('');
    const ctrl = TABS[this.tab];
    for (const el of body.querySelectorAll('[data-i]')) {
      const [kind, path, , extra] = ctrl[+el.dataset.i];
      if (kind === 'slider') el.addEventListener('input', () => this.change(path, +el.value));
      else if (kind === 'option') el.addEventListener('click', () => { const n = OPTIONS[extra].length; this.change(path, el.dataset.d === 'clear' ? 0 : (get(this.spec, path) + +el.dataset.d + n) % n); this.app.sfx.play('ui'); this.render(); });
      else if (kind === 'color' && el.dataset.c) el.addEventListener('click', () => { this.change(path, el.dataset.c); this.render(); });
      else if (kind === 'color') el.addEventListener('input', () => { this.change(path, el.value); el.parentElement.style.background = el.value; });
      else if (kind === 'cards') el.addEventListener('click', () => { this.change(path, el.dataset.k); this.app.sfx.play('ui'); this.render(); });
    }
  }

  save() {
    this.spec = sanitizeSpec({ ...this.spec, name: $('#c-name').value });
    if (this.id) this.app.fighterById(this.id).spec = this.spec;
    else { this.id = 'f' + Date.now(); this.app.fighters.push({ id: this.id, spec: this.spec }); }
    this.app.saveFighters();
    this.app.pick.me = this.id;
    this.app.toast(`${this.spec.name} saved`);
    this.app.show('fighters');
  }
}
function pct(x) { return `${x >= 1 ? '+' : ''}${Math.round((x - 1) * 100)}%`; }
