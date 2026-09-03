/**
 * All game audio, synthesized at runtime — no asset files, no licensing, nothing to load.
 *
 * The first version was four bare sine plucks, which all sounded like the same beep at
 * different pitches. Real pool sounds are *noisy*: a ball strike is a short woody knock with
 * a burst of high noise on the transient, a cushion is a damped thud with felt hiss, a pot is
 * a hollow drop followed by a rattle. So this builds from three primitives — a tuned tone
 * with a pitch envelope, a filtered noise burst, and a resonant "body" — and layers them.
 */

import { getAudioContext, getSfxBus, isAudioReady, unlockAudio } from './audio';

/** One shared noise buffer; regenerating white noise per sound is pure waste. */
let noiseBuffer: AudioBuffer | null = null;

export { unlockAudio };

function ready(): AudioContext | null {
  return isAudioReady() ? getAudioContext() : null;
}

function getNoise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.5);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface ToneOpts {
  freq: number;
  /** Frequency to glide to; omit to hold. */
  to?: number;
  duration: number;
  volume: number;
  type?: OscillatorType;
  /** Seconds to wait before starting. */
  delay?: number;
  /** Attack time; a hard 0 clicks, which is sometimes exactly what you want. */
  attack?: number;
}

/** A pitched layer with an exponential decay — the "body" of a sound. */
function tone(o: ToneOpts): void {
  const c = ready();
  const bus = getSfxBus();
  if (!c || !bus) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.duration);

  const attack = o.attack ?? 0.004;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.volume), t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);

  osc.connect(gain).connect(bus);
  osc.start(t0);
  osc.stop(t0 + o.duration + 0.03);
}

interface NoiseOpts {
  duration: number;
  volume: number;
  /** Band-pass centre; the "colour" of the noise. */
  freq: number;
  q?: number;
  /** Sweep the filter to this frequency over the duration. */
  to?: number;
  delay?: number;
  type?: BiquadFilterType;
}

/** A filtered noise burst — the transient/texture layer. */
function noise(o: NoiseOpts): void {
  const c = ready();
  const bus = getSfxBus();
  if (!c || !bus) return;
  const t0 = c.currentTime + (o.delay ?? 0);

  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  const filter = c.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.frequency.setValueAtTime(o.freq, t0);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + o.duration);
  filter.Q.value = o.q ?? 1;

  const gain = c.createGain();
  gain.gain.setValueAtTime(Math.max(0.0002, o.volume), t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);

  src.connect(filter).connect(gain).connect(bus);
  src.start(t0);
  src.stop(t0 + o.duration + 0.02);
}

// ---- Game sounds ----

/**
 * Ball on ball. Hard hits are brighter and shorter — a sharp phenolic *click* — while soft
 * contacts are duller and rounder, which is how you can hear the weight of a shot.
 */
function playBallClick(volume: number, intensity = 1): void {
  const i = Math.min(1.4, Math.max(0.05, intensity));
  const bright = 900 + i * 1500;

  noise({ duration: 0.035, volume: 0.32 * volume * i, freq: bright, to: bright * 0.45, q: 0.8 });
  tone({
    freq: 420 + i * 520,
    to: 240 + i * 200,
    duration: 0.07 + i * 0.03,
    volume: 0.3 * volume * i,
    type: 'triangle',
    attack: 0.001,
  });
  // A touch of low body so a heavy hit is felt as well as heard.
  if (i > 0.5) {
    tone({ freq: 150, to: 90, duration: 0.09, volume: 0.16 * volume * i, type: 'sine' });
  }
}

/**
 * The impact sound for the shooter's equipped hit effect. Each one is voiced to match what
 * you're looking at — a comic starburst shouldn't sound like ice shattering — and every one
 * still scales with impact strength so you can hear the weight of the shot underneath it.
 */
