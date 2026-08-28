import { BALL_RADIUS, CUE_BALL_ID, TABLE_LENGTH, TABLE_WIDTH } from '@8ball/shared';
import { styleForBall } from './ballStyle';
import type { ReplayFrame } from './replay';

/**
 * A shot, drawn as a picture worth sending to someone.
 *
 * Rendered on a plain 2D canvas rather than through PixiJS. The table renderer is built for
 * sixty frames a second on a screen of unknown size; this needs one frame at a fixed size with
 * text on it, and reusing the renderer would mean fighting its layout, its filters and its
 * ticker for no benefit.
 *
 * The line is drawn from the recording, so it is the path the balls genuinely took — not an
 * idealised one recomputed for the picture.
 */

export interface ShareCardOptions {
  frames: ReplayFrame[];
  /** Headline, e.g. "THREE RAILS". */
  title: string;
  /** Who played it. */
  player: string;
  /** Small print under the title — the mode, the venue, whatever fits. */
  subtitle?: string;
  width?: number;
}

/** PixiJS colours are 0xRRGGBB numbers; the 2D canvas wants a CSS string. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

const CARD_PAD = 44;
const TITLE_BAND = 132;
const FOOT_BAND = 62;

/** Traces one ball through the recording, skipping the frames where it hadn't moved yet. */
function pathOf(frames: ReplayFrame[], id: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const frame of frames) {
    const ball = frame.balls.find((b) => b.id === id);
    if (!ball || ball.pocketed) continue;
    const last = out[out.length - 1];
    // Thin the path: consecutive samples a fraction of a ball apart add nothing but file size.
    if (last && Math.hypot(ball.pos.x - last.x, ball.pos.y - last.y) < BALL_RADIUS * 0.4) continue;
    out.push({ ...ball.pos });
  }
  return out;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws the card and hands back the canvas.
 *
 * Returns the canvas rather than a data URL so the caller can decide what to do with it —
 * download it, copy it to the clipboard, or put it straight in the DOM.
 */
export function renderShareCard(opts: ShareCardOptions): HTMLCanvasElement {
  const width = opts.width ?? 1200;
  const scale = (width - CARD_PAD * 2) / TABLE_LENGTH;
  const tableH = TABLE_WIDTH * scale;
  const height = TITLE_BAND + tableH + FOOT_BAND + CARD_PAD;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Background.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#241a13');
  bg.addColorStop(1, '#140f0b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Title.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd569';
  ctx.font = '900 62px "Baloo 2", system-ui, sans-serif';
  ctx.fillText(opts.title, CARD_PAD, 82);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillText(opts.subtitle ?? '', CARD_PAD, 112);

  // The table.
  const tx = CARD_PAD;
  const ty = TITLE_BAND;
  ctx.save();
  ctx.translate(tx, ty);

  const rail = 22;
  ctx.fillStyle = '#7a4a24';
  roundRect(ctx, -rail, -rail, TABLE_LENGTH * scale + rail * 2, tableH + rail * 2, 18);
  ctx.fill();

  const cloth = ctx.createLinearGradient(0, 0, 0, tableH);
  cloth.addColorStop(0, '#2f9d5e');
  cloth.addColorStop(1, '#1d7442');
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, TABLE_LENGTH * scale, tableH);

  // Pockets, as simple dark discs — the exact geometry is not what this picture is about.
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (const [px, py] of [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [0, 1],
    [0.5, 1],
    [1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(px * TABLE_LENGTH * scale, py * tableH, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  const frames = opts.frames;
  if (frames.length >= 2) {
    const finalBalls = frames[frames.length - 1].balls;
    const startBalls = frames[0].balls;

    // Every ball that moved gets its path drawn; the cue ball's is picked out in white.
    for (const ball of startBalls) {
      const path = pathOf(frames, ball.id);
      if (path.length < 2) continue;
      const isCue = ball.id === CUE_BALL_ID;
      ctx.strokeStyle = isCue ? 'rgba(255,255,255,0.92)' : 'rgba(255,215,120,0.55)';
      ctx.lineWidth = isCue ? 4 : 3;
      ctx.setLineDash(isCue ? [] : [10, 8]);
      ctx.beginPath();
      ctx.moveTo(path[0].x * scale, path[0].y * scale);
      for (const p of path.slice(1)) ctx.lineTo(p.x * scale, p.y * scale);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Balls where they finished. A potted ball is drawn faintly at the pocket it went down,
    // which is the whole point of the picture when the shot was a pot.
    for (const ball of finalBalls) {
      const style = styleForBall(ball.id);
      const last = pathOf(frames, ball.id).slice(-1)[0] ?? ball.pos;
      const x = last.x * scale;
      const y = last.y * scale;
      ctx.globalAlpha = ball.pocketed ? 0.32 : 1;

      ctx.beginPath();
      ctx.arc(x, y, BALL_RADIUS * scale, 0, Math.PI * 2);
      ctx.fillStyle = ball.id === CUE_BALL_ID ? '#fbf8ef' : hex(style.base);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();

      if (style.stripe) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, BALL_RADIUS * scale, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#fbf8ef';
        ctx.fillRect(x - BALL_RADIUS * scale, y - BALL_RADIUS * scale, BALL_RADIUS * scale * 2, BALL_RADIUS * scale * 0.55);
        ctx.fillRect(x - BALL_RADIUS * scale, y + BALL_RADIUS * scale * 0.45, BALL_RADIUS * scale * 2, BALL_RADIUS * scale * 0.55);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // Footer.
  ctx.fillStyle = '#fbf8ef';
  ctx.font = '800 30px "Baloo 2", system-ui, sans-serif';
  ctx.fillText(opts.player, CARD_PAD, ty + tableH + 46);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillText('8-Ball', width - CARD_PAD, ty + tableH + 46);

  return canvas;
}

/**
 * Offers the card to the user.
 *
 * Tries the clipboard first — sharing a shot means pasting it into a chat, and a file in the
 * downloads folder is one more step than anybody will take. Falls back to a download when the
 * clipboard is unavailable or refuses, which it does on plenty of browsers.
 */
export async function offerShareCard(canvas: HTMLCanvasElement, filename: string): Promise<'copied' | 'downloaded'> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return 'downloaded';

  try {
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    }
  } catch {
    // Clipboard refused — fall through to the download, which always works.
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
