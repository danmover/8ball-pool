import { audioContext, musicOut, peekContext } from './sfx';

/**
 * A quiet lounge loop for the menus: soft electric-piano chords over a walking bass and brushed
 * hats, generated as it plays so it never repeats exactly. Nothing to download.
 */

const BPM = 84;
const BEAT = 60 / BPM;

/** ii–V–I–vi in F, with a turnaround — seventh chords voiced close. */
const CHORDS: number[][] = [
  [55, 58, 62, 65], // Gm7
  [48, 52, 55, 58], // C7
  [53, 57, 60, 64], // Fmaj7
  [50, 53, 57, 60], // Dm7
  [55, 58, 62, 65], // Gm7
  [48, 52, 55, 58], // C7
  [57, 60, 64, 67], // Am7
  [50, 54, 57, 60], // D7
];

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

let playing = false;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0;

function note(freq: number, at: number, dur: number, vol: number, type: OscillatorType, cutoff = 2400): void {
  const c = audioContext();
  const out = musicOut();
  if (!c || !out) return;
  const osc = c.createOscillator();
  const osc2 = c.createOscillator();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  osc.type = type;
  osc2.type = 'sine';
  osc.frequency.value = freq;
  osc2.frequency.value = freq * 2.002;
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, at + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  const g2 = c.createGain();
  g2.gain.value = 0.25;
  osc.connect(f);
  osc2.connect(g2).connect(f);
  f.connect(g).connect(out);
  osc.start(at);
  osc2.start(at);
  osc.stop(at + dur + 0.05);
  osc2.stop(at + dur + 0.05);
}

function brush(at: number, vol: number): void {
  const c = audioContext();
  const out = musicOut();
  if (!c || !out) return;
  const len = Math.floor(c.sampleRate * 0.12);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 6000;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(out);
  src.start(at);
}

function schedule(): void {
  const c = audioContext();
  if (!c) return;
  while (nextTime < c.currentTime + 0.5) {
    const bar = Math.floor(step / 4) % CHORDS.length;
    const beat = step % 4;
    const chord = CHORDS[bar];
    const swing = beat % 2 === 1 ? BEAT * 0.08 : 0;
    const t = nextTime + swing;
    // Walking bass, one note a beat.
    const bassNotes = [chord[0] - 12, chord[1] - 12, chord[2] - 12, chord[0] - 13 + (beat === 3 ? 2 : 0)];
    note(midi(bassNotes[beat]), t, BEAT * 0.95, 0.16, 'triangle', 600);
    // Chords on 1 and the "and" of 2.
    if (beat === 0 || (beat === 1 && Math.random() < 0.6)) {
      for (const n of chord) note(midi(n), t + (beat === 1 ? BEAT * 0.5 : 0), BEAT * 1.6, 0.045, 'sine', 1800);
    }
    // A little melody now and then.
    if (Math.random() < 0.22) note(midi(chord[Math.floor(Math.random() * 4)] + 12), t + BEAT * 0.5, BEAT * 0.6, 0.035, 'triangle', 3000);
    brush(t, beat % 2 === 1 ? 0.05 : 0.025);
    nextTime += BEAT;
    step++;
  }
}

export function startMusic(): void {
  const c = peekContext();
  // Only once the browser has let audio start — the first tap does that.
  if (!c || playing || c.state !== 'running') return;
  playing = true;
  nextTime = c.currentTime + 0.1;
  timer = setInterval(schedule, 120);
}

export function stopMusic(): void {
  playing = false;
  if (timer) clearInterval(timer);
  timer = null;
}
