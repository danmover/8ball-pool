import {
  RARITY_LABELS,
  RARITY_ORDER,
  SLOT_LABELS,
  SLOT_ORDER,
  chalkPrice,
  collectionProgress,
  cosmeticById,
  filterItems,
  itemsForSlot,
  levelProgress,
  resolveLoadout,
  setProgress,
  setsContaining,
  slotProgress,
  type CosmeticSlot,
  type Rarity,
  type SortMode,
} from '@8ball/shared';
import { buyWithChalk, equip, getProfile, setDisplayName } from '../profile/profile';
import {
  MAX_PRESETS,
  applyPreset,
  claimSet,
  deletePreset,
  presets,
  savePreset,
} from '../profile/locker';
import { cosmeticPreviewHtml } from '../profile/cosmeticPreview';
import { icon } from '../render/icons';
import { openCase } from '../profile/caseReel';
import { playerBannerHtml } from '../render/banner';
import { showToast } from '../render/dialogs';
import { goBack, navigate } from '../router';
import { mountResumeStrip } from './pageShell';

/**
 * The locker.
 *
 * It used to be a banner, a spin button and one long grid per slot. That was fine at forty
 * items and stopped being fine somewhere past a hundred: everything was equally far away, so
 * nothing felt close, and there was no way to find a particular thing you half-remembered.
 *
 * Three things give the catalogue a shape — a **collection** view with per-shelf progress and
 * cross-slot sets to aim at, **presets** so a look is one tap rather than eight, and a filter
 * bar so the grid can be narrowed to what you actually want to see.
 */
