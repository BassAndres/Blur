// Procedural audio via the Web Audio API. All sounds are synthesized at runtime
// (engine drone, power-up zaps, impacts, UI blips, plus a looping synth music bed)
// so the game ships with no audio asset files and no licensing concerns.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.engineNodes = null;
    this.enabledMusic = true;
    this.enabledSfx = true;
    this._musicTimer = null;
    this._musicStep = 0;
    this.started = false;
  }

  // Must be created/resumed from a user gesture (browser autoplay policy).
  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.enabledMusic ? 0.18 : 0;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.enabledSfx ? 0.9 : 0;
    this.sfxGain.connect(this.master);
    this.started = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMusic(on) {
    this.enabledMusic = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.18 : 0;
  }
  setSfx(on) {
    this.enabledSfx = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.9 : 0;
  }

  _now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---- generic one-shot tone ----
  tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, attack = 0.005, slideTo = null }) {
    if (!this.ctx || !this.enabledSfx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noiseBurst({ dur = 0.25, vol = 0.4, lp = 1200 }) {
    if (!this.ctx || !this.enabledSfx) return;
    const t = this._now();
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = lp;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  // ---- named SFX ----
  ui() { this.tone({ freq: 660, type: 'square', dur: 0.08, vol: 0.18 }); }
  uiBack() { this.tone({ freq: 320, type: 'square', dur: 0.09, vol: 0.16 }); }
  pickup() { this.tone({ freq: 880, type: 'triangle', dur: 0.12, vol: 0.22, slideTo: 1500 }); }
  countdownTick() { this.tone({ freq: 500, type: 'sine', dur: 0.18, vol: 0.3 }); }
  countdownGo() { this.tone({ freq: 900, type: 'sawtooth', dur: 0.4, vol: 0.34, slideTo: 1400 }); }
  fireBolt() { this.tone({ freq: 720, type: 'sawtooth', dur: 0.18, vol: 0.25, slideTo: 300 }); }
  fireMissile() { this.tone({ freq: 260, type: 'sawtooth', dur: 0.3, vol: 0.25, slideTo: 600 }); }
  dropMine() { this.tone({ freq: 180, type: 'square', dur: 0.12, vol: 0.22 }); }
  shock() { this.noiseBurst({ dur: 0.3, vol: 0.4, lp: 3000 }); this.tone({ freq: 1200, type: 'sawtooth', dur: 0.25, vol: 0.2, slideTo: 200 }); }
  shield() { this.tone({ freq: 420, type: 'sine', dur: 0.3, vol: 0.22, slideTo: 700 }); }
  nitro() { this.tone({ freq: 300, type: 'sawtooth', dur: 0.5, vol: 0.22, slideTo: 1100 }); }
  barge() { this.noiseBurst({ dur: 0.22, vol: 0.45, lp: 800 }); }
  repair() { this.tone({ freq: 520, type: 'triangle', dur: 0.25, vol: 0.2, slideTo: 880 }); }
  hit() { this.noiseBurst({ dur: 0.25, vol: 0.5, lp: 1500 }); this.tone({ freq: 140, type: 'square', dur: 0.18, vol: 0.3 }); }
  explosion() { this.noiseBurst({ dur: 0.6, vol: 0.7, lp: 900 }); this.tone({ freq: 90, type: 'sawtooth', dur: 0.5, vol: 0.4, slideTo: 40 }); }
  finish() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.25 }), i * 120)); }

  // ---- continuous engine sound ----
  startEngine() {
    if (!this.ctx || this.engineNodes) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filt = this.ctx.createBiquadFilter();
    osc.type = 'sawtooth'; osc.frequency.value = 60;
    osc2.type = 'square'; osc2.frequency.value = 90;
    filt.type = 'lowpass'; filt.frequency.value = 600;
    g.gain.value = 0;
    osc.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc2.start(t);
    this.engineNodes = { osc, osc2, g, filt };
  }
  updateEngine(speed01, throttle) {
    if (!this.engineNodes || !this.ctx) return;
    const { osc, osc2, g, filt } = this.engineNodes;
    const base = 55 + speed01 * 240;
    osc.frequency.setTargetAtTime(base, this._now(), 0.05);
    osc2.frequency.setTargetAtTime(base * 1.5, this._now(), 0.05);
    filt.frequency.setTargetAtTime(500 + speed01 * 2500, this._now(), 0.08);
    g.gain.setTargetAtTime(this.enabledSfx ? (0.04 + throttle * 0.06 + speed01 * 0.05) : 0, this._now(), 0.08);
  }
  stopEngine() {
    if (!this.engineNodes) return;
    const { osc, osc2, g } = this.engineNodes;
    try { g.gain.setTargetAtTime(0, this._now(), 0.05); osc.stop(this._now() + 0.2); osc2.stop(this._now() + 0.2); } catch (e) {}
    this.engineNodes = null;
  }

  // ---- looping procedural music bed (driving synth arpeggio) ----
  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    const scale = [220, 261.6, 293.66, 349.23, 392, 261.6, 329.63, 196];
    const bass = [55, 55, 73.42, 49];
    this._musicStep = 0;
    const stepDur = 0.22;
    const playStep = () => {
      if (!this.ctx) return;
      const i = this._musicStep % scale.length;
      const t = this._now();
      // arp lead
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = scale[i] * 2;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.4);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + stepDur * 1.5);
      // bass every 2 steps
      if (this._musicStep % 2 === 0) {
        const b = this.ctx.createOscillator();
        const bg = this.ctx.createGain();
        b.type = 'sawtooth';
        b.frequency.value = bass[(this._musicStep / 2) % bass.length];
        bg.gain.setValueAtTime(0.0, t);
        bg.gain.linearRampToValueAtTime(0.4, t + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.8);
        b.connect(bg); bg.connect(this.musicGain);
        b.start(t); b.stop(t + stepDur * 2);
      }
      this._musicStep++;
    };
    this._musicTimer = setInterval(playStep, stepDur * 1000);
  }
  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}

export const audio = new AudioEngine();
