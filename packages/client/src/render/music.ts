/**
 * Background music, one score per table theme, synthesized at runtime.
 *
 * Sequencing uses a look-ahead scheduler rather than timers per note: a `setInterval` wakes
 * up every 60ms and schedules everything falling due in the next 250ms directly on the audio
 * clock. `setTimeout` drifts audibly within a bar or two; the audio clock doesn't drift at all.
 */

import { getAudioContext, getMusicBus, isAudioReady } from './audio';

/** Semitones above A2 (110Hz) → frequency. */
function note(semitone: number): number {
  return 110 * Math.pow(2, semitone / 12);
}

type Voice = 'bass' | 'pluck' | 'pad' | 'bell' | 'lead' | 'noise';

interface Step {
  /** Semitone offset from the track root, or null for a rest. */
  n: number | null;
  voice: Voice;
  /** Beats. */
  len: number;
  gain: number;
}

interface Track {
  bpm: number;
  /** Root note in semitones above A2. */
  root: number;
  /** One entry per 8th note; the pattern loops. */
  pattern: Step[][];
  /** Percussion per 8th: 'k' kick, 's' snare/brush, 'h' hat, '.' silence. */
  drums: string;
  drumKit: 'brush' | 'electro' | 'soft' | 'none';
}

/**
 * Scale degrees in semitones, so patterns can be written as degrees and stay in key.
 * Minor and major pentatonic-ish sets keep everything consonant however it lands.
 */
const MINOR = [0, 3, 5, 7, 10, 12, 15, 17];
const MAJOR = [0, 2, 4, 7, 9, 12, 14, 16];
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12];

function line(
  degrees: (number | null)[],
  scale: number[],
  voice: Voice,
  len: number,
  gain: number,
  octave = 0
): Step[][] {
  return degrees.map((d) =>
    d === null ? [] : [{ n: scale[d % scale.length] + octave * 12, voice, len, gain }]
  );
}

/** Merges several instrument lines into one per-8th step list. */
function merge(...lines: Step[][][]): Step[][] {
  const length = Math.max(...lines.map((l) => l.length));
  return Array.from({ length }, (_, i) => lines.flatMap((l) => l[i % l.length] ?? []));
}

const TRACKS: Record<string, Track> = {
  // Warm pool hall: walking bass under a lazy, bluesy top line.
  classic: {
    bpm: 96,
    root: 3,
    drums: 'h.s.h.h.h.s.h.h.',
    drumKit: 'brush',
    pattern: merge(
      line([0, null, 2, null, 4, null, 2, null, 0, null, 4, null, 5, null, 4, null], MINOR, 'bass', 0.9, 0.5, -1),
      line(
        [null, 4, null, null, 5, null, 4, null, null, 2, null, null, 4, null, null, null],
        MINOR,
        'pluck',
        0.8,
        0.22,
        1
      )
    ),
  },

  // Late-night lounge: sparse, moody, lots of space.
  midnight: {
    bpm: 74,
    root: 0,
    drums: '..h.....h.......',
    drumKit: 'soft',
    pattern: merge(
      line([0, null, null, null, 3, null, null, null, 2, null, null, null, 4, null, null, null], MINOR, 'bass', 1.6, 0.45, -1),
      line([null, null, 4, null, null, null, 5, null, null, null, 2, null, null, null, 0, null], MINOR, 'pad', 2.4, 0.16, 0),
      line([null, null, null, 7, null, null, null, null, null, null, null, 5, null, null, null, null], MINOR, 'bell', 1.2, 0.18, 1)
    ),
  },

  // Plush club: slow organ-ish pads over a heavy root.
  crimson: {
    bpm: 84,
    root: 5,
    drums: 'k...s...k...s...',
    drumKit: 'soft',
    pattern: merge(
      line([0, null, null, null, null, null, 4, null, 3, null, null, null, null, null, 2, null], MINOR, 'bass', 1.8, 0.5, -1),
      line([0, null, null, null, 2, null, null, null, 3, null, null, null, 4, null, null, null], MINOR, 'pad', 3, 0.2, 0),
      line([null, null, 7, null, null, null, null, null, null, null, 6, null, null, null, null, null], MINOR, 'lead', 1, 0.14, 1)
    ),
  },

  // Sunlit patio: bright plucked guitar-ish figure, gentle shaker.
  sandstone: {
    bpm: 108,
    root: 7,
    drums: 'h.h.hh..h.h.h.h.',
    drumKit: 'brush',
    pattern: merge(
      line([0, null, null, 4, null, null, 2, null, 0, null, null, 4, null, 5, null, null], MAJOR, 'bass', 0.8, 0.42, -1),
      line([4, 5, null, 4, 2, null, 4, null, 5, 4, null, 2, null, 4, null, null], MAJOR, 'pluck', 0.5, 0.2, 1)
    ),
  },

  // Arcade: driving synthwave arpeggio over a straight-eighths bass.
  neon: {
    bpm: 124,
    root: 2,
    drums: 'k.h.s.h.k.h.s.hh',
    drumKit: 'electro',
    pattern: merge(
      line([0, 0, null, 0, null, 0, 0, null, 3, 3, null, 3, null, 3, 3, null], MINOR, 'bass', 0.45, 0.5, -1),
      line([4, 5, 7, 5, 4, 5, 7, 5, 4, 5, 6, 5, 4, 5, 6, 7], MINOR, 'lead', 0.3, 0.16, 1)
    ),
  },

  // Frozen cavern: sparse glassy bells, almost no rhythm.
  ice: {
    bpm: 66,
    root: 10,
    drums: '................',
    drumKit: 'none',
    pattern: merge(
      line([0, null, null, null, null, null, null, null, 4, null, null, null, null, null, null, null], MAJOR, 'pad', 4, 0.18, -1),
      line([null, null, 5, null, null, 7, null, null, null, null, 4, null, null, 6, null, null], MAJOR, 'bell', 2.2, 0.22, 1),
      line([null, null, null, null, 9, null, null, null, null, null, null, null, 7, null, null, null], MAJOR, 'bell', 1.8, 0.14, 2)
    ),
  },

  // 70s rec room: bouncy funk bass and a tambourine-ish top.
  vintage: {
    bpm: 102,
    root: 8,
    drums: 'k.hhs.h.k.hhs.hh',
    drumKit: 'brush',
    pattern: merge(
      line([0, null, 0, 2, null, 3, null, 2, 0, null, 0, 4, null, 3, null, 2], DORIAN, 'bass', 0.4, 0.5, -1),
      line([null, 4, null, null, 5, null, 4, null, null, 4, null, null, 6, null, 5, null], DORIAN, 'pluck', 0.45, 0.18, 1)
    ),
  },
};

