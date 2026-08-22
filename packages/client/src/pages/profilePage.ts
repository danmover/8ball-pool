import {
  RARITY_LABELS,
  SLOT_LABELS,
  SLOT_ORDER,
  chalkPrice,
  cosmeticById,
  itemsForSlot,
  levelProgress,
  resolveLoadout,
  type CosmeticSlot,
} from '@8ball/shared';
import { buyWithChalk, equip, getProfile, setDisplayName } from '../profile/profile';
import { cosmeticPreviewHtml } from '../profile/cosmeticPreview';
import { icon } from '../render/icons';
import { openWheel } from '../profile/wheel';
import { playerBannerHtml } from '../render/banner';
import { navigate } from '../router';

/**
 * The locker: your banner, your level, and every cosmetic in the game — owned ones equippable,
 * locked ones buyable with chalk. The wheel opens from here and from the post-match screen.
 */
export function renderProfilePage(root: HTMLElement): () => void {
  let activeSlot: CosmeticSlot = 'cue';

  function draw(): void {
    const profile = getProfile();
    const loadout = resolveLoadout(profile.loadout);
    const progress = levelProgress(profile.xp);
    const name = profile.displayName || 'Player';

    root.innerHTML = `
      <div class="profile-page">
        <div class="profile-top">
          <button class="icon-btn" id="backBtn" title="Back">${icon('back', { size: 20 })}</button>
          <h1>Your Locker</h1>
          <div class="wallet">
            <span class="wallet-chip" title="Chalk">${icon('chalk', { size: 18 })} ${profile.chalk}</span>
            <span class="wallet-chip ${profile.spins > 0 ? 'hot' : ''}" title="Spins">${icon('wheel', {
              size: 18,
            })} ${profile.spins}</span>
          </div>
        </div>

        <div class="profile-hero">
          ${playerBannerHtml({
            name,
            seatIndex: 0,
            loadout,
            subtitle: `Level ${progress.level}`,
            large: true,
            // The kit strip turns the hero into a summary of what you'd actually bring to
            // a table, rather than a nameplate with empty space beside it.
            extra: `<div class="kit-strip">${(['cue', 'ballSet', 'trail'] as CosmeticSlot[])
              .map((slot) => {
                const item = cosmeticById(loadout[slot]!);
                return item
                  ? `<span class="kit-chip" title="${item.name}">${cosmeticPreviewHtml(item, 40)}</span>`
                  : '';
              })
              .join('')}</div>`,
          })}
          <div class="hero-side">
            <label class="name-field">
              <span>Display name</span>
              <input id="nameInput" maxlength="16" placeholder="Player" value="${escapeAttr(
                profile.displayName
              )}" />
            </label>
            <div class="xp-bar" title="${progress.into} / ${progress.span} XP">
              <div class="xp-fill" style="width:${Math.round(progress.ratio * 100)}%"></div>
              <span class="xp-label">${progress.into} / ${progress.span} XP</span>
            </div>
            <div class="stat-row">
              <span><b>${profile.stats.pots}</b> potted</span>
              <span><b>${profile.stats.wins}</b> wins</span>
              <span><b>${profile.stats.bestCombo}</b> best combo</span>
            </div>
            <button id="spinBtn" ${profile.spins > 0 ? '' : 'disabled'}>
              ${profile.spins > 0 ? `SPIN THE WHEEL (${profile.spins})` : 'NO SPINS — PLAY TO EARN'}
            </button>
          </div>
        </div>

        <div class="slot-tabs">
          ${SLOT_ORDER.map(
            (slot) =>
              `<button class="slot-tab${slot === activeSlot ? ' active' : ''}" data-slot="${slot}">${
                SLOT_LABELS[slot]
              }</button>`
          ).join('')}
        </div>

        <div class="item-grid">
          ${itemsForSlot(activeSlot)
            .map((item) => {
              const owned = profile.unlocked.includes(item.id);
              const equipped = loadout[item.slot] === item.id;
              const price = chalkPrice(item.rarity);
              const affordable = profile.chalk >= price;
              return `
                <div class="item-card rarity-${item.rarity}${equipped ? ' equipped' : ''}${
                  owned ? '' : ' locked'
                }" data-id="${item.id}">
                  <div class="item-art">${cosmeticPreviewHtml(item)}</div>
                  <div class="item-name">${item.name}</div>
                  <div class="item-rarity">${RARITY_LABELS[item.rarity]}</div>
                  <div class="item-action">
                    ${
                      equipped
                        ? '<span class="tag-equipped">EQUIPPED</span>'
                        : owned
                          ? '<button class="mini" data-equip="' + item.id + '">Equip</button>'
                          : '<button class="mini secondary" data-buy="' +
                            item.id +
                            '"' +
                            (affordable ? '' : ' disabled') +
                            '>' + icon('chalk', { size: 14 }) + ' ' +
                            price +
                            '</button>'
                    }
                  </div>
                  ${owned ? '' : `<div class="lock-veil">${icon('lock', { size: 14 })}</div>`}
                </div>`;
            })
            .join('')}
        </div>
      </div>`;

    root.querySelector('#backBtn')!.addEventListener('click', () => navigate('/'));

    const nameInput = root.querySelector<HTMLInputElement>('#nameInput')!;
    nameInput.addEventListener('change', () => {
      setDisplayName(nameInput.value.trim());
      draw();
    });

    root.querySelector<HTMLButtonElement>('#spinBtn')!.addEventListener('click', () => {
      void openWheel(root).then((outcome) => {
        if (outcome && !outcome.result.duplicate) activeSlot = outcome.result.item.slot;
        draw();
      });
    });

    root.querySelectorAll<HTMLElement>('.slot-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeSlot = tab.dataset.slot as CosmeticSlot;
        draw();
      });
    });

    root.querySelectorAll<HTMLElement>('[data-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.equip!;
        equip(cosmeticById(id)!.slot, id);
        draw();
      });
    });

    root.querySelectorAll<HTMLElement>('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (buyWithChalk(btn.dataset.buy!)) draw();
      });
    });
  }

  draw();
  return () => {
    root.innerHTML = '';
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
