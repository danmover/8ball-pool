import type { ComponentChildren, JSX } from 'preact';
import { signal } from '@preact/signals';
import { Coins, IconButton } from '../ui/kit';
import { navigate } from './router';
import { profile } from '../state/profile';

export const settingsOpen = signal(false);

/** The frame every menu screen sits in: the room, a top bar, and scrolling content. */
export function ScreenShell({
  title,
  sub,
  back = '/',
  right,
  children,
  class: cls,
}: {
  title: ComponentChildren;
  sub?: ComponentChildren;
  back?: string;
  right?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}): JSX.Element {
  return (
    <div class={`screen ${cls ?? ''}`}>
      <div class="room-bg" />
      <header class="topbar">
        <IconButton icon="back" label="Back" onClick={() => navigate(back)} sound="back" />
        <div class="topbar-title">
          <h1>{title}</h1>
          {sub && <span class="topbar-sub">{sub}</span>}
        </div>
        <div class="topbar-right">
          {right ?? (
            <span class="chip">
              <Coins amount={profile.value.coins} />
            </span>
          )}
        </div>
      </header>
      <main class="screen-main scroll">{children}</main>
    </div>
  );
}
