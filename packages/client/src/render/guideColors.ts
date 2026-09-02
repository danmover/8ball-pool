/**
 * What colour the aim guide should be.
 *
 * Pulled out of `TableRenderer` so it can be tested as a decision rather than as pixels. The
 * renderer draws it; whether a shot is about to be a foul is a question with a right answer,
 * and it should not need a screenshot to check.
 */

/** The guide's ordinary colours: white to the contact, amber for the ball you send away. */
export const GUIDE_CONTACT = 0xffffff;
export const GUIDE_OBJECT = 0xffe27a;
/** Both turn this when the ball you are about to strike is not one you may play. */
export const GUIDE_WARNING = 0xff4d6d;

/**
 * Is this shot about to hit a ball it should not?
 *
 * `legalTargets` empty means the question does not apply — before the break, in sandbox, or
 * in any mode that does not restrict what you may strike. Treating an empty set as "nothing is
 * legal" would paint every shot as a foul, which is the failure mode worth naming: the guide
 * saying "foul" constantly is worse than a guide that never says it, because you stop reading.
 */
export function isIllegalTarget(
  firstContactBallId: number | null,
  legalTargets: ReadonlySet<number>
): boolean {
  if (firstContactBallId === null) return false;
  if (legalTargets.size === 0) return false;
  return !legalTargets.has(firstContactBallId);
}

/** The pair of colours to draw a guide in, given whether it is heading somewhere illegal. */
export function guidePalette(illegal: boolean): { contact: number; object: number } {
  return illegal
    ? { contact: GUIDE_WARNING, object: GUIDE_WARNING }
    : { contact: GUIDE_CONTACT, object: GUIDE_OBJECT };
}
