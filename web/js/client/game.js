// Game sessions. LocalGame runs the World in the browser (single player).
// NetGame talks to the server and interpolates its snapshots (multiplayer).
import { World } from '../shared/sim.js';
import { makeArena } from '../shared/maps.js';
import { WEAPON_ORDER, ENEMY_ORDER, BULLET_KINDS, CREATURES, EVOLVE_LEVEL, grantXp } from '../shared/data.js';
import { toLoadout } from './save.js';
import { wrapAngle } from './input.js';
import { sfx } from './audio.js';

const STEP = 1 / 60;
const CITY_SEED = 20260;
const INTERP = 0.1; // seconds of interpolation delay in multiplayer

class Session {
  constructor(app) {
    this.app = app;
    this.r = app.renderer;
    this.input = app.input;
    this.profile = app.profile;
    this.input.act = 0;
    this.input.wpnReq = null;
    this.wantWpn = 'pistol';
    this.hurtFlash = 0;
    this.closed = false;
  }

  // Resolves weapon-button / number-key requests into a weapon name.
  resolveWeapon(owned, ammo) {
    const req = this.input.wpnReq;
    if (req === null) return;
    this.input.wpnReq = null;
    const usable = WEAPON_ORDER.filter((w, i) => owned.includes(w) && (ammo[i] === -1 || ammo[i] > 0));
    if (req === 'next') {
      const i = usable.indexOf(this.curWpn || 'pistol');
      this.wantWpn = usable[(i + 1) % usable.length] || 'pistol';
    } else if (typeof req === 'number') {
      const w = WEAPON_ORDER[req];
      if (usable.includes(w)) this.wantWpn = w;
    }
    sfx.ui();
  }

  // Shared handling for simulation events (visuals, sounds, rewards).
  handleEvents(events, meId) {
    const app = this.app;
    for (const e of events) {
      this.r.effect(e, meId);
      switch (e.t) {
        case 'shot': if (e.pid === meId || Math.random() < 0.4) sfx.shot(e.k); break;
        case 'hit': sfx.hit(); break;
        case 'die': sfx.die(); break;
        case 'boom': sfx.boom(); break;
        case 'hurt': if (e.pid === meId) { sfx.hurt(); this.hurtFlash = 0.4; } break;
        case 'pick': if (e.pid === meId) sfx.pick(); break;
        case 'car': if (e.pid === meId) sfx.car(); break;
        case 'xp': if (e.pid === meId) this.reward(e.xp, e.coins); break;
        case 'msg': if (!e.pid || e.pid === meId) app.hud.toast(e.text); break;
        case 'quest': sfx.quest(); app.hud.dialog(e.title, e.text); break;
        case 'questDone':
          sfx.quest();
          this.profile.questNum = e.num + 1;
          app.hud.banner('QUEST COMPLETE!', `${e.title}  +${e.xp} XP  +${e.coins} coins`);
          this.reward(e.xp, e.coins);
          app.save(true);
          break;
        case 'ko': {
          const lost = Math.floor(this.profile.coins * 0.1);
          this.profile.coins -= lost;
          app.hud.banner('KNOCKED OUT', lost ? `Dropped ${lost} coins. Back to the plaza...` : 'Back to the plaza...');
          app.save(true);
          break;
        }
        case 'pdie': if (e.pid === meId && this.mode !== 'city') app.hud.banner('KNOCKED OUT', this.mode === 'coop' ? 'You will revive next wave.' : 'Respawning...'); break;
        case 'wave':
          if (e.clear) {
            app.hud.banner(`WAVE ${e.n} CLEARED!`, e.quest ? 'SQUAD QUEST COMPLETE! Huge bonus!' : 'Next wave incoming...');
            if (e.n > this.profile.best.wave) this.profile.best.wave = e.n;
            app.save(true);
          } else app.hud.banner(`WAVE ${e.n}`, e.n % 5 === 0 ? 'A Brute boss is coming!' : 'Here they come!');
          break;
        case 'round':
          app.hud.banner(e.winner === meId ? 'YOU WIN!' : `${e.name} WINS`, 'Next round in a few seconds');
          if (e.winner === meId) { this.profile.best.pvpWins++; app.save(true); }
          break;
        default:
      }
    }
  }

