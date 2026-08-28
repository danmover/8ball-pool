/**
 * The single AudioContext, and the three buses hanging off it.
 *
 * Effects, music and room ambience live on separate gain nodes so their volumes are genuinely
 * independent — turning the music down shouldn't quieten the balls, and the room shouldn't
 * disappear with the tune. Everything is synthesized; there are no audio files anywhere in
 * this project.
 */

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let ambienceBus: GainNode | null = null;

export function getAudioContext(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      ambienceBus = ctx.createGain();
      sfxBus.connect(ctx.destination);
      musicBus.connect(ctx.destination);
      ambienceBus.connect(ctx.destination);
    } catch {
      return null; // no audio on this device; everything below degrades to silence
    }
  }
  return ctx;
}

export function getAmbienceBus(): GainNode | null {
  getAudioContext();
  return ambienceBus;
}

export function getSfxBus(): GainNode | null {
  getAudioContext();
  return sfxBus;
}

export function getMusicBus(): GainNode | null {
  getAudioContext();
  return musicBus;
}

/**
 * Browsers won't start audio until the user has interacted, so every entry point calls this
 * from a click/tap. Callers should re-attempt music afterwards.
 */
export function unlockAudio(): void {
  const c = getAudioContext();
  if (c && c.state === 'suspended') void c.resume();
}

/** True once audio is actually running — i.e. after a user gesture. */
export function isAudioReady(): boolean {
  const c = getAudioContext();
  return c !== null && c.state === 'running';
}