export function playHitImpact(effectId: string, volume: number, intensity = 1): void {
  const i = Math.min(1.4, Math.max(0.05, intensity));
  const v = volume * i;

  switch (effectId) {
    case 'hit.puff':
      // Dull, airy — a cushion of chalk dust absorbing the contact.
      noise({ duration: 0.13, volume: 0.22 * v, freq: 700, to: 220, q: 0.5 });
      tone({ freq: 240, to: 130, duration: 0.1, volume: 0.16 * v, type: 'sine' });
      break;

    case 'hit.pow':
      // Cartoon thwack: a hard transient over a fast falling "boing".
      noise({ duration: 0.03, volume: 0.3 * v, freq: 1800, to: 500, q: 0.7 });
      tone({ freq: 760, to: 150, duration: 0.16, volume: 0.34 * v, type: 'square', attack: 0.001 });
      tone({ freq: 380, to: 110, duration: 0.2, volume: 0.2 * v, type: 'triangle', delay: 0.02 });
      break;

    case 'hit.shockwave':
      // Deep pressure hit with a long sub tail.
      tone({ freq: 180, to: 46, duration: 0.34, volume: 0.4 * v, type: 'sine', attack: 0.001 });
      noise({ duration: 0.2, volume: 0.16 * v, freq: 400, to: 90, q: 0.6 });
      break;

    case 'hit.confetti':
      // A pop, then paper scatter.
      tone({ freq: 900, to: 300, duration: 0.05, volume: 0.3 * v, type: 'square', attack: 0.001 });
      for (let k = 0; k < 4; k++) {
        noise({
          duration: 0.04,
          volume: 0.1 * v,
          freq: 3200 + k * 700,
          q: 1.6,
          delay: 0.03 + k * 0.035,
        });
      }
      break;

    case 'hit.lightning':
      // Crackle first, then the zap sweeping down.
      noise({ duration: 0.07, volume: 0.3 * v, freq: 6000, to: 1400, q: 0.5 });
      tone({ freq: 2400, to: 260, duration: 0.13, volume: 0.22 * v, type: 'sawtooth', attack: 0.001 });
      noise({ duration: 0.16, volume: 0.12 * v, freq: 1200, to: 300, q: 2.4, delay: 0.04 });
      break;

    case 'hit.frost':
      // Glassy: a bright bell over splintering high noise.
      tone({ freq: 2600, duration: 0.3, volume: 0.2 * v, type: 'sine' });
      tone({ freq: 3900, duration: 0.22, volume: 0.12 * v, type: 'sine', delay: 0.02 });
      for (let k = 0; k < 5; k++) {
        noise({
          duration: 0.05,
          volume: 0.1 * v,
          freq: 5200 + k * 900,
          q: 3,
          delay: k * 0.03,
        });
      }
      break;

    case 'hit.ink':
      // Wet, low and short — a splat has almost no ring to it.
      noise({ duration: 0.09, volume: 0.28 * v, freq: 900, to: 180, q: 1.8 });
      tone({ freq: 300, to: 70, duration: 0.09, volume: 0.24 * v, type: 'sine', attack: 0.001 });
      break;

    case 'hit.nova':
      // Bright flash, then a swelling boom underneath it.
      noise({ duration: 0.28, volume: 0.2 * v, freq: 900, to: 6000, q: 0.4 });
      tone({ freq: 620, to: 180, duration: 0.3, volume: 0.26 * v, type: 'triangle' });
      tone({ freq: 120, to: 44, duration: 0.5, volume: 0.3 * v, type: 'sine', delay: 0.04 });
      break;

    case 'hit.bigbang':
      // The full apocalypse: sub drop, long rising sweep, ringing aftermath.
      tone({ freq: 150, to: 32, duration: 0.9, volume: 0.44 * v, type: 'sine', attack: 0.001 });
      noise({ duration: 0.7, volume: 0.24 * v, freq: 200, to: 7000, q: 0.35 });
      noise({ duration: 0.5, volume: 0.16 * v, freq: 5000, to: 300, q: 0.5, delay: 0.18 });
      [0, 0.12, 0.26].forEach((d, k) =>
        tone({ freq: 320 * Math.pow(1.5, k), duration: 0.6, volume: 0.14 * v, type: 'triangle', delay: d })
      );
      break;

    default:
      // 'hit.spark' — the standard phenolic click.
      playBallClick(volume, intensity);
  }
}

/** Cushion: a damped thud with the soft hiss of cloth. */
export function playCushionThud(volume: number, intensity = 1): void {
  const i = Math.min(1.2, Math.max(0.1, intensity));
  tone({ freq: 190, to: 80, duration: 0.13, volume: 0.26 * volume * i, type: 'sine' });
  noise({ duration: 0.08, volume: 0.1 * volume * i, freq: 1400, to: 400, q: 0.6 });
}

/**
 * Miscue: the tip skidding off the side of the ball.
 *
 * Deliberately ugly and unlike every other contact sound in the game — a scrape rather than a
 * click — because the whole point is that you can tell instantly it wasn't the shot you played.
 */
export function playMiscue(volume: number): void {
  // The scrape: broad noise sliding down, with no tonal centre to it.
  noise({ duration: 0.22, volume: 0.3 * volume, freq: 3200, to: 700, q: 0.35 });
  // A dull, wrong-sounding knock underneath.
  tone({ freq: 150, to: 60, duration: 0.16, volume: 0.18 * volume, type: 'square' });
}

