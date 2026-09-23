import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  BOTS,
  MULTIPLAYER_MODES,
  RULE_SETS,
  TIER_LABELS,
  TIER_ORDER,
  botById,
  modeDescriptor,
  type BotTier,
  type GameMode,
  type RoomSettings,
  type RoomView,
  type SeatView,
} from '@8ball/shared';
import { Avatar, Button, IconButton, Modal, Pill, Segmented, Stepper, Toggle, toast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { InviteCard } from '../ui/Invite';
import { ModeArt } from '../ui/ModeArt';
import type { ActiveSession } from '../net/session';
import { SEAT_COLORS } from './table/hud';
import { profile } from '../state/profile';

export function Lobby({ session, onLeave }: { session: ActiveSession; onLeave: () => void }): JSX.Element {
  const client = session.client;
  const room = client.room.value;
  const [addFor, setAddFor] = useState<number | null>(null);
  if (!room) {
    return (
      <div class="screen lobby">
        <div class="room-bg" />
        <div class="lobby-connecting">
          <span class="spinner" style={{ width: '32px', height: '32px' }} />
          <p>{client.status.value === 'closed' ? client.closedReason.value : 'Connecting to the table…'}</p>
          <Button onClick={onLeave} icon="back" sound="back">
            Back
          </Button>
        </div>
      </div>
    );
  }
  const host = client.isHost.value;
  const me = client.me;
  const s = room.settings;
  const desc = modeDescriptor(s.mode);
  const seated = room.seats.filter((x): x is SeatView => x !== null);
  const mySeat = room.seats.findIndex((x) => x?.peer === me && x.kind === 'human');
  const spectators = room.members.filter((m) => !room.seats.some((x) => x?.peer === m.peer));
  const set = (patch: Partial<RoomSettings>) => client.send({ t: 'settings', patch });
  const enough = s.format === 'match' ? seated.length >= desc.minPlayers : true;
  const teams = s.mode === 'eightball' && s.format === 'match' && room.seats.length === 4;
  const connected = room.members.filter((m) => m.connected).length;

  return (
    <div class="screen lobby">
      <div class="room-bg" />
      <header class="topbar">
        <IconButton icon="back" label="Leave" onClick={onLeave} sound="back" />
        <div class="topbar-title">
          <h1>{room.online ? 'Table lobby' : 'Pass & play'}</h1>
          <span class="topbar-sub">
            {room.online ? (
              <>
                <span class={`dot ${client.status.value === 'online' ? 'is-on' : ''}`} /> {connected} here
                {room.settings.visibility === 'public' ? ' · Public' : ' · Private'}
              </>
            ) : (
              'Everyone plays on this device'
            )}
          </span>
        </div>
      </header>

      <main class="lobby-main scroll">
        <section class="lobby-left">
          {room.online && room.code && (
            <div class="panel lobby-invite">
              <InviteCard code={room.code} />
              <p class="invite-help">Friends open the link, scan the code, or type it on the home screen — from any network.</p>
            </div>
          )}

          <div class="panel lobby-seats">
            <div class="section-title">
              <h3>{s.format === 'tournament' ? `Draw · ${s.entrants} players` : s.format === 'king' ? 'Queue' : 'Players'}</h3>
              {s.format !== 'match' && <span class="muted small">Empty seats are filled with bots</span>}
            </div>
            <div class={`seats ${room.seats.length > 4 ? 'is-many' : ''}`}>
              {room.seats.map((seat, i) => (
                <SeatCard
                  key={i}
                  index={i}
                  seat={seat}
                  room={room}
                  me={me}
                  host={host}
                  team={teams ? (i % 2 === 0 ? 'A' : 'B') : null}
                  onSit={() => client.send({ t: 'sit', seat: i })}
                  onAdd={() => setAddFor(i)}
                  onClear={() => {
                    if (seat?.kind === 'human' && seat.peer && seat.peer !== room.host && seat.peer !== me) client.send({ t: 'kick', peer: seat.peer });
                    else client.send({ t: 'clearSeat', seat: i });
                  }}
                />
              ))}
            </div>
            {spectators.length > 0 && (
              <div class="spectators">
                <Icon name="eye" size={15} /> Watching: {spectators.map((m) => m.name).join(', ')}
              </div>
            )}
            {!host && mySeat === -1 && room.seats.some((x) => x === null) && <p class="muted small">Tap an open seat to sit down.</p>}
          </div>
        </section>

        <section class="lobby-right">
          <div class="panel lobby-settings">
            <div class="section-title">
              <h3>Game</h3>
              {!host && <Pill icon="lock">Host sets the rules</Pill>}
            </div>
            <div class="mode-tiles">
              {MULTIPLAYER_MODES.map((m) => {
                const d = modeDescriptor(m);
                return (
                  <button
                    class={`mode-tile ${s.mode === m ? 'is-on' : ''}`}
                    disabled={!host && s.mode !== m}
                    onClick={() => host && set({ mode: m, seats: Math.max(d.minPlayers, Math.min(d.maxPlayers, room.seats.length)) })}
                  >
                    <ModeArt mode={m} size={46} />
                    <span class="mt-name">{d.name}</span>
                    <span class="mt-players">
                      {d.minPlayers === d.maxPlayers ? d.minPlayers : `${d.minPlayers}–${d.maxPlayers}`} players
                    </span>
                  </button>
                );
              })}
            </div>
            <p class="mode-blurb">{desc.blurb}</p>

            <div class="settings-grid">
              {(s.mode === 'eightball' || s.mode === 'nineball') && (
                <Setting label="Format">
                  <Segmented
                    size="sm"
                    disabled={!host}
                    value={s.format}
                    onChange={(v) => set({ format: v })}
                    options={[
                      { value: 'match', label: 'Match' },
                      { value: 'tournament', label: 'Tournament' },
                      { value: 'king', label: 'Winner stays' },
                    ]}
                  />
                </Setting>
              )}
              {s.format === 'match' && desc.maxPlayers > desc.minPlayers && (
                <Setting label="Seats">
                  <Stepper disabled={!host} value={room.seats.length} min={desc.minPlayers} max={desc.maxPlayers} onChange={(v) => set({ seats: v })} />
                </Setting>
              )}
              {s.format === 'tournament' && (
                <Setting label="Entrants">
                  <Segmented size="sm" disabled={!host} value={s.entrants} onChange={(v) => set({ entrants: v })} options={[{ value: 4, label: '4' }, { value: 8, label: '8' }]} />
                </Setting>
              )}
              {s.format === 'king' && (
                <Setting label="Players">
                  <Stepper disabled={!host} value={room.seats.length} min={3} max={8} onChange={(v) => set({ seats: v })} />
                </Setting>
              )}
              {s.format !== 'king' && (
                <Setting label={s.format === 'tournament' ? 'Each tie' : 'Race to'}>
                  <Segmented
                    size="sm"
                    disabled={!host}
                    value={s.raceTo}
                    onChange={(v) => set({ raceTo: v })}
                    options={[1, 2, 3, 5].map((n) => ({ value: n, label: n === 1 ? '1 frame' : `${n}` }))}
                  />
                </Setting>
              )}
              {desc.usesRuleSet && (
                <Setting label="Rules" hint={RULE_SETS[s.ruleSet].blurb}>
                  <Segmented size="sm" disabled={!host} value={s.ruleSet} onChange={(v) => set({ ruleSet: v })} options={[{ value: 'standard', label: 'Standard' }, { value: 'pro', label: 'Pro' }]} />
                </Setting>
              )}
              <Setting label="Shot clock">
                <Segmented
                  size="sm"
                  disabled={!host}
                  value={s.shotClock ?? 0}
                  onChange={(v) => set({ shotClock: v === 0 ? null : v })}
                  options={[0, 20, 30, 45].map((n) => ({ value: n, label: n === 0 ? 'Off' : `${n}s` }))}
                />
              </Setting>
              <Setting label="Aim guide">
                <Segmented size="sm" disabled={!host} value={s.guide} onChange={(v) => set({ guide: v })} options={[{ value: 'full', label: 'Full' }, { value: 'short', label: 'Short' }, { value: 'off', label: 'Off' }]} />
              </Setting>
              <Setting label="Bot level" hint="For bots that fill seats or cover for someone who drops out.">
                <Segmented size="sm" disabled={!host} value={s.botTier} onChange={(v) => set({ botTier: v })} options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABELS[t] }))} />
              </Setting>
              {room.online && host && (
                <Setting label="Public table" hint="Anyone can find it in the table browser.">
                  <Toggle on={s.visibility === 'public'} onChange={(v) => set({ visibility: v ? 'public' : 'private' })} label="Public table" />
                </Setting>
              )}
              {host && room.online && (
                <Setting label="TV mode" hint="This screen shows the table; everyone plays from their phone.">
                  <Toggle on={room.displayMode} onChange={(v) => client.send({ t: 'display', on: v })} label="TV mode" />
                </Setting>
              )}
            </div>
          </div>

          <div class="lobby-cta">
            {host ? (
              <Button
                kind="primary"
                size="xl"
                block
                icon="play"
                sound="confirm"
                disabled={!enough}
                onClick={() => client.send({ t: 'start' })}
              >
                {enough ? (s.format === 'tournament' ? 'Start tournament' : 'Start game') : `Need ${desc.minPlayers} players`}
              </Button>
            ) : mySeat !== -1 ? (
              <Button
                kind={room.seats[mySeat]?.ready ? 'mint' : 'primary'}
                size="xl"
                block
                icon={room.seats[mySeat]?.ready ? 'check' : 'hand'}
                onClick={() => client.send({ t: 'ready', ready: !room.seats[mySeat]?.ready })}
              >
                {room.seats[mySeat]?.ready ? 'Ready — waiting for host' : "I'm ready"}
              </Button>
            ) : (
              <div class="lobby-waiting">
                <Icon name="eye" size={18} /> You're watching. Grab an open seat to play.
              </div>
            )}
            {host && !enough && <p class="muted small center">Add a bot or wait for friends to join.</p>}
          </div>
        </section>
      </main>

      {addFor !== null && (
        <AddSeatModal
          online={room.online}
          onClose={() => setAddFor(null)}
          onBot={(botId) => {
            client.send({ t: 'addBot', seat: addFor, botId });
            setAddFor(null);
          }}
          onGuest={(name) => {
            client.send({ t: 'addGuest', seat: addFor, name, avatar: { icon: ['🦊', '🐯', '🐼', '🐸', '🦄', '🐙'][addFor % 6], color: ['#ff6b5a', '#39d98a', '#ffc542', '#b57bff', '#2ed3d3', '#ff5fa2'][addFor % 6] } });
            setAddFor(null);
          }}
        />
      )}
    </div>
  );
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="setting">
      <div class="setting-label">
        {label}
        {hint && <span class="setting-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SeatCard({
  index,
  seat,
  room,
  me,
  host,
  team,
  onSit,
  onAdd,
  onClear,
}: {
  index: number;
  seat: SeatView | null;
  room: RoomView;
  me: string;
  host: boolean;
  team: 'A' | 'B' | null;
  onSit: () => void;
  onAdd: () => void;
  onClear: () => void;
}): JSX.Element {
  const color = team ? (team === 'A' ? 'var(--p1)' : 'var(--p2)') : SEAT_COLORS[index % 8];
  if (!seat) {
    return (
      <div class="seat is-empty" style={{ '--seat': color }}>
        <div class="seat-empty-ring">
          <Icon name="plus" size={20} />
        </div>
        <div class="seat-text">
          <span class="seat-name muted">Open seat</span>
          {team && <span class="seat-team">Team {team}</span>}
        </div>
        <div class="seat-actions">
          {host ? (
            <Button size="sm" icon="plus" onClick={onAdd}>
              Add
            </Button>
          ) : (
            <Button size="sm" kind="primary" onClick={onSit}>
              Sit
            </Button>
          )}
        </div>
      </div>
    );
  }
  const bot = seat.kind === 'bot' ? botById(seat.botId) : null;
  const isMe = seat.peer === me && seat.kind === 'human';
  const isHostSeat = seat.peer === room.host && seat.kind === 'human';
  return (
    <div class={`seat ${isMe ? 'is-me' : ''} ${!seat.connected ? 'is-away' : ''}`} style={{ '--seat': color }}>
      <Avatar avatar={seat.avatar} size={46} ring={color} bot={!!bot} dim={!seat.connected} />
      <div class="seat-text">
        <span class="seat-name">
          {seat.name}
          {isMe && <span class="seat-you">You</span>}
          {isHostSeat && <Icon name="crown" size={14} class="gold" />}
        </span>
        <span class="seat-meta">
          {bot ? `${TIER_LABELS[bot.tier]} bot · ${bot.bio}` : `Level ${seat.level}`}
          {team && <span class="seat-team"> · Team {team}</span>}
        </span>
      </div>
      <div class="seat-actions">
        {seat.kind === 'human' && seat.ready && !isHostSeat && <Pill tone="mint" icon="check">Ready</Pill>}
        {!seat.connected && <Pill tone="coral">Away</Pill>}
        {host && !isMe && (
          <IconButton icon="close" label={seat.kind === 'bot' ? 'Remove bot' : 'Remove player'} onClick={onClear} class="icon-btn-sm" />
        )}
        {!host && isMe && <IconButton icon="exit" label="Stand up" onClick={onClear} class="icon-btn-sm" />}
      </div>
    </div>
  );
}

