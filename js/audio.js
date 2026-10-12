// Procedural Web Audio: layered engines (fan whine + buzz + rumble), wind, runway/gear rumble, reverse thrust,
// chimes, PA crackle, terminal crowd ambience and security-checkpoint sounds. No audio files.
import { clamp } from './util.js';

export class FlightAudio {
  constructor() { this.ctx = null; this.bumpT = 0; this.jointT = 0; this.flightLevel = 1; this.termLevel = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.flightBus = ctx.createGain(); this.flightBus.connect(this.master);
    this.termBus = ctx.createGain(); this.termBus.gain.value = 0; this.termBus.connect(this.master);
    const sr = ctx.sampleRate;
    const mk = (secs, fill) => { const b = ctx.createBuffer(1, sr * secs, sr); const d = b.getChannelData(0); fill(d); return b; };
    this.white = mk(3, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk(5, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
    this._filt = filt; this._gain = gain; this._loop = loop; this._chain = chain;
    const F = this.flightBus;

    // cabin air / pressurisation roar
    this.cabinF = filt('lowpass', 300); this.cabinG = gain(0); chain(loop(this.brown), this.cabinF, this.cabinG, F);
    // wind: high hiss rises steeply with airspeed, plus a low buffet
    this.windHiF = filt('highpass', 2200, 0.5); this.windHiG = gain(0); chain(loop(this.white), this.windHiF, this.windHiG, F);
    this.airF = filt('bandpass', 1200, 0.5); this.airG = gain(0); chain(loop(this.white), this.airF, this.airG, F);
    // jet roar (broadband) + low engine rumble
    this.jetF = filt('bandpass', 300, 0.8); this.jetG = gain(0); chain(loop(this.white), this.jetF, this.jetG, F);
    this.engLowF = filt('lowpass', 110); this.engLowG = gain(0); chain(loop(this.brown), this.engLowF, this.engLowG, F);
    // reverse thrust: big low roar with a sweeping filter
    this.revF = filt('lowpass', 500, 1.2); this.revG = gain(0); chain(loop(this.white), this.revF, this.revG, F);
    // runway / gear rumble
    this.rumF = filt('lowpass', 80); this.rumG = gain(0); chain(loop(this.brown), this.rumF, this.rumG, F);
    // fan buzz (two engines, slightly detuned -> slow beating)
    this.fan = ctx.createOscillator(); this.fan.type = 'sawtooth'; this.fan2 = ctx.createOscillator(); this.fan2.type = 'sawtooth';
    this.fanF = filt('lowpass', 420); this.fanG = gain(0);
    this.fan.connect(this.fanF); this.fan2.connect(this.fanF); chain(this.fanF, this.fanG, F);
    // fan blade-pass whine (two engines + 2nd harmonic)
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whine2 = ctx.createOscillator(); this.whine2.type = 'sine'; this.whineH = ctx.createOscillator(); this.whineH.type = 'triangle';
    this.whineG = gain(0); this.whineHG = gain(0);
    this.whine.connect(this.whineG); this.whine2.connect(this.whineG); this.whineG.connect(F); chain(this.whineH, this.whineHG, F);
    for (const o of [this.fan, this.fan2, this.whine, this.whine2, this.whineH]) o.start();

    // terminal: crowd babble (formant-ish noise bands with syllable-rate wobble), HVAC hum, x-ray belt motor
    const T = this.termBus;
    this.crowdG = gain(0.9); this.crowdG.connect(T);
    for (let i = 0; i < 7; i++) {
      const bp = filt('bandpass', 350 + Math.random() * 1900, 3 + Math.random() * 3), vg = gain(0.0);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 2 + Math.random() * 4; const depth = gain(0.035);
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.15 + Math.random() * 0.3; const depth2 = gain(0.02);
      lfo.connect(depth); depth.connect(vg.gain); lfo2.connect(depth2); depth2.connect(vg.gain); vg.gain.value = 0.045;
      chain(loop(this.white), bp, vg, this.crowdG); lfo.start(); lfo2.start();
    }
    chain(loop(this.brown), filt('lowpass', 220), gain(0.12), T);
    this.beltF = filt('bandpass', 140, 2); this.beltG = gain(0); chain(loop(this.brown), this.beltF, this.beltG, T);
    this.beltHum = ctx.createOscillator(); this.beltHum.type = 'triangle'; this.beltHum.frequency.value = 100; const bh = gain(0.25); chain(this.beltHum, bh, this.beltG); this.beltHum.start();
    this.ctx.resume();
  }
  set(param, v, tc = 0.25) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }
  // mix between the terminal and the aircraft (0 = flight, 1 = terminal)
  setScene(term) { if (!this.ctx) return; this.set(this.termBus.gain, term ? 1 : 0, 0.6); this.set(this.flightBus.gain, term ? 0 : 1, 0.6); }
  setBelt(on) { if (this.ctx) this.set(this.beltG.gain, on ? 0.10 : 0, 0.2); }
  update(s, dt, turb, paused) {
    if (!this.ctx) return;
    const n = clamp(s.n1 / 100, 0, 1), spd = clamp(s.speed / 230, 0, 1), air = s.ground ? 0 : 1;
    // fan buzz + blade-pass whine
    this.set(this.fan.frequency, 26 + s.n1 * 1.25); this.set(this.fan2.frequency, 26.6 + s.n1 * 1.27);
    this.set(this.fanG.gain, 0.010 + 0.06 * n * n + 0.03 * clamp((s.n1 - 85) / 10, 0, 1));
    const bpf = 380 + s.n1 * 24;
    this.set(this.whine.frequency, bpf); this.set(this.whine2.frequency, bpf * 1.006); this.set(this.whineH.frequency, bpf * 2.01);
    // whine is most noticeable at low/medium power (taxi, approach), masked at full power
    const wAmt = s.n1 > 1 ? 0.004 + 0.012 * Math.sin(Math.PI * clamp(n / 0.9, 0, 1)) : 0;
    this.set(this.whineG.gain, wAmt); this.set(this.whineHG.gain, wAmt * 0.25);
    this.set(this.jetF.frequency, 180 + 520 * n);
    this.set(this.jetG.gain, 0.01 * n + 0.30 * n * n * n);
    this.set(this.engLowG.gain, 0.05 * n + 0.25 * n * n * n);
    // reverse thrust roar
    this.set(this.revG.gain, 0.42 * s.rev, 0.4); this.set(this.revF.frequency, 300 + 700 * s.rev, 0.5);
    // cabin + wind
    this.set(this.cabinF.frequency, 260 + 520 * spd + 200 * s.rev);
    const roar = 0.06 + 0.15 * clamp(s.speed / 160, 0, 1) + s.gear * 0.08 * clamp(s.speed / 100, 0, 1) * air + s.spoil * 0.06 * air;
    this.set(this.cabinG.gain, roar * (1 + turb * 0.25 * Math.sin(performance.now() / 170)));
    this.set(this.windHiG.gain, 0.0015 + 0.018 * spd * spd * (1 + turb * 0.3));
    this.set(this.airG.gain, 0.005 + 0.03 * spd + 0.012 * s.flaps * air);
    this.set(this.airF.frequency, 800 + 900 * spd);
    // runway rumble + pavement joints + centreline-light thumps
    const rum = s.ground ? clamp(s.speed / 70, 0, 1) * 0.6 + (s.speed > 0.5 ? 0.06 : 0) : 0;
    if (s.ground && s.speed > 2 && !paused) {
      this.bumpT -= dt;
      if (this.bumpT <= 0) { this.bumpT = Math.max(0.12, 18 / (s.speed + 4)) * (0.6 + Math.random()); this.thunk(38 + Math.random() * 20, 0.18, 0.12 + 0.2 * clamp(s.speed / 70, 0, 1)); }
      if (s.speed > 25) { this.jointT -= dt; if (this.jointT <= 0) { this.jointT = 15 / s.speed; this.thunk(70, 0.06, 0.05 + 0.06 * clamp(s.speed / 70, 0, 1)); } }
    }
    this.set(this.rumG.gain, rum, 0.15);
  }
  // ---- one-shot sounds ----
  env(node, t0, peak, att, dec) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + att); node.gain.exponentialRampToValueAtTime(0.0001, t0 + att + dec); }
  tone(f, t0, peak, dec, type = 'sine', dest = null) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; o.connect(g); g.connect(dest || this.master); this.env(g, t0, peak, 0.01, dec); o.start(t0); o.stop(t0 + dec + 0.1); return o; }
  noiseBurst(t0, f, q, peak, dec, type = 'lowpass', dest = null) { const c = this.ctx, s = c.createBufferSource(); s.buffer = this.white; const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = c.createGain(); s.connect(b); b.connect(g); g.connect(dest || this.master); this.env(g, t0, peak, 0.01, dec); s.start(t0, Math.random()); s.stop(t0 + dec + 0.1); }
  thunk(f = 55, dec = 0.35, peak = 0.5, delay = 0) { if (!this.ctx) return; const t = this.ctx.currentTime + delay; const o = this.tone(f, t, peak, dec, 'sine', this.flightBus); o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dec); this.noiseBurst(t, 260, 0.7, peak * 0.5, dec * 0.6, 'lowpass', this.flightBus); }
  play(name) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    switch (name) {
      case 'ding': this.tone(1046, t, 0.16, 1.8); this.tone(2093, t, 0.03, 0.9); this.tone(2890, t, 0.012, 0.5); break;
      case 'bingbong': this.tone(932, t, 0.15, 1.3); this.tone(1864, t, 0.025, 0.6); this.tone(740, t + 0.55, 0.15, 1.6); this.tone(1480, t + 0.55, 0.025, 0.7); break;
      case 'door': this.thunk(70, 0.4, 0.5); this.noiseBurst(t + 0.05, 2500, 1.2, 0.08, 0.06, 'bandpass'); this.thunk(110, 0.15, 0.2, 0.35); break;
      case 'gearUp': this.thunk(50, 0.45, 0.7); this.noiseBurst(t, 220, 0.6, 0.25, 3.2); this.whir(t, 3, 420); this.thunk(62, 0.35, 0.6, 3.6); this.thunk(45, 0.25, 0.35, 3.75); break;
      case 'gearDown': this.noiseBurst(t, 200, 0.6, 0.3, 2.5); this.whir(t, 2.2, 380); this.thunk(48, 0.5, 0.8, 1.9); break;
      case 'flaps': this.whir(t, 3.2, 520); break;
      case 'click': this.tone(1800, t, 0.03, 0.05); break;
      case 'touchdown': this.thunk(42, 0.6, 0.95); this.noiseBurst(t, 3200, 2, 0.14, 0.12, 'bandpass'); this.noiseBurst(t + 0.09, 2900, 2, 0.1, 0.1, 'bandpass'); this.thunk(60, 0.3, 0.4, 0.7); break;
      case 'pa': { // PA key-up: click, crackle, a little line hum
        this.noiseBurst(t, 2400, 0.8, 0.06, 0.03, 'bandpass');
        for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.05 + Math.random() * 0.35, 1800 + Math.random() * 1600, 4, 0.02 + Math.random() * 0.03, 0.015 + Math.random() * 0.03, 'bandpass');
        this.tone(120, t + 0.02, 0.012, 0.6, 'square'); break; }
      case 'termchime': this.tone(784, t, 0.12, 1.2); this.tone(988, t + 0.45, 0.12, 1.2); this.tone(1175, t + 0.9, 0.12, 1.6); break;
      case 'beep': this.tone(1760, t, 0.08, 0.12, 'square'); this.tone(1760, t + 0.18, 0.08, 0.14, 'square'); break;
      case 'okbeep': this.tone(1320, t, 0.07, 0.25, 'sine'); this.tone(1980, t + 0.12, 0.05, 0.35, 'sine'); break;
      case 'clack': this.noiseBurst(t, 1600, 1.5, 0.22, 0.07, 'bandpass'); this.tone(420, t, 0.08, 0.08, 'triangle'); this.noiseBurst(t + 0.09, 1200, 1.5, 0.1, 0.05, 'bandpass'); break;
      case 'thud': this.tone(90, t, 0.3, 0.2); this.noiseBurst(t, 400, 0.8, 0.12, 0.12); break;
      case 'scanner': this.whir(t, 2.4, 300); this.noiseBurst(t, 900, 0.7, 0.05, 2.2, 'bandpass'); break;
      case 'step': this.noiseBurst(t, 500, 0.9, 0.05, 0.05); break;
      case 'whoosh': this.noiseBurst(t, 700, 0.6, 0.06, 0.5, 'bandpass'); break;
    }
  }
  whir(t0, dur, f) { const c = this.ctx, o = c.createOscillator(), b = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.8, t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.5); o.frequency.linearRampToValueAtTime(f * 0.9, t0 + dur); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 3; o.connect(b); b.connect(g); g.connect(this.master); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.025, t0 + 0.3); g.gain.setValueAtTime(0.025, t0 + dur - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.start(t0); o.stop(t0 + dur + 0.1); }
  setPaused(p) { if (!this.ctx) return; this.set(this.master.gain, p ? 0.35 : 0.85, 0.3); }
}
