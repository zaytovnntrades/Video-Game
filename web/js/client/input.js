// Twin-stick touch controls (iPhone/iPad) plus keyboard + mouse for desktop.
// Left half of the screen: floating move stick. Right half: floating aim
// stick that fires while held. Buttons are separate DOM elements.
const R = 56; // stick radius in CSS px

export class Input {
  constructor(layer) {
    this.layer = layer;
    this.move = null; // { id, ox, oy, x, y }
    this.aim = null;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, used: false };
    this.ang = 0;
    this.act = 0;
    this.wpnReq = null;
    this.enabled = false;
    this.onPause = null;

    const local = (e) => { const r = layer.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
    layer.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') { this.mouse.down = e.button === 0; this.mouse.used = true; return; }
      const p = local(e);
      const stick = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
      if (p.x < p.w / 2) { if (!this.move) this.move = stick; } else if (!this.aim) this.aim = stick;
      try { layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (e.pointerType === 'mouse') { this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.used = true; return; }
      for (const s of [this.move, this.aim]) {
        if (!s || s.id !== e.pointerId) continue;
        s.x = p.x; s.y = p.y;
        // let the stick base follow the finger if it goes too far
        const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
        if (d > R * 1.4) { s.ox = s.x - (dx / d) * R * 1.4; s.oy = s.y - (dy / d) * R * 1.4; }
      }
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) this.mouse.down = false; return; }
      if (this.move && this.move.id === e.pointerId) this.move = null;
      if (this.aim && this.aim.id === e.pointerId) this.aim = null;
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
    layer.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') { if (this.onPause) this.onPause(); return; }
      if (!this.enabled) return;
      if (k === 'e' || k === 'f' || k === 'enter') { if (!e.repeat) this.act++; }
      else if (k === 'q') this.wpnReq = 'next';
      else if (k >= '1' && k <= '5') this.wpnReq = Number(k) - 1;
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.reset());
  }

  reset() {
    this.move = null; this.aim = null; this.keys.clear(); this.mouse.down = false;
  }

  stickVec(s) {
    if (!s) return { x: 0, y: 0, m: 0 };
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
    const m = Math.min(1, d / R);
    return d < 1 ? { x: 0, y: 0, m: 0 } : { x: (dx / d) * m, y: (dy / d) * m, m };
  }

  // r: the active renderer (maps screen points to the ground); me: local player or null.
  // Sticks are in screen space; on a tilted 3D camera the screen's vertical axis is
  // foreshortened, so r.aimYScale stretches it back to match what the player sees.
  read(r, me) {
    const K = this.keys;
    let mx = 0, my = 0;
    if (K.has('a') || K.has('arrowleft')) mx -= 1;
    if (K.has('d') || K.has('arrowright')) mx += 1;
    if (K.has('w') || K.has('arrowup')) my -= 1;
    if (K.has('s') || K.has('arrowdown')) my += 1;
    const k = (r && r.aimYScale) || 1;
    const mv = this.stickVec(this.move);
    if (mv.m > 0.12) {
      const ux = mv.x, uy = mv.y * k, ul = Math.hypot(ux, uy) || 1;
      mx = (ux / ul) * mv.m; my = (uy / ul) * mv.m;
    }
    const av = this.stickVec(this.aim);
    let fire = false;
    if (av.m > 0.25) { this.ang = Math.atan2(av.y * k, av.x); fire = true; }
    else if (this.mouse.used && r && me) {
      const w = r.screenToWorld(this.mouse.x, this.mouse.y);
      if (w) this.ang = Math.atan2(w.y - me.y, w.x - me.x);
      fire = this.mouse.down || K.has(' ');
    } else if (Math.hypot(mx, my) > 0.2) {
      this.ang = Math.atan2(my, mx);
      fire = K.has(' ');
    } else fire = K.has(' ');
    return { mx, my, ang: this.ang, fire };
  }

  // Draws the floating sticks (called with a CSS-pixel transform).
  draw(g) {
    for (const s of [this.move, this.aim]) {
      if (!s) continue;
      const v = this.stickVec(s);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
      g.beginPath(); g.arc(s.ox, s.oy, R, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = s === this.aim ? 'rgba(255,110,110,0.65)' : 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(s.ox + v.x * R, s.oy + v.y * R, 24, 0, Math.PI * 2); g.fill();
    }
  }
}
