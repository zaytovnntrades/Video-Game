// Player profile, saved on the device (localStorage).
import { WEAPONS, STAT_KEYS, STAT_MAX, LOOK_KEYS, LOOK, CREATURES, sanitizeLoadout } from '../shared/data.js';

const KEY = 'monstreets.save.v1';

export function defaultProfile() {
  return {
    v: 1, created: false, name: '', look: { skin: 1, hair: 0, style: 1, hat: 1, shirt: 0, pants: 0 }, companion: 'cindkit',
    level: 1, xp: 0, coins: 0, points: 0, stats: { pow: 0, vit: 0, agi: 0 }, weapons: ['pistol'], questNum: 0,
    best: { wave: 0, pvpWins: 0 }, settings: { sound: true, server: '' },
  };
}

function store() {
  try { return window.localStorage; } catch { return null; }
}

export function loadProfile() {
  const p = defaultProfile();
  try {
    const raw = store() && store().getItem(KEY);
    if (!raw) return p;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return p;
    Object.assign(p, s);
    p.look = { ...defaultProfile().look, ...(s.look || {}) };
    for (const k of LOOK_KEYS) if (!(p.look[k] >= 0 && p.look[k] < LOOK[k].length)) p.look[k] = 0;
    p.stats = { ...defaultProfile().stats, ...(s.stats || {}) };
    for (const k of STAT_KEYS) p.stats[k] = Math.max(0, Math.min(STAT_MAX, p.stats[k] | 0));
    p.settings = { ...defaultProfile().settings, ...(s.settings || {}) };
    p.best = { ...defaultProfile().best, ...(s.best || {}) };
    if (!CREATURES[p.companion]) p.companion = 'cindkit';
    if (!Array.isArray(p.weapons) || !p.weapons.includes('pistol')) p.weapons = ['pistol'];
    for (const k of ['level', 'xp', 'coins', 'points', 'questNum']) p[k] = Math.max(0, Math.floor(Number(p[k]) || 0));
    p.level = Math.max(1, p.level);
  } catch { /* corrupted save: start fresh */ }
  return p;
}

export function saveProfile(p) {
  try { store() && store().setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ }
}

export function resetProfile() {
  try { store() && store().removeItem(KEY); } catch { /* ignore */ }
}

export function toLoadout(p) {
  return sanitizeLoadout({ name: p.name, look: p.look, companion: p.companion, level: p.level, stats: p.stats, weapons: p.weapons });
}

export function canBuy(p, w) {
  const W = WEAPONS[w];
  if (!W || p.weapons.includes(w)) return { ok: false, why: 'Owned' };
  if (p.level < W.lvl) return { ok: false, why: `Needs Lv ${W.lvl}` };
  if (p.coins < W.cost) return { ok: false, why: `${W.cost} coins` };
  return { ok: true, why: `${W.cost} coins` };
}

export function buy(p, w) {
  const c = canBuy(p, w);
  if (!c.ok) return false;
  p.coins -= WEAPONS[w].cost;
  p.weapons.push(w);
  return true;
}

export function spendPoint(p, k) {
  if (p.points <= 0 || !STAT_KEYS.includes(k) || p.stats[k] >= STAT_MAX) return false;
  p.stats[k]++;
  p.points--;
  return true;
}
