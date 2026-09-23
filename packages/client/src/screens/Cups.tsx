import type { JSX } from 'preact';
import { CUPS, TIER_LABELS, cupUnlocked, itemById, modeDescriptor, type BotTier } from '@8ball/shared';
import { ScreenShell } from '../app/shell';
import { Button, Coins, Pill } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { profile } from '../state/profile';
import { playCup } from '../game/launch';

export function Cups(): JSX.Element {
  const won = profile.value.cupsWon;
  return (
    <ScreenShell title="Cups" sub="Eight-player knockouts against the bots · offline" class="cups">
      <div class="cup-list">
        {CUPS.map((cup, i) => {
          const open = cupUnlocked(cup, won);
          const done = won.includes(cup.id);
          const prize = cup.reward.item ? itemById(cup.reward.item) : null;
          const field = Object.entries(cup.field)
            .filter(([, n]) => (n ?? 0) > 0)
            .map(([t, n]) => `${n} ${TIER_LABELS[t as BotTier]}`)
            .join(' · ');
          return (
            <article class={`panel cup-card ${open ? '' : 'is-locked'} ${done ? 'is-won' : ''}`} style={{ '--accent': cup.accent, '--i': i }}>
              <div class="cup-icon">{cup.icon}</div>
              <div class="cup-text">
                <div class="cup-head">
                  <h2>{cup.name}</h2>
                  {done && <Pill tone="gold" icon="trophy">Won</Pill>}
                  {!open && <Pill icon="lock">Win the {CUPS.find((c) => c.id === cup.requires)?.name}</Pill>}
                </div>
                <p>{cup.blurb}</p>
                <div class="cup-meta">
                  <span>
                    <Icon name="target" size={14} /> {modeDescriptor(cup.mode).name}
                  </span>
                  <span>
                    <Icon name="users" size={14} /> {field}
                  </span>
                  <span>
                    <Icon name="flag" size={14} /> {cup.raceTo === 1 ? 'Single frames' : `Race to ${cup.raceTo}`}
                  </span>
                </div>
              </div>
              <div class="cup-prize">
                <span class="muted small">{done ? 'Replay prize' : 'Prize'}</span>
                <Coins amount={done ? Math.round(cup.reward.coins / 3) : cup.reward.coins} />
                {prize && !done && <span class="cup-item">+ {prize.name}</span>}
                <Button kind={open ? 'primary' : 'secondary'} disabled={!open} icon={open ? 'play' : 'lock'} onClick={() => playCup(cup)} sound="confirm">
                  {done ? 'Play again' : 'Enter'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </ScreenShell>
  );
}
