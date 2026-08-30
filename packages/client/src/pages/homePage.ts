import {
  CHALLENGES,
  allModes,
  careerNext,
  careerProgress,
  clampPlayerCount,
  levelProgress,
  type GameMode,
} from '@8ball/shared';
import { getSocket } from '../net/socket';
import { loadSettings, saveSession, saveSettings } from '../settings/settingsStore';
import { equippedLoadout, getProfile, setDisplayName } from '../profile/profile';
import { achievementSummary, weeklyMissions } from '../profile/progression';
import { openCase } from '../profile/caseReel';
import { playerBannerHtml } from '../render/banner';
import { modeArtSvg } from '../render/modeArt';
import { TableRenderer } from '../render/TableRenderer';
import { openSettingsPanel } from '../settings/settingsPanel';
import { applyRenderSettings } from '../settings/applySettings';
import { icon } from '../render/icons';
import { promptText } from '../render/dialogs';
import { challengeForToday, challengeProgress } from '../profile/dailyChallenge';
import { navigate } from '../router';
import * as sfx from '../render/sfx';

/** The game's mark: a cartoon 8-ball, drawn rather than borrowed from the emoji font. */
function eightBallLogo(): string {
  return `<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
    <circle cx="32" cy="33" r="27" fill="#0f0f14"/>
    <circle cx="32" cy="32" r="27" fill="#1b1b22"/>
    <circle cx="32" cy="32" r="14" fill="#fbf8ef"/>
    <text x="32" y="33" font-family="Baloo 2, Nunito, sans-serif" font-size="20" font-weight="900"
          text-anchor="middle" dominant-baseline="central" fill="#14141a">8</text>
    <ellipse cx="22" cy="19" rx="9" ry="6" fill="#fff" opacity="0.55" transform="rotate(-28 22 19)"/>
    <circle cx="32" cy="32" r="27" fill="none" stroke="var(--ink)" stroke-width="3.5"/>
  </svg>`;
}

/**
 * The arcade shell. A live table runs behind the menu (real physics, not a loop), with the
 * player's card, the mode carousel and the main actions on top of it.
 */
