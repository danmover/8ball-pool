import type { CosmeticItem } from '@8ball/shared';
import { avatarSvg } from '../render/avatar';
import { bannerClassFor, bannerEffectClassFor, bannerEffectHtml } from '../render/cosmetics/banners';
import { ballSetFor, styleForBallInSet } from '../render/cosmetics/ballSets';
import { cueSkinFor } from '../render/cosmetics/cueSkins';
import { trailStyleFor } from '../render/cosmetics/trailStyles';
import { hitEffectFor } from '../render/cosmetics/hitEffects';

/**
 * Small inline previews for the item grid and the wheel reveal, drawn from the same data the
 * table renderer uses — so what you see on the card is what you get on the table.
 */

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * A cue, drawn as a cue.
 *
 * This was one diagonal line with eight coloured segments on it, which meant all twenty-four
 * cues in the locker were the same picture in different colours — and six of them were not even
 * that, because they had no skin and silently drew the house cue.
 *
 * What separates real cues is construction, so that is what this draws: the taper from a slim
 * ferrule up to the butt (built from a polygon, because a stroke is constant-width and the
 * taper is the whole point), the splice points running up the forearm, the wrap on the grip,
 * the inlays along it, and the cap on the end. Same data the table renderer uses, so a cue in
 * the locker is the cue you take to the table.
 */
