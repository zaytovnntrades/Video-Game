import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fight, blankInput } from '../web/js/sim/fight.js';
import { CPU } from '../web/js/sim/ai.js';
import { defaultSpec, randomSpec, sanitizeSpec } from '../web/js/sim/spec.js';
import { MELEE, COMBO, ARENA, MAX_COMBO_HITS, BLASTS } from '../web/js/sim/data.js';

const I = (o = {}) => ({ ...blankInput(), ...o });
function close(fight, d = 2.2) { // put the fighters face to face
  fight.f[0].pos = { x: 0, y: 0, z: -d / 2 }; fight.f[1].pos = { x: 0, y: 0, z: d / 2 };
}
function run(fight, frames, a = () => I(), b = () => I()) {
  for (let i = 0; i < frames && !fight.over; i++) fight.step([a(i), b(i)]);
}
const tapAt = (k, at) => (i) => I({ [k]: i === at });

test('a jab hits for its frame-data damage and gives meter', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  close(f);
  const m0 = f.f[0].meter, hp = f.f[1].hp;
  run(f, 30, tapAt('atk', 0));
  assert.equal(Math.round(hp - f.f[1].hp), Math.round(MELEE.jab.dmg * f.f[0].style.melee));
  assert.ok(f.f[0].meter > m0);
});

test('guard takes only chip damage; smash breaks guard', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  close(f);
  const hp = f.f[1].hp;
  run(f, 30, tapAt('atk', 4), () => I({ guard: true }));
  const chip = hp - f.f[1].hp;
  assert.ok(chip > 0 && chip < MELEE.jab.dmg * 0.3, `chip ${chip}`);
  const g = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  close(g);
  let broke = false;
  run(g, 60, (i) => I({ atk: i < 20 }), () => I({ guard: true }));
  for (const e of g.events) if (e.t === 'guardbreak') broke = true;
  assert.ok(broke, 'held attack should break guard');
});

test('a full combo chains, scales and launches; no infinites', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  close(f);
  run(f, 140, (i) => I({ atk: i % 4 === 0 }));
  const hits = f.events.filter((e) => e.t === 'hit' && e.by === 0);
  assert.ok(hits.length >= COMBO.length, `hits ${hits.length}`);
  assert.ok(hits.some((h) => h.heavy), 'combo ends in a launcher');
  assert.ok(hits.every((h) => h.combo <= MAX_COMBO_HITS));
  const total = hits.reduce((s, h) => s + h.dmg, 0);
  const raw = COMBO.reduce((s, k) => s + MELEE[k].dmg, 0);
  assert.ok(total < raw * 1.6, 'scaling keeps combos bounded');
});

test('a blink right before a hit dodges it and costs a blink', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  close(f);
  const hp = f.f[1].hp;
  // jab becomes active at frame ~6 after the tap releases; tap guard just before
  run(f, 30, tapAt('atk', 0), tapAt('guard', 4));
  assert.equal(f.f[1].hp, hp);
  assert.equal(f.f[1].blink, 2);
  assert.ok(f.events.some((e) => e.t === 'blink'));
});

test('blasts travel, home and hit at range; beams cost meter', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  const hp = f.f[1].hp;
  run(f, 90, tapAt('blast', 0));
  assert.ok(f.f[1].hp < hp, 'blast should land at 28 m');
  const g = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  g.f[0].meter = 60;
  run(g, 150, (i) => I({ blast: i < 20 }));
  assert.ok(g.events.some((e) => e.t === 'beam'));
  assert.ok(g.f[0].meter < 60 - 20);
  assert.ok(g.f[1].hp < g.f[1].maxHp - 100, `beam damage ${g.f[1].maxHp - g.f[1].hp}`);
});

test('charging, ascending and the apex finisher', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  run(f, 240, () => I({ dash: true }));
  assert.ok(f.f[0].meter >= 99, `meter ${f.f[0].meter}`);
  run(f, 2, () => I());
  run(f, 60, tapAt('special', 0));
  assert.ok(f.f[0].ascended);
  f.f[0].meter = 100;
  const hp = f.f[1].hp;
  run(f, 200, tapAt('special', 0));
  assert.ok(f.events.some((e) => e.t === 'apex'));
  assert.ok(hp - f.f[1].hp > 150, `apex damage ${hp - f.f[1].hp}`);
});

test('flight: jump, rise, stay under the ceiling, drop', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  run(f, 500, (i) => I({ jump: i === 0 || i > 10 }));
  assert.ok(f.f[0].flying);
  assert.ok(f.f[0].pos.y <= ARENA.ceiling && f.f[0].pos.y > ARENA.ceiling - 1);
  run(f, 4, () => I());
  run(f, 200, tapAt('jump', 0));
  assert.equal(f.f[0].pos.y, 0);
});

