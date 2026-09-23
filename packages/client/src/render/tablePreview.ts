/**
 * A whole table, drawn small, into any 2D canvas.
 *
 * This exists because the theme picker used to be three nested `<span>`s with background
 * colours on them — a wood-coloured box round a green box — and you cannot choose between
 * eleven tables from that. What you need to see is the *table*: how the cloth catches the lamp,
 * what the sights are plated in, how dark the room round it goes. So the picker draws real
 * miniatures, and the Theme Studio uses exactly the same function for its live preview, which
 * means what you are shown while building a table is what you get when you sit down at it.
 *
 * It is not the Pixi renderer at small scale — that would mean standing an entire WebGL context
 * up per swatch. It is the same *material description* interpreted for a 2D context, and it is
 * cheap enough to redraw every one of them on every keystroke in the Studio.
 */

import type { TableTheme } from './cosmetics/tableThemes';

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * A tile of plain weave, used as a repeating pattern.
 *
 * The full cloth generator walks two million pixels; that is fine once per theme and absurd
 * eleven times per settings-panel open. A four-cell tile repeated by the 2D context gives the
 * same weave for the cost of one tiny canvas, because a plain weave *is* a four-cell tile.
 */
const weaveTiles = new Map<string, CanvasPattern | null>();

function weavePattern(ctx: CanvasRenderingContext2D, cell: number): CanvasPattern | null {
  const key = String(cell);
  if (weaveTiles.has(key)) return weaveTiles.get(key)!;

  const tile = document.createElement('canvas');
  tile.width = cell * 2;
  tile.height = cell * 2;
  const t = tile.getContext('2d');
  if (!t) {
    weaveTiles.set(key, null);
    return null;
  }
  // Warp on top in two opposite quadrants, weft on top in the other two — light on the crown
  // of whichever thread is over, shadow in the gap beside it.
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const warpOnTop = (qx + qy) % 2 === 0;
      const ox = qx * cell;
      const oy = qy * cell;
      const grad = warpOnTop
        ? t.createLinearGradient(ox, 0, ox + cell, 0)
        : t.createLinearGradient(0, oy, 0, oy + cell);
      grad.addColorStop(0, 'rgba(0,0,0,0.16)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      grad.addColorStop(1, 'rgba(0,0,0,0.16)');
      t.fillStyle = grad;
      t.fillRect(ox, oy, cell, cell);
    }
  }
  const pattern = t.createPattern(tile, 'repeat');
  weaveTiles.set(key, pattern);
  return pattern;
}

/** Rounded rect on a plain 2D context, since `roundRect` is still not everywhere. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export interface PreviewOptions {
  /** Draw the room behind the table. Off for a swatch that sits on a panel of its own. */
  room?: boolean;
  /** Fraction of the shorter side left as margin round the table. */
  pad?: number;
}

/**
 * Paints `theme` into `canvas` at its current pixel size.
 *
 * Handles device pixel ratio itself — a table drawn at CSS pixels on a retina screen looks
 * soft, and soft is the one thing a preview of a *premium* table cannot afford to be.
 */
