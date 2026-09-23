import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { modeDescriptor, type PublicRoom } from '@8ball/shared';
import { ScreenShell } from '../app/shell';
import { Button, Pill, Spinner } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { ModeArt } from '../ui/ModeArt';
import { hostOnline, joinRoom, passAndPlay } from '../game/launch';
import { listPublicRooms, relayReachable } from '../net/relay';

export function Friends(): JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'host' | 'tv' | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);

  const refresh = async () => {
    setRooms(null);
    const ok = await relayReachable();
    setOnline(ok);
    setRooms(ok ? ((await listPublicRooms()) ?? []) : []);
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void listPublicRooms().then((r) => r && setRooms(r)), 8000);
    return () => clearInterval(t);
  }, []);

  const host = async (tv: boolean) => {
    setBusy(tv ? 'tv' : 'host');
    await hostOnline(tv);
    setBusy(null);
  };

  return (
    <ScreenShell title="Play with friends" sub="Works across any networks — share a code or a link" class="friends">
      {online === false && (
        <div class="offline-note panel">
          <Icon name="wifiOff" size={22} />
          <div>
            <b>You're offline</b>
            <p>Online tables need a connection. You can still play bots, or pass & play on this device.</p>
          </div>
          <Button size="sm" onClick={passAndPlay} icon="users">
            Pass & play
          </Button>
        </div>
      )}
      <div class="friends-grid">
        <section class="panel friends-card host-card">
          <div class="fc-icon">
            <Icon name="users" size={28} />
          </div>
          <h2>Host a table</h2>
          <p>You get a room code and a QR code. Friends join from their phones or computers, wherever they are.</p>
          <Button kind="primary" size="lg" block icon="play" disabled={online === false || busy !== null} onClick={() => host(false)} sound="confirm">
            {busy === 'host' ? <Spinner size={18} /> : 'Create table'}
          </Button>
          <button class="tv-option" disabled={online === false || busy !== null} onClick={() => host(true)}>
            <Icon name="tv" size={22} />
            <span>
              <b>TV mode</b>
              <small>This screen shows the table, everyone plays from their phone.</small>
            </span>
            {busy === 'tv' ? <Spinner size={16} /> : <Icon name="forward" size={18} />}
          </button>
        </section>

        <section class="panel friends-card join-card">
          <div class="fc-icon">
            <Icon name="link" size={28} />
          </div>
          <h2>Join a table</h2>
          <p>Enter the 4-character code from your friend's screen.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 4) joinRoom(code);
            }}
          >
            <div class="code-boxes" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
              {[0, 1, 2, 3].map((i) => (
                <span class={`code-box ${code.length === i ? 'is-active' : ''}`}>{code[i] ?? ''}</span>
              ))}
              <input
                class="code-input"
                value={code}
                maxLength={4}
                autocapitalize="characters"
                autocomplete="off"
                spellcheck={false}
                aria-label="Room code"
                onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
              />
            </div>
            <Button kind="primary" size="lg" block type="submit" disabled={code.length !== 4} sound="confirm">
              Join
            </Button>
          </form>
        </section>
      </div>

      <section class="panel public-rooms">
        <div class="section-title">
          <h3>Public tables</h3>
          <Button kind="ghost" size="sm" icon="refresh" onClick={refresh}>
            Refresh
          </Button>
        </div>
        {rooms === null ? (
          <div class="pr-empty">
            <Spinner />
          </div>
        ) : rooms.length === 0 ? (
          <div class="pr-empty">
            <p>No public tables right now.</p>
            <p class="muted small">Host one and switch on "Public table" in the lobby for anyone to join.</p>
          </div>
        ) : (
          <ul class="pr-list">
            {rooms.map((r) => (
              <li>
                <ModeArt mode={r.mode} size={40} />
                <span class="pr-text">
                  <b>{r.host}'s table</b>
                  <span class="muted small">
                    {modeDescriptor(r.mode).name} · {r.players}/{r.seats} seated
                  </span>
                </span>
                {r.playing ? <Pill tone="sky">Playing</Pill> : <Pill tone="mint">Open</Pill>}
                <Button size="sm" kind={r.playing ? 'secondary' : 'primary'} onClick={() => joinRoom(r.code)}>
                  {r.playing ? 'Watch' : 'Join'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ScreenShell>
  );
}
