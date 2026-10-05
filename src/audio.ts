// Synthesized audio (engine, weapons, alerts, music sequencer) plus the recorded radio voices.

import VOICE from './voice-manifest.json';

export type Track = 'none' | 'calm' | 'combat' | 'boss' | 'final';

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Radio clips by "WHO|text" (scripts/voice/generate.py). */
const CLIPS: Record<string, { file: string; dur: number }> = VOICE;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private gunBuf!: AudioBuffer;
  private boomBuf!: AudioBuffer;
  private smallBoomBuf!: AudioBuffer;
  private engine: {
    rumble: OscillatorNode;
    whine: OscillatorNode;
    roarF: BiquadFilterNode;
    roarG: GainNode;
    whineG: GainNode;
    windF: BiquadFilterNode;
    windG: GainNode;
    rumbleG: GainNode;
  } | null = null;
  private lockOsc: OscillatorNode | null = null;
  private lockGain: GainNode | null = null;
  private alertOsc: OscillatorNode | null = null;
  private alertGain: GainNode | null = null;
  music: Music | null = null;
  muted = false;
  voiceOn = true;
  private voiceLoads = new Map<string, Promise<AudioBuffer | null>>();
  private voiceSrc: AudioBufferSourceNode | null = null;
  private voiceReq = 0;
  private lastShot = 0;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);
    this.buildBuffers();
    this.buildEngine();
    this.buildTones();
    this.music = new Music(ctx, this.musicBus, this.noiseBuf);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 0.8;
    this.voiceBus.connect(this.master);
    for (const clip of Object.values(CLIPS)) void this.loadVoice(clip.file);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    if (m) this.stopSpeech();
  }

  setMusicVolume(v: number) {
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  private buildBuffers() {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.gunBuf = ctx.createBuffer(1, Math.floor(sr * 0.09), sr);
    const gd = this.gunBuf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < gd.length; i++) {
      const t = i / sr;
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      gd[i] = (lp * 1.4 * Math.exp(-t / 0.016) + Math.sin(2 * Math.PI * 95 * t) * 0.9 * Math.exp(-t / 0.03)) * 0.8;
    }
    const boom = (dur: number, decay: number, thumpF: number) => {
      const b = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const d = b.getChannelData(0);
      let brown = 0;
      let lp2 = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        brown = (brown + (Math.random() * 2 - 1) * 0.08) * 0.995;
        lp2 += (Math.random() * 2 - 1 - lp2) * 0.12;
        const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
        const crackle = Math.random() < 0.002 * Math.exp(-t / (decay * 0.6)) ? (Math.random() - 0.5) * 2 : 0;
        const f = thumpF * Math.exp(-t * 2.2) + 26;
        d[i] = (brown * 3.2 + lp2 * 0.9 + crackle) * env + Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (decay * 0.5)) * 0.9;
      }
      return b;
    };
    this.boomBuf = boom(2.6, 0.55, 70);
    this.smallBoomBuf = boom(1.1, 0.22, 110);
  }

  private buildEngine() {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.sfx);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    const roarF = ctx.createBiquadFilter();
    roarF.type = 'lowpass';
    roarF.frequency.value = 600;
    const roarG = ctx.createGain();
    roarG.gain.value = 0;
    noise.connect(roarF).connect(roarG).connect(out);
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 900;
    windF.Q.value = 0.6;
    const windG = ctx.createGain();
    windG.gain.value = 0;
    noise.connect(windF).connect(windG).connect(out);
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.value = 220;
    const whineF = ctx.createBiquadFilter();
    whineF.type = 'lowpass';
    whineF.frequency.value = 1400;
    const whineG = ctx.createGain();
    whineG.gain.value = 0;
    whine.connect(whineF).connect(whineG).connect(out);
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 48;
    const rumbleG = ctx.createGain();
    rumbleG.gain.value = 0;
    rumble.connect(rumbleG).connect(out);
    noise.start();
    whine.start();
    rumble.start();
    this.engine = { rumble, whine, roarF, roarG, whineG, windF, windG, rumbleG };
  }

  private buildTones() {
    const ctx = this.ctx!;
    this.lockOsc = ctx.createOscillator();
    this.lockOsc.type = 'square';
    this.lockOsc.frequency.value = 1150;
    this.lockGain = ctx.createGain();
    this.lockGain.gain.value = 0;
    const lf = ctx.createBiquadFilter();
    lf.type = 'lowpass';
    lf.frequency.value = 3000;
    this.lockOsc.connect(lf).connect(this.lockGain).connect(this.sfx);
    this.lockOsc.start();
    this.alertOsc = ctx.createOscillator();
    this.alertOsc.type = 'square';
    this.alertOsc.frequency.value = 1600;
    this.alertGain = ctx.createGain();
    this.alertGain.gain.value = 0;
    const af = ctx.createBiquadFilter();
    af.type = 'lowpass';
    af.frequency.value = 3500;
    this.alertOsc.connect(af).connect(this.alertGain).connect(this.sfx);
    this.alertOsc.start();
  }

  /** Called every frame. */
  updateEngine(speed: number, throttle: number, boosting: boolean, active: boolean, time: number) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const e = this.engine;
    const on = active ? 1 : 0;
    const s = speed / 400;
    e.roarG.gain.setTargetAtTime(on * (0.12 + throttle * 0.22 + (boosting ? 0.18 : 0)), t, 0.08);
    e.roarF.frequency.setTargetAtTime(350 + throttle * 900 + (boosting ? 900 : 0), t, 0.1);
    e.whine.frequency.setTargetAtTime(160 + s * 260 + throttle * 60, t, 0.15);
    e.whineG.gain.setTargetAtTime(on * (0.018 + throttle * 0.02), t, 0.1);
    e.rumble.frequency.setTargetAtTime(40 + throttle * 18, t, 0.2);
    e.rumbleG.gain.setTargetAtTime(on * (0.12 + (boosting ? 0.14 : 0)), t, 0.1);
    e.windG.gain.setTargetAtTime(on * Math.min(0.32, s * s * 0.22), t, 0.1);
    e.windF.frequency.setTargetAtTime(500 + s * 900, t, 0.1);
    void time;
  }

  setLockTone(state: 'none' | 'locking' | 'locked', time: number) {
    if (!this.ctx || !this.lockGain || !this.lockOsc) return;
    let v = 0;
    if (state === 'locking') v = (time * 9) % 1 < 0.45 ? 0.035 : 0;
    else if (state === 'locked') v = 0.04;
    this.lockOsc.frequency.setTargetAtTime(state === 'locked' ? 1550 : 1150, this.ctx.currentTime, 0.005);
    this.lockGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.004);
  }

  setMissileAlert(level: number, time: number) {
    if (!this.ctx || !this.alertGain || !this.alertOsc) return;
    let v = 0;
    if (level > 0) {
      const rate = level > 1 ? 14 : 7;
      v = (time * rate) % 1 < 0.5 ? 0.045 : 0;
      this.alertOsc.frequency.setTargetAtTime((time * rate) % 2 < 1 ? 1700 : 1350, this.ctx.currentTime, 0.002);
    }
    this.alertGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.003);
  }

  private out(vol: number, pan = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  gunshot(vol = 0.35) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.03) return;
    this.lastShot = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.gunBuf;
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    src.connect(this.out(vol));
    src.start();
  }

  enemyGun(vol: number, pan: number) {
    if (!this.ctx || vol < 0.01) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.gunBuf;
    src.playbackRate.value = 1.3;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    src.connect(f).connect(this.out(vol, pan));
    src.start();
  }

  explosion(vol: number, big: boolean, pan = 0) {
    if (!this.ctx || vol < 0.01) return;
    const src = this.ctx.createBufferSource();
    src.buffer = big ? this.boomBuf : this.smallBoomBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = big ? 2400 : 3200;
    src.connect(f).connect(this.out(vol, pan));
    src.start();
  }

  missileLaunch(vol = 0.5, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 1.1);
    const g = this.out(0, pan);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 1.4);
    this.tone(180, 0.08, 'sawtooth', vol * 0.3, 0, 60);
  }

  hitTick(vol = 0.2) {
    this.tone(2400, 0.03, 'square', vol, 0, 1400);
  }

  playerHit(heavy: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = heavy ? 900 : 2200;
    const g = this.out(0);
    g.gain.setValueAtTime(heavy ? 0.9 : 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.6 : 0.12));
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 0.7);
    this.tone(heavy ? 140 : 620, heavy ? 0.3 : 0.06, 'triangle', heavy ? 0.5 : 0.18, 0, heavy ? 50 : 300);
  }

  tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, endFreq?: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = this.out(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  chime(level = 0) {
    const base = 76 + level * 2;
    [0, 4, 7, 12].forEach((s, i) => this.tone(midi(base + s), 0.25, 'triangle', 0.12, i * 0.05));
  }

  bonus() {
    this.tone(midi(84), 0.1, 'square', 0.05);
    this.tone(midi(91), 0.14, 'square', 0.05, 0.06);
  }

  comboTick(n: number) {
    this.tone(midi(72 + Math.min(n, 12) * 2), 0.12, 'triangle', 0.1);
  }

  radioBlip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 0.8;
    const g = this.out(0);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 0.15);
    this.tone(1250, 0.07, 'sine', 0.06, 0.02);
  }

  /** Cockpit warning: short soft double chirps. (A square-wave two-tone read as an air horn on phone speakers.) */
  klaxon(times = 4) {
    for (let i = 0; i < times; i++) {
      this.tone(1180, 0.09, 'triangle', 0.1, i * 0.5);
      this.tone(1180, 0.09, 'triangle', 0.1, i * 0.5 + 0.15);
    }
  }

  countdownBeep(final = false) {
    this.tone(final ? 1320 : 880, final ? 0.4 : 0.12, 'sine', 0.14);
  }

  catapult() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 1.6);
    const g = this.out(0);
    g.gain.setValueAtTime(0.05, t);
    g.gain.linearRampToValueAtTime(0.5, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    src.connect(f).connect(g);
    src.start(t);
    src.stop(t + 2.5);
    this.tone(90, 0.5, 'sine', 0.5, 1.55, 40);
  }

  flare() {
    this.tone(1800, 0.12, 'sawtooth', 0.05, 0, 500);
  }

  whoosh(vol: number, pan: number) {
    if (!this.ctx || vol < 0.02) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.9);
    const g = this.out(0, pan);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 1.05);
  }

  /** Deep hit under the NEXT MISSION card. Sine drops only: sawtooth drones here came through
   *  phone speakers (which can't play the fundamental) as a long buzzing horn. */
  stinger() {
    if (!this.ctx) return;
    this.tone(70, 2.2, 'sine', 0.35, 0, 38);
    this.tone(105, 1.2, 'sine', 0.12, 0, 60);
    this.explosion(0.35, true);
  }

  setTrack(track: Track, immediate = false) {
    this.music?.setTrack(track, immediate);
  }

  /** Plays the line's radio clip, cutting off any line still playing. Returns the clip
   *  length in seconds (0 when nothing plays) so the caption can stay up as long. */
  speak(text: string, who: string): number {
    this.stopSpeech();
    const clip = CLIPS[`${who}|${text}`];
    if (!clip) {
      console.warn(`No radio clip for ${who}: ${text}`);
      return 0;
    }
    if (!this.voiceOn || this.muted || !this.ctx) return 0;
    const ctx = this.ctx;
    const req = this.voiceReq;
    const asked = ctx.currentTime;
    void this.loadVoice(clip.file).then((buf) => {
      // Skip a clip that arrives too late to match its caption.
      if (!buf || req !== this.voiceReq || ctx.currentTime - asked > 1) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceBus);
      src.start(ctx.currentTime + 0.08); // after the squelch
      src.onended = () => {
        if (this.voiceSrc === src) this.voiceSrc = null;
      };
      this.voiceSrc = src;
    });
    return clip.dur + 0.08;
  }

  stopSpeech() {
    this.voiceReq++;
    try {
      this.voiceSrc?.stop();
    } catch {
      // Already stopped.
    }
    this.voiceSrc = null;
  }

  private loadVoice(file: string): Promise<AudioBuffer | null> {
    let p = this.voiceLoads.get(file);
    if (!p && this.ctx) {
      const ctx = this.ctx;
      p = fetch(file)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${file}`))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => {
          this.voiceLoads.delete(file); // try again next time
          return null;
        });
      this.voiceLoads.set(file, p);
    }
    return p ?? Promise.resolve(null);
  }
}

// ---------------------------------------------------------------- Music

interface Pattern {
  bpm: number;
  bars: number;
  step: (m: Music, bar: number, s: number, t: number, phrase: number) => void;
}

class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;
  private track: Track = 'none';
  private pending: Track | null = null;
  private stepIdx = 0;
  private nextTime = 0;
  private timer: number;

  constructor(ctx: AudioContext, out: GainNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(out);
    this.noise = noise;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  setTrack(track: Track, immediate: boolean) {
    if (track === this.track && !this.pending) return;
    if (immediate || this.track === 'none' || track === 'none') {
      this.track = track;
      this.pending = null;
      this.stepIdx = 0;
      this.nextTime = this.ctx.currentTime + 0.05;
      if (track === 'none') {
        this.out.gain.cancelScheduledValues(this.ctx.currentTime);
        this.out.gain.setValueAtTime(0, this.ctx.currentTime);
      } else {
        this.out.gain.cancelScheduledValues(this.ctx.currentTime);
        this.out.gain.setValueAtTime(1, this.ctx.currentTime);
      }
    } else this.pending = track;
  }

  private tick() {
    if (this.nextTime < this.ctx.currentTime - 0.5) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.track !== 'none' && this.nextTime < this.ctx.currentTime + 0.15) {
      const pat = PATTERNS[this.track];
      const total = pat.bars * 16;
      const s = this.stepIdx % 16;
      const bar = Math.floor(this.stepIdx / 16) % pat.bars;
      const phrase = Math.floor(this.stepIdx / total);
      // Switch tracks on an even bar line so transitions land on the beat.
      if (s === 0 && this.pending && bar % 2 === 0) {
        this.track = this.pending;
        this.pending = null;
        this.stepIdx = 0;
        continue;
      }
      pat.step(this, bar, s, this.nextTime, phrase);
      this.nextTime += 60 / pat.bpm / 4;
      this.stepIdx++;
    }
  }

  dispose() {
    clearInterval(this.timer);
  }

  // Instruments ---------------------------------------------------
  private env(t: number, vol: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  kick(t: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    o.connect(this.env(t, vol, 0.002, 0.32));
    o.start(t);
    o.stop(t + 0.4);
  }

  snare(t: number, vol: number) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1300;
    n.connect(f).connect(this.env(t, vol, 0.002, 0.17));
    n.start(t, Math.random());
    n.stop(t + 0.25);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    o.connect(this.env(t, vol * 0.6, 0.002, 0.09));
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t: number, vol: number, open = false) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    n.connect(f).connect(this.env(t, vol, 0.001, open ? 0.22 : 0.035));
    n.start(t, Math.random());
    n.stop(t + 0.3);
  }

  crash(t: number, vol: number) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 4500;
    n.connect(f).connect(this.env(t, vol, 0.002, 1.3));
    n.start(t, Math.random());
    n.stop(t + 1.5);
  }

  tom(t: number, note: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(midi(note), t);
    o.frequency.exponentialRampToValueAtTime(midi(note) * 0.55, t + 0.2);
    o.connect(this.env(t, vol, 0.002, 0.25));
    o.start(t);
    o.stop(t + 0.3);
  }

  bass(t: number, note: number, dur: number, vol: number, bright = 1) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(note);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(260 + 1300 * bright, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    o.connect(f).connect(this.env(t, vol, 0.004, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  lead(t: number, note: number, dur: number, vol: number, type: OscillatorType = 'square') {
    for (const det of [-6, 6]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = midi(note);
      o.detune.value = det;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      o.connect(f).connect(this.env(t, vol * 0.5, 0.008, dur));
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  pluck(t: number, note: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midi(note);
    o.connect(this.env(t, vol, 0.003, 0.28));
    o.start(t);
    o.stop(t + 0.35);
  }

  /** Soft chord swell: detuned triangles. Detuned sawtooths here sounded like a horn section on phones. */
  pad(t: number, notes: number[], dur: number, vol: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 1.4, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, t + dur);
    f.connect(g).connect(this.out);
    for (const n of notes) {
      for (const det of [-9, 0, 9]) {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }
}

const CALM_CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 60, 64],
  [55, 59, 62],
];
const CALM_ROOTS = [45, 41, 48, 43];

const COMBAT_CHORDS = [
  [62, 65, 69],
  [58, 62, 65],
  [60, 64, 67],
  [61, 64, 69],
];
const COMBAT_ROOTS = [38, 34, 36, 33];
const COMBAT_HOOK: Record<number, number>[] = [
  { 0: 74, 3: 77, 6: 81, 8: 79, 10: 77, 12: 76, 14: 74 },
  { 0: 77, 3: 74, 6: 70, 8: 72, 10: 74, 14: 77 },
  { 0: 76, 3: 79, 6: 84, 8: 82, 10: 81, 12: 79 },
  { 0: 81, 4: 80, 6: 76, 8: 73, 12: 76, 14: 81 },
];

const BOSS_CHORDS = [
  [64, 67, 71],
  [60, 64, 67],
  [62, 66, 69],
  [63, 66, 71],
];
const BOSS_ROOTS = [40, 36, 38, 35];

function bossStep(m: Music, bar: number, s: number, t: number, phrase: number, intensity: number) {
  const root = BOSS_ROOTS[bar];
  const chord = BOSS_CHORDS[bar];
  if ([0, 3, 6, 8, 11, 12, 14].includes(s)) m.kick(t, 0.55);
  if (s === 4 || s === 12) m.snare(t, 0.38);
  if (s === 15 && bar % 2 === 1) m.snare(t, 0.15);
  m.hat(t, s % 2 === 0 ? 0.06 : 0.035, s === 6 || s === 14);
  if (s === 0 && bar === 0) m.crash(t, 0.18);
  const oct = s % 4 === 2 ? 12 : 0;
  m.bass(t, root + oct, 0.1, 0.17, 0.9);
  if (bar === 3 && s >= 12) m.tom(t, 50 - (s - 12) * 3, 0.3);
  if (phrase % 2 === 1 || intensity > 1) {
    const arp = chord[(s * 2 + (s >> 2)) % 3] + 12 + (s % 8 >= 6 ? 12 : 0);
    m.lead(t, arp, 0.09, 0.05, 'sawtooth');
  }
  if (s === 0) m.pad(t, chord, 1.6, 0.03);
  if (intensity > 1 && s % 2 === 1) m.hat(t, 0.04);
}

const PATTERNS: Record<Exclude<Track, 'none'>, Pattern> = {
  calm: {
    bpm: 108,
    bars: 4,
    step(m, bar, s, t, phrase) {
      const chord = CALM_CHORDS[bar];
      if (s === 0) m.pad(t, chord, 2.4, 0.045);
      if (s === 0 || s === 10) m.bass(t, CALM_ROOTS[bar], 0.4, 0.11, 0.3);
      if (s % 2 === 0) {
        const n = chord[(s / 2) % 3] + 12 + ((s / 2) % 4 === 3 ? 12 : 0);
        m.pluck(t, n, 0.05);
      }
      if (phrase > 0) {
        if (s === 0 || s === 8) m.kick(t, 0.28);
        if (s === 4 || s === 12) m.hat(t, 0.05, true);
      }
    },
  },
  combat: {
    bpm: 150,
    bars: 4,
    step(m, bar, s, t, phrase) {
      const root = COMBAT_ROOTS[bar];
      if (s % 4 === 0) m.kick(t, 0.55);
      if (s === 4 || s === 12) m.snare(t, 0.36);
      m.hat(t, s % 2 === 0 ? 0.055 : 0.03, s % 4 === 2);
      if (s === 0 && bar === 0 && phrase % 2 === 0) m.crash(t, 0.15);
      m.bass(t, root + (s % 4 === 2 ? 12 : 0), 0.1, 0.16, 0.8);
      if (s === 0) m.pad(t, COMBAT_CHORDS[bar], 1.6, 0.03);
      if (phrase % 2 === 1) {
        const n = COMBAT_HOOK[bar][s];
        if (n) m.lead(t, n, 0.16, 0.07);
      } else if (s === 0 || s === 3 || s === 6 || s === 10) {
        m.lead(t, COMBAT_CHORDS[bar][s % 3] + 12, 0.08, 0.04);
      }
    },
  },
  boss: {
    bpm: 160,
    bars: 4,
    step(m, bar, s, t, phrase) {
      bossStep(m, bar, s, t, phrase, 1);
    },
  },
  final: {
    bpm: 172,
    bars: 4,
    step(m, bar, s, t, phrase) {
      bossStep(m, bar, s, t, phrase, 2);
    },
  },
};
