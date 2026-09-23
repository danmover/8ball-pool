import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button, Modal, Row, Segmented, Slider, Toggle, toast } from '../ui/kit';
import { settings, updateSettings } from '../state/settings';
import { exportProfile, importProfile } from '../state/profile';
import { startMusic, stopMusic } from '../audio/music';

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const s = settings.value;
  const [tab, setTab] = useState<'game' | 'sound' | 'display' | 'advanced'>('game');
  const [code, setCode] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Settings" wide>
      <div class="settings-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'game', label: 'Gameplay' },
            { value: 'sound', label: 'Sound' },
            { value: 'display', label: 'Graphics' },
            { value: 'advanced', label: 'Advanced' },
          ]}
        />
      </div>
      {tab === 'game' && (
        <div class="settings-group">
          <Row label="Aim guide" hint="A table's host can limit this further.">
            <Segmented
              size="sm"
              value={s.guide}
              onChange={(v) => updateSettings({ guide: v })}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'short', label: 'Short' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </Row>
          <Row label="Left-handed" hint="Power cue on the right, ball return on the left.">
            <Toggle on={s.leftHanded} onChange={(v) => updateSettings({ leftHanded: v })} label="Left-handed" />
          </Row>
          <Row label="Vibration" hint="On phones that support it.">
            <Toggle on={s.haptics} onChange={(v) => updateSettings({ haptics: v })} label="Vibration" />
          </Row>
        </div>
      )}
      {tab === 'sound' && (
        <div class="settings-group">
          <Row label="Sound effects">
            <div class="row-inline">
              <Slider value={s.sfxVolume} onChange={(v) => updateSettings({ sfxVolume: v })} label="Effects volume" />
              <Toggle on={s.sfxOn} onChange={(v) => updateSettings({ sfxOn: v })} label="Effects" />
            </div>
          </Row>
          <Row label="Music" hint="A quiet lounge loop on the menus.">
            <div class="row-inline">
              <Slider value={s.musicVolume} onChange={(v) => updateSettings({ musicVolume: v })} label="Music volume" />
              <Toggle
                on={s.musicOn}
                onChange={(v) => {
                  updateSettings({ musicOn: v });
                  if (v) startMusic();
                  else stopMusic();
                }}
                label="Music"
              />
            </div>
          </Row>
        </div>
      )}
      {tab === 'display' && (
        <div class="settings-group">
          <Row label="Quality" hint="Lower it if the table feels slow on this device.">
            <Segmented
              size="sm"
              value={s.quality}
              onChange={(v) => updateSettings({ quality: v })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Row>
          <Row label="Shot effects" hint="Trails, sparks and pocket bursts.">
            <Toggle on={s.effects} onChange={(v) => updateSettings({ effects: v })} label="Shot effects" />
          </Row>
          <Row label="Broadcast camera" hint="Tilted TV-style view instead of straight down (landscape).">
            <Toggle on={s.tiltCamera} onChange={(v) => updateSettings({ tiltCamera: v })} label="Broadcast camera" />
          </Row>
          <Row label="Reduce motion" hint="Fewer animations throughout.">
            <Toggle on={s.reduceMotion} onChange={(v) => updateSettings({ reduceMotion: v })} label="Reduce motion" />
          </Row>
        </div>
      )}
      {tab === 'advanced' && (
        <div class="settings-group">
          <Row label="Game server" hint="Leave empty to use this site's. For self-hosted relays.">
            <input class="input input-sm" value={s.relayUrl} placeholder="https://…" onChange={(e) => updateSettings({ relayUrl: (e.target as HTMLInputElement).value.trim() })} />
          </Row>
          <Row label="Move your profile" hint="Copy a code here, paste it on another device.">
            <Button
              size="sm"
              icon="copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(exportProfile());
                  toast('Profile code copied', 'good', 'check');
                } catch {
                  toast('Could not copy — your browser blocked it', 'bad');
                }
              }}
            >
              Copy code
            </Button>
          </Row>
          <div class="import-row">
            <input class="input" value={code} placeholder="Paste a profile code" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            <Button
              kind="primary"
              disabled={!code.trim()}
              onClick={() => {
                if (importProfile(code)) {
                  toast('Profile loaded', 'good', 'check');
                  setCode('');
                } else toast("That code didn't work", 'bad');
              }}
            >
              Load
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
