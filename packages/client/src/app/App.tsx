import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { normalizeCode } from '@8ball/shared';
import { match, navigate, route } from './router';
import { settingsOpen } from './shell';
import { Home } from '../screens/Home';
import { Play } from '../screens/Play';
import { Friends } from '../screens/Friends';
import { Cups } from '../screens/Cups';
import { Solo, Tricks } from '../screens/Solo';
import { Progress } from '../screens/Progress';
import { Locker } from '../screens/Locker';
import { Lobby } from '../screens/Lobby';
import { SettingsModal } from '../screens/Settings';
import { TableScreen } from '../screens/table/TableScreen';
import { Avatar, Button, Spinner, Toasts } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { active, joinTable, savedHost } from '../net/session';
import { joinRoom, resumeHosted } from '../game/launch';
import { profile, setName } from '../state/profile';
import { settings } from '../state/settings';
import { startMusic, stopMusic } from '../audio/music';

export function App(): JSX.Element {
  const path = route.value;
  const room = match('/room/:code', path);
  const join = match('/j/:code', path);
  const atTable = !!room || path === '/local';

  useEffect(() => {
    if (atTable) stopMusic();
    else if (settings.value.musicOn) startMusic();
  }, [atTable]);

  let screen: JSX.Element;
  if (path === '/') screen = <Home />;
  else if (path === '/play') screen = <Play />;
  else if (path === '/friends') screen = <Friends />;
  else if (path === '/cups') screen = <Cups />;
  else if (path === '/solo') screen = <Solo />;
  else if (path === '/tricks') screen = <Tricks />;
  else if (path === '/progress') screen = <Progress />;
  else if (path === '/locker') screen = <Locker />;
  else if (atTable) screen = <RoomRoute code={room ? normalizeCode(room.code) : null} />;
  else if (join) screen = <JoinRoute code={join.code} />;
  else {
    queueMicrotask(() => navigate('/', true));
    screen = <Home />;
  }

  return (
    <>
      {screen}
      <Toasts />
      <SettingsModal open={settingsOpen.value} onClose={() => (settingsOpen.value = false)} />
    </>
  );
}

function RoomRoute({ code }: { code: string | null }): JSX.Element {
  const a = active.value;
  useEffect(() => {
    if (a) return;
    if (code) {
      const saved = savedHost();
      if (saved?.code === code) resumeHosted();
      else joinTable(code);
    } else if (!resumeHosted()) navigate('/', true);
  }, [code, !!a]);

  if (!a) {
    return (
      <div class="screen center-screen">
        <div class="room-bg" />
        <Spinner size={36} />
      </div>
    );
  }
  const client = a.client;
  const room = client.room.value;
  const leave = () => {
    a.leave();
    navigate('/');
  };
  if (client.status.value === 'closed') {
    return (
      <div class="screen center-screen">
        <div class="room-bg" />
        <div class="panel closed-card">
          <Icon name="info" size={32} />
          <h2>Table closed</h2>
          <p>{client.closedReason.value ?? 'This table is no longer available.'}</p>
          <Button kind="primary" size="lg" icon="home" onClick={leave}>
            Home
          </Button>
        </div>
      </div>
    );
  }
  if (!room || room.phase === 'lobby') return <Lobby session={a} onLeave={leave} />;
  return <TableScreen session={a} onLeave={leave} />;
}

function JoinRoute({ code }: { code: string }): JSX.Element {
  const p = profile.value;
  const [name, setLocal] = useState(p.name);
  const valid = normalizeCode(code);
  useEffect(() => {
    if (valid && p.name.trim()) joinRoom(valid);
  }, []);
  return (
    <div class="screen center-screen">
      <div class="room-bg" />
      <div class="panel closed-card">
        <Avatar avatar={p.avatar} size={64} />
        <h2>{valid ? `Joining table ${valid}` : 'That link looks broken'}</h2>
        {valid ? (
          <>
            <p>What should everyone call you?</p>
            <input class="input" placeholder="Your name" maxLength={16} value={name} onInput={(e) => setLocal((e.target as HTMLInputElement).value)} />
            <Button
              kind="primary"
              size="lg"
              block
              icon="play"
              sound="confirm"
              onClick={() => {
                setName(name.trim() || 'Player');
                joinRoom(valid);
              }}
            >
              Join the table
            </Button>
          </>
        ) : (
          <Button kind="primary" onClick={() => navigate('/')}>
            Home
          </Button>
        )}
      </div>
    </div>
  );
}
