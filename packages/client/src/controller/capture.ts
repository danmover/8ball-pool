/**
 * Pointer capture, as a convenience rather than a requirement.
 *
 * Capture keeps a drag tracking when the pointer wanders off the element it started on. Every
 * control here also listens for the release at the window, so losing capture costs nothing —
 * but `setPointerCapture` *throws* for a pointer the browser does not consider active, and an
 * exception thrown out of a pointerdown handler takes the rest of that handler with it. That
 * is a real way to lose a shot to a stray event.
 */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // No such active pointer. The drag still works without it.
  }
}
