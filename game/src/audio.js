// Synthesised sound: no audio files, everything is made with the Web Audio
// API at run time — the engine's hum, the wind, the ring chime and the
// touchdown thud. Silent until the player first interacts, as browsers ask.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engine = null;
    this.wind = null;
    this.started = false;
  }

  /** Build the graph on the first user gesture. Safe to call repeatedly. */
  ensure() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.started = true;
      // Engine: two detuned saws through a low-pass, pitched by throttle.
      const engineGain = this.ctx.createGain();
      engineGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.connect(engineGain);
      engineGain.connect(this.ctx.destination);
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 62;
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = 93;
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.4;
      osc1.connect(filter);
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      osc1.start();
      osc2.start();
      // Wind: looped noise through a band-pass, loud with speed.
      const noise = this.makeNoiseBuffer();
      const windSrc = this.ctx.createBufferSource();
      windSrc.buffer = noise;
      windSrc.loop = true;
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 700;
      windFilter.Q.value = 0.6;
      const windGain = this.ctx.createGain();
      windGain.gain.value = 0;
      windSrc.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(this.ctx.destination);
      windSrc.start();
      this.engine = { osc1, osc2, gain: engineGain, filter };
      this.wind = { gain: windGain, filter: windFilter };
    } catch {
      this.started = false;
    }
  }

  makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Called every frame with the plane's state; the hum follows the sim. */
  update(plane, flying) {
    if (!this.started || !this.ctx || this.muted) {
      if (this.engine) this.engine.gain.gain.value = 0;
      if (this.wind) this.wind.gain.gain.value = 0;
      return;
    }
    const t = this.ctx.currentTime;
    const throttle = plane.engineOut ? 0 : plane.throttle;
    const target = flying && !plane.onGround ? 0.05 + throttle * 0.075 : plane.onGround && throttle > 0.05 ? 0.04 + throttle * 0.05 : 0;
    this.engine.gain.gain.setTargetAtTime(target, t, 0.15);
    this.engine.osc1.frequency.setTargetAtTime(52 + throttle * 55 + plane.speed * 0.35, t, 0.2);
    this.engine.osc2.frequency.setTargetAtTime(78 + throttle * 82 + plane.speed * 0.5, t, 0.2);
    this.engine.filter.frequency.setTargetAtTime(320 + throttle * 700, t, 0.2);
    const windTarget = flying ? Math.min(0.12, plane.speed * 0.0012) : 0;
    this.wind.gain.gain.setTargetAtTime(windTarget, t, 0.3);
    this.wind.filter.frequency.setTargetAtTime(500 + plane.speed * 9, t, 0.3);
  }

  /** A two-note chime when a ring is flown through. */
  ring(style) {
    this.blip(880, 0.14, 0.16);
    window.setTimeout(() => this.blip(1318, 0.2, 0.2 + style * 0.1), 90);
  }

  /** A low thud for a touchdown, softer the gentler the landing. */
  thud(softness) {
    if (!this.started || !this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(42, this.ctx.currentTime + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25 * softness + 0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  /** A short warning buzz (stall, engine out). */
  warn() {
    this.blip(220, 0.22, 0.12);
    window.setTimeout(() => this.blip(220, 0.22, 0.12), 160);
  }

  blip(freq, duration, volume) {
    if (!this.started || !this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration + 0.02);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.engine) this.engine.gain.gain.value = 0;
    if (this.wind) this.wind.gain.gain.value = 0;
    return this.muted;
  }
}