export function drawTablePreview(
  canvas: HTMLCanvasElement,
  theme: TableTheme,
  options: PreviewOptions = {}
): void {
  const { room = true, pad = 0.1 } = options;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || Number(canvas.getAttribute('width')) || 200;
  const cssH = canvas.clientHeight || Number(canvas.getAttribute('height')) || 100;
  if (cssW <= 0 || cssH <= 0) return;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // --- The room. Cloth pushed toward the lamp, then taken down to nearly black. ---
  if (room) {
    const g = ctx.createRadialGradient(cssW / 2, cssH * 0.42, 2, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.72);
    g.addColorStop(0, rgba(theme.dark, 0.55));
    g.addColorStop(0.55, 'rgba(0,0,0,0.82)');
    g.addColorStop(1, 'rgba(0,0,0,0.96)');
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
    // The lamp's own pool on the floor.
    const pool = ctx.createRadialGradient(cssW / 2, cssH * 0.5, 2, cssW / 2, cssH * 0.5, cssW * 0.6);
    pool.addColorStop(0, rgba(theme.lamp.color, 0.16 * theme.lamp.strength));
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  // --- Fit a 2:1 table into the frame. ---
  const margin = Math.min(cssW, cssH) * pad;
  const availW = cssW - margin * 2;
  const availH = cssH - margin * 2;
  const scale = Math.min(availW / 2, availH);
  const tw = scale * 2;
  const th = scale;
  const tx = (cssW - tw) / 2;
  const ty = (cssH - th) / 2;
  const railW = Math.max(3, th * 0.115);
  const radius = th * 0.11;

  // --- Shadow under the whole cabinet. ---
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = th * 0.22;
  ctx.shadowOffsetY = th * 0.07;
  ctx.fillStyle = theme.railDark;
  rr(ctx, tx, ty, tw, th, radius);
  ctx.fill();
  ctx.restore();

  // --- Rail: base, grain, varnish, lit top edge. ---
  ctx.save();
  rr(ctx, tx, ty, tw, th, radius);
  ctx.clip();

  ctx.fillStyle = theme.rail;
  ctx.fillRect(tx, ty, tw, th);

  // Grain, at a density and contrast the wood itself decides.
  const streaks = Math.round(6 + theme.grain * 26);
  ctx.lineWidth = Math.max(0.5, th * 0.008);
  for (let i = 0; i < streaks; i++) {
    const y = ty + ((i + 0.5) / streaks) * th + (Math.sin(i * 12.9898) * th) / streaks / 2;
    ctx.strokeStyle = rgba(theme.railDark, 0.1 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 0.22 * (0.4 + theme.grain));
    ctx.beginPath();
    ctx.moveTo(tx, y);
    for (let x = tx; x <= tx + tw; x += tw / 8) {
      ctx.lineTo(x, y + Math.sin((x / tw) * 6.2 + i) * th * 0.012 * (1 + theme.grain));
    }
    ctx.stroke();
  }

  // Varnish: one broad diagonal reflection, scaled by the finish.
  if (theme.gloss > 0.05) {
    const sweep = ctx.createLinearGradient(tx, ty, tx + tw * 0.8, ty + th);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.42, `rgba(255,255,255,${0.03 * theme.gloss})`);
    sweep.addColorStop(0.5, `rgba(255,255,255,${0.2 * theme.gloss})`);
    sweep.addColorStop(0.58, `rgba(255,255,255,${0.03 * theme.gloss})`);
    sweep.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(tx, ty, tw, th);
  }

  // Top lit, bottom shadowed.
  const band = ctx.createLinearGradient(0, ty, 0, ty + th);
  band.addColorStop(0, 'rgba(255,255,255,0.16)');
  band.addColorStop(0.45, 'rgba(0,0,0,0)');
  band.addColorStop(1, rgba(theme.railDark, 0.45));
  ctx.fillStyle = band;
  ctx.fillRect(tx, ty, tw, th);
  ctx.restore();

  // --- The bed. ---
  const bx = tx + railW;
  const by = ty + railW;
  const bw = tw - railW * 2;
  const bh = th - railW * 2;
  const bedR = Math.max(1.5, radius * 0.32);

  ctx.save();
  rr(ctx, bx, by, bw, bh, bedR);
  ctx.clip();

  // Cloth, lit from where the lamp hangs.
  const cloth = ctx.createRadialGradient(bx + bw / 2, by + bh * 0.42, bh * 0.05, bx + bw / 2, by + bh / 2, bw * 0.62);
  cloth.addColorStop(0, theme.light);
  cloth.addColorStop(0.6, theme.light);
  cloth.addColorStop(1, theme.dark);
  ctx.fillStyle = cloth;
  ctx.fillRect(bx, by, bw, bh);

  // Weave. Cell size follows the cloth's own thread pitch, floored so it never sub-pixels.
  const cell = Math.max(2, Math.round((theme.weave / 3) * Math.max(2, bh * 0.022)));
  const pattern = weavePattern(ctx, cell);
  if (pattern) {
    ctx.save();
    ctx.globalAlpha = 0.5 + theme.nap * 0.28;
    ctx.fillStyle = pattern;
    ctx.fillRect(bx, by, bw, bh);
    ctx.restore();
  }

  // Painted markings.
  if (theme.markings) {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = Math.max(0.5, bh * 0.006);
    for (const frac of [0.25, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(bx + bw * frac, by);
      ctx.lineTo(bx + bw * frac, by + bh);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (const frac of [0.25, 0.75]) {
      ctx.beginPath();
      ctx.arc(bx + bw * frac, by + bh / 2, Math.max(0.8, bh * 0.014), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The lamp's specular on the cloth — the single detail that makes it a surface.
  const sheen = ctx.createRadialGradient(bx + bw / 2, by + bh * 0.34, 1, bx + bw / 2, by + bh * 0.42, bw * (0.28 + (1 - theme.lamp.focus) * 0.3));
  sheen.addColorStop(0, rgba(theme.lamp.color, 0.2 * theme.lamp.strength));
  sheen.addColorStop(1, rgba(theme.lamp.color, 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(bx, by, bw, bh);

  // Cushion shadow all the way round the bed.
  const inset = Math.max(1.5, bh * 0.1);
  const shade: [number, number, number, number, number, number, number, number][] = [
    [bx, by, bw, inset, bx, by, bx, by + inset],
    [bx, by + bh - inset, bw, inset, bx, by + bh, bx, by + bh - inset],
    [bx, by, inset, bh, bx, by, bx + inset, by],
    [bx + bw - inset, by, inset, bh, bx + bw, by, bx + bw - inset, by],
  ];
  for (const [rx2, ry2, rw, rh, gx0, gy0, gx1, gy1] of shade) {
    const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    grad.addColorStop(0, 'rgba(0,0,0,0.34)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(rx2, ry2, rw, rh);
  }
  ctx.restore();

  /*
   * Pockets, as leather bezels with a dark throat.
   *
   * Sized off the rail rather than the bed, and deliberately smaller than the real thing looks
   * from above. At swatch scale a faithfully-proportioned mouth is a black blob big enough to
   * be the first thing you see, and the first thing you should see is the cloth.
   */
  const pr = railW * 0.6;
  const mouths: [number, number][] = [
    [bx, by],
    [bx + bw / 2, by - railW * 0.18],
    [bx + bw, by],
    [bx, by + bh],
    [bx + bw / 2, by + bh + railW * 0.18],
    [bx + bw, by + bh],
  ];
  for (const [px, py] of mouths) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = theme.pocket;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.68, 0, Math.PI * 2);
    ctx.fillStyle = theme.pocketDark;
    ctx.fill();
    // A crescent of light on the near lip, so the mouth reads as a hole and not a dot.
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.86, Math.PI * 1.15, Math.PI * 1.85);
    ctx.lineWidth = Math.max(0.5, pr * 0.18);
    ctx.strokeStyle = rgba(theme.metal.light, 0.22 + theme.metal.polish * 0.22);
    ctx.stroke();
  }

  /*
   * Sights, plated in whatever the theme's fittings are.
   *
   * Kept small and held well back. Eighteen full-brightness dots at this size turn the rail
   * into a fairground marquee, and they then out-shout the cloth — which is the first thing a
   * swatch has to communicate. They are here to show what the fittings are plated in, and that
   * reads perfectly well at a tenth of the rail width and 90% opacity.
   */
  const dr = Math.max(0.6, railW * 0.1);
  const sight = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, dr * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = rgba(theme.metal.dark, 0.45);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, dr, 0, Math.PI * 2);
    ctx.fillStyle = rgba(theme.metal.mid, 0.9);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - dr * 0.3, y - dr * 0.3, dr * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = rgba(theme.metal.light, 0.4 + theme.metal.polish * 0.3);
    ctx.fill();
  };
  const railMid = railW / 2;
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue;
    const x = bx + (bw * i) / 8;
    sight(x, ty + railMid);
    sight(x, ty + th - railMid);
  }
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = by + bh * frac;
    sight(tx + railMid, y);
    sight(tx + tw - railMid, y);
  }

  // --- The cabinet's own outline, last, so nothing sits over it. ---
  ctx.lineWidth = Math.max(1, th * 0.016);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  rr(ctx, tx, ty, tw, th, radius);
  ctx.stroke();
}
