// Touch controls (iPhone/iPad) plus keyboard + mouse for desktop. Two styles:
//  - overhead: left half = floating move stick, right half = floating aim stick
//    that fires while held (twin-stick).
//  - street (third-person camera behind the hero): left half = move stick
//    relative to the camera, right half = drag to turn the camera, FIRE button
//    shoots (a drag that starts on FIRE also turns the camera).
// Buttons are separate DOM elements.
const R = 56; // stick radius in CSS px
const LOOK_SPEED = 0.0095; // radians per CSS px of thumb drag
const MOUSE_SPEED = 0.0028; // radians per px of locked mouse movement

export function wrapAngle(a) {
  a = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a;
}

export class Input {
  constructor(layer) {
    this.layer = layer;
    this.mode = 'overhead';
    this.move = null; // { id, ox, oy, x, y }
    this.aim = null;
    this.look = null; // { id, x } finger turning the camera (street mode)
    this.fireHeld = new Set(); // pointer ids holding a FIRE button
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, used: false };
    this.ang = 0;
    this.yaw = 0; // camera heading in street mode (world angle the camera looks along)
    this.act = 0;
    this.wpnReq = null;
    this.enabled = false;
    this.onPause = null;
    this.lastRead = 0;

    const local = (e) => { const r = layer.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
    layer.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        this.mouse.down = e.button === 0; this.mouse.used = true;
        // desktop street mode: lock the mouse so moving it turns the camera
        if (this.mode === 'street' && document.pointerLockElement !== layer && layer.requestPointerLock) {
          try { const p = layer.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* not supported: drag to look instead */ }
        }
        return;
      }
      const p = local(e);
      if (p.x < p.w / 2) { if (!this.move) this.move = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y }; }
      else if (this.mode === 'street') { if (!this.look) this.look = { id: e.pointerId, x: p.x }; }
      else if (!this.aim) this.aim = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
      try { layer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (e.pointerType === 'mouse') {
        this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.used = true;
        if (this.mode === 'street' && this.enabled) {
          if (document.pointerLockElement === layer) this.turn(e.movementX * MOUSE_SPEED);
          else if (e.buttons & 2) this.turn(e.movementX * LOOK_SPEED * 0.5); // right-drag fallback
        }
        return;
      }
      for (const s of [this.move, this.aim]) {
        if (!s || s.id !== e.pointerId) continue;
        s.x = p.x; s.y = p.y;
        // let the stick base follow the finger if it goes too far
        const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
        if (d > R * 1.4) { s.ox = s.x - (dx / d) * R * 1.4; s.oy = s.y - (dy / d) * R * 1.4; }
      }
      if (this.look && this.look.id === e.pointerId) { this.turn((p.x - this.look.x) * LOOK_SPEED); this.look.x = p.x; }
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) this.mouse.down = false; return; }
      if (this.move && this.move.id === e.pointerId) this.move = null;
      if (this.aim && this.aim.id === e.pointerId) this.aim = null;
      if (this.look && this.look.id === e.pointerId) this.look = null;
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

  // A FIRE button (street mode). Holding it shoots; dragging from it turns the camera.
  bindFire(btn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this.enabled) return;
      this.fireHeld.add(e.pointerId);
      if (!this.look) this.look = { id: e.pointerId, x: e.clientX };
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    btn.addEventListener('pointermove', (e) => {
      if (this.look && this.look.id === e.pointerId) { this.turn((e.clientX - this.look.x) * LOOK_SPEED); this.look.x = e.clientX; }
    });
    const up = (e) => {
      this.fireHeld.delete(e.pointerId);
      if (this.look && this.look.id === e.pointerId) this.look = null;
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }

  turn(d) { if (Number.isFinite(d)) this.yaw = wrapAngle(this.yaw + d); }

  // Eases the camera toward a heading (used while driving so the camera follows the car).
  followYaw(target, dt, rate = 4) {
    this.yaw = wrapAngle(this.yaw + wrapAngle(target - this.yaw) * Math.min(1, dt * rate));
  }

  reset() {
    this.move = null; this.aim = null; this.look = null; this.fireHeld.clear(); this.keys.clear(); this.mouse.down = false;
  }

  stickVec(s) {
    if (!s) return { x: 0, y: 0, m: 0 };
    const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
    const m = Math.min(1, d / R);
    return d < 1 ? { x: 0, y: 0, m: 0 } : { x: (dx / d) * m, y: (dy / d) * m, m };
  }

  // r: the active renderer (maps screen points to the ground); me: local player or null.
  read(r, me) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastRead || now)) / 1000);
    this.lastRead = now;
    return this.mode === 'street' ? this.readStreet(dt) : this.readOverhead(r, me);
  }

  // Third-person: movement is relative to where the camera looks; the hero faces the camera.
  readStreet(dt) {
    const K = this.keys;
    let fwd = 0, side = 0;
    if (K.has('w') || K.has('arrowup')) fwd += 1;
    if (K.has('s') || K.has('arrowdown')) fwd -= 1;
    if (K.has('d')) side += 1;
    if (K.has('a')) side -= 1;
    if (K.has('arrowleft')) this.turn(-2.6 * dt);
    if (K.has('arrowright')) this.turn(2.6 * dt);
    const mv = this.stickVec(this.move);
    if (mv.m > 0.12) { fwd = -mv.y; side = mv.x; }
    const m = Math.hypot(fwd, side);
    if (m > 1) { fwd /= m; side /= m; }
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // forward = (cos, sin); right of forward on a y-down map = (-sin, cos)
    const mx = c * fwd - s * side, my = s * fwd + c * side;
    this.ang = this.yaw;
    const fire = this.fireHeld.size > 0 || this.mouse.down || K.has(' ');
    return { mx, my, ang: this.yaw, fire };
  }

  // Twin-stick. Sticks are in screen space; on a tilted 3D camera the screen's vertical
  // axis is foreshortened, so r.aimYScale stretches it back to match what the player sees.
  readOverhead(r, me) {
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
      const w = r.screenToWorld(this.mouse.x - (r.ox || 0), this.mouse.y - (r.oy || 0));
      if (w) this.ang = Math.atan2(w.y - me.y, w.x - me.x);
      fire = this.mouse.down || K.has(' ');
    } else if (Math.hypot(mx, my) > 0.2) {
      this.ang = Math.atan2(my, mx);
      fire = K.has(' ');
    } else fire = K.has(' ');
    return { mx, my, ang: wrapAngle(this.ang), fire };
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
