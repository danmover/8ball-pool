import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { modeDescriptor, RULE_SETS, type RoomView } from '@8ball/shared';
import { Button, Modal } from '../../ui/kit';
import { InviteCard } from '../../ui/Invite';
import { SettingsModal } from '../Settings';
import type { ActiveSession } from '../../net/session';

export function TableMenu({ session, room, onClose, onLeave }: { session: ActiveSession; room: RoomView; onClose: () => void; onLeave: () => void }): JSX.Element {
  const [view, setView] = useState<'menu' | 'rules' | 'settings' | 'leave'>('menu');
  const desc = modeDescriptor(room.settings.mode);
  const host = session.client.isHost.value;

  if (view === 'settings') return <SettingsModal open onClose={() => setView('menu')} />;

  return (
    <Modal open onClose={onClose} title={view === 'rules' ? `How to play ${desc.name}` : view === 'leave' ? 'Leave the table?' : 'Menu'}>
      {view === 'menu' && (
        <div class="menu-list">
          <Button kind="primary" size="lg" block icon="play" onClick={onClose}>
            Resume
          </Button>
          {room.online && room.code && <InviteCard code={room.code} compact />}
          <Button kind="secondary" size="lg" block icon="info" onClick={() => setView('rules')}>
            How to play
          </Button>
          <Button kind="secondary" size="lg" block icon="settings" onClick={() => setView('settings')}>
            Settings
          </Button>
          {host && room.online && room.phase !== 'lobby' && (
            <Button kind="secondary" size="lg" block icon="users" onClick={() => { session.client.send({ t: 'toLobby' }); onClose(); }}>
              Back to lobby
            </Button>
          )}
          <Button kind="ghost" size="lg" block icon="exit" onClick={() => setView('leave')} sound="back">
            Leave table
          </Button>
          <div class="menu-keys">
            <b>Keys</b> ← → aim · Shift fine · Hold Space to shoot · S spin · 1 2 3 shot type
          </div>
        </div>
      )}
      {view === 'rules' && (
        <div class="rules-view">
          <p class="rules-blurb">{desc.blurb}</p>
          <ul>
            {desc.rulesSummary.map((r) => (
              <li>{r}</li>
            ))}
          </ul>
          {desc.usesRuleSet && (
            <p class="rules-set">
              <b>{RULE_SETS[room.settings.ruleSet].name} rules:</b> {RULE_SETS[room.settings.ruleSet].blurb}
            </p>
          )}
          <Button kind="secondary" block onClick={() => setView('menu')} icon="back" sound="back">
            Back
          </Button>
        </div>
      )}
      {view === 'leave' && (
        <div class="menu-list">
          <p class="leave-copy">
            {host && room.online
              ? 'You are hosting — leaving closes the table for everyone.'
              : room.phase === 'playing' && !desc.solo
                ? 'A bot will take your seat for the rest of the game.'
                : 'You can come back from the home screen.'}
          </p>
          <Button kind="danger" size="lg" block icon="exit" onClick={onLeave}>
            Leave
          </Button>
          <Button kind="secondary" size="lg" block onClick={() => setView('menu')} sound="back">
            Stay
          </Button>
        </div>
      )}
    </Modal>
  );
}
