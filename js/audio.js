// Procedural Web Audio: engines, cabin air, runway rumble, chimes, gear, touchdown. No audio files.
import { clamp } from './util.js';

export class FlightAudio {
  constructor() { this.ctx = null; this.enabled = true; this.bumpT = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    const sr = ctx.sampleRate;
    const mk = (secs, fill) => { const b = ctx.createBuffer(1, sr * secs, sr); const d = b.getChannelData(0); fill(d); return b; };
    this.white = mk(3, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk(5, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 2); return s; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };

    // cabin air roar
    this.cabinF = filt('lowpass', 300); this.cabinG = gain(0.0);
    chain(loop(this.brown), this.cabinF, this.cabinG, this.master);
    // airflow hiss
    this.airF = filt('bandpass', 1400, 0.5); this.airG = gain(0);
    chain(loop(this.white), this.airF, this.airG, this.master);
    // jet roar
    this.jetF = filt('bandpass', 300, 0.8); this.jetG = gain(0);
    chain(loop(this.white), this.jetF, this.jetG, this.master);
    // runway rumble
    this.rumF = filt('lowpass', 80); this.rumG = gain(0);
    chain(loop(this.brown), this.rumF, this.rumG, this.master);
    // fan hum (low buzz) and turbine whine
    this.fan = ctx.createOscillator(); this.fan.type = 'sawtooth'; this.fan.frequency.value = 40;
    this.fan2 = ctx.createOscillator(); this.fan2.type = 'sawtooth'; this.fan2.frequency.value = 40.7;
    this.fanF = filt('lowpass', 420); this.fanG = gain(0);
    this.fan.connect(this.fanF); this.fan2.connect(this.fanF); chain(this.fanF, this.fanG, this.master);
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 900;
    this.whineG = gain(0); chain(this.whine, this.whineG, this.master);
    this.fan.start(); this.fan2.start(); this.whine.start();
    this.ctx.resume();
  }
  set(param, v, tc = 0.25) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }
  update(s, dt, turb, paused) {
    if (!this.ctx) return;
    const n = clamp(s.n1 / 100, 0, 1), spd = clamp(s.speed / 230, 0, 1);
    const air = s.ground ? 0 : 1;
    this.set(this.fan.frequency, 26 + s.n1 * 1.25); this.set(this.fan2.frequency, 26.6 + s.n1 * 1.27);
    this.set(this.fanG.gain, 0.012 + 0.07 * n * n);
    this.set(this.whine.frequency, 650 + s.n1 * 26);
    this.set(this.whineG.gain, s.n1 > 1 ? 0.0025 + 0.008 * n * n : 0);
    this.set(this.jetF.frequency, 180 + 520 * n);
    this.set(this.jetG.gain, 0.01 * n + 0.30 * n * n * n + 0.22 * s.rev);
    this.set(this.cabinF.frequency, 260 + 520 * spd + 200 * s.rev);
    const roar = 0.06 + 0.17 * clamp(s.speed / 160, 0, 1) + s.gear * 0.07 * clamp(s.speed / 100, 0, 1) * air + s.spoil * 0.05 * air;
    this.set(this.cabinG.gain, roar * (1 + turb * 0.25 * Math.sin(performance.now() / 170)));
    this.set(this.airG.gain, 0.006 + 0.03 * spd);
    // runway rumble + pavement joint bumps
    let rum = s.ground ? clamp(s.speed / 70, 0, 1) * 0.55 + (s.speed > 0.5 ? 0.06 : 0) : 0;
    if (s.ground && s.speed > 2 && !paused) {
      this.bumpT -= dt;
      if (this.bumpT <= 0) { this.bumpT = Math.max(0.12, 18 / (s.speed + 4)) * (0.6 + Math.random()); this.thunk(38 + Math.random() * 20, 0.18, 0.12 + 0.2 * clamp(s.speed / 70, 0, 1)); }
    }
    this.set(this.rumG.gain, rum, 0.15);
  }
  // ---- one-shot sounds ----
  env(node, t0, peak, att, dec) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + att); node.gain.exponentialRampToValueAtTime(0.0001, t0 + att + dec); }
  tone(f, t0, peak, dec, type = 'sine') { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; o.connect(g); g.connect(this.master); this.env(g, t0, peak, 0.01, dec); o.start(t0); o.stop(t0 + dec + 0.1); return o; }
  noiseBurst(t0, f, q, peak, dec, type = 'lowpass') { const c = this.ctx, s = c.createBufferSource(); s.buffer = this.white; const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = c.createGain(); s.connect(b); b.connect(g); g.connect(this.master); this.env(g, t0, peak, 0.01, dec); s.start(t0, Math.random()); s.stop(t0 + dec + 0.1); }
  thunk(f = 55, dec = 0.35, peak = 0.5, delay = 0) { if (!this.ctx) return; const t = this.ctx.currentTime + delay; const o = this.tone(f, t, peak, dec); o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dec); this.noiseBurst(t, 260, 0.7, peak * 0.5, dec * 0.6); }
  play(name) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    switch (name) {
      case 'ding': this.tone(1046, t, 0.16, 1.8); this.tone(2093, t, 0.03, 0.9); this.tone(2890, t, 0.012, 0.5); break;
      case 'bingbong': this.tone(932, t, 0.15, 1.3); this.tone(1864, t, 0.025, 0.6); this.tone(740, t + 0.55, 0.15, 1.6); this.tone(1480, t + 0.55, 0.025, 0.7); break;
      case 'door': this.thunk(70, 0.4, 0.5); this.noiseBurst(t + 0.05, 2500, 1.2, 0.08, 0.06, 'bandpass'); this.thunk(110, 0.15, 0.2, 0.35); break;
      case 'gearUp': this.thunk(50, 0.45, 0.7); this.noiseBurst(t, 220, 0.6, 0.25, 3.2); this.whir(t, 3, 420); this.thunk(65, 0.3, 0.45, 3.6); break;
      case 'gearDown': this.noiseBurst(t, 200, 0.6, 0.3, 2.5); this.whir(t, 2.2, 380); this.thunk(48, 0.5, 0.8, 1.9); break;
      case 'flaps': this.whir(t, 3.2, 520); break;
      case 'click': this.tone(1800, t, 0.03, 0.05); break;
      case 'touchdown': this.thunk(42, 0.6, 0.95); this.noiseBurst(t, 3200, 2, 0.14, 0.12, 'bandpass'); this.noiseBurst(t + 0.09, 2900, 2, 0.1, 0.1, 'bandpass'); this.thunk(60, 0.3, 0.4, 0.7); break;
    }
  }
  whir(t0, dur, f) { const c = this.ctx, o = c.createOscillator(), b = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.8, t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.5); o.frequency.linearRampToValueAtTime(f * 0.9, t0 + dur); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 3; o.connect(b); b.connect(g); g.connect(this.master); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.025, t0 + 0.3); g.gain.setValueAtTime(0.025, t0 + dur - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.start(t0); o.stop(t0 + dur + 0.1); }
  setPaused(p) { if (!this.ctx) return; this.set(this.master.gain, p ? 0.35 : 0.85, 0.3); }
}
