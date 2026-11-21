// Player progression: XP from fights, levels, and what each level unlocks.
// Pure functions (no storage) so they are easy to test.
import { UNLOCKS, OPTIONS } from './spec.js';

// total XP needed to reach a level: L2 150, L3 450, L4 900, L5 1500, L7 3150, L10 6750
export const xpForLevel = (L) => 75 * (L - 1) * L;
export function levelOf(xp) { let L = 1; while (xp >= xpForLevel(L + 1)) L++; return L; }

const DIFF_BONUS = { easy: 0, normal: 30, hard: 60, master: 100 };
// won/lost/draw against a CPU level; ko: won by knockout; best: best combo
export function fightXp({ result, level = 'normal', ko = false, best = 0 }) {
  let xp = result === 'win' ? 120 + (DIFF_BONUS[level] ?? 0) : result === 'draw' ? 70 : 50;
  if (result === 'win' && ko) xp += 30;
  xp += Math.min(30, best * 3);
  return xp;
}

const NICE = { animalEars: 'Animal ears', tail: 'Tails', pattern: 'Skin patterns', snout: 'Animal snouts & beaks', horns: 'Horns', fangs: 'Fangs', wings: 'Wings', claws: 'Claws' };
// creature parts unlocked exactly at level L (for the level-up message)
export function unlocksAt(L) { return Object.entries(UNLOCKS).filter(([, lv]) => lv === L).map(([k]) => NICE[k] || k); }
export function nextUnlock(level) {
  const lv = Object.values(UNLOCKS).filter((l) => l > level).sort((a, b) => a - b)[0];
  return lv ? { level: lv, parts: unlocksAt(lv) } : null;
}
export { OPTIONS };
