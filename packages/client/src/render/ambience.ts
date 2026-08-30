import { getAmbienceBus, getAudioContext } from './audio';

/**
 * The room behind the table, in sound.
 *
 * Each theme already draws a whole room — a bar, an arcade, an ice cavern — and until now all
 * of them were silent. A bed of noise underneath does more for the sense of place than any
 * amount of extra geometry, and it costs nothing: like everything else here it is synthesized,
 * so there are no audio files to load and no licences to worry about.
 *
 * Deliberately *very* quiet and deliberately without melody. This has to survive being left on
 * for an hour, which rules out anything with a loop point you could learn.
 */

interface AmbienceVoice {
  /** Centre of the noise band, in Hz. */
  band: number;
  /** How tight the band is. Low Q is a wash, high Q is a hum. */
  q: number;
  /** Gain relative to the bus. */
  level: number;
  /** Slow wobble, in Hz — zero for a completely steady bed. */
  drift: number;
  driftDepth: number;
}

interface AmbienceRecipe {
  /** One or more filtered noise voices layered together. */
  voices: AmbienceVoice[];
  /** Occasional one-off blips: [min, max] seconds apart, and the pitch range. */
  sparkle?: { everyMin: number; everyMax: number; lowHz: number; highHz: number; level: number };
}

/**
 * A room per theme. These are guesses made by ear rather than recordings, which is the honest
 * description — "bar chatter" here is a low band of noise that suggests a room with people in
 * it, not actual voices.
 */
const ROOMS: Record<string, AmbienceRecipe> = {
  // A pub: low room tone, the murmur of people, the odd glass.
  classic: {
    voices: [
      { band: 220, q: 0.7, level: 0.05, drift: 0.07, driftDepth: 40 },
      { band: 900, q: 0.4, level: 0.012, drift: 0.11, driftDepth: 120 },
    ],
    sparkle: { everyMin: 7, everyMax: 20, lowHz: 1800, highHz: 3200, level: 0.02 },
  },
  // Late and nearly empty: just the building.
  midnight: {
    voices: [
      { band: 120, q: 0.9, level: 0.055, drift: 0.05, driftDepth: 20 },
      { band: 480, q: 1.4, level: 0.008, drift: 0.03, driftDepth: 30 },
    ],
  },
  // A busier room, warmer and closer.
  crimson: {
    voices: [
      { band: 260, q: 0.6, level: 0.055, drift: 0.09, driftDepth: 50 },
      { band: 1100, q: 0.5, level: 0.014, drift: 0.13, driftDepth: 150 },
    ],
    sparkle: { everyMin: 5, everyMax: 14, lowHz: 1500, highHz: 2600, level: 0.018 },
  },
  // Open and dry, with air moving through it.
  sandstone: {
    voices: [
      { band: 180, q: 0.5, level: 0.045, drift: 0.04, driftDepth: 35 },
      { band: 2400, q: 0.3, level: 0.01, drift: 0.06, driftDepth: 400 },
    ],
  },
  // An arcade: mains hum and electronics.
  neon: {
    voices: [
      { band: 100, q: 6, level: 0.03, drift: 0, driftDepth: 0 },
      { band: 3000, q: 0.8, level: 0.012, drift: 0.21, driftDepth: 300 },
    ],
    sparkle: { everyMin: 3, everyMax: 9, lowHz: 900, highHz: 2200, level: 0.026 },
  },
  // A cavern: deep, wide, and cold.
  ice: {
    voices: [
      { band: 70, q: 0.8, level: 0.07, drift: 0.03, driftDepth: 12 },
      { band: 3600, q: 0.35, level: 0.009, drift: 0.05, driftDepth: 500 },
    ],
    sparkle: { everyMin: 9, everyMax: 26, lowHz: 2600, highHz: 5200, level: 0.014 },
  },
  // An old hall: wood, dust, a clock somewhere.
  vintage: {
    voices: [
      { band: 160, q: 1.1, level: 0.05, drift: 0.06, driftDepth: 25 },
      { band: 700, q: 0.9, level: 0.01, drift: 0.08, driftDepth: 80 },
    ],
    sparkle: { everyMin: 12, everyMax: 30, lowHz: 600, highHz: 1100, level: 0.016 },
  },
};

/** Two seconds of looping noise. Generated once and shared by every voice. */
let noiseBuffer: AudioBuffer | null = null;

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Brown-ish noise: white noise integrated, which sits far lower and is much easier to
  // listen to for an hour than the hiss of white.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  noiseBuffer = buffer;
  return buffer;
}

let nodes: AudioNode[] = [];
let sparkleTimer: ReturnType<typeof setTimeout> | null = null;
let playingTheme: string | null = null;

/**
 * Starts (or switches to) the room for `themeId`.
 *
 * Volume is applied to the ambience bus only, so it is genuinely independent of the music and
 * of the balls.
 */
export function startAmbience(themeId: string, volume: number): void {
  const ctx = getAudioContext();
  const bus = getAmbienceBus();
  if (!ctx || !bus || ctx.state !== 'running') return;
  if (playingTheme === themeId && nodes.length > 0) {
    setAmbienceVolume(volume);
    return;
  }

  stopAmbience();
  const recipe = ROOMS[themeId] ?? ROOMS.classic;
  playingTheme = themeId;
  bus.gain.value = volume;

  for (const voice of recipe.voices) {
    const src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = voice.band;
    filter.Q.value = voice.q;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Fade in over a couple of seconds. Ambience that arrives suddenly is a sound effect.
    gain.gain.linearRampToValueAtTime(voice.level, ctx.currentTime + 2.5);

    src.connect(filter).connect(gain).connect(bus);
    src.start();
    nodes.push(src, filter, gain);

    // A slow wander through the band, so the bed never sits still enough to be identified.
    if (voice.drift > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = voice.drift;
      const depth = ctx.createGain();
      depth.gain.value = voice.driftDepth;
      lfo.connect(depth).connect(filter.frequency);
      lfo.start();
      nodes.push(lfo, depth);
    }
  }

  if (recipe.sparkle) scheduleSparkle(recipe.sparkle);
}

function scheduleSparkle(s: NonNullable<AmbienceRecipe['sparkle']>): void {
  const delay = (s.everyMin + Math.random() * (s.everyMax - s.everyMin)) * 1000;
  sparkleTimer = setTimeout(() => {
    const ctx = getAudioContext();
    const bus = getAmbienceBus();
    if (ctx && bus && ctx.state === 'running' && nodes.length > 0) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = s.lowHz + Math.random() * (s.highHz - s.lowHz);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(s.level, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(bus);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    }
    scheduleSparkle(s);
  }, delay);
}

export function stopAmbience(): void {
  if (sparkleTimer) {
    clearTimeout(sparkleTimer);
    sparkleTimer = null;
  }
  for (const node of nodes) {
    // Sources need stopping; plain nodes only need disconnecting.
    if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
      try {
        (node as AudioScheduledSourceNode).stop();
      } catch {
        // Already stopped — nothing to do.
      }
    }
    node.disconnect();
  }
  nodes = [];
  playingTheme = null;
}

export function setAmbienceVolume(volume: number): void {
  const bus = getAmbienceBus();
  if (bus) bus.gain.value = Math.max(0, Math.min(1, volume));
}

function isAmbiencePlaying(): boolean {
  return nodes.length > 0;
}

/** Theme ids that have a room of their own, for tests and for the settings copy. */
function ambienceThemeIds(): string[] {
  return Object.keys(ROOMS);
}
