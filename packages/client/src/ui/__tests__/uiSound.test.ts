import { describe, expect, it } from 'vitest';
import { soundFor } from '../uiSound';

/*
 * These run without a DOM, so `closest` and `matches` are stood up by hand. It is a small
 * amount of scaffolding for the ability to test the actual rule — which is what decides
 * whether pressing Play sounds different from pressing Back, and whether the prize wheel ends
 * up ticking twice.
 */
interface FakeOpts {
  classes?: string[];
  id?: string;
  disabled?: boolean;
  ariaDisabled?: boolean;
  /** Ancestors, nearest first, as class names. */
  within?: string[];
  /** Not a button at all — a plain div, say. */
  notAControl?: boolean;
}

function el(o: FakeOpts = {}): Element {
  const classes = new Set(o.classes ?? []);
  const self = {
    hasAttribute: (n: string) => n === 'disabled' && !!o.disabled,
    getAttribute: (n: string) => (n === 'aria-disabled' && o.ariaDisabled ? 'true' : null),
    matches: (sel: string) =>
      sel
        .split(',')
        .map((s) => s.trim())
        .some((s) => {
          if (s.startsWith('#')) return o.id === s.slice(1);
          if (s.startsWith('[')) return classes.has(s);
          // Handles both `.a` and the compound `.a.b`.
          return s
            .split('.')
            .filter(Boolean)
            .every((c) => classes.has(c));
        }),
    closest: (sel: string): Element | null => {
      if (sel.includes('button')) return o.notAControl ? null : (self as Element);
      const wanted = sel.split(',').map((s) => s.trim().replace('.', ''));
      return (o.within ?? []).some((a) => wanted.includes(a)) ? (self as Element) : null;
    },
  };
  return self as unknown as Element;
}

describe('which sound a press makes', () => {
  it('says nothing for something that is not a control', () => {
    expect(soundFor(el({ notAControl: true }))).toBeNull();
    expect(soundFor(null)).toBeNull();
  });

  it('says nothing for a button that cannot be pressed', () => {
    expect(soundFor(el({ classes: ['mini'], disabled: true }))).toBeNull();
    expect(soundFor(el({ classes: ['mini'], ariaDisabled: true }))).toBeNull();
  });

  it('gives an ordinary button the ordinary click', () => {
    expect(soundFor(el({ classes: ['mini'] }))).toBe('click');
    expect(soundFor(el({ classes: ['secondary'] }))).toBe('click');
  });

  it('gives the presses that start a game something bigger', () => {
    expect(soundFor(el({ classes: ['btn-play'] }))).toBe('hero');
    expect(soundFor(el({ classes: ['btn-start'] }))).toBe('hero');
    expect(soundFor(el({ classes: ['btn-join'] }))).toBe('hero');
    expect(soundFor(el({ classes: ['format-card'] }))).toBe('hero');
  });

  it('gives going back a falling one', () => {
    expect(soundFor(el({ classes: ['icon-btn', 'back-btn'] }))).toBe('back');
    expect(soundFor(el({ classes: ['icon-btn', 'danger'] }))).toBe('back');
    expect(soundFor(el({ id: 'closeSettings', classes: ['icon-btn'] }))).toBe('back');
  });

  it('does not double up on things that already make their own noise', () => {
    // The wheel ratchets as it spins, and the shot deck belongs to the table's soundscape.
    expect(soundFor(el({ classes: ['mini'], within: ['wheel-card'] }))).toBeNull();
    expect(soundFor(el({ classes: ['spin-preset'], within: ['shot-deck'] }))).toBeNull();
    expect(soundFor(el({ classes: ['emote-btn'], within: ['emote-bar'] }))).toBeNull();
    expect(soundFor(el({ classes: ['mini'], within: ['case-overlay'] }))).toBeNull();
  });

  it('keeps a plain icon button ordinary', () => {
    // Only the *danger* icon button is a going-back sound; the rest are presses.
    expect(soundFor(el({ classes: ['icon-btn'] }))).toBe('click');
  });
});