  reward(xp, coins) {
    const p = this.profile;
    const before = p.level;
    const gained = grantXp(p, xp, coins);
    this.app.dirty = true;
    if (gained) {
      sfx.level();
      const C = CREATURES[p.companion];
      if (before < EVOLVE_LEVEL && p.level >= EVOLVE_LEVEL) this.app.hud.banner('EVOLUTION!', `${C.name} evolved into ${C.evo}!`);
      else this.app.hud.banner(`LEVEL UP!  Lv ${p.level}`, 'Spend your new stat point in Training.');
      this.onLevel();
      this.app.save(true);
    }
  }

  onLevel() {}

  // Street (third-person) camera helpers. While driving, the camera swings behind
  // the car; on foot, a light aim assist pulls the shot toward an enemy near the
  // crosshair, since aiming by dragging a thumb is coarse on a phone.
  streetAim(inp, me, carAng, targets, dt) {
    if (this.input.mode !== 'street' || !me) return inp;
    if (carAng !== null) { this.input.followYaw(carAng, dt); return inp; }
    let best = null, bestD = 0.22;
    for (const t of targets) {
      if (t === me || t.dead) continue;
      const dx = t.x - me.x, dy = t.y - me.y, d = Math.hypot(dx, dy);
      if (d > 460 || d < 1) continue;
      const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - inp.ang));
      if (off < bestD) { bestD = off; best = Math.atan2(dy, dx); }
    }
    if (best !== null) inp.ang = wrapAngle(inp.ang + wrapAngle(best - inp.ang) * 0.85);
    return inp;
  }
}

export class LocalGame extends Session {
  constructor(app) {
    super(app);
    this.mode = 'city';
    this.world = new World({ mode: 'city', seed: CITY_SEED });
    this.world.questNum = this.profile.questNum;
    this.me = this.world.addPlayer(toLoadout(this.profile));
    this.acc = 0;
    this.r.setMap(this.world.map);
    this.r.snapCamera(this.me.x, this.me.y);
    this.paused = false;
  }

  onLevel() { this.world.setLoadout(this.me, toLoadout(this.profile)); }

  update(dt) {
    if (this.paused) return;
    const me = this.me;
    const ammo = WEAPON_ORDER.map((w) => (!me.weapons.includes(w) ? -2 : me.ammo[w] === Infinity ? -1 : me.ammo[w]));
    this.curWpn = me.wpn;
    this.resolveWeapon(me.weapons, ammo);
    const car = me.car ? this.world.cars.find((c) => c.id === me.car) : null;
    const inp = this.streetAim(this.input.read(this.r, me), me, car ? car.ang : null, this.world.enemies, dt);
    Object.assign(me.input, inp, { act: this.input.act, wpn: this.wantWpn });
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= STEP) {
      this.world.step(STEP);
      this.acc -= STEP;
      this.handleEvents(this.world.events.splice(0), me.id);
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  hint() {
    const me = this.me, w = this.world;
    if (me.dead) return '';
    if (me.car) return 'Exit car';
    for (const c of w.cars) if (!c.driver && Math.hypot(c.x - me.x, c.y - me.y) < 46) return 'Drive';
    for (const n of w.npcs) if (Math.hypot(n.x - me.x, n.y - me.y) < 56) return w.quest ? 'Talk' : 'Get quest';
    return '';
  }

  scene() {
    const w = this.world, me = this.me;
    me.hurtFlash = this.hurtFlash;
    const q = w.quest;
    return {
      me, players: w.players, multi: false, pvp: false, showMini: true, miniTop: 44, camYaw: this.input.yaw,
      enemies: w.enemies.map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, ang: e.ang, boss: e.boss, hpPct: Math.max(1, Math.round((e.hp / e.maxHp) * 100)) })),
      bullets: w.bullets, pickups: w.pickups,
      cars: w.cars.map((c) => ({ ...c, driverName: '' })),
      npcs: w.npcs,
      questTarget: q ? q.target : w.npcs[0],
      questDest: q && q.type === 'drive' ? q.dest : null,
    };
  }

  hudState() {
    const me = this.me, w = this.world, q = w.quest;
    let quest;
    if (q) quest = { title: q.title, text: q.type === 'drive' ? (me.car ? 'Drive to the yellow ring' : 'Get in a car (A)') : q.type === 'boss' ? 'Defeat the Brute' : `${q.progress}/${q.goal}` };
    else quest = { title: 'Free Roam', text: 'Talk to Mayor Pix (!) for a quest' };
    return {
      hp: me.hp, maxHp: me.maxHp, wpn: me.wpn, ammo: me.ammo[me.wpn], quest, hint: this.hint(),
      dead: me.dead, respawn: me.dead ? Math.ceil(me.respawn) : 0,
      // ammo per weapon slot for the touch panel: -1 unlimited, -2 not owned
      slots: WEAPON_ORDER.map((w) => (!me.weapons.includes(w) ? -2 : me.ammo[w] === Infinity ? -1 : me.ammo[w])),
    };
  }

  close() { this.closed = true; this.profile.questNum = this.world.quest ? this.world.quest.num : this.world.questNum; }
}

