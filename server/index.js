// Monstreets server: serves the web game and hosts multiplayer rooms.
// The server runs the same World simulation as single player and is the
// authority: clients only send their inputs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from '../web/js/shared/sim.js';
import { WEAPON_ORDER } from '../web/js/shared/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PORT = Number(process.env.PORT) || 8080;
const TICK = 1 / 30;
const SEND_EVERY = 2; // 15 snapshots per second
const CAPS = { coop: 4, pvp: 6 };
const MAX_MSG = 4096;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/health') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
  });
}

const rooms = new Map(); // code -> room

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

function createRoom(mode, code, isPrivate) {
  const room = { code, mode, isPrivate, world: new World({ mode, seed: Math.floor(Math.random() * 1e9) }), clients: new Map(), tick: 0 };
  rooms.set(code, room);
  return room;
}

function findRoom(mode, code) {
  if (code) {
    const r = rooms.get(code);
    if (r) {
      if (r.mode !== mode) return { err: `Room ${code} is a ${r.mode === 'pvp' ? 'PvP' : 'Co-op'} room.` };
      if (r.clients.size >= CAPS[mode]) return { err: `Room ${code} is full.` };
      return { room: r };
    }
    return { room: createRoom(mode, code, true) };
  }
  for (const r of rooms.values()) if (!r.isPrivate && r.mode === mode && r.clients.size < CAPS[mode]) return { room: r };
  return { room: createRoom(mode, newCode(), false) };
}

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const broadcastRoster = (room) => { for (const ws of room.clients.keys()) send(ws, { t: 'roster', roster: room.world.roster() }); };

const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };

function onMessage(ws, raw) {
  if (raw.length > MAX_MSG) return;
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }
  if (!m || typeof m !== 'object') return;
  const me = ws.session;
  if (m.t === 'join' && !me) {
    const mode = m.mode === 'pvp' ? 'pvp' : 'coop';
    const code = typeof m.room === 'string' ? m.room.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
    if (code && code.length !== 4) { send(ws, { t: 'err', msg: 'Room codes are 4 letters.' }); return; }
    const { room, err } = findRoom(mode, code);
    if (err) { send(ws, { t: 'err', msg: err }); return; }
    const p = room.world.addPlayer(m.loadout);
    ws.session = { room, pid: p.id };
    room.clients.set(ws, p.id);
    send(ws, { t: 'welcome', id: p.id, mode, seed: room.world.seed, room: room.code, roster: room.world.roster() });
    broadcastRoster(room);
    room.world.events.push({ t: 'msg', text: `${p.name} joined the room.` });
    return;
  }
  if (!me) return;
  const p = me.room.world.byId(me.pid);
  if (!p) return;
  if (m.t === 'in') {
    p.input.mx = num(m.mx, -1, 1);
    p.input.my = num(m.my, -1, 1);
    p.input.ang = num(m.ang, -10, 10);
    p.input.fire = !!m.fire;
    p.input.wpn = WEAPON_ORDER.includes(m.wpn) ? m.wpn : null;
    p.input.act = Math.floor(num(m.act, 0, 1e9));
  } else if (m.t === 'loadout') {
    me.room.world.setLoadout(p, m.loadout);
    broadcastRoster(me.room);
  }
}

function onClose(ws) {
  const me = ws.session;
  if (!me) return;
  const { room } = me;
  const p = room.world.byId(me.pid);
  room.clients.delete(ws);
  room.world.removePlayer(me.pid);
  if (room.clients.size === 0) { rooms.delete(room.code); return; }
  if (p) room.world.events.push({ t: 'msg', text: `${p.name} left the room.` });
  broadcastRoster(room);
}

// Personal events (xp, private messages) only go to that player.
const isPersonal = (e) => (e.t === 'xp' || e.t === 'msg') && e.pid;

function tickRooms() {
  for (const room of rooms.values()) {
    room.world.step(TICK);
    room.tick++;
    if (room.tick % SEND_EVERY) continue;
    const events = room.world.events.splice(0);
    const snap = room.world.snapshot();
    const shared = events.filter((e) => !isPersonal(e));
    for (const [ws, pid] of room.clients) {
      const ev = shared.concat(events.filter((e) => isPersonal(e) && e.pid === pid));
      send(ws, { t: 's', s: snap, me: room.world.privateFor(pid), ev });
    }
  }
}

export function startServer(port = PORT) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => { try { onMessage(ws, raw); } catch (e) { console.error('message error', e); } });
    ws.on('close', () => onClose(ws));
    ws.on('error', () => {});
  });
  const tick = setInterval(tickRooms, TICK * 1000);
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10000);
  server.on('close', () => { clearInterval(tick); clearInterval(ping); });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, wss })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`Monstreets running: http://localhost:${PORT}  (multiplayer at ws://<host>:${PORT}/ws)`));
}
