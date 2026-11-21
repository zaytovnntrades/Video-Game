// Player input: touch (virtual stick + buttons), keyboard and gamepad, merged into
// the sim's input struct. Touch buttons are DOM elements so they're easy to restyle.
import { blankInput } from '../sim/fight.js';

const KEYS = {
  KeyW: ['my', 1], ArrowUp: ['my', 1], KeyS: ['my', -1], ArrowDown: ['my', -1], KeyA: ['mx', -1], ArrowLeft: ['mx', -1], KeyD: ['mx', 1], ArrowRight: ['mx', 1],
  KeyJ: 'atk', KeyK: 'blast', KeyL: 'guard', ShiftLeft: 'dash', ShiftRight: 'dash', Space: 'jump', KeyU: 'special', KeyI: 'special',
};

export class Input {
  constructor(root) {
    this.root = root;
    this.keys = new Set();
    this.touch = blankInput();
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.enabled = false;
    addEventListener('keydown', (e) => { if (KEYS[e.code] && this.enabled) { this.keys.add(e.code); e.preventDefault(); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touch = blankInput(); this.stick.id = null; });
    this.buildTouch();
  }

  buildTouch() {
    const el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `
      <div class="stickzone"><div class="stickbase"><div class="stickknob"></div></div></div>
      <div class="btns">
        <button data-k="special" class="b-special">ASCEND</button>
        <button data-k="guard" class="b-guard">GUARD</button>
        <button data-k="blast" class="b-blast">BLAST</button>
        <button data-k="jump" class="b-jump">JUMP</button>
        <button data-k="atk" class="b-atk">ATTACK</button>
        <button data-k="dash" class="b-dash">DASH</button>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.special = el.querySelector('.b-special');
    const zone = el.querySelector('.stickzone'), base = el.querySelector('.stickbase'), knob = el.querySelector('.stickknob');
    const R = 52;
    const setKnob = () => { knob.style.transform = `translate(${this.stick.x * R}px, ${-this.stick.y * R}px)`; };
    zone.addEventListener('pointerdown', (e) => {
      this.stick.id = e.pointerId; zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      this.stick.ox = e.clientX; this.stick.oy = e.clientY;
      base.style.left = `${e.clientX - r.left}px`; base.style.top = `${e.clientY - r.top}px`; base.classList.add('on');
      this.stick.x = this.stick.y = 0; setKnob();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let x = (e.clientX - this.stick.ox) / R, y = -(e.clientY - this.stick.oy) / R;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.stick.x = x; this.stick.y = y; setKnob();
    });
    const end = (e) => { if (e.pointerId !== this.stick.id) return; this.stick.id = null; this.stick.x = this.stick.y = 0; setKnob(); base.classList.remove('on'); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    for (const b of el.querySelectorAll('button')) {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); this.touch[k] = true; b.classList.add('down'); b.setPointerCapture?.(e.pointerId); navigator.vibrate?.(8); };
      const off = (e) => { e.preventDefault(); this.touch[k] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  show(on) { this.el.style.display = on ? '' : 'none'; this.enabled = on; if (!on) { this.keys.clear(); this.touch = blankInput(); } }

  setSpecial(label, ready) { if (this.special.textContent !== label) this.special.textContent = label; this.special.classList.toggle('ready', ready); }

  read() {
    const inp = blankInput();
    if (!this.enabled) return inp;
    for (const k of Object.keys(this.touch)) if (this.touch[k] === true) inp[k] = true;
    inp.mx = this.stick.x; inp.my = this.stick.y;
    for (const code of this.keys) {
      const m = KEYS[code];
      if (Array.isArray(m)) inp[m[0]] = Math.max(-1, Math.min(1, inp[m[0]] + m[1]));
      else if (m) inp[m] = true;
    }
    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.2) { inp.mx = ax; inp.my = -ay; }
      const b = (i) => p.buttons[i]?.pressed;
      if (b(2)) inp.atk = true; if (b(3)) inp.blast = true; if (b(0)) inp.jump = true; if (b(1)) inp.dash = true;
      if (b(4) || b(6)) inp.guard = true; if (b(5) || b(7)) inp.special = true;
      if (b(12)) inp.my = 1; if (b(13)) inp.my = -1; if (b(14)) inp.mx = -1; if (b(15)) inp.mx = 1;
    }
    const l = Math.hypot(inp.mx, inp.my); if (l > 1) { inp.mx /= l; inp.my /= l; }
    return inp;
  }
}
