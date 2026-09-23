import type { JSX } from 'preact';
import { challengeSets, formatRunTime, modeDescriptor, TIME_ATTACK_PAR_MS, timeAttackStars } from '@8ball/shared';
import { ScreenShell } from '../app/shell';
import { Button, Pill } from '../ui/kit';
import { ModeArt } from '../ui/ModeArt';
import { navigate } from '../app/router';
import { profile, totalTrickStars } from '../state/profile';
import { playSolo } from '../game/launch';

export function Solo(): JSX.Element {
  const p = profile.value;
  const best = p.bestTimeMs;
  const total = challengeSets().reduce((n, s) => n + s.challenges.length * 3, 0);
  return (
    <ScreenShell title="Solo" sub="Sharpen up on your own · offline" class="solo">
      <p class="solo-intro">No opponent, no pressure — the best way to learn how spin, pace and the cue ball really behave.</p>
      <div class="solo-grid">
        <button class="panel solo-card" style={{ '--glow': 'var(--mint)' }} onClick={() => playSolo('practice')}>
          <ModeArt mode="practice" size={64} />
          <h2>Practice</h2>
          <p>{modeDescriptor('practice').blurb}</p>
          <span class="solo-go">Open table →</span>
        </button>
        <button class="panel solo-card" style={{ '--glow': 'var(--gold)' }} onClick={() => playSolo('timeattack')}>
          <ModeArt mode="timeattack" size={64} />
          <h2>Time Attack</h2>
          <p>{modeDescriptor('timeattack').blurb}</p>
          <span class="solo-meta">
            {best !== null ? (
              <>
                Best <b class="tabular">{formatRunTime(best)}</b> · {'★'.repeat(timeAttackStars(best))}
              </>
            ) : (
              <>3 stars under {formatRunTime(TIME_ATTACK_PAR_MS[0])}</>
            )}
          </span>
        </button>
        <button class="panel solo-card" style={{ '--glow': 'var(--pink)' }} onClick={() => navigate('/tricks')}>
          <ModeArt mode="trickshot" size={64} />
          <h2>Trick Shots</h2>
          <p>{modeDescriptor('trickshot').blurb}</p>
          <span class="solo-meta">
            <b class="tabular">
              {totalTrickStars.value}/{total}
            </b>{' '}
            stars
          </span>
        </button>
      </div>
    </ScreenShell>
  );
}

export function Tricks(): JSX.Element {
  const stars = profile.value.trickStars;
  const sets = challengeSets();
  let unlocked = true;
  return (
    <ScreenShell title="Trick Shots" sub={`${totalTrickStars.value} stars earned — 30 unlocks the Void effect`} back="/solo" class="tricks">
      {sets.map((set) => (
        <section class="trick-set">
          <div class="section-title">
            <h3>{set.name}</h3>
          </div>
          <div class="trick-grid">
            {set.challenges.map((c) => {
              const s = stars[c.id] ?? 0;
              const open = unlocked;
              // Each puzzle opens once the one before it has at least one star.
              if (s === 0) unlocked = false;
              return (
                <button class={`panel trick-card ${open ? '' : 'is-locked'} ${s > 0 ? 'is-done' : ''}`} disabled={!open} onClick={() => playSolo('trickshot', c.id)}>
                  <span class="tc-name">{c.name}</span>
                  <span class="tc-brief">{c.brief}</span>
                  <span class="tc-stars">
                    {[1, 2, 3].map((k) => (
                      <span class={k <= s ? 'is-on' : ''}>★</span>
                    ))}
                  </span>
                  <span class="tc-limit">
                    {open ? <Pill>{c.shotLimit} shots</Pill> : <Pill icon="lock">Locked</Pill>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <div class="center" style={{ marginTop: '12px' }}>
        <Button kind="ghost" onClick={() => navigate('/solo')} icon="back" sound="back">
          Back to Solo
        </Button>
      </div>
    </ScreenShell>
  );
}
