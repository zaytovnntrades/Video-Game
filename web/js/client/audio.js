// Tiny synthesized sound effects (no audio files needed).
// iOS only allows audio after a user gesture, so unlock() is called on first touch.
let ctx = null;
let master = null;
let enabled = true;
let lastShot = 0;

export function setSound(on) { enabled = !!on; }

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  // play a silent buffer: required by some iOS versions to fully unlock
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b; s.connect(master); s.start(0);
}

function tone(freq, dur, type = 'square', vol = 0.3, slide = 0) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, vol = 0.3, cutoff = 2000) {
  if (!ctx || !enabled) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = cutoff;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

export const sfx = {
  shot(kind) {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastShot < 0.05) return;
    lastShot = now;
    if (kind === 'shotgun') noise(0.18, 0.45, 1500);
    else if (kind === 'rocket') { noise(0.3, 0.3, 600); tone(180, 0.3, 'sawtooth', 0.15, 0.4); }
    else if (kind === 'rifle') { noise(0.12, 0.4, 3000); tone(500, 0.08, 'square', 0.1, 0.3); }
    else tone(kind === 'uzi' ? 700 : 520, 0.06, 'square', 0.12, 0.4);
  },
  hit() { tone(220, 0.05, 'square', 0.08, 0.6); },
  die() { tone(300, 0.2, 'sawtooth', 0.15, 0.25); },
  boom() { noise(0.5, 0.6, 500); },
  hurt() { tone(140, 0.15, 'sawtooth', 0.2, 0.6); },
  pick() { tone(660, 0.06, 'square', 0.15); setTimeout(() => tone(990, 0.08, 'square', 0.15), 60); },
  level() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.18), i * 90)); },
  quest() { [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.25), i * 80)); },
  car() { tone(90, 0.3, 'sawtooth', 0.15, 1.8); },
  ui() { tone(880, 0.04, 'square', 0.1); },
};
