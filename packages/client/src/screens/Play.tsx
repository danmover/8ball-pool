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
  pickBot,
  type BotTier,
  type GameMode,
  type RuleSetId,
} from '@8ball/shared';
import { ScreenShell } from '../app/shell';
import { Avatar, Button, Pill, Segmented, Stepper } from '../ui/kit';
import { ModeArt } from '../ui/ModeArt';
import { profile } from '../state/profile';
import { playBots, passAndPlay } from '../game/launch';

export function Play(): JSX.Element {
  const last = profile.value.lastPlay;
  const [mode, setMode] = useState<GameMode>(MULTIPLAYER_MODES.includes(last.mode) ? last.mode : 'eightball');
  const [tier, setTier] = useState<BotTier>(last.tier);
  const [botId, setBotId] = useState<string>(last.botId && botById(last.botId)?.tier === last.tier ? last.botId : BOTS.find((b) => b.tier === last.tier)!.id);
  const [raceTo, setRaceTo] = useState(last.raceTo);
  const [ruleSet, setRuleSet] = useState<RuleSetId>(last.ruleSet);
  const desc = modeDescriptor(mode);
  const [opponents, setOpponents] = useState(Math.min(desc.maxPlayers - 1, 3));
  const multi = mode === 'killer' || mode === 'power';
  const count = multi ? Math.max(1, Math.min(desc.maxPlayers - 1, opponents)) : 1;

  const start = () => {
    const ids = [botId];
    while (ids.length < count) ids.push(pickBot(tier, ids).id);
    playBots({ mode, botIds: ids, raceTo, ruleSet, tier });
  };

  return (
    <ScreenShell title="Play vs bots" sub="Offline — no connection needed" class="play">
      <div class="play-layout">
        <section class="panel play-section">
          <div class="section-title">
            <h3>Game</h3>
          </div>
          <div class="mode-tiles is-large">
            {MULTIPLAYER_MODES.map((m) => {
              const d = modeDescriptor(m);
              return (
                <button class={`mode-tile ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m)}>
                  <ModeArt mode={m} size={54} />
                  <span class="mt-name">{d.name}</span>
                  <span class="mt-blurb">{d.blurb}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section class="panel play-section">
          <div class="section-title">
            <h3>Opponent{multi ? 's' : ''}</h3>
            <Segmented
              size="sm"
              value={tier}
              onChange={(t) => {
                setTier(t);
                setBotId(BOTS.find((b) => b.tier === t)!.id);
              }}
              options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
            />
          </div>
          <div class="bot-grid is-select">
            {BOTS.filter((b) => b.tier === tier).map((b) => (
              <button class={`bot-card ${botId === b.id ? 'is-on' : ''}`} onClick={() => setBotId(b.id)}>
                <Avatar avatar={b.avatar} size={56} bot />
                <span class="bc-name">{b.name}</span>
                <span class="bc-bio">{b.bio}</span>
                <span class="bc-tags">
                  {b.style.aggression > 0.7 && <Pill tone="coral">Attacker</Pill>}
                  {b.style.aggression < 0.4 && <Pill tone="sky">Safety player</Pill>}
                  {b.style.flair > 0.6 && <Pill tone="violet">Show-off</Pill>}
                  {b.style.aggression >= 0.4 && b.style.aggression <= 0.7 && b.style.flair <= 0.6 && <Pill>All-rounder</Pill>}
                </span>
              </button>
            ))}
          </div>
          {multi && (
            <div class="setting inline">
              <div class="setting-label">Number of bots</div>
              <Stepper value={count} min={1} max={desc.maxPlayers - 1} onChange={setOpponents} />
            </div>
          )}
        </section>

        <section class="panel play-section play-options">
          <div class="setting">
            <div class="setting-label">Match length</div>
            <Segmented value={raceTo} onChange={setRaceTo} options={[1, 2, 3, 5].map((n) => ({ value: n, label: n === 1 ? 'One frame' : `Race to ${n}` }))} />
          </div>
          {desc.usesRuleSet && (
            <div class="setting">
              <div class="setting-label">
                Rules <span class="setting-hint">{RULE_SETS[ruleSet].blurb}</span>
              </div>
              <Segmented value={ruleSet} onChange={setRuleSet} options={[{ value: 'standard', label: 'Standard' }, { value: 'pro', label: 'Pro' }]} />
            </div>
          )}
          <Button kind="primary" size="xl" block icon="play" sound="confirm" onClick={start}>
            Play {multi ? `${desc.name} vs ${count} bot${count > 1 ? 's' : ''}` : `vs ${botById(botId)?.name}`}
          </Button>
          <Button kind="ghost" block icon="users" onClick={passAndPlay}>
            Pass & play on this device instead
          </Button>
        </section>
      </div>
    </ScreenShell>
  );
}