function cuePreview(id: string, size: number): string {
  const s = cueSkinFor(id);
  const b = s.build;

  // The cue lies corner to corner, tip at the bottom left.
  const x0 = 10;
  const y0 = 90;
  const x1 = 90;
  const y1 = 10;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // Normal to the cue, for fanning each segment out to its half-width.
  const nx = -uy;
  const ny = ux;

  const R_TIP = 1.6;
  const R_BUTT = 5.2;
  const at = (f: number) => ({
    x: x0 + dx * f,
    y: y0 + dy * f,
    r: R_TIP + (R_BUTT - R_TIP) * Math.pow(f, 0.72),
  });

  /** A tapered slice of the stick between two points along it. */
  const seg = (f0: number, f1: number, color: string, opacity = 1): string => {
    const a = at(f0);
    const c = at(f1);
    const pts = [
      [a.x + nx * a.r, a.y + ny * a.r],
      [c.x + nx * c.r, c.y + ny * c.r],
      [c.x - nx * c.r, c.y - ny * c.r],
      [a.x - nx * a.r, a.y - ny * a.r],
    ]
      .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
      .join(' ');
    return `<polygon points="${pts}" fill="${color}" opacity="${opacity}"/>`;
  };

  // Construction stops, tip to butt.
  const F_FERRULE = 0.05;
  const F_SHAFT = 0.5;
  const F_COLLAR = 0.55;
  const F_RING = 0.58;
  const F_FOREARM = 0.86;
  const F_WRAP = 0.94;

  const body =
    seg(0, 0.02, css(s.tip)) +
    seg(0.02, F_FERRULE, css(s.ferrule)) +
    seg(F_FERRULE, F_SHAFT, css(s.shaft)) +
    seg(F_SHAFT, F_COLLAR, css(s.collar)) +
    seg(F_COLLAR, F_RING, css(s.ring)) +
    seg(F_RING, F_FOREARM, css(s.forearm)) +
    seg(F_FOREARM, F_WRAP, css(s.wrap)) +
    seg(F_WRAP, 1, css(s.butt));

  // --- Splice points: long tapering slivers of the butt colour up the forearm. ---
  let points = '';
  if (b.points > 0) {
    const tipF = F_RING + 0.02;
    const baseF = F_FOREARM - 0.02;
    const a = at(tipF);
    const c = at(baseF);
    for (let i = 0; i < b.points; i++) {
      // Half the points sit on each side of the stick; more points means narrower ones.
      const side = i % 2 === 0 ? 1 : -1;
      const lane = Math.floor(i / 2);
      const lanes = b.points / 2;
      const off = ((lane + 0.5) / lanes) * 0.72;
      const w = c.r * (0.5 / lanes);
      const px = nx * side * off;
      const py = ny * side * off;
      const pts = [
        [a.x + px * a.r, a.y + py * a.r],
        [c.x + px * c.r - nx * w, c.y + py * c.r - ny * w],
        [c.x + px * c.r + nx * w, c.y + py * c.r + ny * w],
      ]
        .map(([qx, qy]) => `${qx.toFixed(2)},${qy.toFixed(2)}`)
        .join(' ');
      points += `<polygon points="${pts}" fill="${css(s.butt)}" opacity="0.85"/>`;
    }
  }

  // --- Inlays along the forearm. ---
  let inlays = '';
  const inlayColor = css(s.inlay);
  if (b.inlay !== 'none') {
    const count = b.inlay === 'dots' ? 4 : b.inlay === 'diamonds' ? 3 : b.inlay === 'chevrons' ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const f = F_RING + 0.05 + (i / count) * (F_FOREARM - F_RING - 0.08);
      const q = at(f);
      const sz = q.r * 0.55;
      if (b.inlay === 'dots') {
        inlays += `<circle cx="${q.x.toFixed(2)}" cy="${q.y.toFixed(2)}" r="${sz.toFixed(2)}" fill="${inlayColor}"/>`;
      } else if (b.inlay === 'diamonds') {
        const pts = [
          [q.x + ux * sz * 1.6, q.y + uy * sz * 1.6],
          [q.x + nx * sz, q.y + ny * sz],
          [q.x - ux * sz * 1.6, q.y - uy * sz * 1.6],
          [q.x - nx * sz, q.y - ny * sz],
        ]
          .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
          .join(' ');
        inlays += `<polygon points="${pts}" fill="${inlayColor}"/>`;
      } else if (b.inlay === 'chevrons') {
        const pts = [
          [q.x + nx * q.r * 0.9 - ux * sz, q.y + ny * q.r * 0.9 - uy * sz],
          [q.x + ux * sz * 0.8, q.y + uy * sz * 0.8],
          [q.x - nx * q.r * 0.9 - ux * sz, q.y - ny * q.r * 0.9 - uy * sz],
        ]
          .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
          .join(' ');
        inlays += `<polyline points="${pts}" fill="none" stroke="${inlayColor}" stroke-width="1.5" stroke-linejoin="round"/>`;
      } else {
        // Runes: a short bar across the stick with a dot above it.
        inlays +=
          `<line x1="${(q.x + nx * q.r * 0.8).toFixed(2)}" y1="${(q.y + ny * q.r * 0.8).toFixed(2)}"` +
          ` x2="${(q.x - nx * q.r * 0.8).toFixed(2)}" y2="${(q.y - ny * q.r * 0.8).toFixed(2)}"` +
          ` stroke="${inlayColor}" stroke-width="1.6" stroke-linecap="round"/>` +
          `<circle cx="${(q.x + ux * sz).toFixed(2)}" cy="${(q.y + uy * sz).toFixed(2)}" r="1" fill="${inlayColor}"/>`;
      }
    }
  }

  // --- The wrap: what your hand actually holds. ---
  let wrap = '';
  if (b.wrap !== 'none') {
    const turns = b.wrap === 'linen' ? 9 : b.wrap === 'cord' ? 6 : 5;
    for (let i = 0; i <= turns; i++) {
      const f = F_FOREARM + (i / turns) * (F_WRAP - F_FOREARM);
      const q = at(f);
      if (b.wrap === 'leather') {
        // Cross-hatch: two short strokes crossing, like stitched leather.
        inlays += '';
        wrap +=
          `<line x1="${(q.x + nx * q.r + ux * 1.4).toFixed(2)}" y1="${(q.y + ny * q.r + uy * 1.4).toFixed(2)}"` +
          ` x2="${(q.x - nx * q.r - ux * 1.4).toFixed(2)}" y2="${(q.y - ny * q.r - uy * 1.4).toFixed(2)}"` +
          ` stroke="rgba(0,0,0,0.45)" stroke-width="1"/>`;
      } else {
        wrap +=
          `<line x1="${(q.x + nx * q.r).toFixed(2)}" y1="${(q.y + ny * q.r).toFixed(2)}"` +
          ` x2="${(q.x - nx * q.r).toFixed(2)}" y2="${(q.y - ny * q.r).toFixed(2)}"` +
          ` stroke="${b.wrap === 'cord' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.28)'}"` +
          ` stroke-width="${b.wrap === 'cord' ? 1.8 : 1}"/>`;
      }
    }
  }

  // --- Joint collar band and the butt cap. ---
  const joint = at(F_COLLAR);
  const bands =
    `<line x1="${(joint.x + nx * joint.r).toFixed(2)}" y1="${(joint.y + ny * joint.r).toFixed(2)}"` +
    ` x2="${(joint.x - nx * joint.r).toFixed(2)}" y2="${(joint.y - ny * joint.r).toFixed(2)}"` +
    ` stroke="${inlayColor}" stroke-width="1.4"/>`;

  const end = at(1);
  let cap = '';
  if (b.cap === 'ringed') {
    const inner = at(0.965);
    cap =
      `<line x1="${(inner.x + nx * inner.r).toFixed(2)}" y1="${(inner.y + ny * inner.r).toFixed(2)}"` +
      ` x2="${(inner.x - nx * inner.r).toFixed(2)}" y2="${(inner.y - ny * inner.r).toFixed(2)}"` +
      ` stroke="${inlayColor}" stroke-width="1.6"/>`;
  } else if (b.cap === 'domed') {
    cap = `<circle cx="${end.x.toFixed(2)}" cy="${end.y.toFixed(2)}" r="${(R_BUTT * 0.92).toFixed(
      2
    )}" fill="${css(s.butt)}" stroke="${inlayColor}" stroke-width="1.2"/>`;
  }

  // A specular line along the top edge, so the stick reads as round rather than flat.
  const shine =
    `<line x1="${(x0 + nx * 1.4).toFixed(2)}" y1="${(y0 + ny * 1.4).toFixed(2)}"` +
    ` x2="${(x1 + nx * 2.6).toFixed(2)}" y2="${(y1 + ny * 2.6).toFixed(2)}"` +
    ` stroke="rgba(255,255,255,0.3)" stroke-width="1.1" stroke-linecap="round"/>`;

  const aura = s.aura
    ? `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${css(
        s.aura
      )}" stroke-width="15" stroke-linecap="round" opacity="0.24"/>`
    : '';

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="rgba(8,8,14,0.55)" stroke-width="13" stroke-linecap="round"/>
    ${aura}${body}${points}${inlays}${wrap}${bands}${cap}${shine}</svg>`;
}

/**
 * A miniature of the set's surface treatment, matching what `paintBallPattern` draws on the
 * table. Without this the locker showed twelve near-identical discs.
 */
function patternOverlay(set: ReturnType<typeof ballSetFor>, cx: number, cy: number, r: number, clip: string, base: string): string {
  const g = `<g clip-path="url(#${clip})">`;
  switch (set.pattern) {
    case 'marble':
      return `${g}
        <path d="M${cx - r} ${cy - r * 0.3} q ${r * 0.7} ${r * 0.4} ${r * 1.3} -${r * 0.1} t ${r * 0.9} ${r * 0.3}"
              fill="none" stroke="rgba(70,66,80,0.4)" stroke-width="${r * 0.16}"/>
        <path d="M${cx - r} ${cy + r * 0.4} q ${r * 0.8} -${r * 0.5} ${r * 1.5} ${r * 0.2}"
              fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="${r * 0.09}"/></g>`;
    case 'wood':
      return `${g}${[0.35, 0.6, 0.85, 1.1].map(
        (f) =>
          `<ellipse cx="${cx + r * 0.2}" cy="${cy + r * 0.1}" rx="${r * f}" ry="${r * f * 1.15}"
                    fill="none" stroke="rgba(60,34,14,0.3)" stroke-width="${r * 0.09}"/>`
      ).join('')}</g>`;
    case 'swirl':
      return `${g}${[0, 2.1, 4.2].map((off) => {
        const pts = Array.from({ length: 14 }, (_, t) => {
          const a = (t / 14) * Math.PI * 2.4 + off;
          const rad = (t / 14) * r * 1.4;
          return `${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`;
        }).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="rgba(255,255,255,0.8)"
                          stroke-width="${r * 0.2}" stroke-linecap="round"/>`;
      }).join('')}</g>`;
    case 'starfield':
      return `${g}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#neb)"/>
        ${Array.from({ length: 14 }, (_, i) => {
          const a = i * 2.4;
          const d = ((i * 37) % 100) / 100;
          return `<circle cx="${cx + Math.cos(a) * r * d}" cy="${cy + Math.sin(a) * r * d}"
                          r="${0.7 + (i % 3) * 0.5}" fill="#fff"/>`;
        }).join('')}</g>`;
    case 'glass':
      return `${g}<circle cx="${cx}" cy="${cy}" r="${r * 0.78}" fill="none"
                          stroke="rgba(255,255,255,0.6)" stroke-width="${r * 0.12}"/>
        <circle cx="${cx + r * 0.25}" cy="${cy - r * 0.2}" r="${r * 0.35}" fill="#fff" opacity="0.55"/></g>`;
    case 'engraved':
      return `${g}${Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return `<line x1="${cx + Math.cos(a) * r * 0.8}" y1="${cy + Math.sin(a) * r * 0.8}"
                      x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}"
                      stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>`;
      }).join('')}
        <circle cx="${cx}" cy="${cy}" r="${r * 0.76}" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.6"/></g>`;
    case 'crackle':
      return `${g}${Array.from({ length: 5 }, (_, i) => {
        const a = i * 1.3;
        return `<path d="M${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r} L${cx + Math.cos(a + 0.6) * r * 0.3} ${
          cy + Math.sin(a + 0.6) * r * 0.3
        } L${cx + Math.cos(a + 2.2) * r} ${cy + Math.sin(a + 2.2) * r}"
                 fill="none" stroke="rgba(70,50,30,0.35)" stroke-width="1"/>`;
      }).join('')}</g>`;
    case 'prism':
      return `${g}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#pris)" opacity="0.6"/></g>`;
    case 'circuit':
      return `${g}<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(6,10,20,0.5)"/>
        <path d="M${cx - r * 0.7} ${cy - r * 0.3} h${r * 0.6} v${r * 0.5} h${r * 0.7}"
              fill="none" stroke="${base}" stroke-width="1.6"/>
        <path d="M${cx - r * 0.2} ${cy + r * 0.6} v-${r * 0.5} h${r * 0.8}"
              fill="none" stroke="${base}" stroke-width="1.6"/>
        <circle cx="${cx + r * 0.6}" cy="${cy + r * 0.2}" r="2.2" fill="${base}"/></g>`;
    default:
      return '';
  }
}