// ---- Synthesis ----

interface VoiceSpec {
  type: OscillatorType;
  attack: number;
  release: number;
  /** Low-pass cutoff; keeps the pads and basses from getting shrill. */
  cutoff: number;
  /** Optional detuned second oscillator for width. */
  detune?: number;
}

const VOICES: Record<Voice, VoiceSpec> = {
  bass: { type: 'triangle', attack: 0.01, release: 0.18, cutoff: 700, detune: 4 },
  pluck: { type: 'triangle', attack: 0.004, release: 0.3, cutoff: 2600 },
  pad: { type: 'sawtooth', attack: 0.5, release: 1.4, cutoff: 900, detune: 8 },
  bell: { type: 'sine', attack: 0.004, release: 2.2, cutoff: 5000 },
  lead: { type: 'square', attack: 0.006, release: 0.22, cutoff: 3200, detune: 6 },
  noise: { type: 'sine', attack: 0.001, release: 0.1, cutoff: 4000 },
};

let timer: ReturnType<typeof setInterval> | null = null;
let current: Track | null = null;
let currentId = '';
let step = 0;
let nextStepTime = 0;
let volume = 0.35;

const LOOKAHEAD_MS = 60;
const SCHEDULE_AHEAD = 0.25;

function playNote(freq: number, at: number, beats: number, secPerBeat: number, spec: VoiceSpec, gain: number): void {
  const ctx = getAudioContext();
  const bus = getMusicBus();
  if (!ctx || !bus) return;

  const dur = beats * secPerBeat;
  const amp = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = spec.cutoff;

  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + spec.attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur + spec.release);

  const oscs: OscillatorNode[] = [];
  const make = (detune: number): void => {
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    oscs.push(osc);
  };
  make(0);
  if (spec.detune) make(spec.detune);

  filter.connect(amp).connect(bus);
  for (const osc of oscs) {
    osc.start(at);
    osc.stop(at + dur + spec.release + 0.05);
  }
}

function playDrum(kind: string, at: number, kit: Track['drumKit']): void {
  const ctx = getAudioContext();
  const bus = getMusicBus();
  if (!ctx || !bus || kit === 'none') return;

  const amp = ctx.createGain();
  amp.connect(bus);

  if (kind === 'k') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(kit === 'electro' ? 150 : 110, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.12);
    amp.gain.setValueAtTime(0.5, at);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(amp);
    osc.start(at);
    osc.stop(at + 0.2);
    return;
  }

  // Snare/hat are filtered noise; the kit only changes the colour and length.
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = kind === 'h' ? 'highpass' : 'bandpass';
  filter.frequency.value = kind === 'h' ? 7000 : kit === 'electro' ? 1800 : 1200;
  filter.Q.value = kind === 'h' ? 0.7 : 1.2;

  const life = kind === 'h' ? 0.035 : kit === 'brush' ? 0.14 : 0.09;
  amp.gain.setValueAtTime(kind === 'h' ? 0.12 : 0.22, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + life);

  src.connect(filter).connect(amp);
  src.start(at);
  src.stop(at + life + 0.05);
}

function schedule(): void {
  const ctx = getAudioContext();
  if (!ctx || !current) return;

  const secPerBeat = 60 / current.bpm;
  const secPerStep = secPerBeat / 2; // pattern is in 8th notes

  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    const idx = step % current.pattern.length;
    for (const s of current.pattern[idx]) {
      if (s.n === null) continue;
      playNote(
        note(current.root + s.n),
        nextStepTime,
        s.len,
        secPerBeat,
        VOICES[s.voice],
        s.gain * volume
      );
    }
    const drum = current.drums[step % current.drums.length];
    if (drum && drum !== '.') playDrum(drum, nextStepTime, current.drumKit);

    step++;
    nextStepTime += secPerStep;
  }
}

/**
 * Starts (or switches to) the score for a table theme. Safe to call repeatedly — it's a
 * no-op when that theme is already playing.
 */
export function startMusic(themeId: string, vol: number): void {
  volume = vol;
  const track = TRACKS[themeId] ?? TRACKS.classic;
  if (timer && currentId === themeId) return;

  stopMusic();
  if (!isAudioReady()) return; // waits for a user gesture; callers retry after one

  current = track;
  currentId = themeId;
  step = 0;
  nextStepTime = (getAudioContext()?.currentTime ?? 0) + 0.1;
  timer = setInterval(schedule, LOOKAHEAD_MS);
  schedule();
}

export function stopMusic(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  current = null;
  currentId = '';
}

export function setMusicVolume(vol: number): void {
  volume = vol;
  const bus = getMusicBus();
  if (bus) bus.gain.value = vol > 0 ? 1 : 0;
}

export function isMusicPlaying(): boolean {
  return timer !== null;
}
