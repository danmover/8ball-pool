import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setBusy, runBusy, runBusyWithTimeout } from '../busy';

/*
 * The double-press this exists to stop is the one that hosts two rooms: press "Play" on the
 * career page, see nothing happen because nothing was ever shown, press again.
 */

/** Enough of a button for the helper — the tests run without a DOM. */
function fakeButton(): HTMLButtonElement {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  return {
    disabled: false,
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  } as unknown as HTMLButtonElement;
}

const isBusy = (b: HTMLButtonElement): boolean =>
  b.classList.contains('is-busy') && b.disabled && b.getAttribute('aria-busy') === 'true';

describe('showing that a button is working', () => {
  it('marks and unmarks', () => {
    const b = fakeButton();
    setBusy(b, true);
    expect(isBusy(b)).toBe(true);
    setBusy(b, false);
    expect(b.classList.contains('is-busy')).toBe(false);
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-busy')).toBe('false');
  });

  it('holds the button until the action says it is done', () => {
    const b = fakeButton();
    let finish = (): void => {};
    runBusy(b, (done) => {
      finish = done;
    });
    expect(isBusy(b)).toBe(true);
    finish();
    expect(isBusy(b)).toBe(false);
  });

  it('refuses a second press while the first is still going', () => {
    const b = fakeButton();
    const action = vi.fn();
    expect(runBusy(b, action)).toBe(true);
    expect(runBusy(b, action)).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not come unstuck if the action finishes twice', () => {
    // A socket callback firing twice, or a success path that also runs a cleanup.
    const b = fakeButton();
    let finish = (): void => {};
    runBusy(b, (done) => {
      finish = done;
    });
    finish();
    finish();
    expect(b.disabled).toBe(false);
  });

  it('releases the button when the action throws rather than leaving it spinning', () => {
    const b = fakeButton();
    expect(() =>
      runBusy(b, () => {
        throw new Error('socket is gone');
      })
    ).toThrow('socket is gone');
    expect(isBusy(b)).toBe(false);
  });
});

describe('when the server never answers', () => {
  beforeEach(() => vi.useFakeTimers());

  it('gives the button back, and says so', () => {
    const b = fakeButton();
    const onTimeout = vi.fn();
    runBusyWithTimeout(b, () => {}, onTimeout, 1000);
    expect(isBusy(b)).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(isBusy(b)).toBe(false);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('ignores a reply that turns up after the deadline', () => {
    // Otherwise a late callback un-busies a button somebody has since pressed again.
    const b = fakeButton();
    const onTimeout = vi.fn();
    let reply = (): void => {};
    runBusyWithTimeout(b, (done) => (reply = done), onTimeout, 1000);
    vi.advanceTimersByTime(1001);

    setBusy(b, true);
    reply();
    expect(isBusy(b)).toBe(true);
  });

  it('does not fire the deadline once the reply has landed', () => {
    const b = fakeButton();
    const onTimeout = vi.fn();
    let reply = (): void => {};
    runBusyWithTimeout(b, (done) => (reply = done), onTimeout, 1000);
    reply();
    expect(isBusy(b)).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
