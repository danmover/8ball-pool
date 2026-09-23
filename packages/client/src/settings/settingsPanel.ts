import { DEFAULT_SETTINGS, type BotDifficulty, type PlayerSettings } from '@8ball/shared';
import { navigate } from '../router';
import { icon, type IconName } from '../render/icons';
import { openTransferDialog } from '../profile/transferDialog';
import { confirmDialog, modalBehaviour, promptText } from '../render/dialogs';
import { getProfile, setDisplayName } from '../profile/profile';
import { allTableThemes, CUSTOM_PREFIX } from '../render/cosmetics/tableThemes';
import { drawTablePreview } from '../render/tablePreview';
import { openThemeStudio } from './themeStudio';

const BOT_LABELS: Record<BotDifficulty, string> = {
  rookie: 'Rookie',
  club: 'Club',
  shark: 'Shark',
  legend: 'Legend',
};

type TabId = 'game' | 'table' | 'audio' | 'access' | 'profile';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'game', label: 'Game', icon: 'target' },
  { id: 'table', label: 'Table', icon: 'ball' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'access', label: 'Access', icon: 'eye' },
  { id: 'profile', label: 'You', icon: 'star' },
];

/*
 * The drawer's building blocks.
 *
 * The previous version had exactly one: a row of label, description and control, repeated down
 * a flat list. That is why it read as a spreadsheet — nine settings of visibly equal importance
 * with nothing saying which belonged with which, and controls landing wherever their own width
 * put them, so a two-option segment sat right-aligned and a four-option one ran full width.
 *
 * Three things fix it, and they are the whole redesign: settings are collected into named
 * **groups**; every row is the same `icon | text | control` skeleton with the control in a
 * fixed column so they all line up; and a switch that owns a level — sound, music, ambience —
 * is *one* row with the level under it rather than two rows pretending to be unrelated.
 */

/** A titled block of related settings. */
function group(title: string, rows: string[]): string {
  return `
    <section class="set-group">
      <h3 class="set-group-title">${title}</h3>
      <div class="set-group-body">${rows.join('')}</div>
    </section>`;
}

function row(iconName: IconName, label: string, desc: string, control: string): string {
  return `
    <div class="set-row">
      <span class="set-icon">${icon(iconName, { size: 18 })}</span>
      <div class="set-text">
        <div class="set-label">${label}</div>
        ${desc ? `<div class="set-desc">${desc}</div>` : ''}
      </div>
      <div class="set-control">${control}</div>
    </div>`;
}

/** A row with no control, for something that opens a screen of its own. */
function linkRow(iconName: IconName, label: string, desc: string, control: string): string {
  return row(iconName, label, desc, control);
}

function segmented(key: string, options: { value: string; label: string }[]): string {
  return `<div class="segmented" data-key="${key}">${options
    .map((o) => `<button data-value="${o.value}">${o.label}</button>`)
    .join('')}</div>`;
}

function toggle(key: string): string {
  return `<button class="toggle" data-key="${key}" role="switch" aria-label="Toggle"></button>`;
}

/**
 * A switch and the level it governs, as one control.
 *
 * These were two separate rows — "Music" then "Music volume" — which is a lie about how they
 * relate: turning the switch off leaves a live-looking slider sitting under it doing nothing.
 * Here the slider is visibly part of the switch's row, it carries a readout so the number is
 * knowable, and it goes flat and inert when the switch is off.
 */
function levelRow(
  iconName: IconName,
  label: string,
  desc: string,
  toggleKey: string,
  levelKey: string,
  value: number,
  on: boolean
): string {
  const pct = Math.round(value * 100);
  return `
    <div class="set-row set-row-level${on ? '' : ' muted'}">
      <span class="set-icon">${icon(iconName, { size: 18 })}</span>
      <div class="set-text">
        <div class="set-label">${label}</div>
        ${desc ? `<div class="set-desc">${desc}</div>` : ''}
      </div>
      <div class="set-control">${toggle(toggleKey)}</div>
      <div class="set-level">
        <input class="slider" type="range" min="0" max="100" value="${pct}"
               data-key="${levelKey}" aria-label="${label} level"${on ? '' : ' disabled'} />
        <span class="set-level-value" data-readout="${levelKey}">${pct}%</span>
      </div>
    </div>`;
}

