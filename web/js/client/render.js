// Draws a "scene" (plain lists of things to draw) to the game canvas.
// Single player builds the scene from the local World; multiplayer builds it
// from interpolated server snapshots. The renderer does not care which.
import { TILE } from '../shared/data.js';
import { charSprite, petSprite, enemySprite, carSprite, pickupSprite, renderGround, renderMini } from './art.js';

const GROUND_CACHE = new Map();

const BULLET_STYLE = {
  pistol: ['#fff3a0', 3], uzi: ['#ffe066', 2.5], shotgun: ['#ffcf70', 2.5], rifle: ['#ffffff', 3], rocket: ['#ff7a3a', 5],
  fire: ['#ff8a2a', 4], water: ['#6cc8ff', 4], grass: ['#7ee06a', 4], spit: ['#a6e22e', 4.5],
};

function facing(ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  if (Math.abs(c) > Math.abs(s)) return c > 0 ? 2 : 1;
  return s > 0 ? 0 : 3;
}

export class Renderer {
  constructor(cv) {
    this.cv = cv;
    this.g = cv.getContext('2d');
    this.cam = { x: 0, y: 0 };
    this.parts = [];
    this.texts = [];
    this.shake = 0;
    this.time = 0;
    this.kind = 'classic';
    this.aimYScale = 1;
    this.resize();
  }

  // rect: where the game view sits on the page (CSS px). Full window unless the
  // dual-screen layout gives the game only the top (or left) screen.
  resize(rect) {
    rect = rect || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    this.ox = rect.x; this.oy = rect.y;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = rect.w, h = rect.h;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    Object.assign(this.cv.style, { left: rect.x + 'px', top: rect.y + 'px', width: w + 'px', height: h + 'px' });
    this.dpr = dpr;
    // Show about 8.5 tiles vertically (more on tall/portrait screens).
    const tiles = h > w ? 12 : 8.5;
    this.scale = Math.max(1, (h * dpr) / (TILE * tiles));
  }

  setMap(map) {
    this.map = map;
    const key = `${map.kind}:${map.seed}`;
    let c = GROUND_CACHE.get(key);
    if (!c) {
      c = { ground: renderGround(map), mini: renderMini(map) };
      GROUND_CACHE.set(key, c);
      // keep memory low on iOS: at most the city and one arena
      if (GROUND_CACHE.size > 2) GROUND_CACHE.delete(GROUND_CACHE.keys().next().value); // oldest; never the one just added
    }
    this.ground = c.ground;
    this.mini = c.mini;
    this.parts = [];
    this.texts = [];
  }

  snapCamera(x, y) { this.cam.x = x; this.cam.y = y; }

  // World point under a screen (CSS pixel) position.
  screenToWorld(sx, sy) {
    return { x: (sx * this.dpr - this.cv.width / 2) / this.scale + this.cam.x, y: (sy * this.dpr - this.cv.height / 2) / this.scale + this.cam.y };
  }

  // Screen (CSS pixel) position of a world point.
  toScreen(x, y) {
    return { x: ((x - this.cam.x) * this.scale + this.cv.width / 2) / this.dpr, y: ((y - this.cam.y) * this.scale + this.cv.height / 2) / this.dpr };
  }

