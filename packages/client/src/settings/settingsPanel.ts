import type { PlayerSettings, TrajectoryPreviewMode } from '@8ball/shared';

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
      <button id="closeSettings" class="secondary" style="width:100%;margin-top:1rem">Done</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const settings: PlayerSettings = { ...current };

  function render(): void {
    overlay.querySelectorAll<HTMLElement>('.segmented').forEach((seg) => {
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

  overlay.querySelectorAll<HTMLButtonElement>('.segmented button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seg = btn.closest('.segmented') as HTMLElement;
      const key = seg.dataset.key as 'trajectoryPreview';
      settings[key] = btn.dataset.value as TrajectoryPreviewMode;
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

  overlay.querySelector('#closeSettings')!.addEventListener('click', () => overlay.remove());

  render();
}
