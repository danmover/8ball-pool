import type { BotDifficulty, PlayerSettings } from '@8ball/shared';
import { navigate } from '../router';
import { icon } from '../render/icons';
import { openTransferDialog } from '../profile/transferDialog';
import { modalBehaviour, promptText } from '../render/dialogs';
import { getProfile, setDisplayName } from '../profile/profile';
import { TABLE_THEMES } from '../render/cosmetics/tableThemes';

const BOT_LABELS: Record<BotDifficulty, string> = {
  rookie: 'Rookie',
  club: 'Club',
  shark: 'Shark',
  legend: 'Legend',
};

type TabId = 'game' | 'table' | 'audio' | 'access' | 'profile';

const TABS: { id: TabId; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'table', label: 'Table' },
  { id: 'audio', label: 'Audio' },
  { id: 'access', label: 'Access' },
  { id: 'profile', label: 'You' },
];

function row(label: string, desc: string, control: string): string {
  return `
    <div class="settings-row">
      <div>
        <div class="label">${label}</div>
        ${desc ? `<div class="desc">${desc}</div>` : ''}
      </div>
      ${control}
    </div>`;
}

function segmented(key: string, options: { value: string; label: string }[]): string {
  return `<div class="segmented" data-key="${key}">${options
    .map((o) => `<button data-value="${o.value}">${o.label}</button>`)
    .join('')}</div>`;
}

function toggle(key: string): string {
  return `<div class="toggle" data-key="${key}"></div>`;
}

function slider(key: string, value: number): string {
  return `<input class="slider" type="range" min="0" max="100" value="${Math.round(
    value * 100
  )}" data-key="${key}" />`;
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
        row(
          'Aim guide',
          'Preview where the cue ball (and object ball) will travel',
          segmented('trajectoryPreview', [
            { value: 'off', label: 'Off' },
            { value: 'basic', label: 'Basic' },
            { value: 'full', label: 'Full' },
          ])
        ),
        row(
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
          'Shot clock',
          'Default countdown for tables you host',
          segmented('defaultShotClock', [
            { value: 'null', label: 'Off' },
            { value: '30', label: '30s' },
            { value: '20', label: '20s' },
            { value: '10', label: '10s' },
          ])
        ),
        row('Left-handed layout', 'Mirror the phone controls', toggle('leftHanded')),
      ].join('');
    }

    if (id === 'table') {
      return [
        `<div class="settings-row column">
          <div>
            <div class="label">Table</div>
            <div class="desc">Cloth, rails and the room behind them</div>
          </div>
          <div class="theme-grid" data-key="tableTheme">
            ${TABLE_THEMES.map(
              (t) => `
              <button class="theme-swatch" data-value="${t.id}" title="${t.name}">
                <span class="theme-preview" style="background:${t.surround}">
                  <span class="theme-rail" style="background:${t.rail}">
                    <span class="theme-cloth" style="background:linear-gradient(160deg, ${t.light}, ${t.dark})"></span>
                  </span>
                </span>
                <span class="theme-name">${t.name}</span>
              </button>`
            ).join('')}
          </div>
        </div>`,
        row(
          'Effects',
          'Sparks, dust and confetti on hits and pots',
          segmented('effectsIntensity', [
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ])
        ),
        row('Ball trails', 'Speed streaks behind moving balls', toggle('ballTrails')),
        row('Screen shake', 'Camera kick on hard hits and pots', toggle('screenShake')),
      ].join('');
    }

    if (id === 'audio') {
      return [
        row('Sound effects', 'Hits, cushions, pots and the wheel', toggle('soundEnabled')),
        row('Effects volume', '', slider('soundVolume', settings.soundVolume)),
        row('Music', 'Each table theme has its own score', toggle('musicEnabled')),
        row('Music volume', '', slider('musicVolume', settings.musicVolume)),
        row('Room ambience', 'The venue behind the table — chatter, hum, wind', toggle('ambienceEnabled')),
        row('Ambience volume', '', slider('ambienceVolume', settings.ambienceVolume)),
        row('Vibration', 'Haptic feedback on collisions and pots', toggle('hapticsEnabled')),
      ].join('');
    }

    return [
      row(
        'Colourblind patterns',
        'Add hatching to stripe balls in addition to colour',
        toggle('colorblindPatterns')
      ),
      row(
        'Reduce motion',
        'Stills the menu backdrop, banner effects and celebrations',
        toggle('reduceMotion')
      ),
      row(
        'Locker',
        'Cues, ball sets, trails, banners and the prize wheel',
        `<button id="openLocker" class="mini">Open</button>`
      ),
    ].join('');
  }

  /**
   * Everything about *you* rather than about the game: your name, your collection, and moving
   * your progress to another device. Its own tab because a profile transfer buried at the
   * bottom of "Access" is one nobody would ever find.
   */
  function profilePanel(): string {
    return [
      row('Display name', 'What other players see at the table', `<button id="editProfileName" class="mini">Change</button>`),
      row(
        'Locker',
        'Cues, ball sets, trails, banners and the prize wheel',
        `<button id="openLocker" class="mini">Open</button>`
      ),
      // Progress lives on the server now, so it can follow you. There's no account to log
      // into, which is deliberate — see the note in profiles/routes.ts.
      row(
        'Play on another device',
        'Get a code to carry this profile to your phone, or enter one from another device',
        `<button id="transferProfile" class="mini">Transfer</button>`
      ),
    ].join('');
  }

  function render(): void {
    drawer.innerHTML = `
      <header class="drawer-head">
        <h2>${icon('settings', { size: 20 })} Settings</h2>
        <button class="icon-btn" id="closeSettings" title="Close">${icon('close', { size: 18 })}</button>
      </header>
      <div class="settings-tabs">
        ${TABS.map(
          (t) =>
            `<button class="settings-tab${t.id === tab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
        ).join('')}
      </div>
      <div class="settings-body">${tab === 'profile' ? profilePanel() : panelFor(tab)}</div>`;

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
        commit();
      });
    });

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