export class NetGame extends Session {
  constructor(app, { url, mode, room, onReady, onFail }) {
    super(app);
    this.mode = mode;
    this.snaps = [];
    this.roster = new Map();
    this.meId = 0;
    this.ready = false;
    this.lastSend = 0;
    this.priv = null;
    this.clock = null; // offset between server time and local time
    this.onReady = onReady;
    this.onFail = onFail;
    try {
      this.ws = new WebSocket(url);
    } catch {
      setTimeout(() => onFail('Bad server address.'), 0);
      return;
    }
    const timeout = setTimeout(() => { if (!this.ready) { this.fail('Could not reach the server.'); } }, 8000);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'join', mode, room, loadout: toLoadout(this.profile) }));
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.onMsg(m);
    };
    this.ws.onerror = () => {};
    this.ws.onclose = () => {
      clearTimeout(timeout);
      if (this.closed) return;
      if (!this.ready) this.fail('Could not reach the server.');
      else { this.closed = true; app.onDisconnect('Disconnected from server.'); }
    };
  }

  fail(msg) {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
    this.onFail(msg);
  }

  onMsg(m) {
    if (this.closed) return;
    if (m.t === 'err') { this.fail(m.msg); return; }
    if (m.t === 'welcome') {
      this.meId = m.id; this.room = m.room; this.mode = m.mode;
      this.map = makeArena(m.seed);
      this.r.setMap(this.map);
      this.r.snapCamera(this.map.spawn.x, this.map.spawn.y);
      for (const p of m.roster) this.roster.set(p.id, p);
      this.ready = true;
      this.onReady(this);
      return;
    }
    if (m.t === 'roster') { this.roster = new Map(m.roster.map((p) => [p.id, p])); return; }
    if (m.t === 's' && this.ready) {
      const now = performance.now() / 1000;
      const st = m.s.tm / 1000;
      if (this.clock === null || now - st < this.clock) this.clock = now - st; // smallest observed delay
      this.clock += 0.0005; // drift slowly so the estimate can recover from a lucky packet
      this.snaps.push({ t: st, s: m.s });
      if (this.snaps.length > 30) this.snaps.shift();
      this.priv = m.me;
      if (m.ev.length) this.handleEvents(m.ev, this.meId);
    }
  }

  onLevel() { this.send({ t: 'loadout', loadout: toLoadout(this.profile) }); }

  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // Returns the interpolated world state at (server time - INTERP).
  sample() {
    const S = this.snaps;
    if (!S.length) return null;
    const t = performance.now() / 1000 - this.clock - INTERP;
    let a = S[0], b = S[0];
    for (let i = 0; i < S.length - 1; i++) {
      if (S[i].t <= t && S[i + 1].t >= t) { a = S[i]; b = S[i + 1]; break; }
      if (S[i + 1].t < t) { a = S[i + 1]; b = S[i + 1]; }
    }
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    const lerp = (x, y) => x + (y - x) * k;
    const lerpA = (x, y) => { let d = y - x; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return x + d * k; };
    const index = (arr) => { const m = new Map(); for (const r of arr) m.set(r[0], r); return m; };
    const pa = index(a.s.p), ea = index(a.s.e), ba = index(a.s.b);
    const players = b.s.p.map((r) => {
      const o = pa.get(r[0]) || r;
      const info = this.roster.get(r[0]) || { name: '?', look: {}, pet: 'cindkit', evolved: false, level: 1 };
      return {
        id: r[0], x: lerp(o[1], r[1]), y: lerp(o[2], r[2]), ang: lerpA(o[3], r[3]), hp: r[4], maxHp: r[5], wpn: WEAPON_ORDER[r[6]] || 'pistol',
        dead: !!r[7], kills: r[8], deaths: r[9], pet: { x: lerp(o[10], r[10]), y: lerp(o[11], r[11]) }, moving: !!r[12],
        name: info.name, look: info.look, petType: info.pet, evolved: info.evolved, level: info.level, car: 0,
      };
    });
    const enemies = b.s.e.map((r) => {
      const o = ea.get(r[0]) || r;
      return { id: r[0], type: ENEMY_ORDER[r[1]], x: lerp(o[2], r[2]), y: lerp(o[3], r[3]), ang: r[4], hpPct: r[5], boss: !!r[6] };
    });
    const bullets = b.s.b.map((r) => {
      const o = ba.get(r[0]) || r;
      return { x: lerp(o[1], r[1]), y: lerp(o[2], r[2]), kind: BULLET_KINDS[r[3]] };
    });
    const pickups = b.s.k.map((r) => ({ id: r[0], x: r[1], y: r[2], kind: r[3] }));
    return { players, enemies, bullets, pickups, latest: b.s };
  }

  update(dt) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.view = this.sample();
    if (!this.view) return;
    const me = this.view.players.find((p) => p.id === this.meId);
    const owned = this.priv ? WEAPON_ORDER.filter((w, i) => this.priv.ammo[i] !== -2) : ['pistol'];
    this.curWpn = this.priv ? this.priv.wpn : 'pistol';
    this.resolveWeapon(owned, this.priv ? this.priv.ammo : [-1]);
    const targets = this.mode === 'pvp' ? this.view.players : this.view.enemies;
    const inp = this.streetAim(this.input.read(this.r, me), me, null, targets, dt);
    this.myAng = inp.ang;
    const now = performance.now();
    if (now - this.lastSend > 50) {
      this.lastSend = now;
      this.send({ t: 'in', mx: inp.mx, my: inp.my, ang: inp.ang, fire: inp.fire, wpn: this.wantWpn, act: this.input.act });
    }
  }

  scene() {
    const v = this.view;
    if (!v) return { me: null, players: [], enemies: [], bullets: [], pickups: [], cars: [], npcs: [] };
    const me = v.players.find((p) => p.id === this.meId) || null;
    if (me) { me.ang = this.myAng ?? me.ang; me.hurtFlash = this.hurtFlash; if (this.priv) me.wpn = this.priv.wpn; }
    return { me, players: v.players, enemies: v.enemies, bullets: v.bullets, pickups: v.pickups, cars: [], npcs: [], multi: true, pvp: this.mode === 'pvp', showMini: false, camYaw: this.input.yaw };
  }

  hudState() {
    const v = this.view;
    const me = v && v.players.find((p) => p.id === this.meId);
    if (!me) return null;
    const pr = this.priv;
    const wi = pr ? WEAPON_ORDER.indexOf(pr.wpn) : 0;
    const s = v.latest;
    let quest;
    if (this.mode === 'coop') {
      quest = { title: `Co-op  Room ${this.room}`, text: s.w ? `Wave ${s.w}  -  ${s.left} enemies left  -  Squad quest: reach wave 10` : 'Get ready...' };
    } else {
      const goal = s.rd ? s.rd[2] : 10;
      const board = v.players.slice().sort((a, b) => b.kills - a.kills).slice(0, 4).map((p) => `${p.name} ${p.kills}`).join('   ');
      quest = { title: `PvP  Room ${this.room}  -  first to ${goal}`, text: board };
    }
    return {
      hp: me.hp, maxHp: me.maxHp, wpn: pr ? pr.wpn : 'pistol', ammo: pr ? (pr.ammo[wi] === -1 ? Infinity : pr.ammo[wi]) : Infinity, quest, hint: '',
      dead: me.dead, respawn: this.mode === 'coop' ? -1 : pr ? pr.respawn : 0, noAction: true,
      slots: pr ? pr.ammo : [-1, -2, -2, -2, -2],
    };
  }

  close() {
    this.closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

