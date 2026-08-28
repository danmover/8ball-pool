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
              <p class="tagline">Host on the big screen. Play from your phone.</p>
            </div>
          </div>
          <div class="home-player" id="homePlayer"></div>
        </header>

        <section class="mode-section">
          <div class="section-head">
            <h2>Choose a game</h2>
            <div class="rail-nav">
              <button class="rail-arrow" id="railPrev" title="Previous">${icon('back', { size: 18 })}</button>
              <button class="rail-arrow" id="railNext" title="Next">${icon('back', { size: 18 })}</button>
            </div>
          </div>
          <div class="mode-rail-wrap">
            <div class="mode-rail" id="modeRail"></div>
          </div>
          <div class="rail-dots" id="railDots"></div>
        </section>

        <section class="home-actions">
          <button class="play-btn" id="playSolo">
            <span class="play-main">PLAY SOLO</span>
            <span class="play-sub" id="soloSub">vs the computer</span>
          </button>
          <button class="play-btn secondary-play" id="hostBtn">
            <span class="play-main">HOST A TABLE</span>
            <span class="play-sub">Friends join from their phones</span>
          </button>
          <form class="join-box" id="joinForm">
            <input id="codeInput" maxlength="4" placeholder="CODE" autocapitalize="characters"
                   autocomplete="off" aria-label="Table code" />
            <button type="submit" class="secondary" id="joinBtn">Join</button>
          </form>
          <p id="joinError" class="error"></p>
        </section>

        <section class="home-footer">
          <button class="tile-btn" id="lockerBtn">
            <span class="tile-icon">${icon('locker', { size: 26 })}</span>
            <span class="tile-label">Locker</span>
            <span class="tile-sub" id="lockerSub"></span>
          </button>
          <button class="tile-btn" id="settingsBtn">
            <span class="tile-icon">${icon('settings', { size: 26 })}</span>
            <span class="tile-label">Settings</span>
            <span class="tile-sub">Aim guide, table, audio</span>
          </button>
          <button class="tile-btn" id="careerBtn">
            <span class="tile-icon">${icon('trophy', { size: 26 })}</span>
            <span class="tile-label">Career</span>
            <span class="tile-sub" id="careerSub"></span>
          </button>
          <button class="tile-btn" id="trickShotsBtn">
            <span class="tile-icon">${icon('target', { size: 26 })}</span>
            <span class="tile-label">Trick Shots</span>
            <span class="tile-sub" id="trickSub"></span>
          </button>
          <button class="tile-btn" id="progressBtn">
            <span class="tile-icon">${icon('star', { size: 26 })}</span>
            <span class="tile-label">Progress</span>
            <span class="tile-sub" id="progressSub"></span>
          </button>
          <button class="tile-btn" id="statsBtn">
            <span class="tile-icon">${icon('trophy', { size: 26 })}</span>
            <span class="tile-label">Stats</span>
            <span class="tile-sub" id="statsSub"></span>
          </button>
          <div class="tile-btn challenge" id="challengeTile"></div>
        </section>
      </div>
    </div>`;

  const backdrop = root.querySelector<HTMLElement>('#homeBackdrop')!;
  const railEl = root.querySelector<HTMLElement>('#modeRail')!;
  const railWrap = root.querySelector<HTMLElement>('.mode-rail-wrap')!;
  const dotsEl = root.querySelector<HTMLElement>('#railDots')!;
  const prevBtn = root.querySelector<HTMLButtonElement>('#railPrev')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('#railNext')!;
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

  function drawModes(): void {
    railEl.innerHTML = modes
      .map(
        (mode) => `
        <button class="mode-tile${mode.id === selectedMode ? ' active' : ''}" data-mode="${mode.id}">
          <span class="mode-art">${modeArtSvg(mode.id)}</span>
          <span class="mode-title">${mode.name}</span>
          <span class="mode-blurb">${mode.blurb}</span>
          <span class="mode-meta">${
            mode.minPlayers === mode.maxPlayers
              ? `${mode.minPlayers} players`
              : `${mode.minPlayers}–${mode.maxPlayers} players`
          }</span>
          <span class="mode-rules">${mode.rulesSummary.map((r) => `<span>${r}</span>`).join('')}</span>
        </button>`
      )
      .join('');

    railEl.querySelectorAll<HTMLElement>('.mode-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        selectedMode = tile.dataset.mode as GameMode;
        localStorage.setItem('8ball:lastMode', selectedMode);
        drawModes();
        updateSoloSub();
        scrollToSelected();
      });
    });

    drawDots();
  }

  /** Page dots under the rail — a readable position indicator instead of a scrollbar. */
  function drawDots(): void {
    dotsEl.innerHTML = modes
      .map(
        (mode) =>
          `<button class="rail-dot${mode.id === selectedMode ? ' active' : ''}"
                   data-mode="${mode.id}" title="${mode.name}"></button>`
      )
      .join('');
    dotsEl.querySelectorAll<HTMLElement>('.rail-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        selectedMode = dot.dataset.mode as GameMode;
        localStorage.setItem('8ball:lastMode', selectedMode);
        drawModes();
        updateSoloSub();
        scrollToSelected();
      });
    });
  }

  /** Brings the selected tile into view, centred where there's room for it. */
  function scrollToSelected(): void {
    const tile = railEl.querySelector<HTMLElement>('.mode-tile.active');
    tile?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  /** One tile's worth of scroll, so the arrows move in whole cards rather than pixels. */
  function railStep(): number {
    const tile = railEl.querySelector<HTMLElement>('.mode-tile');
    const gap = parseFloat(getComputedStyle(railEl).columnGap || '12') || 12;
    return (tile?.offsetWidth ?? 240) + gap;
  }

  /** Greys out an arrow when there's nothing further that way. */
  function updateArrows(): void {
    const max = railEl.scrollWidth - railEl.clientWidth;
    prevBtn.disabled = railEl.scrollLeft <= 2;
    nextBtn.disabled = railEl.scrollLeft >= max - 2;
    railWrap.classList.toggle('at-start', railEl.scrollLeft <= 2);
    railWrap.classList.toggle('at-end', railEl.scrollLeft >= max - 2);
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
    root.querySelector<HTMLElement>('#challengeTile')!.innerHTML = `
      <span class="tile-icon">${icon(done ? 'check' : 'target', { size: 26 })}</span>
      <span class="tile-label">Daily Challenge</span>
      <span class="tile-sub">${done ? 'Done — come back tomorrow' : challenge.text}</span>
      ${done ? '' : `<span class="tile-reward">+${challenge.xp} XP &amp; a spin</span>`}`;
  }

  prevBtn.addEventListener('click', () => {
    railEl.scrollBy({ left: -railStep(), behavior: 'smooth' });
  });
  nextBtn.addEventListener('click', () => {
    railEl.scrollBy({ left: railStep(), behavior: 'smooth' });
  });
  railEl.addEventListener('scroll', updateArrows, { passive: true });
  window.addEventListener('resize', updateArrows);

  // Drag-to-scroll, so the rail feels like a carousel on a desktop too. A small threshold
  // keeps a normal click on a tile from being swallowed as a drag.
  let dragStartX = 0;
  let dragStartScroll = 0;
  let dragging = false;
  railEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartScroll = railEl.scrollLeft;
  });
  railEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) < 4) return;
    railWrap.classList.add('dragging');
    railEl.scrollLeft = dragStartScroll - dx;
  });
  const endDrag = (): void => {
    dragging = false;
    railWrap.classList.remove('dragging');
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  drawPlayer();
  drawModes();
  updateSoloSub();
  drawChallenge();
  requestAnimationFrame(() => {
    scrollToSelected();
    updateArrows();
  });

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
