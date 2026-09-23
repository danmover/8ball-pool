import { effect } from '@preact/signals';
import { settings } from '../state/settings';

/**
 * Every sound in the game, synthesised — no audio files, nothing to download, works offline.
 *
 * Pool sounds are noisy rather than tonal: a ball strike is a short woody knock with a burst of
 * bright noise on the transient, a cushion is a damped thud with a little felt hiss, a pot is a
 * rattle followed by a hollow drop. Everything is built from two primitives — a pitched tone with
 * an envelope and a filtered noise burst — layered.
 */

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function audioContext(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      comp.connect(ctx.destination);
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      sfxBus.connect(comp);
      musicBus.connect(comp);
      applyVolumes();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** The context if one already exists — never creates one (which browsers warn about pre-gesture). */
export function peekContext(): AudioContext | null {
  return ctx;
}

export function musicOut(): GainNode | null {
  audioContext();
  return musicBus;
}

function applyVolumes(): void {
  const s = settings.value;
  if (sfxBus) sfxBus.gain.value = s.sfxOn ? s.sfxVolume : 0;
  if (musicBus) musicBus.gain.value = s.musicOn ? s.musicVolume * 0.5 : 0;
}

effect(() => {
  void settings.value;
  applyVolumes();
});

/** Browsers only allow audio after a gesture; every tap calls this. */
export function unlockAudio(): void {
  const c = audioContext();
  if (c && c.state === 'suspended') void c.resume();
}

function ready(): AudioContext | null {
  const c = ctx;
  return c && c.state === 'running' && sfxBus ? c : null;
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

interface Tone {
  freq: number;
  to?: number;
  dur: number;
  vol: number;
  type?: OscillatorType;
  delay?: number;
  attack?: number;
  pan?: number;
}

function tone(o: Tone): void {
  const c = ready();
  if (!c || o.vol <= 0.0005) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let out: AudioNode = g;
  if (o.pan !== undefined && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    g.connect(p);
    out = p;
  }
  osc.connect(g);
  out.connect(sfxBus!);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

interface Noise {
  dur: number;
  vol: number;
  freq: number;
  q?: number;
  to?: number;
  delay?: number;
  type?: BiquadFilterType;
  pan?: number;
}

function burst(o: Noise): void {
  const c = ready();
  if (!c || o.vol <= 0.0005) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, t0);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(o.vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let out: AudioNode = g;
  if (o.pan !== undefined && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    g.connect(p);
    out = p;
  }
  src.connect(f).connect(g);
  out.connect(sfxBus!);
  src.start(t0, Math.random() * 0.3);
  src.stop(t0 + o.dur + 0.05);
}

// Many collisions can land on one frame of a break; cap how many voices a burst spawns.
let recent = 0;
let recentAt = 0;
function allow(): boolean {
  const now = performance.now();
  if (now - recentAt > 40) {
    recent = 0;
    recentAt = now;
  }
  return ++recent <= 6;
}

// ------------------------------------------------------------------ table

/** Two balls meeting. `impulse` in table units/s; `pan` -1 (left) .. 1 (right). */
export function ballHit(impulse: number, pan = 0): void {
  if (!allow()) return;
  const k = Math.min(1, impulse / 2600);
  if (k < 0.01) return;
  const vol = 0.08 + k * 0.55;
  const pitch = 2200 + Math.random() * 500 + k * 400;
  tone({ freq: pitch, to: pitch * 0.82, dur: 0.05 + k * 0.03, vol: vol * 0.55, type: 'triangle', pan });
  tone({ freq: pitch * 1.52, dur: 0.03, vol: vol * 0.18, pan });
  burst({ dur: 0.035 + k * 0.02, vol: vol * 0.55, freq: 4200, q: 0.8, type: 'highpass', pan });
}

export function cushion(speed: number, pan = 0): void {
  if (!allow()) return;
  const k = Math.min(1, speed / 2600);
  if (k < 0.03) return;
  tone({ freq: 140, to: 70, dur: 0.12 + k * 0.05, vol: 0.12 + k * 0.35, pan });
  burst({ dur: 0.08, vol: 0.04 + k * 0.12, freq: 700, q: 0.6, pan });
}

export function pocket(pan = 0): void {
  // The rattle in the jaws, then the drop into the bag.
  burst({ dur: 0.06, vol: 0.25, freq: 1400, q: 2, pan });
  tone({ freq: 900, to: 600, dur: 0.05, vol: 0.12, type: 'triangle', delay: 0.02, pan });
  tone({ freq: 95, to: 55, dur: 0.22, vol: 0.45, delay: 0.07, pan });
  burst({ dur: 0.18, vol: 0.12, freq: 260, q: 0.9, delay: 0.08, pan });
}

export function cueStrike(power: number): void {
  const k = Math.max(0.05, Math.min(1, power));
  tone({ freq: 1600 + k * 500, to: 900, dur: 0.045, vol: 0.12 + k * 0.4, type: 'triangle' });
  burst({ dur: 0.04, vol: 0.1 + k * 0.3, freq: 3200, q: 0.7, type: 'highpass' });
  tone({ freq: 220, to: 120, dur: 0.07, vol: 0.08 + k * 0.15 });
}

export function miscue(): void {
  burst({ dur: 0.14, vol: 0.4, freq: 2400, to: 600, q: 3 });
  tone({ freq: 700, to: 260, dur: 0.12, vol: 0.12, type: 'sawtooth' });
}

export function bomb(): void {
  tone({ freq: 90, to: 30, dur: 0.7, vol: 0.9 });
  burst({ dur: 0.6, vol: 0.7, freq: 500, to: 80, q: 0.5, type: 'lowpass' });
  burst({ dur: 0.15, vol: 0.4, freq: 3000, q: 0.5 });
}

export function orb(): void {
  [0, 4, 7, 12].forEach((s, i) => tone({ freq: 880 * 2 ** (s / 12), dur: 0.22, vol: 0.12, delay: i * 0.045, type: 'sine' }));
}

export function arm(): void {
  tone({ freq: 520, to: 1040, dur: 0.18, vol: 0.14, type: 'triangle' });
}

// ------------------------------------------------------------------ table talk

export function turn(): void {
  tone({ freq: 660, dur: 0.12, vol: 0.14, type: 'triangle' });
  tone({ freq: 990, dur: 0.18, vol: 0.12, type: 'triangle', delay: 0.08 });
}

export function foul(): void {
  tone({ freq: 330, to: 220, dur: 0.22, vol: 0.18, type: 'square' });
  tone({ freq: 250, to: 165, dur: 0.28, vol: 0.12, type: 'square', delay: 0.12 });
}

export function tick(urgent = false): void {
  tone({ freq: urgent ? 1400 : 1000, dur: 0.05, vol: urgent ? 0.18 : 0.08, type: 'square' });
}

export function combo(n: number): void {
  const base = 523 * 2 ** (Math.min(n, 6) / 12);
  [0, 4, 7].forEach((s, i) => tone({ freq: base * 2 ** (s / 12), dur: 0.2, vol: 0.12, delay: i * 0.05, type: 'triangle' }));
}

export function pop(): void {
  tone({ freq: 700, to: 1100, dur: 0.08, vol: 0.12, type: 'sine' });
}

export function win(): void {
  const notes = [0, 4, 7, 12, 7, 12, 16];
  notes.forEach((s, i) => tone({ freq: 392 * 2 ** (s / 12), dur: i === notes.length - 1 ? 0.8 : 0.18, vol: 0.18, delay: i * 0.11, type: 'triangle' }));
  notes.forEach((s, i) => tone({ freq: 196 * 2 ** (s / 12), dur: 0.3, vol: 0.08, delay: i * 0.11, type: 'sine' }));
}

export function lose(): void {
  [7, 4, 0, -5].forEach((s, i) => tone({ freq: 330 * 2 ** (s / 12), dur: 0.35, vol: 0.12, delay: i * 0.16, type: 'triangle' }));
}

export function coins(n = 6): void {
  for (let i = 0; i < n; i++) {
    tone({ freq: 1800 + Math.random() * 900, dur: 0.12, vol: 0.07, delay: i * 0.05 + Math.random() * 0.02, type: 'sine' });
  }
}

export function levelUp(): void {
  [0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => tone({ freq: 440 * 2 ** (s / 12), dur: 0.28, vol: 0.14, delay: i * 0.06, type: 'triangle' }));
}

// ------------------------------------------------------------------ interface

export function uiTap(): void {
  tone({ freq: 1250, to: 950, dur: 0.045, vol: 0.07, type: 'triangle' });
}

export function uiBack(): void {
  tone({ freq: 800, to: 560, dur: 0.07, vol: 0.07, type: 'triangle' });
}

export function uiConfirm(): void {
  tone({ freq: 740, dur: 0.07, vol: 0.09, type: 'triangle' });
  tone({ freq: 1110, dur: 0.12, vol: 0.09, type: 'triangle', delay: 0.06 });
}