/**
 * Settings live in a slide-over drawer down the right rather than a sheet in the middle of
 * the screen: changing the felt or the effects while the table is hidden behind the panel
 * makes it impossible to see what you're choosing.
 */
export function openSettingsPanel(
  current: PlayerSettings,
  onChange: (settings: PlayerSettings) => void
): void {
  const settings: PlayerSettings = { ...current };
  let tab: TabId = 'game';

  const overlay = document.createElement('div');
  overlay.className = 'settings-scrim';
  const drawer = document.createElement('aside');
  drawer.className = 'settings-drawer';
  overlay.appendChild(drawer);
  document.body.appendChild(overlay);
  // Next frame, so the slide-in transition has a starting state to animate from.
  requestAnimationFrame(() => overlay.classList.add('open'));

  /*
   * Escape, a focus trap, and focus put back where it came from — the same behaviour the
   * confirm dialog gets, from the same place.
   *
   * The drawer had its own Escape handler that only unhooked itself when Escape was what
   * closed it, so closing with the X or a click on the scrim left a listener on `window`
   * holding a reference to a removed overlay. Every open-and-close added another.
   */
  const close = modalBehaviour(overlay, drawer, 'Settings');

  function panelFor(id: TabId): string {
    if (id === 'game') {
      return [
        group('Aiming', [
          row(
            'target',
            'Aim guide',
            'Preview where the cue ball — and the object ball — will travel',
            segmented('trajectoryPreview', [
              { value: 'off', label: 'Off' },
              { value: 'basic', label: 'Basic' },
              { value: 'full', label: 'Full' },
            ])
          ),
          row('phone', 'Left-handed layout', 'Mirror the phone controls', toggle('leftHanded')),
        ]),
        group('Tables you host', [
          row(
            'bot',
            'Computer skill',
            'Used for Play Solo and when you add a bot to a lobby',
            segmented(
              'defaultBotDifficulty',
              (Object.keys(BOT_LABELS) as BotDifficulty[]).map((d) => ({
                value: d,
                label: BOT_LABELS[d],
              }))
            )
          ),
          row(
            'clock',
            'Shot clock',
            'Default countdown for new tables',
            segmented('defaultShotClock', [
              { value: 'null', label: 'Off' },
              { value: '30', label: '30s' },
              { value: '20', label: '20s' },
              { value: '10', label: '10s' },
            ])
          ),
        ]),
      ].join('');
    }

    if (id === 'table') {
      /*
       * Drawn rather than described.
       *
       * These were three nested coloured boxes — a wood-ish frame round a green-ish middle —
       * and you cannot pick between eleven tables from that, because what separates them is
       * the weave, the light and the fittings, none of which a box has. Each swatch is now the
       * same miniature the Theme Studio previews with, so the picker and the builder cannot
       * disagree about what a table looks like.
       */
      return [
        `<section class="set-group">
          <h3 class="set-group-title">Your table</h3>
          <div class="theme-grid" data-key="tableTheme">
            ${allTableThemes()
              .map(
                (t) => `
              <button class="theme-swatch${t.custom ? ' custom' : ''}" data-value="${t.id}" title="${t.name}">
                <span class="theme-preview"><canvas data-theme="${t.id}"></canvas></span>
                <span class="theme-name">${t.name}</span>
                ${t.custom ? '<span class="theme-badge">Yours</span>' : ''}
              </button>`
              )
              .join('')}
          </div>
          <button class="studio-open" id="openStudio">
            <span class="studio-open-mark">✦</span>
            <span>
              <strong>Design your own table</strong>
              <em>Cloth, frame, fittings, pockets and lighting</em>
            </span>
          </button>
          ${
            String(settings.tableTheme).startsWith(CUSTOM_PREFIX)
              ? `<button class="mini secondary studio-edit" id="editStudio">Edit this table</button>`
              : ''
          }
        </section>`,
        group('Effects', [
          row(
            'sparkle',
            'Detail',
            'Sparks, dust and confetti on hits and pots',
            segmented('effectsIntensity', [
              { value: 'low', label: 'Low' },
              { value: 'high', label: 'High' },
            ])
          ),
          row('flame', 'Ball trails', 'Speed streaks behind moving balls', toggle('ballTrails')),
          row('screen', 'Screen shake', 'Camera kick on hard hits and pots', toggle('screenShake')),
        ]),
      ].join('');
    }

    if (id === 'audio') {
      return [
        group('Mix', [
          levelRow(
            'ball',
            'Sound effects',
            'Hits, cushions, pots and the wheel',
            'soundEnabled',
            'soundVolume',
            settings.soundVolume,
            settings.soundEnabled
          ),
          levelRow(
            'volume',
            'Music',
            'Each table has its own score',
            'musicEnabled',
            'musicVolume',
            settings.musicVolume,
            settings.musicEnabled
          ),
          levelRow(
            'sparkle',
            'Room tone',
            'The air around the table — hum, chatter, wind',
            'ambienceEnabled',
            'ambienceVolume',
            settings.ambienceVolume,
            settings.ambienceEnabled
          ),
        ]),
        group('On your phone', [
          row('phone', 'Vibration', 'Haptic feedback on collisions and pots', toggle('hapticsEnabled')),
        ]),
      ].join('');
    }

    return group('Access', [
      row(
        'eye',
        'Colourblind patterns',
        'Hatch the stripes as well as colouring them',
        toggle('colorblindPatterns')
      ),
      row(
        'heart',
        'Reduce motion',
        'Stills the air around the table, the banners and the celebrations',
        toggle('reduceMotion')
      ),
    ]);
  }

  /**
   * Everything about *you* rather than about the game: your name, your collection, and moving
   * your progress to another device. Its own tab because a profile transfer buried at the
   * bottom of "Access" is one nobody would ever find.
   */
  function profilePanel(): string {
    const profile = getProfile();
    return [
      `<div class="set-identity">
        <span class="set-identity-avatar">${(profile.displayName || 'Player').slice(0, 2).toUpperCase()}</span>
        <div>
          <div class="set-identity-name">${profile.displayName || 'Player'}</div>
          <div class="set-identity-sub">What other players see at the table</div>
        </div>
        <button id="editProfileName" class="mini secondary">Rename</button>
      </div>`,
      group('Your things', [
        linkRow(
          'locker',
          'Locker',
          'Cues, ball sets, trails, banners and the prize wheel',
          `<button id="openLocker" class="mini">Open</button>`
        ),
      ]),
      // Progress lives on the server now, so it can follow you. There's no account to log
      // into, which is deliberate — see the note in profiles/routes.ts.
      group('Devices', [
        linkRow(
          'phone',
          'Play on another device',
          'Get a code to carry this profile to your phone, or enter one from another device',
          `<button id="transferProfile" class="mini secondary">Transfer</button>`
        ),
      ]),
    ].join('');
  }

  function render(): void {
    /*
     * The tab strip is icon-over-label rather than a row of text pills.
     *
     * Five text pills at this width were forever one word away from wrapping, and they gave the
     * eye nothing to aim at — every tab looked like every other tab. An icon is a target you can
     * hit without reading, which is what a tab strip you use constantly needs to be.
     */
    drawer.innerHTML = `
      <header class="drawer-head">
        <h2>${icon('settings', { size: 20 })} Settings</h2>
        <button class="icon-btn" id="closeSettings" title="Close">${icon('close', { size: 18 })}</button>
      </header>
      <div class="settings-tabs" role="tablist">
        ${TABS.map(
          (t) =>
            `<button class="settings-tab${t.id === tab ? ' active' : ''}" data-tab="${t.id}"
                     role="tab" aria-selected="${t.id === tab}">
              ${icon(t.icon, { size: 18 })}<span>${t.label}</span>
            </button>`
        ).join('')}
      </div>
      <div class="settings-body">${tab === 'profile' ? profilePanel() : panelFor(tab)}</div>
      <footer class="settings-foot">
        <button class="mini secondary" id="resetSettings">Reset to defaults</button>
      </footer>`;

    drawer.querySelectorAll<HTMLElement>('.segmented, .theme-grid').forEach((seg) => {
      const key = seg.dataset.key as keyof PlayerSettings;
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
        btn.classList.toggle('active', String(settings[key] ?? 'null') === btn.dataset.value);
      });
    });
    drawer.querySelectorAll<HTMLElement>('.toggle').forEach((t) => {
      const key = t.dataset.key as keyof PlayerSettings;
      t.classList.toggle('on', Boolean(settings[key]));
    });

    // Canvases have no size until they are laid out, so the miniatures are painted on the
    // frame after the markup lands rather than as part of building it.
    const themes = allTableThemes();
    requestAnimationFrame(() => {
      drawer.querySelectorAll<HTMLCanvasElement>('.theme-preview canvas').forEach((canvas) => {
        const theme = themes.find((t) => t.id === canvas.dataset.theme);
        if (theme) drawTablePreview(canvas, theme, { pad: 0.06 });
      });
    });

    bind();
  }

  function commit(): void {
    onChange({ ...settings });
  }

  function bind(): void {
    drawer.querySelector('#transferProfile')?.addEventListener('click', () => openTransferDialog());
    drawer.querySelector('#editProfileName')?.addEventListener('click', () => {
      promptText('What should we call you?', getProfile().displayName || 'Player', (next) => {
        setDisplayName(next);
        render();
      }, { placeholder: 'Player', maxLength: 18 });
    });

    drawer.querySelectorAll<HTMLElement>('.settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab as TabId;
        render();
      });
    });

    drawer
      .querySelectorAll<HTMLButtonElement>('.segmented button, .theme-grid button')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const seg = btn.closest<HTMLElement>('.segmented, .theme-grid')!;
          const key = seg.dataset.key as keyof PlayerSettings;
          const raw = btn.dataset.value!;
          // The shot clock is the one numeric-or-null control, so it needs decoding.
          const value: unknown = raw === 'null' ? null : /^\d+$/.test(raw) ? Number(raw) : raw;
          (settings as unknown as Record<string, unknown>)[key] = value;
          render();
          commit();
        });
      });

    drawer.querySelectorAll<HTMLElement>('.toggle').forEach((toggleEl) => {
      toggleEl.addEventListener('click', () => {
        const key = toggleEl.dataset.key as keyof PlayerSettings;
        (settings as unknown as Record<string, unknown>)[key] = !settings[key];
        render();
        commit();
      });
    });

    drawer.querySelectorAll<HTMLInputElement>('.slider').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key as keyof PlayerSettings;
        (settings as unknown as Record<string, unknown>)[key] = Number(input.value) / 100;
        // Updated in place rather than through `render()`: re-rendering the drawer on every
        // input event would tear the slider out from under the pointer mid-drag.
        const readout = drawer.querySelector<HTMLElement>(`[data-readout="${key}"]`);
        if (readout) readout.textContent = `${input.value}%`;
        commit();
      });
    });

    drawer.querySelector('#resetSettings')?.addEventListener('click', () => {
      confirmDialog({
        title: 'Reset settings?',
        message:
          'Every setting goes back to how it shipped. Your locker, your progress and any tables you designed are left alone.',
        confirmLabel: 'Reset',
        cancelLabel: 'Keep mine',
        iconName: 'settings',
        onConfirm: () => {
          // The table you are looking at is deliberately kept. Resetting the aim guide should
          // not also take away a table you spent ten minutes building in the Studio.
          const keptTheme = settings.tableTheme;
          Object.assign(settings, DEFAULT_SETTINGS, { tableTheme: keptTheme });
          render();
          commit();
        },
      });
    });

    /*
     * The studio is opened over the drawer rather than replacing it, and it hands back the id
     * of whatever was saved. Applying it through the same `settings`/`commit` path as any other
     * control is what makes a table you built indistinguishable from one that shipped.
     */
    const studio = (editing?: string) => (): void => {
      openThemeStudio(editing, ({ themeId }) => {
        if (!themeId) return;
        settings.tableTheme = themeId;
        render();
        commit();
      });
    };
    drawer.querySelector('#openStudio')?.addEventListener('click', studio());
    drawer
      .querySelector('#editStudio')
      ?.addEventListener('click', studio(String(settings.tableTheme)));

    drawer.querySelector('#openLocker')?.addEventListener('click', () => {
      close();
      navigate('/profile');
    });

    drawer.querySelector('#closeSettings')!.addEventListener('click', close);
  }

  // Clicking the dimmed area outside the drawer closes it, as drawers do.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  render();
  // Focused after the first render, since nothing exists to focus before it.
  drawer.querySelector<HTMLElement>('#closeSettings')?.focus();
}
