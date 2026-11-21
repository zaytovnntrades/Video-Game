// Synthesised sound effects (WebAudio, no files): punches, blasts, beams, blinks...
export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.7; this.hum = null; }
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination); } catch { this.ctx = null; }
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  noise(dur) {
    const c = this.ctx, b = c.createBuffer(1, Math.max(1, (c.sampleRate * dur) | 0), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b; return s;
  }
  env(node, t, a, peak, dur) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); node.connect(g); g.connect(this.master); return g; }
  tone(type, f0, f1, dur, peak = 0.3) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(o, t, 0.005, peak, dur); o.start(t); o.stop(t + dur + 0.05);
  }
  thump(freq, dur, peak, hp = 400) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const n = this.noise(dur); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(hp * 4, t); f.frequency.exponentialRampToValueAtTime(hp, t + dur);
    n.connect(f); this.env(f, t, 0.003, peak, dur); n.start(t);
    this.tone('sine', freq, freq * 0.4, dur, peak * 0.8);
  }
  play(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'swing': this.thump(200, 0.08, 0.08, 1500); break;
      case 'hit': this.thump(140, 0.12, 0.45, 900); break;
      case 'heavy': this.thump(90, 0.3, 0.7, 500); this.tone('square', 220, 60, 0.18, 0.08); break;
      case 'guard': this.tone('triangle', 900, 600, 0.08, 0.18); this.thump(300, 0.05, 0.15, 2000); break;
      case 'break': this.tone('sawtooth', 600, 80, 0.35, 0.2); this.thump(80, 0.3, 0.5); break;
      case 'blast': this.tone('sawtooth', 900, 300, 0.16, 0.08); this.tone('sine', 500, 1200, 0.1, 0.1); break;
      case 'pop': this.thump(180, 0.18, 0.35, 1200); break;
      case 'beam': this.tone('sawtooth', 110, 90, 1.1, 0.14); this.tone('square', 220, 330, 1.0, 0.05); this.thump(120, 0.6, 0.3, 300); break;
      case 'charge': this.tone('sawtooth', 70, 140, 0.6, 0.08); break;
      case 'blink': this.tone('sine', 1800, 400, 0.12, 0.15); this.tone('triangle', 2400, 1200, 0.08, 0.07); break;
      case 'dash': this.thump(400, 0.15, 0.12, 2500); break;
      case 'ascend': this.tone('sawtooth', 60, 400, 1.0, 0.18); this.tone('sine', 120, 900, 0.9, 0.2); break;
      case 'apex': this.tone('sawtooth', 50, 30, 1.6, 0.25); this.thump(50, 1.2, 0.8, 200); break;
      case 'ko': this.thump(60, 1.0, 0.8, 250); this.tone('sine', 300, 40, 1.2, 0.3); break;
      case 'land': this.thump(80, 0.3, 0.5, 300); break;
      case 'ui': this.tone('triangle', 660, 880, 0.06, 0.12); break;
      case 'go': this.tone('square', 440, 880, 0.25, 0.12); break;
    }
  }
}
