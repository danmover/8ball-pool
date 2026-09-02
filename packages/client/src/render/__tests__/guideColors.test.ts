import { describe, expect, it } from 'vitest';
import {
  GUIDE_CONTACT,
  GUIDE_OBJECT,
  GUIDE_WARNING,
  guidePalette,
  isIllegalTarget,
} from '../guideColors';

/**
 * The guide knew which balls were legal all along — it rings them on the cloth — but never
 * said anything about the one you were aiming at, so lining up on the wrong ball looked
 * exactly like lining up on the right one and you found out afterwards.
 */
describe('warning that a shot is about to foul', () => {
  const legal = new Set([1, 2, 3]);

  it('says nothing when the target is legal', () => {
    expect(isIllegalTarget(2, legal)).toBe(false);
  });

  it('warns when it is not', () => {
    expect(isIllegalTarget(9, legal)).toBe(true);
  });

  it('says nothing when the line hits nothing at all', () => {
    expect(isIllegalTarget(null, legal)).toBe(false);
  });

  /*
   * The one that matters. An empty set means the question does not apply — before the break,
   * in sandbox, in any mode that does not restrict what you may strike. Read as "nothing is
   * legal" it would paint every shot as a foul, and a guide that cries foul constantly is
   * worse than one that never does, because you stop reading it.
   */
  it('says nothing when no restriction is in force', () => {
    expect(isIllegalTarget(9, new Set())).toBe(false);
    expect(isIllegalTarget(null, new Set())).toBe(false);
  });

  it('paints the contact and the object ball the same warning colour', () => {
    expect(guidePalette(true)).toEqual({ contact: GUIDE_WARNING, object: GUIDE_WARNING });
  });

  it('and keeps them distinct when the shot is fine', () => {
    const ok = guidePalette(false);
    expect(ok).toEqual({ contact: GUIDE_CONTACT, object: GUIDE_OBJECT });
    expect(ok.contact).not.toBe(ok.object);
  });
});