function ballPreview(id: string, size: number): string {
  const set = ballSetFor(id);
  const balls = [1, 9, 8];
  const cx = [30, 55, 76];
  const cy = [58, 42, 62];
  const r = [22, 20, 17];
  // Clip ids must be unique per preview — several of these sit on the page at once.
  const uid = id.replace(/\W/g, '');
  const discs = balls
    .map((ballId, i) => {
      const style = styleForBallInSet(ballId, set);
      const fill = style.stripe ? css(set.backing) : css(style.base);
      const band = style.stripe
        ? `<rect x="${cx[i] - r[i]}" y="${cy[i] - r[i] * 0.55}" width="${r[i] * 2}" height="${
            r[i] * 1.1
          }" fill="${css(style.base)}" clip-path="url(#cp${uid}${i})"/>`
        : '';
      const glow =
        set.finish === 'neon'
          ? `<circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i] + 3}" fill="${css(style.base)}" opacity="0.35"/>`
          : '';
      const shine =
        set.finish === 'matte'
          ? ''
          : `<ellipse cx="${cx[i] - r[i] * 0.3}" cy="${cy[i] - r[i] * 0.4}" rx="${r[i] * 0.3}" ry="${
              r[i] * 0.2
            }" fill="#fff" opacity="${set.finish === 'metallic' ? 0.9 : 0.65}"/>`;
      const pattern = patternOverlay(set, cx[i], cy[i], r[i], `cp${uid}${i}`, css(style.base));
      return `<clipPath id="cp${uid}${i}"><circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i]}"/></clipPath>
        ${glow}<circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i]}" fill="${fill}"/>${band}${pattern}${shine}
        <circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i]}" fill="none" stroke="${css(
          set.outline
        )}" stroke-width="3"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <defs>
      <radialGradient id="neb" cx="35%" cy="35%">
        <stop offset="0%" stop-color="#b98cff"/>
        <stop offset="55%" stop-color="#2a1060"/>
        <stop offset="100%" stop-color="#05020c"/>
      </radialGradient>
      <linearGradient id="pris" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#ff4d4d"/><stop offset="25%" stop-color="#ffc94d"/>
        <stop offset="50%" stop-color="#39ff88"/><stop offset="75%" stop-color="#4aa8ff"/>
        <stop offset="100%" stop-color="#b44dff"/>
      </linearGradient>
    </defs>${discs}</svg>`;
}

/**
 * A trail, drawn as the trail it actually is.
 *
 * `TrailStyle` has carried a `shape` since it was written — ribbon, comet, sparkle, fire — and
 * this preview ignored it completely, drawing the same swoosh for all seventeen and letting the
 * colour ramp do the whole job. So the locker showed seventeen identical curves. The shape is
 * free information that was already there; using it is most of the fix.
 */
function trailPreview(id: string, size: number): string {
  const style = trailStyleFor(id);
  const stops = style.ramp
    .map((c, i) => `<stop offset="${(i / (style.ramp.length - 1)) * 100}%" stop-color="${css(c)}"/>`)
    .join('');
  const gid = `tg-${id.replace(/\W/g, '')}`;
  const w = 10 * style.width;
  const alpha = 0.9 * style.alpha;
  const head = css(style.ramp[style.ramp.length - 1]);

  // Everything is drawn behind a ball sitting at the head of the trail, so the eye reads it as
  // "this is what follows the ball" rather than as an abstract stripe.
  let body: string;
  switch (style.shape) {
    case 'comet':
      // A wedge: wide and hot at the back, pinched to nothing at the ball.
      body = `<path d="M4 78 Q 32 72 64 42 Q 40 58 4 78 Z" fill="url(#${gid})" opacity="${alpha}"/>
        <path d="M8 74 Q 34 68 60 44" fill="none" stroke="#fff" stroke-width="${w * 0.18}"
              stroke-linecap="round" opacity="${alpha * 0.5}"/>`;
      break;
    case 'sparkle': {
      // Discrete motes rather than a stroke — a sparkle trail has gaps in it.
      const motes = Array.from({ length: 11 }, (_, i) => {
        const t = i / 10;
        const x = 6 + t * 58;
        const y = 76 - t * 36 + Math.sin(t * 7) * 5;
        const r = 1.4 + (1 - t) * 2.6;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
                        fill="url(#${gid})" opacity="${(alpha * (0.35 + t * 0.65)).toFixed(2)}"/>`;
      }).join('');
      const stars = [0.25, 0.62].map((t) => {
        const x = 10 + t * 52;
        const y = 74 - t * 34;
        return `<path d="M${x} ${y - 6} L${x + 1.6} ${y - 1.6} L${x + 6} ${y} L${x + 1.6} ${y + 1.6}
                         L${x} ${y + 6} L${x - 1.6} ${y + 1.6} L${x - 6} ${y} L${x - 1.6} ${y - 1.6} Z"
                      fill="${head}" opacity="${alpha}"/>`;
      }).join('');
      body = motes + stars;
      break;
    }
    case 'fire': {
      // Overlapping tongues, each a little shorter than the last.
      body = [0, 1, 2]
        .map((i) => {
          const lift = i * 7;
          const o = alpha * (1 - i * 0.26);
          return `<path d="M${5 + i * 6} ${78 - lift} Q ${28 + i * 4} ${66 - lift} ${62} ${44}
                           Q ${34 + i * 6} ${62 - lift} ${5 + i * 6} ${78 - lift} Z"
                        fill="url(#${gid})" opacity="${o.toFixed(2)}"/>`;
        })
        .join('');
      break;
    }
    case 'bubbles': {
      // Rings that grow as they fall behind, the way a bubble expands as it rises.
      body = Array.from({ length: 8 }, (_, i) => {
        const t = i / 7;
        const x = 8 + t * 54;
        const y = 76 - t * 34 + Math.sin(t * 5) * 4;
        const r = 2.2 + (1 - t) * 5.5;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
                        fill="none" stroke="url(#${gid})" stroke-width="${(w * 0.28).toFixed(2)}"
                        opacity="${(alpha * (0.4 + t * 0.6)).toFixed(2)}"/>`;
      }).join('');
      break;
    }
    case 'bolt': {
      // A jagged discharge — straight runs with hard corners, not a curve.
      const pts = [
        [5, 78], [16, 66], [24, 74], [36, 58], [45, 66], [56, 48], [64, 44],
      ]
        .map(([x, y]) => `${x},${y}`)
        .join(' ');
      body = `<polyline points="${pts}" fill="none" stroke="url(#${gid})" stroke-width="${w * 0.8}"
                    stroke-linejoin="round" stroke-linecap="round" opacity="${alpha}"/>
        <polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${w * 0.22}"
                  stroke-linejoin="round" stroke-linecap="round" opacity="${alpha * 0.6}"/>`;
      break;
    }
    case 'smoke': {
      // Soft overlapping puffs that widen and fade as they drift back.
      body = Array.from({ length: 7 }, (_, i) => {
        const t = i / 6;
        const x = 8 + t * 54;
        const y = 76 - t * 34;
        const r = 9 - t * 4.5;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
                        fill="url(#${gid})" opacity="${(alpha * 0.3 * (0.45 + t * 0.55)).toFixed(2)}"/>`;
      }).join('');
      break;
    }
    default:
      // Ribbon: a smooth band that keeps its width, with a highlight down the middle.
      body = `<path d="M5 76 Q 34 72 63 43" fill="none" stroke="url(#${gid})" stroke-width="${w}"
                    stroke-linecap="round" opacity="${alpha}"/>
        <path d="M5 76 Q 34 72 63 43" fill="none" stroke="#fff" stroke-width="${w * 0.22}"
              stroke-linecap="round" opacity="${alpha * 0.35}"/>`;
      break;
  }

  const glow = style.glow
    ? `<path d="M5 76 Q 34 72 63 43" fill="none" stroke="${head}" stroke-width="${w * 2.2}"
              stroke-linecap="round" opacity="0.18"/>`
    : '';

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0">${stops}</linearGradient></defs>
    ${glow}${body}
    <circle cx="72" cy="34" r="14" fill="#f6f2e6" stroke="rgba(10,10,18,0.6)" stroke-width="3"/>
    <ellipse cx="67" cy="29" rx="4" ry="3" fill="#fff"/>
  </svg>`;
}

function bannerPreview(item: CosmeticItem, size: number): string {
  const bannerClass = item.slot === 'banner' ? bannerClassFor(item.id) : bannerClassFor(undefined);
  const fxClass = item.slot === 'bannerEffect' ? bannerEffectClassFor(item.id) : '';
  return `<div class="banner-preview ${bannerClass}" style="width:${size * 1.6}px; height:${size * 0.72}px">
    ${bannerEffectHtml(fxClass)}
    <span class="banner-preview-name">PLAYER</span>
  </div>`;
}

/** Two balls at the moment of contact, with the effect's own burst between them. */
function hitPreview(id: string, size: number): string {
  const fx = hitEffectFor(id);
  const [core, mid, outer] = fx.colors;
  const cx = 50;
  const cy = 50;
  const r = fx.scale * 26;

  let burst = '';
  if (fx.shape === 'ring') {
    burst = `<circle cx="${cx}" cy="${cy}" r="${r * 0.75}" fill="none" stroke="${css(mid)}" stroke-width="4"/>
             <circle cx="${cx}" cy="${cy}" r="${r * 0.4}" fill="${css(core)}"/>`;
  } else if (fx.shape === 'confetti') {
    burst = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      const d = r * 0.75;
      return `<rect x="${cx + Math.cos(a) * d - 3}" y="${cy + Math.sin(a) * d - 1.5}" width="6" height="3"
                    fill="${css([core, mid, outer][i % 3])}" transform="rotate(${(a * 180) / Math.PI} ${
                      cx + Math.cos(a) * d
                    } ${cy + Math.sin(a) * d})"/>`;
    }).join('');
  } else if (fx.shape === 'bolt') {
    burst = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      const p = [1, 2, 3].map((s) => {
        const rr = (r * 1.3 * s) / 3;
        const jitter = ((i * 37) % 10) / 12 - 0.4;
        return `${cx + Math.cos(a + jitter * (s / 3)) * rr},${cy + Math.sin(a + jitter * (s / 3)) * rr}`;
      });
      return `<polyline points="${cx},${cy} ${p.join(' ')}" fill="none" stroke="${css(
        i % 2 ? core : mid
      )}" stroke-width="2.4" stroke-linejoin="round"/>`;
    }).join('');
  } else if (fx.shape === 'puff' || fx.shape === 'splat') {
    burst = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2;
      const d = r * (fx.shape === 'puff' ? 0.45 : 0.75);
      return `<circle cx="${cx + Math.cos(a) * d}" cy="${cy + Math.sin(a) * d}" r="${
        r * (fx.shape === 'puff' ? 0.3 : 0.16)
      }" fill="${css(i % 2 ? core : mid)}" opacity="${fx.shape === 'puff' ? 0.6 : 0.9}"/>`;
    }).join(`<circle cx="${cx}" cy="${cy}" r="${r * 0.4}" fill="${css(core)}"/>`);
  } else {
    // Star-like shapes: pow, spark, shard, nova.
    const count = fx.shape === 'nova' ? 14 : fx.shape === 'shard' ? 7 : 9;
    const innerRatio = fx.shape === 'nova' ? 0.24 : 0.42;
    const pts = Array.from({ length: count * 2 }, (_, i) => {
      const rr = i % 2 === 0 ? r : r * innerRatio;
      const a = (i / (count * 2)) * Math.PI * 2;
      return `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
    }).join(' ');
    burst =
      (fx.outlined ? `<polygon points="${pts}" fill="none" stroke="#140f22" stroke-width="7"/>` : '') +
      `<polygon points="${pts}" fill="${css(core)}" stroke="${css(mid)}" stroke-width="2.5"/>`;
  }

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <circle cx="24" cy="62" r="13" fill="#f6f2e6" stroke="rgba(10,10,18,0.65)" stroke-width="3"/>
    <circle cx="76" cy="40" r="13" fill="#f03a2e" stroke="rgba(10,10,18,0.65)" stroke-width="3"/>
    ${burst}
  </svg>`;
}

export function cosmeticPreviewHtml(item: CosmeticItem, size = 88): string {
  switch (item.slot) {
    case 'cue':
      return cuePreview(item.id, size);
    case 'hitEffect':
      return hitPreview(item.id, size);
    case 'ballSet':
      return ballPreview(item.id, size);
    case 'trail':
      return trailPreview(item.id, size);
    case 'banner':
    case 'bannerEffect':
      return bannerPreview(item, size);
    case 'chalk':
      return chalkPreview(item.id, size);
    case 'avatar':
      return `<div class="avatar-preview" style="width:${size}px; height:${size}px; background-image:${avatarSvg(
        0,
        'You',
        false,
        item.id
      )}"></div>`;
    default:
      return '';
  }
}

/** Chalk cube colours, keyed by item id. The puff colour follows the cube. */
const CHALK_COLORS: Record<string, { face: string; puff: string }> = {
  'chalk.blue': { face: '#2f6fd0', puff: '#7ea9e8' },
  'chalk.green': { face: '#2f9d5e', puff: '#8fd6b0' },
  'chalk.red': { face: '#c0392b', puff: '#f0958c' },
  'chalk.talc': { face: '#e8e4da', puff: '#ffffff' },
  'chalk.violet': { face: '#7d4bd0', puff: '#c3a6f0' },
  'chalk.copper': { face: '#a8642c', puff: '#e0a978' },
  'chalk.neon': { face: '#1a1030', puff: '#8cff4d' },
  'chalk.ember': { face: '#8a2d12', puff: '#ff9a4d' },
  'chalk.frost': { face: '#9fd8e8', puff: '#e8fbff' },
  'chalk.midas': { face: '#d4a017', puff: '#ffe9a8' },
  'chalk.stardust': { face: '#2a2350', puff: '#dcd0ff' },
  'chalk.singularity': { face: '#08070e', puff: '#b98cff' },
};

/**
 * A chalk cube seen from a corner, with its puff drifting off it.
 *
 * Drawn in isometric rather than flat-on because a flat square reads as a colour swatch, and
 * three visible faces is the difference between "a blue square" and "a cube of chalk".
 */
function chalkPreview(id: string, size: number): string {
  const c = CHALK_COLORS[id] ?? CHALK_COLORS['chalk.blue'];
  const top = shadeHex(c.face, 0.3);
  const side = shadeHex(c.face, -0.3);
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
      <g transform="translate(50 58)">
        <path d="M0 -26 L28 -12 L0 2 L-28 -12 Z" fill="${top}"/>
        <path d="M-28 -12 L0 2 L0 30 L-28 16 Z" fill="${side}"/>
        <path d="M28 -12 L0 2 L0 30 L28 16 Z" fill="${c.face}"/>
        <path d="M0 -26 L28 -12 L0 2 L-28 -12 Z M-28 -12 L-28 16 L0 30 L28 16 L28 -12"
              fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="2" stroke-linejoin="round"/>
      </g>
      <g fill="${c.puff}" opacity="0.75">
        <circle cx="70" cy="26" r="7"/>
        <circle cx="80" cy="16" r="4.5"/>
        <circle cx="86" cy="27" r="3"/>
      </g>
    </svg>`;
}

/** Lighten (positive) or darken (negative) a #rrggbb colour. */
function shadeHex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v + (amount > 0 ? (255 - v) * amount : v * amount))))
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
