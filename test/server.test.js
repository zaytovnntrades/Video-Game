import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';

const PORT = 18555;
let srv;
test.before(async () => { srv = await startServer(PORT); });
test.after(() => { for (const c of srv.wss.clients) c.terminate(); srv.wss.close(); srv.server.close(); });

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const next = (pred, ms = 4000) => new Promise((res, rej) => {
    const hit = inbox.find(pred);
    if (hit) { inbox.splice(inbox.indexOf(hit), 1); res(hit); return; }
    const w = { pred: (m) => { if (pred(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, res };
    waiters.push(w);
    setTimeout(() => rej(new Error('timeout')), ms);
  });
  return { ws, next, open: new Promise((r) => ws.on('open', r)), send: (m) => ws.send(JSON.stringify(m)) };
}

test('static files are served and path traversal is blocked', async () => {
  const r = await fetch(`http://localhost:${PORT}/js/shared/data.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  const bad = await fetch(`http://localhost:${PORT}/%2e%2e/package.json`);
  assert.notEqual(bad.status, 200);
});

test('co-op: two players share a room, get snapshots and private ammo', async () => {
  const a = client(), b = client();
  await Promise.all([a.open, b.open]);
  a.send({ t: 'join', mode: 'coop', room: 'TEST', loadout: { name: 'Ann', level: 3, weapons: ['uzi'] } });
  const wa = await a.next((m) => m.t === 'welcome');
  b.send({ t: 'join', mode: 'coop', room: 'test', loadout: { name: 'Bo' } });
  const wb = await b.next((m) => m.t === 'welcome');
  assert.equal(wa.room, 'TEST');
  assert.equal(wb.room, 'TEST');
  assert.equal(wa.seed, wb.seed);
  await a.next((m) => m.t === 'roster' && m.roster.length === 2);
  const s = await b.next((m) => m.t === 's' && m.s.p.length === 2);
  assert.equal(s.me.ammo[0], -1);
  assert.equal(s.me.ammo[1], -2, 'Bo does not own the uzi');
  const sa = await a.next((m) => m.t === 's');
  assert.ok(sa.me.ammo[1] > 0, 'Ann owns the uzi');
  // movement input is applied
  const x0 = s.s.p.find((p) => p[0] === wb.id)[1];
  b.send({ t: 'in', mx: 5, my: 0, ang: 0, fire: false, wpn: null, act: 0 });
  await new Promise((r) => setTimeout(r, 600));
  const s2 = await b.next((m) => m.t === 's');
  const x1 = s2.s.p.find((p) => p[0] === wb.id)[1];
  assert.ok(x1 !== x0, 'player moved');
  // wave starts
  await b.next((m) => m.t === 's' && m.ev.some((e) => e.t === 'wave'), 8000);
  // garbage does not crash the server
  b.ws.send('not json'); b.ws.send(JSON.stringify({ t: 'in', mx: 'NaN', ang: {} }));
  await b.next((m) => m.t === 's');
  a.ws.close();
  await b.next((m) => m.t === 'roster' && m.roster.length === 1);
  b.ws.close();
});

test('pvp: mode mismatch and quick match', async () => {
  const a = client();
  await a.open;
  a.send({ t: 'join', mode: 'coop', room: 'MIXX', loadout: {} });
  await a.next((m) => m.t === 'welcome');
  const b = client();
  await b.open;
  b.send({ t: 'join', mode: 'pvp', room: 'MIXX', loadout: {} });
  const err = await b.next((m) => m.t === 'err');
  assert.match(err.msg, /Co-op/);
  b.send({ t: 'join', mode: 'pvp', loadout: { name: 'Q' } });
  const w = await b.next((m) => m.t === 'welcome');
  assert.equal(w.mode, 'pvp');
  assert.equal(w.room.length, 4);
  a.ws.close(); b.ws.close();
});
