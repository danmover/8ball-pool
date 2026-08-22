import type { FeltTheme, PlayerSettings } from '@8ball/shared';
import { navigate } from '../router';

const FELT_SWATCHES: Record<FeltTheme, string> = {
  green: '#1f8a4c',
  blue: '#1f6fa8',
  crimson: '#9c2b3a',
  midnight: '#2c2f52',
};

export function openSettingsPanel(current: PlayerSettings, onChange: (settings: PlayerSettings) => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'settings-sheet';
  overlay.innerHTML = `
    <div class="panel">
      <h2 style="margin-top:0">Settings</h2>
      <div class="settings-row">
        <div>
          <div class="label">Aim guide</div>
          <div class="desc">Preview where the cue ball (and object ball) will travel</div>
        </div>
        <div class="segmented" data-key="trajectoryPreview">
          <button data-value="off">Off</button>
          <button data-value="basic">Basic</button>
          <button data-value="full">Full</button>
        </div>
      </div>
      <div class="settings-row">
        <div><div class="label">Table felt</div></div>
        <div class="swatches" data-key="feltTheme">
          ${(Object.keys(FELT_SWATCHES) as FeltTheme[])
            .map((t) => `<button class="swatch" data-value="${t}" style="background:${FELT_SWATCHES[t]}"></button>`)
            .join('')}
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="label">Effects</div>
          <div class="desc">Sparks, dust, and confetti on hits and pots</div>
        </div>
        <div class="segmented" data-key="effectsIntensity">
          <button data-value="low">Low</button>
          <button data-value="high">High</button>
        </div>
      </div>
      <div class="settings-row">
        <div><div class="label">Sound</div></div>
        <div class="toggle" data-key="soundEnabled"></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="label">Vibration</div>
          <div class="desc">Haptic feedback on collisions and pots</div>
        </div>
        <div class="toggle" data-key="hapticsEnabled"></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="label">Colorblind patterns</div>
          <div class="desc">Add hatching to stripe balls in addition to color</div>
        </div>
        <div class="toggle" data-key="colorblindPatterns"></div>
      </div>
      <div class="settings-row">
        <div><div class="label">Left-handed layout</div></div>
        <div class="toggle" data-key="leftHanded"></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="label">Locker</div>
          <div class="desc">Cues, ball sets, trails, banners and the prize wheel</div>
        </div>
        <button id="openLocker" class="mini">Open</button>
      </div>
      <button id="closeSettings" class="secondary" style="width:100%;margin-top:1rem">Done</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const settings: PlayerSettings = { ...current };

  function render(): void {
    overlay.querySelectorAll<HTMLElement>('.segmented, .swatches').forEach((seg) => {
      const key = seg.dataset.key as keyof PlayerSettings;
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
        btn.classList.toggle('active', settings[key] === btn.dataset.value);
      });
    });
    overlay.querySelectorAll<HTMLElement>('.toggle').forEach((t) => {
      const key = t.dataset.key as keyof PlayerSettings;
      t.classList.toggle('on', Boolean(settings[key]));
    });
  }

  overlay.querySelectorAll<HTMLButtonElement>('.segmented button, .swatches button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seg = btn.closest<HTMLElement>('.segmented, .swatches')!;
      const key = seg.dataset.key as 'trajectoryPreview' | 'effectsIntensity' | 'feltTheme';
      (settings as unknown as Record<string, unknown>)[key] = btn.dataset.value;
      render();
      onChange(settings);
    });
  });

  overlay.querySelectorAll<HTMLElement>('.toggle').forEach((toggleEl) => {
    toggleEl.addEventListener('click', () => {
      const key = toggleEl.dataset.key as 'soundEnabled' | 'hapticsEnabled' | 'colorblindPatterns' | 'leftHanded';
      settings[key] = !settings[key];
      render();
      onChange(settings);
    });
  });

  overlay.querySelector('#openLocker')!.addEventListener('click', () => {
    overlay.remove();
    navigate('/profile');
  });

  overlay.querySelector('#closeSettings')!.addEventListener('click', () => overlay.remove());

  render();
}
