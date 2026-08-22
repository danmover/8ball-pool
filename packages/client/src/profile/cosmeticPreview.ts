import type { CosmeticItem } from '@8ball/shared';
import { avatarSvg } from '../render/avatar';
import { bannerClassFor, bannerEffectClassFor, bannerEffectHtml } from '../render/cosmetics/banners';
import { ballSetFor, styleForBallInSet } from '../render/cosmetics/ballSets';
import { cueSkinFor } from '../render/cosmetics/cueSkins';
import { trailStyleFor } from '../render/cosmetics/trailStyles';

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
      return `<clipPath id="cp${uid}${i}"><circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i]}"/></clipPath>
        ${glow}<circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i]}" fill="${fill}"/>${band}${shine}
        <circle cx="${cx[i]}" cy="${cy[i]}" r="${r[i]}" fill="none" stroke="${css(
          set.outline
        )}" stroke-width="3"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><defs></defs>${discs}</svg>`;
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

export function cosmeticPreviewHtml(item: CosmeticItem, size = 88): string {
  switch (item.slot) {
    case 'cue':
      return cuePreview(item.id, size);
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
