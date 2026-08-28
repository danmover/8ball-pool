/**
 * When the room behind the table needs repainting.
 *
 * Its own module because getting this wrong is expensive in two different directions, and this
 * project has now managed both:
 *
 *   * **Too coarse** and the room stays painted for the wrong layout. `chromeless` changes the
 *     fit from 0.8 to 1.0 at the *same* canvas size, so a key of theme-plus-canvas-size left a
 *     table footprint 25% too big — every prop off-screen and the rug stretched to the edges.
 *   * **Too fine** and it repaints constantly. Including the *camera's* scale meant easing the
 *     replay camera in redrew the whole room — floor, rug, furniture — on every frame of the
 *     move, several hundred full vector repaints for one replay.
 *
 * So the key takes the table's **resting** scale and nothing about where the camera happens to
 * be looking. The camera is a transform over a fixed picture; it is not a new picture.
 */
export function sceneCacheKey(
  themeId: string,
  canvasWidth: number,
  canvasHeight: number,
  /** The table's scale with the camera at rest — never the zoomed one. */
  baseScale: number
): string {
  return `${themeId}|${Math.round(canvasWidth)}x${Math.round(canvasHeight)}|${baseScale.toFixed(3)}`;
}
