import { describe, expect, it } from 'vitest';
import { TABLE_THEME_IDS } from '@8ball/shared';
import { TABLE_THEMES, tableThemeFor } from '../cosmetics/tableThemes';

/**
 * The career ladder sends opponents to named venues, but the venues themselves are drawn on the
 * client. `TABLE_THEME_IDS` in shared is the agreed vocabulary between the two, and this is the
 * half that checks it still matches reality — otherwise a renamed theme would quietly turn a
 * career match into a fallback table nobody chose.
 */
describe('table themes match the shared venue ids', () => {
  it('covers every id the career ladder can name', () => {
    const drawn = new Set(TABLE_THEMES.map((t) => t.id));
    for (const id of TABLE_THEME_IDS) {
      expect(drawn.has(id), `no table theme is drawn for venue "${id}"`).toBe(true);
    }
  });

  it('does not have themes the shared list has never heard of', () => {
    const known = new Set<string>(TABLE_THEME_IDS);
    for (const theme of TABLE_THEMES) {
      expect(known.has(theme.id), `theme "${theme.id}" is missing from TABLE_THEME_IDS`).toBe(true);
    }
  });

  it('falls back to a real theme for an unknown id', () => {
    expect(tableThemeFor('nonsense').id).toBe(TABLE_THEMES[0].id);
    expect(tableThemeFor(undefined).id).toBe(TABLE_THEMES[0].id);
  });
});