export function renderProfilePage(root: HTMLElement): () => void {
  type Tab = 'items' | 'collection' | 'kits';
  let tab: Tab = 'items';
  let activeSlot: CosmeticSlot = 'cue';

  // Grid filters. Held here rather than in the profile: these are how you are browsing right
  // now, not something you would want restored a week later.
  let search = '';
  let ownership: 'all' | 'owned' | 'missing' = 'all';
  let rarity: Rarity | 'all' = 'all';
  let sort: SortMode = 'rarity';

  function toast(msg: string, kind = 'info'): void {
    const stack = root.querySelector<HTMLElement>('#lockerToasts');
    if (stack) showToast(stack, msg, kind as Parameters<typeof showToast>[2]);
  }

  function itemsTab(): string {
    const profile = getProfile();
    const loadout = resolveLoadout(profile.loadout);
    const shelves = slotProgress(profile.unlocked);
    const all = itemsForSlot(activeSlot);
    const shown = filterItems(
      all,
      profile.unlocked,
      {
        search,
        ownership,
        rarity,
        sort,
        affordableWith: null,
      },
      chalkPrice
    );

    return `
      <div class="slot-tabs">
        ${SLOT_ORDER.map((slot) => {
          const shelf = shelves.find((s) => s.slot === slot)!;
          const done = shelf.owned === shelf.total;
          return `<button class="slot-tab${slot === activeSlot ? ' active' : ''}${
            done ? ' complete' : ''
          }" data-slot="${slot}">
              ${SLOT_LABELS[slot]}
              <span class="slot-count">${shelf.owned}/${shelf.total}</span>
            </button>`;
        }).join('')}
      </div>

      <div class="filter-bar">
        <input id="lockerSearch" class="filter-search" type="search" placeholder="Search…"
               value="${escapeAttr(search)}" />
        <select id="filterOwned" class="filter-select">
          <option value="all"${ownership === 'all' ? ' selected' : ''}>All</option>
          <option value="owned"${ownership === 'owned' ? ' selected' : ''}>Owned</option>
          <option value="missing"${ownership === 'missing' ? ' selected' : ''}>Not owned</option>
        </select>
        <select id="filterRarity" class="filter-select">
          <option value="all"${rarity === 'all' ? ' selected' : ''}>Any rarity</option>
          ${RARITY_ORDER.map(
            (r) => `<option value="${r}"${rarity === r ? ' selected' : ''}>${RARITY_LABELS[r]}</option>`
          ).join('')}
        </select>
        <select id="filterSort" class="filter-select">
          <option value="rarity"${sort === 'rarity' ? ' selected' : ''}>By rarity</option>
          <option value="name"${sort === 'name' ? ' selected' : ''}>By name</option>
          <option value="owned"${sort === 'owned' ? ' selected' : ''}>Owned first</option>
        </select>
        <span class="filter-count">${shown.length} of ${all.length}</span>
      </div>

      <div class="item-grid">
        ${
          shown.length === 0
            ? '<p class="muted empty-grid">Nothing here matches that.</p>'
            : shown.map((item) => itemCard(item, profile, loadout)).join('')
        }
      </div>`;
  }

  function itemCard(
    item: ReturnType<typeof itemsForSlot>[number],
    profile: ReturnType<typeof getProfile>,
    loadout: Required<ReturnType<typeof resolveLoadout>>
  ): string {
    const owned = profile.unlocked.includes(item.id);
    const equipped = loadout[item.slot] === item.id;
    const price = chalkPrice(item.rarity);
    const affordable = profile.chalk >= price;
    // Which set this belongs to, so an item is a step toward something rather than a loose end.
    const sets = setsContaining(item.id);

    return `
      <div class="item-card rarity-${item.rarity}${equipped ? ' equipped' : ''}${
        owned ? '' : ' locked'
      }" data-id="${item.id}">
        <div class="item-art">${cosmeticPreviewHtml(item)}</div>
        <div class="item-name">${item.name}</div>
        <div class="item-rarity">${RARITY_LABELS[item.rarity]}</div>
        ${sets.length > 0 ? `<div class="item-set">${sets[0].name}</div>` : ''}
        <div class="item-action">
          ${
            equipped
              ? '<span class="tag-equipped">EQUIPPED</span>'
              : owned
                ? `<button class="mini" data-equip="${item.id}">Equip</button>`
                : `<button class="mini secondary" data-buy="${item.id}"${
                    affordable ? '' : ' disabled'
                  }>${icon('chalk', { size: 14 })} ${price}</button>`
          }
        </div>
        ${owned ? '' : `<div class="lock-veil">${icon('lock', { size: 14 })}</div>`}
      </div>`;
  }

  function collectionTab(): string {
    const profile = getProfile();
    const overall = collectionProgress(profile.unlocked);
    const shelves = slotProgress(profile.unlocked);
    const sets = setProgress(profile.unlocked, profile.claimedSets ?? []);

    return `
      <div class="collection-head">
        <div class="collection-ring" style="--p:${Math.round(overall.ratio * 100)}">
          <span>${Math.round(overall.ratio * 100)}%</span>
        </div>
        <div>
          <h2>${overall.owned} of ${overall.total} collected</h2>
          <p class="muted">${
            overall.owned === overall.total
              ? 'Everything. There is genuinely nothing left.'
              : `${overall.total - overall.owned} still out there.`
          }</p>
        </div>
      </div>

      <div class="shelf-list">
        ${shelves
          .map(
            (s) => `
          <div class="shelf-row${s.owned === s.total ? ' complete' : ''}">
            <span class="shelf-label">${s.label}</span>
            <div class="shelf-bar"><div class="shelf-fill" style="width:${Math.round(
              s.ratio * 100
            )}%"></div></div>
            <span class="shelf-count">${s.owned}/${s.total}</span>
          </div>`
          )
          .join('')}
      </div>

      <h2 class="section-head">Sets</h2>
      <div class="set-list">
        ${sets
          .map((p) => {
            const claimable = p.complete && !p.claimed;
            return `
            <div class="set-card${p.complete ? ' complete' : ''}${p.claimed ? ' claimed' : ''}">
              <div class="set-top">
                <b>${p.set.name}</b>
                <span class="set-count">${p.owned.length}/${p.set.items.length}</span>
              </div>
              <p class="set-blurb">${p.set.blurb}</p>
              <div class="set-items">
                ${p.set.items
                  .map((id) => {
                    const item = cosmeticById(id);
                    if (!item) return '';
                    const have = profile.unlocked.includes(id);
                    return `<span class="set-piece${have ? ' have' : ''}" title="${item.name}">
                        ${cosmeticPreviewHtml(item, 34)}
                      </span>`;
                  })
                  .join('')}
              </div>
              <div class="set-reward">
                Reward: <b>${cosmeticById(p.set.reward)?.name ?? p.set.reward}</b>
                + ${p.set.chalk} chalk
              </div>
              ${
                claimable
                  ? `<button class="mini" data-claimset="${p.set.id}">CLAIM</button>`
                  : p.claimed
                    ? '<span class="tag-equipped">CLAIMED</span>'
                    : `<span class="muted set-missing">${p.missing.length} to go</span>`
              }
            </div>`;
          })
          .join('')}
      </div>`;
  }

  function kitsTab(): string {
    const saved = presets();
    const loadout = resolveLoadout(getProfile().loadout);

    return `
      <div class="kit-save">
        <input id="presetName" maxlength="20" placeholder="Name this kit…" />
        <button class="mini" id="savePreset"${saved.length >= MAX_PRESETS ? ' disabled' : ''}>
          Save current kit
        </button>
        <span class="muted">${saved.length}/${MAX_PRESETS}</span>
      </div>

      <div class="preset-list">
        ${
          saved.length === 0
            ? '<p class="muted">No saved kits yet. Equip a look you like, then save it here.</p>'
            : saved
                .map(
                  (p) => `
          <div class="preset-card">
            <div class="preset-top">
              <b>${p.name}</b>
              <button class="seat-x" data-delpreset="${escapeAttr(p.name)}" title="Delete">
                ${icon('close', { size: 12 })}
              </button>
            </div>
            <div class="preset-pieces">
              ${SLOT_ORDER.map((slot) => {
                const item = cosmeticById(p.loadout[slot] ?? '');
                return item
                  ? `<span class="preset-piece" title="${item.name}">${cosmeticPreviewHtml(
                      item,
                      32
                    )}</span>`
                  : '';
              }).join('')}
            </div>
            <button class="mini" data-usepreset="${escapeAttr(p.name)}">Wear this</button>
          </div>`
                )
                .join('')
        }
      </div>

      <h2 class="section-head">Currently wearing</h2>
      <div class="preset-pieces wearing">
        ${SLOT_ORDER.map((slot) => {
          const item = cosmeticById(loadout[slot]);
          return item
            ? `<span class="preset-piece" title="${SLOT_LABELS[slot]}: ${item.name}">
                 ${cosmeticPreviewHtml(item, 40)}
               </span>`
            : '';
        }).join('')}
      </div>`;
  }

  function draw(): void {
    const profile = getProfile();
    const loadout = resolveLoadout(profile.loadout);
    const progress = levelProgress(profile.xp);
    const name = profile.displayName || 'Player';
    const readySets = setProgress(profile.unlocked, profile.claimedSets ?? []).filter(
      (p) => p.complete && !p.claimed
    ).length;

    root.innerHTML = `
      <div class="profile-page">
        <div class="profile-top">
          <button class="icon-btn" id="backBtn" title="Back">${icon('back', { size: 20 })}</button>
          <h1>Your Locker</h1>
          <div class="wallet">
            <span class="wallet-chip" title="Chalk">${icon('chalk', { size: 18 })} ${
              profile.chalk
            }</span>
            <span class="wallet-chip ${profile.spins > 0 ? 'hot' : ''}" title="Spins">${icon(
              'wheel',
              { size: 18 }
            )} ${profile.spins}</span>
          </div>
        </div>

        <div class="profile-hero">
          ${playerBannerHtml({
            name,
            seatIndex: 0,
            loadout,
            subtitle: `Level ${progress.level}`,
            large: true,
            extra: `<div class="kit-strip">${(['cue', 'ballSet', 'trail', 'chalk'] as CosmeticSlot[])
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
              ${profile.spins > 0 ? `OPEN A CASE (${profile.spins})` : 'NO SPINS — PLAY TO EARN'}
            </button>
          </div>
        </div>

        <div class="locker-tabs">
          <button class="locker-tab${tab === 'items' ? ' active' : ''}" data-tab="items">Items</button>
          <button class="locker-tab${tab === 'collection' ? ' active' : ''}" data-tab="collection">
            Collection${readySets > 0 ? `<span class="tab-badge">${readySets}</span>` : ''}
          </button>
          <button class="locker-tab${tab === 'kits' ? ' active' : ''}" data-tab="kits">Kits</button>
        </div>

        ${tab === 'items' ? itemsTab() : tab === 'collection' ? collectionTab() : kitsTab()}
        <div class="toast-stack" id="lockerToasts"></div>
      </div>`;

    wire();
  }

  function wire(): void {
    root.querySelector('#backBtn')!.addEventListener('click', () => goBack());
    mountResumeStrip(root);

    const nameInput = root.querySelector<HTMLInputElement>('#nameInput')!;
    nameInput.addEventListener('change', () => {
      setDisplayName(nameInput.value.trim());
      draw();
    });

    root.querySelector<HTMLButtonElement>('#spinBtn')!.addEventListener('click', () => {
      void openCase(root).then((outcome) => {
        if (outcome && !outcome.result.duplicate) {
          tab = 'items';
          activeSlot = outcome.result.item.slot;
        }
        draw();
      });
    });

    root.querySelectorAll<HTMLElement>('.locker-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab as Tab;
        draw();
      });
    });

    root.querySelectorAll<HTMLElement>('.slot-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeSlot = btn.dataset.slot as CosmeticSlot;
        draw();
      });
    });

    // --- filters ---
    const searchInput = root.querySelector<HTMLInputElement>('#lockerSearch');
    searchInput?.addEventListener('input', () => {
      search = searchInput.value;
      draw();
      // Redrawing blows away focus, which makes typing impossible; put it back where it was.
      const again = root.querySelector<HTMLInputElement>('#lockerSearch');
      again?.focus();
      again?.setSelectionRange(again.value.length, again.value.length);
    });
    root.querySelector<HTMLSelectElement>('#filterOwned')?.addEventListener('change', (e) => {
      ownership = (e.target as HTMLSelectElement).value as typeof ownership;
      draw();
    });
    root.querySelector<HTMLSelectElement>('#filterRarity')?.addEventListener('change', (e) => {
      rarity = (e.target as HTMLSelectElement).value as Rarity | 'all';
      draw();
    });
    root.querySelector<HTMLSelectElement>('#filterSort')?.addEventListener('change', (e) => {
      sort = (e.target as HTMLSelectElement).value as SortMode;
      draw();
    });

    // --- items ---
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

    // --- sets ---
    root.querySelectorAll<HTMLElement>('[data-claimset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const set = claimSet(btn.dataset.claimset!);
        draw();
        if (set) {
          toast(
            `${set.name} complete — ${cosmeticById(set.reward)?.name} and ${set.chalk} chalk`,
            'reward'
          );
        }
      });
    });

    // --- kits ---
    const presetName = root.querySelector<HTMLInputElement>('#presetName');
    root.querySelector('#savePreset')?.addEventListener('click', () => {
      const value = presetName?.value.trim() ?? '';
      if (!value) {
        toast('Give the kit a name first', 'foul');
        return;
      }
      savePreset(value);
      draw();
      toast(`Saved "${value}"`);
    });
    root.querySelectorAll<HTMLElement>('[data-usepreset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { applied, skipped } = applyPreset(btn.dataset.usepreset!);
        draw();
        toast(
          skipped > 0
            ? `Wearing ${applied} pieces — ${skipped} not unlocked on this device`
            : 'Kit equipped',
          skipped > 0 ? 'foul' : 'info'
        );
      });
    });
    root.querySelectorAll<HTMLElement>('[data-delpreset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deletePreset(btn.dataset.delpreset!);
        draw();
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