function AddSeatModal({ online, onClose, onBot, onGuest }: { online: boolean; onClose: () => void; onBot: (id: string) => void; onGuest: (name: string) => void }): JSX.Element {
  const [tier, setTier] = useState<BotTier>(profile.value.lastPlay.tier);
  const [name, setName] = useState('');
  return (
    <Modal open onClose={onClose} title="Fill the seat" wide>
      <Segmented value={tier} onChange={setTier} options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABELS[t] }))} />
      <div class="bot-grid">
        {BOTS.filter((b) => b.tier === tier).map((b) => (
          <button class="bot-card" onClick={() => onBot(b.id)}>
            <Avatar avatar={b.avatar} size={48} bot />
            <span class="bc-name">{b.name}</span>
            <span class="bc-bio">{b.bio}</span>
          </button>
        ))}
      </div>
      <div class="guest-row">
        <div>
          <b>Someone on this device</b>
          <p class="muted small">{online ? 'For a friend without a phone — they play from this screen.' : 'Pass the device between turns.'}</p>
        </div>
        <input class="input" placeholder="Their name" value={name} maxLength={16} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <Button kind="primary" disabled={!name.trim()} onClick={() => (name.trim() ? onGuest(name.trim()) : toast('Add a name', 'bad'))}>
          Add
        </Button>
      </div>
    </Modal>
  );
}

export type { GameMode };