/** Pot: the ball disappears, drops, then rattles down the return. */
export function playPocketSwish(volume: number): void {
  // Falling away into the pocket.
  noise({ duration: 0.16, volume: 0.16 * volume, freq: 2600, to: 300, q: 0.7 });
  tone({ freq: 520, to: 180, duration: 0.2, volume: 0.24 * volume, type: 'sine' });
  // The hollow drop, a beat later.
  tone({ freq: 190, to: 95, duration: 0.24, volume: 0.26 * volume, type: 'triangle', delay: 0.09 });
  // Rattle down the track.
  for (let k = 0; k < 3; k++) {
    noise({
      duration: 0.03,
      volume: (0.09 - k * 0.02) * volume,
      freq: 1800 - k * 300,
      q: 1.4,
      delay: 0.2 + k * 0.07,
    });
  }
}

/** The strike: chalk bite, then the cue transferring into the ball. */
export function playCueStrike(volume: number, power: number): void {
  const p = Math.min(1, Math.max(0.1, power));
  noise({ duration: 0.02, volume: 0.2 * volume, freq: 3200, to: 1200, q: 0.9 });
  tone({
    freq: 300 + p * 380,
    to: 160,
    duration: 0.06 + p * 0.04,
    volume: 0.34 * volume,
    type: 'triangle',
    attack: 0.001,
  });
}

/**
 * Combo chime — pitch climbs with each extra ball dropped on the same shot, so a runout
 * sounds like it's building rather than repeating.
 */
export function playCombo(volume: number, comboIndex: number): void {
  const step = Math.min(comboIndex, 7);
  const root = 520 * Math.pow(1.16, step);
  tone({ freq: root, duration: 0.2, volume: 0.26 * volume, type: 'triangle' });
  tone({ freq: root * 1.5, duration: 0.24, volume: 0.18 * volume, type: 'sine', delay: 0.05 });
  noise({ duration: 0.12, volume: 0.08 * volume, freq: root * 3, to: root, q: 1.2 });
}

/** Single tick of the prize wheel's ratchet, or the shot clock. */
export function playWheelTick(volume: number): void {
  noise({ duration: 0.02, volume: 0.14 * volume, freq: 2600, q: 2.4 });
  tone({ freq: 1200, to: 900, duration: 0.02, volume: 0.08 * volume, type: 'square' });
}

/** Reveal sting when the wheel stops; brighter and longer for higher rarities. */
export function playReveal(volume: number, tier: number): void {
  const root = 420 * Math.pow(1.14, tier);
  [0, 0.08, 0.16, 0.26].forEach((delay, i) => {
    tone({
      freq: root * [1, 1.25, 1.5, 2][i],
      duration: 0.45 - i * 0.05,
      volume: (0.24 - i * 0.03) * volume,
      type: i === 3 ? 'triangle' : 'sine',
      delay,
    });
  });
  noise({ duration: 0.5, volume: 0.06 * volume, freq: 4000, to: 900, q: 0.5, delay: 0.02 });
}

/** Level-up fanfare on the post-match screen. */
export function playLevelUp(volume: number): void {
  [0, 0.1, 0.2, 0.32].forEach((delay, i) => {
    tone({
      freq: 440 * Math.pow(1.26, i),
      duration: 0.3,
      volume: 0.24 * volume,
      type: 'triangle',
      delay,
    });
  });
}

/* ==========================================================================
   Interface sounds
   ==========================================================================
   The menus were completely silent: 120 buttons and nothing to hear from any
   of them. In a game styled like an arcade cabinet, pressing something and
   hearing nothing reads as the press not having registered.

   Deliberately small. These play many times a minute, so anything with a tail
   on it becomes a drone — each is under 90ms, quiet, and built from the same
   primitives as the table sounds so the interface belongs to the same object.
   ========================================================================== */

/** An ordinary press. Woody and short, like a chip set down on a table. */
export function playUiClick(volume: number): void {
  tone({ freq: 520, to: 380, duration: 0.055, volume: 0.1 * volume, type: 'triangle' });
  noise({ duration: 0.028, volume: 0.045 * volume, freq: 2400, q: 1.6 });
}

/** Going back, or closing something. The click, falling instead of rising. */
export function playUiBack(volume: number): void {
  tone({ freq: 380, to: 250, duration: 0.07, volume: 0.09 * volume, type: 'triangle' });
  noise({ duration: 0.025, volume: 0.035 * volume, freq: 1500, q: 1.4 });
}

/** Starting a game. The one press in the menus that deserves more than a tick. */
export function playUiHero(volume: number): void {
  [0, 0.055].forEach((delay, i) => {
    tone({
      freq: 440 * (i === 0 ? 1 : 1.5),
      duration: 0.2,
      volume: (0.16 - i * 0.04) * volume,
      type: 'triangle',
      delay,
    });
  });
  noise({ duration: 0.14, volume: 0.05 * volume, freq: 3200, to: 800, q: 0.7 });
}
