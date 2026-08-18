let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Unlocks the AudioContext; must be called from a user gesture (tap/click). */
export function unlockAudio(): void {
  const c = getCtx();
  if (c.state === 'suspended') void c.resume();
}

function pluck(freq: number, duration: number, volume: number, type: OscillatorType = 'sine'): void {
  const c = getCtx();
  if (c.state === 'suspended') return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.6), c.currentTime + duration);
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration + 0.02);
}

export function playBallClick(volume: number, intensity = 1): void {
  pluck(1200 * Math.min(1.4, 0.6 + intensity), 0.08, 0.35 * volume, 'triangle');
}

export function playCushionThud(volume: number): void {
  pluck(180, 0.12, 0.25 * volume, 'sine');
}

export function playPocketSwish(volume: number): void {
  pluck(700, 0.35, 0.3 * volume, 'sine');
  setTimeout(() => pluck(420, 0.25, 0.22 * volume, 'sine'), 60);
}

export function playCueStrike(volume: number, power: number): void {
  pluck(260 + power * 200, 0.09, 0.4 * volume, 'square');
}