export function renderHomePage(root: HTMLElement): () => void {
  const settings = loadSettings();
  const modes = allModes();
  let selectedMode: GameMode = (localStorage.getItem('8ball:lastMode') as GameMode) ?? 'classic';
  if (!modes.some((m) => m.id === selectedMode)) selectedMode = 'classic';
  let renderer: TableRenderer | null = null;
  let disposed = false;

  root.innerHTML = `
    <div class="home">
      <div class="home-backdrop" id="homeBackdrop"></div>
      <div class="home-scrim"></div>
      <div class="home-content">
        <header class="home-head">
          <div class="home-title">
            <span class="home-logo">${eightBallLogo()}</span>
            <div>
              <h1>8-Ball Pool</h1>
              <p class="tagline">Play online from anywhere, or host on the big screen.</p>
            </div>
          </div>
          <div class="home-player" id="homePlayer"></div>
        </header>

        <!--
          The cabinet: one mode shown as a poster, the rest as a rack beside it.

          Seven equal tiles gave the page no hierarchy — every mode shouted the same volume and
          nothing told a new player where to start, so the row read as a settings screen. One
          featured mode and a list is how a cabinet actually presents its games, and it buys
          the room to show the mode's art at a size worth looking at.
        -->
        <section class="cabinet">
          <!--
            Play sits on the poster rather than in the side column, because it acts on the mode
            the poster is showing — and it is what fills the poster out to the height of the
            rack instead of leaving a slab of empty panel under the blurb.

            It lives in its own container that drawHero() does not overwrite: rebuilding it
            with the rest of the poster would throw away its click handler on every mode change.
          -->
          <div class="mode-hero">
            <div class="hero-art" id="heroArt"></div>
            <div class="hero-body" id="heroBody"></div>
            <div class="hero-cta">
              <button class="btn-play" id="playSolo">
                <span class="btn-play-main">Play</span>
                <span class="btn-play-sub" id="soloSub">vs the computer</span>
              </button>
            </div>
          </div>

          <div class="cabinet-side">
            <div class="rack-head">Pick your game</div>
            <div class="mode-rack" id="modeRack"></div>

            <div class="side-pair">
              <button class="btn-hot" id="onlineBtn">Go Online</button>
              <button class="btn-quiet" id="hostBtn">Host Table</button>
            </div>

            <form class="join-box" id="joinForm">
              <input id="codeInput" maxlength="4" placeholder="CODE" autocapitalize="characters"
                     autocomplete="off" aria-label="Table code" />
              <button type="submit" class="btn-quiet" id="joinBtn">Join</button>
            </form>
            <p id="joinError" class="error"></p>
          </div>
        </section>

        <!--
          The shelf. Struck tokens rather than more rectangles: these are six side doors off the
          menu, not six more things to weigh up against the modes above, and giving them the
          same card shape made the page read as fourteen equal choices.
        -->
        <section class="home-shelf">
          <button class="token" id="lockerBtn">
            <span class="token-disc">${icon('locker', { size: 25 })}</span>
            <span class="token-label">Locker</span>
            <span class="token-sub" id="lockerSub"></span>
          </button>
          <button class="token" id="careerBtn">
            <span class="token-disc">${icon('trophy', { size: 25 })}</span>
            <span class="token-label">Career</span>
            <span class="token-sub" id="careerSub"></span>
          </button>
          <button class="token" id="trickShotsBtn">
            <span class="token-disc">${icon('target', { size: 25 })}</span>
            <span class="token-label">Trick Shots</span>
            <span class="token-sub" id="trickSub"></span>
          </button>
          <button class="token" id="progressBtn">
            <span class="token-disc">${icon('star', { size: 25 })}</span>
            <span class="token-label">Progress</span>
            <span class="token-sub" id="progressSub"></span>
          </button>
          <button class="token" id="statsBtn">
            <span class="token-disc">${icon('chart', { size: 25 })}</span>
            <span class="token-label">Stats</span>
            <span class="token-sub" id="statsSub"></span>
          </button>
          <button class="token" id="settingsBtn">
            <span class="token-disc">${icon('settings', { size: 25 })}</span>
            <span class="token-label">Settings</span>
            <span class="token-sub">Aim, table, audio</span>
          </button>

          <!-- The daily is a ticket, not a seventh token: it expires, and the others don't.
               It stays a readout rather than a button — there is nowhere for it to go. -->
          <div class="daily-ticket" id="challengeTile"></div>
        </section>
      </div>
    </div>`;

  const backdrop = root.querySelector<HTMLElement>('#homeBackdrop')!;
  const rackEl = root.querySelector<HTMLElement>('#modeRack')!;
  const heroArtEl = root.querySelector<HTMLElement>('#heroArt')!;
  const heroBodyEl = root.querySelector<HTMLElement>('#heroBody')!;
  const playerEl = root.querySelector<HTMLElement>('#homePlayer')!;
  const joinError = root.querySelector<HTMLElement>('#joinError')!;

  // ---- Live table backdrop ----
  // The CSS class paints a felt-and-vignette backdrop immediately; the live table then
  // renders over it. If WebGL is unavailable — or the browser has run out of contexts after
  // enough navigation — the page still has a proper background instead of going black.
  backdrop.classList.add('has-fallback');

  if (!settings.reduceMotion) {
    void TableRenderer.create(backdrop)
      .then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      renderer = created;
      renderer.setChromeless(true);
      renderer.setTableTheme(settings.tableTheme);
      renderer.setEffectsIntensity('low'); // wallpaper shouldn't throw particles about
      const loadout = equippedLoadout();
      renderer.setBallSet(loadout.ballSet);
      renderer.setShooterLoadout(loadout);
      renderer.setTrailsEnabled(settings.ballTrails);
      renderer.startAttractMode();
      })
      .catch((err) => {
        // Never silent: a blank menu with no explanation is exactly what this used to be.
        console.error('Menu backdrop failed to start; falling back to the painted one.', err);
      });
  }

  function drawPlayer(): void {
    const profile = getProfile();
    const progress = levelProgress(profile.xp);
    playerEl.innerHTML = `
      ${playerBannerHtml({
        name: profile.displayName || 'Player',
        seatIndex: 0,
        loadout: equippedLoadout(),
        subtitle: `Level ${progress.level}`,
        active: true,
        extra: `<div class="xp-bar mini"><div class="xp-fill" style="width:${Math.round(
          progress.ratio * 100
        )}%"></div></div>`,
      })}
      <button class="icon-btn edit-name" id="editName" title="Change your name">${icon('edit', {
        size: 16,
      })}</button>`;

    playerEl.querySelector('#editName')!.addEventListener('click', () => {
      promptText(
        'What should we call you?',
        getProfile().displayName || 'Player',
        (next) => {
          setDisplayName(next);
          drawPlayer();
        },
        { placeholder: 'Player', maxLength: 18 }
      );
    });

    const career = careerProgress(profile.careerBeaten ?? []);
    const nextUp = careerNext(profile.careerBeaten ?? []);
    root.querySelector<HTMLElement>('#careerSub')!.textContent = nextUp
      ? `${career.beaten} / ${career.total} · next: ${nextUp.name}`
      : 'Ladder complete';

    const ach = achievementSummary();
    const ready = weeklyMissions().filter((m) => m.progress >= m.mission.target && !m.claimed).length;
    root.querySelector<HTMLElement>('#progressSub')!.textContent = ready
      ? `${ready} reward${ready === 1 ? '' : 's'} to claim!`
      : `${ach.earned} / ${ach.total} achievements`;
    root.querySelector<HTMLElement>('#progressBtn')!.classList.toggle('has-reward', ready > 0);

    // The subtitle is the one number worth seeing without opening the page.
    const sp = getProfile();
    const shots = sp.history?.shots ?? 0;
    root.querySelector<HTMLElement>('#statsSub')!.textContent =
      shots > 0 ? `${Math.round((sp.stats.pots / shots) * 100)}% pot rate` : 'no frames yet';

    const stars = Object.values(profile.challengeStars ?? {}).reduce((a, b) => a + b, 0);
    const possible = CHALLENGES.length * 3;
    root.querySelector<HTMLElement>('#trickSub')!.textContent = `${stars} / ${possible} stars`;

    const spins = profile.spins;
    root.querySelector<HTMLElement>('#lockerSub')!.textContent =
      spins > 0 ? `${spins} spin${spins === 1 ? '' : 's'} ready!` : `${profile.unlocked.length} items owned`;
    root.querySelector<HTMLElement>('#lockerBtn')!.classList.toggle('has-reward', spins > 0);
  }

  /** How many can play, said the way a person would say it — "Solo", not "1 players". */
  function playerRange(mode: (typeof modes)[number]): string {
    if (mode.minPlayers === mode.maxPlayers) {
      return mode.minPlayers === 1 ? 'Solo' : `${mode.minPlayers} players`;
    }
    return `${mode.minPlayers}–${mode.maxPlayers} players`;
  }

  /** The same fact, short enough for a rack plate. */
  function playerBadge(mode: (typeof modes)[number]): string {
    if (mode.minPlayers === mode.maxPlayers) {
      return mode.minPlayers === 1 ? 'Solo' : `${mode.minPlayers}P`;
    }
    return `${mode.minPlayers}–${mode.maxPlayers}`;
  }

  /** The rack: every mode as a plate, the chosen one lit. */
  function drawRack(): void {
    rackEl.innerHTML = modes
      .map(
        (mode) => `
        <button class="rack-plate${mode.id === selectedMode ? ' active' : ''}" data-mode="${mode.id}">
          <span class="rack-art">${modeArtSvg(mode.id)}</span>
          <span class="rack-name">${mode.name}</span>
          <span class="rack-players">${playerBadge(mode)}</span>
        </button>`
      )
      .join('');

    rackEl.querySelectorAll<HTMLElement>('.rack-plate').forEach((plate) => {
      plate.addEventListener('click', () => {
        selectedMode = plate.dataset.mode as GameMode;
        localStorage.setItem('8ball:lastMode', selectedMode);
        drawRack();
        drawHero();
        updateSoloSub();
      });
    });
  }

  /**
   * The chosen mode, at poster size.
   *
   * This is where the space freed up by not drawing seven equal cards goes: the art large
   * enough to be worth having, the blurb readable, and the rules as chips rather than a list
   * of small grey lines nobody finished reading.
   */
  function drawHero(): void {
    const mode = modes.find((m) => m.id === selectedMode)!;
    // The art is drawn 3:2 and the poster frame is wider, so it is sliced to fill rather than
    // fitted — `meet` left violet bars either side that read as a broken image.
    heroArtEl.innerHTML = modeArtSvg(mode.id).replace('xMidYMid meet', 'xMidYMid slice');
    heroBodyEl.innerHTML = `
      <div class="hero-eyebrow">Now selected</div>
      <h2 class="hero-name">${mode.name}</h2>
      <p class="hero-blurb">${mode.blurb}</p>
      <div class="hero-chips">
        <span class="chip chip-players">${playerRange(mode)}</span>
        ${mode.rulesSummary.map((r) => `<span class="chip">${r}</span>`).join('')}
      </div>`;
  }

  function updateSoloSub(): void {
    const label = { rookie: 'Rookie', club: 'Club', shark: 'Shark', legend: 'Legend' }[
      settings.defaultBotDifficulty
    ];
    const mode = modes.find((m) => m.id === selectedMode)!;
    root.querySelector<HTMLElement>('#soloSub')!.textContent = `${mode.name} vs ${label}`;
  }

  function drawChallenge(): void {
    const challenge = challengeForToday();
    const progress = challengeProgress();
    const done = progress.completed;
    const tile = root.querySelector<HTMLElement>('#challengeTile')!;
    tile.classList.toggle('done', done);
    tile.innerHTML = `
      <span class="ticket-stub">${icon(done ? 'check' : 'clock', { size: 20 })}</span>
      <span class="ticket-body">
        <span class="ticket-label">Today's challenge</span>
        <span class="ticket-text">${done ? 'Done — come back tomorrow' : challenge.text}</span>
      </span>
      ${done ? '' : `<span class="ticket-reward">+${challenge.xp}</span>`}`;
  }

  drawPlayer();
  drawRack();
  drawHero();
  updateSoloSub();
  drawChallenge();

  // ---- Actions ----

  /** Creates a room, applies the picked mode and the player's defaults, then opens it. */
  function createRoom(then: (code: string) => void): void {
    const socket = getSocket();
    socket.emit('hostCreateRoom', { hostName: getProfile().displayName || 'Host' }, (res) => {
      saveSession(res.code, 'host', { token: res.token });
      const mode = modes.find((m) => m.id === selectedMode)!;
      socket.emit('hostUpdateLobby', {
        mode: selectedMode,
        maxPlayers: clampPlayerCount(selectedMode, mode.minPlayers),
        shotClockSeconds: mode.supportsShotClock ? settings.defaultShotClock : null,
      });
      then(res.code);
    });
  }

  root.querySelector('#playSolo')!.addEventListener('click', () => {
    sfx.unlockAudio();
    createRoom((code) => {
      // Claim seat 1, fill the rest with bots, and go — no lobby step for solo play.
      sessionStorage.setItem(`8ball:autostart:${code}`, JSON.stringify({ solo: true }));
      navigate(`/table/${code}`);
    });
  });

  root.querySelector('#hostBtn')!.addEventListener('click', () => {
    sfx.unlockAudio();
    createRoom((code) => navigate(`/table/${code}`));
  });

  const codeInput = root.querySelector<HTMLInputElement>('#codeInput')!;
  root.querySelector<HTMLFormElement>('#joinForm')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 4) {
      joinError.textContent = 'Enter the 4-character table code.';
      return;
    }
    navigate(`/play/${code}`);
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  root.querySelector('#lockerBtn')!.addEventListener('click', () => {
    if (getProfile().spins > 0) {
      void openCase(root).then(() => drawPlayer());
      return;
    }
    navigate('/profile');
  });

  root.querySelector('#careerBtn')!.addEventListener('click', () => navigate('/career'));
  root.querySelector('#progressBtn')!.addEventListener('click', () => navigate('/progress'));
  root.querySelector('#statsBtn')!.addEventListener('click', () => navigate('/stats'));
  root.querySelector('#onlineBtn')!.addEventListener('click', () => navigate('/online'));
  root.querySelector('#trickShotsBtn')!.addEventListener('click', () => navigate('/challenges'));

  root.querySelector('#settingsBtn')!.addEventListener('click', () => {
    openSettingsPanel(settings, (next) => {
      Object.assign(settings, next);
      saveSettings(settings);
      applyRenderSettings(renderer, settings);
      if (settings.reduceMotion) renderer?.stopAttractMode();
      else renderer?.startAttractMode();
      updateSoloSub();
    });
  });

  return () => {
    disposed = true;
    renderer?.destroy();
  };
}
