import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  CUE_BALL_ID,
  CUPS,
  RARITY_LABELS,
  SLOTS,
  SLOT_LABELS,
  applyCueStrike,
  ballSetStyle,
  cloneBalls,
  createBall,
  cueStyle,
  fxStyle,
  itemById,
  itemsForSlot,
  rackBalls,
  readStrike,
  runShot,
  tableStyle,
  type Ball,
  type CosmeticItem,
  type ItemSlot,
  type ShotPlayback,
} from '@8ball/shared';
import { ScreenShell } from '../app/shell';
import { Avatar, Button, Coins, CoinIcon, Segmented, toast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { TableView } from '../render/TableView';
import { ShotPlayer } from '../game/shotPlayer';
import { buy, equip, level, profile, setAvatar, setName, totalTrickStars } from '../state/profile';
import { settings } from '../state/settings';
import { active } from '../net/session';
import { coins as coinSound, uiConfirm } from '../audio/sfx';

type Tab = ItemSlot | 'profile';

function unlockText(item: CosmeticItem): string {
  const u = item.unlock;
  switch (u.kind) {
    case 'starter':
      return 'Starter';
    case 'coins':
      return `${u.price.toLocaleString()}`;
    case 'level':
      return `Reach level ${u.level}`;
    case 'cup':
      return `Win the ${CUPS.find((c) => c.id === u.cupId)?.name ?? 'cup'}`;
    case 'stars':
      return `Earn ${u.stars} trick-shot stars`;
  }
}

function unlockProgress(item: CosmeticItem): number | null {
  const u = item.unlock;
  if (u.kind === 'level') return Math.min(1, level.value / u.level);
  if (u.kind === 'stars') return Math.min(1, totalTrickStars.value / u.stars);
  return null;
}

/** A demo shot, so an effect can be seen doing what it does. */
function demoShot(): ShotPlayback {
  const pre: Ball[] = [createBall(CUE_BALL_ID, 'cue', 520, 420), createBall(3, 'solid', 1260, 250), createBall(11, 'stripe', 1500, 620), createBall(6, 'solid', 900, 700)];
  const balls = cloneBalls(pre);
  const cue = balls[0];
  const angle = Math.atan2(250 - 420, 1260 - 520) + 0.04;
  applyCueStrike(cue, angle, 0.72, { x: 0, y: -0.3 }, () => 1, 0);
  const strike = readStrike(cue, false);
  const run = runShot(balls);
  return {
    id: 1,
    seat: 'p1',
    input: { angle, power: 0.72, spin: { x: 0, y: -0.3 }, elevation: 0, call: null },
    pre,
    strike,
    mods: { bigPockets: false, bomb: false },
    orbs: null,
    steps: run.steps,
    result: null as never,
  };
}

function Preview({ item }: { item: CosmeticItem }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<TableView | null>(null);
  const loop = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const p = profile.value;
    view.current = new TableView(host.current!, {
      quality: settings.value.quality === 'low' ? 'low' : 'medium',
      table: tableStyle(p.loadout.table),
      balls: ballSetStyle(p.loadout.balls),
      cue: cueStyle(p.loadout.cue),
      fx: fxStyle(p.loadout.fx),
      effects: true,
      tilt: false,
    });
    return () => {
      if (loop.current) clearTimeout(loop.current);
      view.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (loop.current) clearTimeout(loop.current);
    const p = profile.value;
    v.setTable(item.slot === 'table' ? (item.style as never) : tableStyle(p.loadout.table), 'medium');
    v.setBallSet(item.slot === 'balls' ? (item.style as never) : ballSetStyle(p.loadout.balls));
    v.setCueStyle(item.slot === 'cue' ? (item.style as never) : cueStyle(p.loadout.cue));
    v.setFx(item.slot === 'fx' ? (item.style as never) : fxStyle(p.loadout.fx));
    v.setAim(null);
    v.setTilt(item.slot === 'cue');

    if (item.slot === 'table') {
      v.setFocus(null);
      v.setBalls(rackBalls());
    } else if (item.slot === 'balls') {
      const show = [1, 9, 8, 3, 13, 0, 5, 14].map((id, k) => createBall(id, id === 0 ? 'cue' : id === 8 ? 'eight' : id < 8 ? 'solid' : 'stripe', 870 + (k % 4) * 58 + (k >= 4 ? 29 : 0), 470 + (k >= 4 ? 52 : 0)));
      v.setBalls(show);
      v.setFocus({ x: 973, y: 496 }, 7);
    } else if (item.slot === 'cue') {
      // Lay the cue diagonally across the cloth and frame its butt, where the design lives.
      const cue = createBall(CUE_BALL_ID, 'cue', 1500, 300);
      v.setBalls([cue, createBall(3, 'solid', 1720, 190)]);
      const angle = -0.46;
      v.setAim({ from: cue.pos, angle, power: 0.2, elevation: 0.12 });
      v.setFocus({ x: 1500 - Math.cos(angle) * 640, y: 300 - Math.sin(angle) * 640 }, 2.1);
    } else {
      v.setFocus(null);
      const run = () => {
        const shot = demoShot();
        v.setBalls(shot.pre);
        const cue = shot.pre[0];
        v.setAim({ from: cue.pos, angle: shot.input.angle, power: 0.6, elevation: 0 });
        loop.current = setTimeout(() => {
          v.strike();
          v.play(new ShotPlayer(shot), () => {}, () => {
            loop.current = setTimeout(run, 1200);
          });
        }, 500);
      };
      run();
    }
  }, [item.id]);

  return <div ref={host} class="locker-preview" />;
}

