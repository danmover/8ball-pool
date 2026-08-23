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

function cuePreview(id: string, size: number): string {
  const s = cueSkinFor(id);
  // A cue laid diagonally, tip bottom-left, built from stacked segments like the real one.
  const segs: Array<[number, number, number]> = [
    [0, 0.02, s.tip],
    [0.02, 0.055, s.ferrule],
    [0.055, 0.5, s.shaft],
    [0.5, 0.545, s.collar],
    [0.545, 0.58, s.ring],
    [0.58, 0.86, s.forearm],
    [0.86, 0.94, s.wrap],
    [0.94, 1, s.butt],
  ];
  const x0 = 8;
  const y0 = 92;
  const x1 = 92;
  const y1 = 8;
  const parts = segs
    .map(([a, b, color]) => {
      const ax = x0 + (x1 - x0) * a;
      const ay = y0 + (y1 - y0) * a;
      const bx = x0 + (x1 - x0) * b;
      const by = y0 + (y1 - y0) * b;
      const w = 3 + 6 * Math.pow((a + b) / 2, 0.72);
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${css(
        color
      )}" stroke-width="${w}" stroke-linecap="butt"/>`;
    })
    .join('');
  const aura = s.aura
    ? `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${css(
        s.aura
      )}" stroke-width="16" stroke-linecap="round" opacity="0.28"/>`
    : '';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="rgba(8,8,14,0.7)" stroke-width="12" stroke-linecap="round"/>
    ${aura}${parts}</svg>`;
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

function trailPreview(id: string, size: number): string {
  const style = trailStyleFor(id);
  const stops = style.ramp
    .map((c, i) => `<stop offset="${(i / (style.ramp.length - 1)) * 100}%" stop-color="${css(c)}"/>`)
    .join('');
  const gid = `tg-${id.replace(/\W/g, '')}`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>
    <path d="M6 70 Q 40 70 62 44" fill="none" stroke="url(#${gid})" stroke-width="${
      10 * style.width
    }" stroke-linecap="round" opacity="${0.9 * style.alpha}"/>
    <circle cx="70" cy="36" r="14" fill="#f6f2e6" stroke="rgba(10,10,18,0.6)" stroke-width="3"/>
    <ellipse cx="65" cy="31" rx="4" ry="3" fill="#fff"/>
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