  // ---------- effects ----------
  burst(x, y, color, n, speed = 120, life = 0.4, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size });
    }
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
  }
  floatText(x, y, text, color = '#fff', big = false) {
    this.texts.push({ x, y, text, color, life: big ? 1.4 : 0.8, max: big ? 1.4 : 0.8, big });
    if (this.texts.length > 80) this.texts.shift();
  }

  effect(e, meId) {
    switch (e.t) {
      case 'hit': this.burst(e.x, e.y, '#ffffff', 4, 90, 0.25, 2); this.floatText(e.x, e.y - 14, String(e.d), '#ffe066'); break;
      case 'die': this.burst(e.x, e.y, e.boss ? '#ffd23f' : '#b48cff', e.boss ? 40 : 14, e.boss ? 220 : 140, 0.6, 4); if (e.boss) this.shake = 0.5; break;
      case 'boom': this.burst(e.x, e.y, '#ff9a3a', 30, 260, 0.5, 5); this.burst(e.x, e.y, '#fff2a0', 14, 120, 0.3, 4); this.parts.push({ ring: true, x: e.x, y: e.y, r: e.r, life: 0.3, max: 0.3 }); this.shake = Math.max(this.shake, 0.3); break;
      case 'spark': this.burst(e.x, e.y, '#ffe9a0', 3, 70, 0.15, 2); break;
      case 'hurt': this.burst(e.x, e.y, '#ff4f6d', 6, 100, 0.3, 3); if (e.pid === meId) this.shake = Math.max(this.shake, 0.15); break;
      case 'pdie': this.burst(e.x, e.y, '#ffffff', 24, 180, 0.7, 4); break;
      case 'pick': this.burst(e.x, e.y, e.k === 'health' ? '#ff6b8b' : e.k === 'ammo' ? '#ffd23f' : '#c99558', 10, 90, 0.4, 3); this.floatText(e.x, e.y - 16, e.k === 'health' ? '+HP' : e.k === 'ammo' ? '+AMMO' : '+CRATE', '#ffffff'); break;
      case 'spawn': this.burst(e.x, e.y, '#7c4dff', 10, 60, 0.5, 3); break;
      case 'shot': this.parts.push({ flash: true, x: e.x, y: e.y, life: 0.05, max: 0.05 }); break;
      default:
    }
  }

  // ---------- main draw ----------
  draw(scene, dt) {
    this.time += dt;
    const { g, cv, scale } = this;
    const me = scene.me;
    if (me) {
      const k = Math.min(1, dt * 8);
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - this.cam.y) * k;
    }
    const halfW = cv.width / 2 / scale, halfH = cv.height / 2 / scale;
    const mw = this.map.w * TILE, mh = this.map.h * TILE;
    let cx = mw < halfW * 2 ? mw / 2 : Math.max(halfW, Math.min(mw - halfW, this.cam.x));
    let cy = mh < halfH * 2 ? mh / 2 : Math.max(halfH, Math.min(mh - halfH, this.cam.y));
    this.cam.x = cx; this.cam.y = cy;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      cx += (Math.random() - 0.5) * 10 * this.shake; cy += (Math.random() - 0.5) * 10 * this.shake;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = this.map.kind === 'arena' ? '#211d33' : '#2f6f3a';
    g.fillRect(0, 0, cv.width, cv.height);
    g.setTransform(scale, 0, 0, scale, cv.width / 2 - cx * scale, cv.height / 2 - cy * scale);
    // ground (only the visible part)
    const sx = Math.max(0, Math.floor(cx - halfW - 2)), sy = Math.max(0, Math.floor(cy - halfH - 2));
    const sw = Math.min(mw - sx, Math.ceil(halfW * 2 + 4)), sh = Math.min(mh - sy, Math.ceil(halfH * 2 + 4));
    if (sw > 0 && sh > 0) g.drawImage(this.ground, sx, sy, sw, sh, sx, sy, sw, sh);

    const view = { x0: cx - halfW - 40, x1: cx + halfW + 40, y0: cy - halfH - 40, y1: cy + halfH + 40 };
    const vis = (o) => o.x > view.x0 && o.x < view.x1 && o.y > view.y0 && o.y < view.y1;

    // quest destination marker
    if (scene.questDest) {
      const d = scene.questDest, p = 0.6 + 0.4 * Math.sin(this.time * 5);
      g.strokeStyle = `rgba(255,210,63,${p})`; g.lineWidth = 3;
      g.beginPath(); g.arc(d.x, d.y, 26, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,210,63,0.18)'; g.fill();
    }

    // pickups
    for (const k of scene.pickups) {
      if (!vis(k)) continue;
      const bob = Math.sin(this.time * 4 + k.id) * 2;
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(k.x - 6, k.y + 6, 12, 3);
      g.drawImage(pickupSprite(k.kind), k.x - 7, k.y - 9 + bob);
    }

    // y-sorted actors
    const list = [];
    for (const c of scene.cars) if (vis(c)) list.push({ y: c.y, f: () => this.drawCar(c) });
    for (const n of scene.npcs) if (vis(n)) list.push({ y: n.y, f: () => this.drawPerson(n, n.ang ?? Math.PI / 2, false, 1, true) });
    for (const e of scene.enemies) if (vis(e)) list.push({ y: e.y, f: () => this.drawEnemy(e) });
    for (const p of scene.players) {
      if (p.dead) continue;
      if (p.pet && vis(p.pet)) list.push({ y: p.pet.y, f: () => this.drawPet(p) });
      if (!p.car && vis(p)) list.push({ y: p.y, f: () => this.drawPlayer(p, p === me, scene) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.f();

    // bullets
    for (const b of scene.bullets) {
      if (!vis(b)) continue;
      const [col, r] = BULLET_STYLE[b.kind] || BULLET_STYLE.pistol;
      g.fillStyle = col;
      g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.fill();
      if (b.kind === 'rocket') this.parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#9a9a9a', size: 3 });
    }

    // particles
    for (const p of this.parts) {
      p.life -= dt;
      const a = Math.max(0, p.life / p.max);
      if (p.ring) {
        g.strokeStyle = `rgba(255,200,90,${a})`; g.lineWidth = 3;
        g.beginPath(); g.arc(p.x, p.y, p.r * (1.2 - a * 0.6), 0, Math.PI * 2); g.stroke();
      } else if (p.flash) {
        g.fillStyle = 'rgba(255,240,170,0.9)';
        g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.fill();
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
        g.globalAlpha = a; g.fillStyle = p.color; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); g.globalAlpha = 1;
      }
    }
    this.parts = this.parts.filter((p) => p.life > 0);

    // floating text
    g.textAlign = 'center';
    for (const t of this.texts) {
      t.life -= dt;
      const a = Math.max(0, t.life / t.max);
      g.globalAlpha = Math.min(1, a * 2);
      g.font = `bold ${t.big ? 16 : 10}px "Press Start 2P", monospace`;
      g.fillStyle = '#1d1a2b'; g.fillText(t.text, t.x + 1, t.y - (1 - a) * 18 + 1);
      g.fillStyle = t.color; g.fillText(t.text, t.x, t.y - (1 - a) * 18);
      g.globalAlpha = 1;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    // screen-space overlays
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (scene.questTarget && me) this.drawArrow(scene.questTarget, me);
    if (scene.showMini && me) this.drawMini(scene, me);
    if (me && me.hurtFlash > 0) {
      g.fillStyle = `rgba(255,40,60,${me.hurtFlash * 0.35})`;
      g.fillRect(0, 0, cv.width / this.dpr, cv.height / this.dpr);
    }
  }

  drawShadow(x, y, w) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.ellipse(x, y, w, w * 0.4, 0, 0, Math.PI * 2); g.fill();
  }

  drawPerson(p, ang, moving, alpha, npc) {
    const g = this.g;
    const dir = facing(ang);
    const fr = moving ? [1, 0, 2, 0][Math.floor(this.time * 8 + (p.id || 0)) % 4] : 0;
    this.drawShadow(p.x, p.y + 9, 7);
    g.globalAlpha = alpha;
    g.drawImage(charSprite(p.look, dir, fr), Math.round(p.x - 8), Math.round(p.y - 13));
    g.globalAlpha = 1;
    if (npc) {
      const bob = Math.sin(this.time * 3) * 2;
      g.fillStyle = '#ffd23f';
      g.font = 'bold 12px "Press Start 2P", monospace'; g.textAlign = 'center';
      g.fillStyle = '#1d1a2b'; g.fillText('!', p.x + 1, p.y - 18 + bob + 1);
      g.fillStyle = '#ffd23f'; g.fillText('!', p.x, p.y - 18 + bob);
      this.label(p.name, p.x, p.y - 32, '#ffe9a0');
    }
  }

  drawPlayer(p, isMe, scene) {
    const g = this.g;
    const dir = facing(p.ang);
    const gun = () => {
      g.save();
      g.translate(p.x, p.y + 2);
      g.rotate(p.ang);
      const len = p.wpn === 'rocket' ? 13 : p.wpn === 'shotgun' || p.wpn === 'rifle' ? 12 : 8;
      g.fillStyle = '#1d1a2b'; g.fillRect(3, -2.5, len + 1, 5);
      g.fillStyle = p.wpn === 'rocket' ? '#5a8a4a' : '#555b66'; g.fillRect(4, -1.5, len, 3);
      g.restore();
    };
    if (dir === 3) gun();
    this.drawPerson(p, p.ang, p.moving, p.hurtFlash > 0 && Math.floor(this.time * 20) % 2 ? 0.5 : 1, false);
    if (dir !== 3) gun();
    if (!isMe || scene.multi) {
      this.label(`${p.name} ${scene.pvp ? '' : 'Lv' + p.level}`.trim(), p.x, p.y - 22, isMe ? '#9fe8ff' : '#ffffff');
      if (!isMe) this.bar(p.x, p.y - 18, 22, p.hp / p.maxHp, '#5be37a');
    }
  }

  drawPet(p) {
    const g = this.g;
    const pet = p.pet;
    const s = petSprite(p.petType, p.evolved, Math.floor(this.time * 3) % 2);
    const flip = Math.cos(p.ang) < 0;
    this.drawShadow(pet.x, pet.y + s.height / 2 - 2, s.width / 3);
    g.save();
    g.translate(Math.round(pet.x), Math.round(pet.y));
    if (flip) g.scale(-1, 1);
    g.drawImage(s, -s.width / 2, -s.height / 2);
    g.restore();
  }

  drawEnemy(e) {
    const g = this.g;
    const s = enemySprite(e.type, Math.floor(this.time * 4 + e.id) % 2, e.boss);
    const k = e.boss ? 1.6 : 1;
    this.drawShadow(e.x, e.y + (s.height * k) / 2 - 3, (s.width * k) / 3);
    g.save();
    g.translate(Math.round(e.x), Math.round(e.y));
    if (Math.cos(e.ang) < 0) g.scale(-1, 1);
    g.drawImage(s, (-s.width * k) / 2, (-s.height * k) / 2, s.width * k, s.height * k);
    g.restore();
    if (e.hpPct < 100) this.bar(e.x, e.y - (s.height * k) / 2 - 5, e.boss ? 34 : 18, e.hpPct / 100, e.boss ? '#ffd23f' : '#ff5d6c');
  }

  drawCar(c) {
    const g = this.g;
    g.save();
    g.translate(c.x, c.y);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(2, 4, 16, 10, c.ang, 0, Math.PI * 2); g.fill();
    g.rotate(c.ang);
    g.drawImage(carSprite(c.color), -15, -9);
    g.restore();
    if (c.driver && c.driverName) this.label(c.driverName, c.x, c.y - 20, '#ffffff');
  }

  label(text, x, y, color) {
    const g = this.g;
    g.font = '7px "Press Start 2P", monospace'; g.textAlign = 'center';
    g.fillStyle = 'rgba(29,26,43,0.85)';
    const w = g.measureText(text).width;
    g.fillRect(x - w / 2 - 2, y - 7, w + 4, 9);
    g.fillStyle = color; g.fillText(text, x, y);
  }

  bar(x, y, w, f, color) {
    const g = this.g;
    g.fillStyle = '#1d1a2b'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle = '#4a4458'; g.fillRect(x - w / 2, y, w, 3);
    g.fillStyle = color; g.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, f)), 3);
  }

  // Arrow at the screen edge pointing toward an off-screen objective.
  drawArrow(t, me) {
    const g = this.g;
    const s = this.toScreen(t.x, t.y);
    const W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    if (s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) return;
    const c = this.toScreen(me.x, me.y);
    const a = Math.atan2(s.y - c.y, s.x - c.x);
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
    for (const k2 of scene.pickups) if (k2.kind === 'crate') dot(k2.x, k2.y, '#c99558', 4);
    if (scene.questTarget) dot(scene.questTarget.x, scene.questTarget.y, Math.floor(this.time * 4) % 2 ? '#ffd23f' : '#ffffff', 5);
    dot(me.x, me.y, '#5bd8ff', 4);
  }
}