export function Locker(): JSX.Element {
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'cue');
  const p = profile.value;
  const slot: ItemSlot = tab === 'profile' ? 'cue' : tab;
  const [selected, setSelected] = useState<string>(p.loadout[slot]);
  const items = itemsForSlot(slot);
  const item = itemById(selected) ?? items[0];
  const owned = p.owned.includes(item.id);
  const equipped = p.loadout[item.slot] === item.id;
  const price = item.unlock.kind === 'coins' ? item.unlock.price : null;

  useEffect(() => {
    if (tab !== 'profile') setSelected(profile.value.loadout[tab]);
  }, [tab]);

  const onEquip = () => {
    if (equip(item.slot, item.id)) {
      uiConfirm();
      toast(`${item.name} equipped`, 'good', 'check');
      active.value?.host?.refreshIdentity();
      if (active.value?.kind === 'guest') active.value.client.send({ t: 'identity', ...{ name: p.name || 'Player', avatar: p.avatar, level: level.value, loadout: profile.value.loadout } });
    }
  };

  const onBuy = () => {
    const r = buy(item.id);
    if (r === 'ok') {
      coinSound(10);
      toast(`${item.name} unlocked!`, 'gold', 'sparkles');
      equip(item.slot, item.id);
      active.value?.host?.refreshIdentity();
    } else if (r === 'poor') toast(`You need ${(price! - p.coins).toLocaleString()} more coins`, 'bad');
  };

  return (
    <ScreenShell title="Locker" sub={`${p.owned.length} of 32 items`} class="locker">
      <div class="locker-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[...SLOTS.map((s) => ({ value: s as Tab, label: SLOT_LABELS[s] })), { value: 'profile' as Tab, label: 'Profile' }]}
        />
      </div>

      {tab === 'profile' ? (
        <ProfileEditor />
      ) : (
        <div class="locker-layout">
          <section class="panel locker-stage">
            <Preview item={item} />
            <div class="stage-info">
              <div class="si-head">
                <span class={`rarity rarity-${item.rarity}`}>{RARITY_LABELS[item.rarity]}</span>
                <h2>{item.name}</h2>
                <p>{item.blurb}</p>
              </div>
              <div class="si-action">
                {owned ? (
                  <Button kind={equipped ? 'secondary' : 'primary'} size="lg" icon={equipped ? 'check' : undefined} disabled={equipped} onClick={onEquip} sound="none">
                    {equipped ? 'Equipped' : 'Equip'}
                  </Button>
                ) : price !== null ? (
                  <Button kind="primary" size="lg" onClick={onBuy} sound="none" disabled={p.coins < price}>
                    <CoinIcon size={20} /> {price.toLocaleString()}
                  </Button>
                ) : (
                  <div class="si-locked">
                    <Icon name="lock" size={16} /> {unlockText(item)}
                    {unlockProgress(item) !== null && (
                      <div class="progress progress-gold">
                        <div class="progress-fill" style={{ width: `${unlockProgress(item)! * 100}%` }} />
                      </div>
                    )}
                  </div>
                )}
                {item.slot === 'table' || item.slot === 'balls' ? <p class="muted small">Everyone at a table you host sees your {item.slot === 'table' ? 'table' : 'balls'}.</p> : <p class="muted small">Everyone sees your {item.slot === 'cue' ? 'cue' : 'shot effects'} when you shoot.</p>}
              </div>
            </div>
          </section>

          <section class="locker-grid">
            {items.map((it) => {
              const own = p.owned.includes(it.id);
              const eq = p.loadout[it.slot] === it.id;
              return (
                <button class={`item-card rarity-border-${it.rarity} ${selected === it.id ? 'is-on' : ''} ${own ? 'is-owned' : ''}`} onClick={() => setSelected(it.id)}>
                  <ItemSwatch item={it} />
                  <span class="ic-name">{it.name}</span>
                  <span class="ic-foot">
                    {eq ? (
                      <span class="ic-eq">
                        <Icon name="check" size={13} /> Equipped
                      </span>
                    ) : own ? (
                      <span class="muted">Owned</span>
                    ) : it.unlock.kind === 'coins' ? (
                      <Coins amount={it.unlock.price} size="sm" />
                    ) : (
                      <span class="ic-lock">
                        <Icon name="lock" size={12} /> {unlockText(it)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        </div>
      )}
    </ScreenShell>
  );
}

/** A small flat swatch for an item card, drawn from its style. */
function ItemSwatch({ item }: { item: CosmeticItem }): JSX.Element {
  if (item.slot === 'table') {
    const s = item.style;
    return (
      <span class="swatch-table" style={{ '--rail': s.rail, '--cloth': s.cloth, '--trim': s.trim, '--neon': s.neon ?? 'transparent' }}>
        <span />
      </span>
    );
  }
  if (item.slot === 'balls') {
    const s = item.style;
    return (
      <span class="swatch-balls">
        {[s.colors[0], s.colors[1], s.eight, s.colors[2]].map((c, i) => (
          <span style={{ background: i === 3 ? `linear-gradient(${s.base} 30%, ${c} 30%, ${c} 70%, ${s.base} 70%)` : c, boxShadow: s.finish === 'neon' ? `0 0 10px ${c}` : undefined }} />
        ))}
      </span>
    );
  }
  if (item.slot === 'cue') {
    const s = item.style;
    return (
      <span class="swatch-cue">
        <span style={{ background: `linear-gradient(90deg, ${s.shaft} 0 48%, ${s.accent} 48% 50%, ${s.butt} 50% 76%, ${s.wrap} 76% 94%, ${s.butt} 94%)`, boxShadow: s.glow ? `0 0 12px ${s.glow}` : undefined }} />
      </span>
    );
  }
  const s = item.style;
  return (
    <span class="swatch-fx" style={{ '--c1': s.color, '--c2': s.color2 }}>
      {s.trail === 'none' ? <Icon name="ball" size={26} /> : <span class={`fx-streak fx-${s.trail}`} />}
    </span>
  );
}

function ProfileEditor(): JSX.Element {
  const p = profile.value;
  const [name, setLocal] = useState(p.name);
  return (
    <div class="panel profile-editor">
      <div class="pe-top">
        <Avatar avatar={p.avatar} size={88} />
        <div class="pe-name">
          <label class="muted small" for="pname">
            Name
          </label>
          <input
            id="pname"
            class="input"
            maxLength={16}
            value={name}
            onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
            onBlur={() => {
              setName(name.trim() || 'Player');
              active.value?.host?.refreshIdentity();
            }}
          />
        </div>
      </div>
      <div class="section-title">
        <h3>Avatar</h3>
      </div>
      <div class="avatar-grid">
        {AVATAR_ICONS.map((icon) => (
          <button class={p.avatar.icon === icon ? 'is-on' : ''} onClick={() => setAvatar({ icon })}>
            {icon}
          </button>
        ))}
      </div>
      <div class="section-title">
        <h3>Colour</h3>
      </div>
      <div class="color-row">
        {AVATAR_COLORS.map((color) => (
          <button class={`swatch ${p.avatar.color === color ? 'is-on' : ''}`} style={{ background: color }} onClick={() => setAvatar({ color })} aria-label={color} />
        ))}
      </div>
    </div>
  );
}