test('KO ends the fight; time-out picks the higher health', () => {
  const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3 });
  f.f[1].hp = 10; close(f);
  run(f, 40, tapAt('atk', 0));
  assert.ok(f.over); assert.equal(f.winner, 0); assert.equal(f.reason, 'ko');
  const g = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 3, time: 1 });
  g.f[0].hp -= 50;
  run(g, 70);
  assert.ok(g.over); assert.equal(g.winner, 1); assert.equal(g.reason, 'time');
});

test('mirror symmetry: the same inputs from either side give the same result', () => {
  const play = (side) => {
    const f = new Fight({ specs: [defaultSpec(), defaultSpec()], seed: 5 });
    close(f, 6);
    const script = (i) => I({ atk: i % 5 === 0 && i < 100, my: i < 30 ? 1 : 0, blast: i === 120 });
    run(f, 200, side === 0 ? script : () => I(), side === 1 ? script : () => I());
    return [f.f[side].hp, f.f[1 - side].hp, f.f[side].meter.toFixed(3)];
  };
  assert.deepEqual(play(0), play(1));
});

test('determinism: same seed and inputs give identical fights', () => {
  const go = () => {
    const f = new Fight({ specs: [randomSpec(1), randomSpec(2)], seed: 9 });
    const a = new CPU(0, 'hard', 1), b = new CPU(1, 'normal', 2);
    for (let i = 0; i < 3000 && !f.over; i++) f.step([a.think(f), b.think(f)]);
    return JSON.stringify([f.tick, f.f[0].hp, f.f[1].hp, f.f[0].pos, f.winner]);
  };
  assert.equal(go(), go());
});

test('soak: CPU vs CPU fights finish with sane numbers', () => {
  let kos = 0;
  for (let s = 1; s <= 12; s++) {
    const f = new Fight({ specs: [randomSpec(s * 11), randomSpec(s * 13)], seed: s });
    const a = new CPU(0, ['easy', 'normal', 'hard'][s % 3], s), b = new CPU(1, 'hard', s + 50);
    let stuck = 0, last = '';
    for (let i = 0; i < 99 * 60 + 600 && !f.over; i++) {
      f.step([a.think(f), b.think(f)]);
      for (const x of f.f) {
        for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(x.pos[k]) && Number.isFinite(x.vel[k]), 'finite');
        assert.ok(Math.hypot(x.pos.x, x.pos.z) <= ARENA.radius + 1e-6 && x.pos.y >= 0 && x.pos.y <= ARENA.ceiling);
        assert.ok(x.hp >= 0 && x.meter >= 0 && x.meter <= 100.0001);
      }
      const key = f.f.map((x) => x.state + x.t).join();
      stuck = key === last ? stuck + 1 : 0; last = key;
      assert.ok(stuck < 600, 'a fighter is frozen');
    }
    assert.ok(f.over, `fight ${s} never ended`);
    if (f.reason === 'ko') kos++;
  }
  assert.ok(kos >= 3, `CPU fights should often end in a KO (got ${kos}/12)`);
});

test('random-input soak never breaks the sim', () => {
  for (let s = 1; s <= 6; s++) {
    const f = new Fight({ specs: [randomSpec(s), randomSpec(s + 100)], seed: s });
    let r = s * 99991;
    const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
    const rand = () => I({ mx: rnd() * 2 - 1, my: rnd() * 2 - 1, atk: rnd() < 0.3, blast: rnd() < 0.2, guard: rnd() < 0.15, dash: rnd() < 0.2, jump: rnd() < 0.15, special: rnd() < 0.05 });
    for (let i = 0; i < 4000 && !f.over; i++) {
      f.step([rand(), rand()]);
      for (const x of f.f) assert.ok(Number.isFinite(x.pos.x + x.pos.y + x.pos.z + x.hp + x.meter));
    }
  }
});

test('specs are sanitized; random specs are valid and avoid gold-on-gold', () => {
  const bad = sanitizeSpec({ name: '<script>alert(1)</script>xx', body: { height: 9 }, style: 'god', moves: { blast: '__proto__' }, hair: { color: 'red' } });
  assert.equal(bad.name, 'scriptalert1sc');
  assert.equal(bad.body.height, 1); assert.equal(bad.style, 'striker'); assert.equal(bad.moves.blast, 'volley'); assert.equal(bad.hair.color, '#1d1b22');
  for (let s = 0; s < 200; s++) {
    const r = randomSpec(s);
    assert.deepEqual(sanitizeSpec(r), r);
    assert.ok(Object.hasOwn(BLASTS, r.moves.blast));
  }
});
