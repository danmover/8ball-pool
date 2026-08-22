import { resolveLoadout, type Loadout } from '@8ball/shared';
import { avatarSvg } from './avatar';
import { bannerClassFor, bannerEffectClassFor, bannerEffectHtml } from './cosmetics/banners';

/**
 * A player's banner: frame, avatar, name and effect layer. Used by the host scoreboard, the
 * phone controller header and the profile locker, so a loadout looks the same everywhere.
 */
export interface BannerOpts {
  name: string;
  seatIndex: number;
  loadout: Loadout;
  /** Small line under the name — group, team, score, level. */
  subtitle?: string;
  /** Extra markup appended inside the info column (ball rows, badges). */
  extra?: string;
  /** This player is up: effects run at full intensity. */
  active?: boolean;
  /** On a scoring streak: the banner ignites regardless of the equipped effect. */
  onFire?: boolean;
  large?: boolean;
  striped?: boolean;
  /** Dim everything (empty seat / disconnected). */
  muted?: boolean;
}

export function playerBannerHtml(opts: BannerOpts): string {
  const loadout = resolveLoadout(opts.loadout);
  const frame = bannerClassFor(loadout.banner);
  const effect = bannerEffectClassFor(loadout.bannerEffect);
  const avatar = avatarSvg(opts.seatIndex, opts.name, opts.striped ?? false, loadout.avatar);

  const classes = [
    'player-banner',
    frame,
    opts.active ? 'active' : '',
    opts.large ? 'large' : '',
    opts.muted ? 'muted' : '',
    opts.onFire ? 'on-fire' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // The streak fire is its own layer so it stacks on top of whatever effect is equipped.
  const fireLayer = opts.onFire ? bannerEffectHtml('fx-flames') : '';

  return `
    <div class="${classes}">
      ${bannerEffectHtml(effect)}
      ${fireLayer}
      <div class="banner-body">
        <div class="avatar" style="background-image:${avatar}"></div>
        <div class="player-info">
          <div class="player-name">${opts.name}</div>
          ${opts.subtitle ? `<div class="banner-sub">${opts.subtitle}</div>` : ''}
          ${opts.extra ?? ''}
        </div>
      </div>
      ${opts.onFire ? '<span class="fire-tag">ON FIRE</span>' : ''}
    </div>`;
}
