/**
 * The Theme Studio: build your own table.
 *
 * The picker answers "which of these eleven?", which is the wrong question to have as the only
 * one on offer — the reason people care about the cloth under their game is that it is *theirs*,
 * and eleven fixed answers cannot be. So the same five material choices the presets are
 * assembled from are handed over directly: cloth, frame stock, fittings, pocket leather, and
 * what is hanging over the table.
 *
 * Two things make it worth using rather than a novelty. The preview is the real thing — the same
 * `drawTablePreview` the picker swatches use, driven by the same theme object the Pixi renderer
 * will be handed the moment you save, so there is no gap between what you designed and what you
 * sit down at. And every swatch in every row is drawn *as it would look on your current table*,
 * so choosing a wood shows you that wood against your cloth under your light, rather than
 * against a neutral card that tells you nothing.
 */

import {
  CLOTHS,
  LAMPS,
  LEATHERS,
  METALS,
  WOODS,
} from '../render/cosmetics/materials';
import {
  deleteCustomTable,
  loadCustomTables,
  newCustomId,
  themeFromSpec,
  upsertCustomTable,
  type TableSpec,
} from '../render/cosmetics/tableThemes';
import { drawTablePreview } from '../render/tablePreview';
import { modalBehaviour } from '../render/dialogs';
import { icon } from '../render/icons';

/** The table you get before you have touched anything: the house's own. */
const STARTING_SPEC: TableSpec = {
  cloth: 'tournament',
  wood: 'oak',
  metal: 'brass',
  leather: 'tan',
  lamp: 'pendant',
  markings: true,
};

interface Row {
  key: keyof TableSpec;
  label: string;
  hint: string;
  items: { id: string; name: string }[];
}

const ROWS: Row[] = [
  { key: 'cloth', label: 'Cloth', hint: 'Colour, weave and nap of the bed', items: CLOTHS },
  { key: 'wood', label: 'Frame', hint: 'The stock the rails are cut from', items: WOODS },
  { key: 'metal', label: 'Fittings', hint: 'Sights and pocket bezels', items: METALS },
  { key: 'leather', label: 'Pockets', hint: 'The leather on the bags', items: LEATHERS },
  { key: 'lamp', label: 'Lighting', hint: 'What is hanging over the table', items: LAMPS },
];

export interface StudioResult {
  /** The theme id to switch to, or null if nothing was saved. */
  themeId: string | null;
}

/**
 * Opens the studio.
 *
 * @param editing  id of a saved table to load, or undefined to start a new one.
 * @param onPreview called on every change with a live theme id, so the table behind the modal
 *                  can follow along. Called with the original id again if the studio is closed
 *                  without saving.
 */
export function openThemeStudio(
  editing: string | undefined,
  onDone: (result: StudioResult) => void
): void {
  const saved = editing ? loadCustomTables().find((t) => t.id === editing) : undefined;
  const spec: TableSpec = { ...(saved ? saved.spec : STARTING_SPEC) };
  let name = saved ? saved.name : 'My Table';
  const id = saved ? saved.id : newCustomId();

  const scrim = document.createElement('div');
  scrim.className = 'dialog-scrim studio-scrim';
  scrim.innerHTML = `
    <div class="dialog studio">
      <header class="studio-head">
        <h2>${icon('settings', { size: 20 })} Theme Studio</h2>
        <button class="icon-btn" id="studioClose" title="Close">${icon('close', { size: 18 })}</button>
      </header>

      <div class="studio-stage">
        <canvas class="studio-preview" id="studioPreview"></canvas>
        <div class="studio-caption">
          <input id="studioName" class="studio-name" maxlength="22" value="" spellcheck="false" />
          <div class="studio-recipe" id="studioRecipe"></div>
        </div>
      </div>

      <div class="studio-rows" id="studioRows"></div>

      <footer class="studio-foot">
        <label class="studio-check" id="studioMarkings">
          <span class="studio-box"></span>
          <span>Painted markings</span>
        </label>
        <div class="studio-actions">
          ${saved ? `<button class="mini secondary danger" id="studioDelete">Delete</button>` : ''}
          <button class="mini secondary" id="studioCancel">Cancel</button>
          <button class="mini" id="studioSave">Save &amp; use</button>
        </div>
      </footer>
    </div>`;
  document.body.appendChild(scrim);
  // Next frame, so the scrim's fade and the dialog's pop have a starting state to animate from.
  // Without it the dialog is in the document at `opacity: 0` and never comes back — present,
  // focusable, and completely invisible.
  requestAnimationFrame(() => scrim.classList.add('open'));

  const dialog = scrim.querySelector<HTMLElement>('.studio')!;
  const preview = scrim.querySelector<HTMLCanvasElement>('#studioPreview')!;
  const rowsEl = scrim.querySelector<HTMLElement>('#studioRows')!;
  const recipeEl = scrim.querySelector<HTMLElement>('#studioRecipe')!;
  const nameEl = scrim.querySelector<HTMLInputElement>('#studioName')!;
  const markingsEl = scrim.querySelector<HTMLElement>('#studioMarkings')!;
  nameEl.value = name;

  let settled = false;
  const finish = (themeId: string | null): void => {
    if (settled) return;
    settled = true;
    onDone({ themeId });
  };

  const close = modalBehaviour(scrim, dialog, 'Theme Studio', () => finish(null));

  const theme = () => themeFromSpec(id, name, spec);

  /**
   * Swatches are miniature tables rather than colour chips.
   *
   * A chip of walnut tells you the colour of walnut. What you actually want to know is what
   * *this* table looks like made of walnut, which is a different question and the only one
   * worth answering — the cloth, the light and the fittings all change how a wood reads.
   */
  function paintSwatches(): void {
    for (const row of ROWS) {
      for (const item of row.items) {
        const canvas = rowsEl.querySelector<HTMLCanvasElement>(
          `canvas[data-row="${row.key}"][data-id="${item.id}"]`
        );
        if (!canvas) continue;
        drawTablePreview(canvas, themeFromSpec(id, name, { ...spec, [row.key]: item.id }), {
          room: false,
          pad: 0.04,
        });
      }
    }
  }

  function paint(): void {
    const t = theme();
    drawTablePreview(preview, t);
    recipeEl.textContent = [
      t.metal.name,
      LAMPS.find((l) => l.id === spec.lamp)?.name ?? '',
      WOODS.find((w) => w.id === spec.wood)?.name ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    markingsEl.classList.toggle('on', spec.markings);
    rowsEl.querySelectorAll<HTMLElement>('.studio-swatch').forEach((el) => {
      el.classList.toggle('active', spec[el.dataset.row as keyof TableSpec] === el.dataset.id);
    });
    paintSwatches();
  }

  rowsEl.innerHTML = ROWS.map(
    (row) => `
    <section class="studio-row">
      <div class="studio-row-head">
        <span class="studio-row-label">${row.label}</span>
        <span class="studio-row-hint">${row.hint}</span>
      </div>
      <div class="studio-strip" role="radiogroup" aria-label="${row.label}">
        ${row.items
          .map(
            (item) => `
          <button class="studio-swatch" data-row="${row.key}" data-id="${item.id}" title="${item.name}" role="radio">
            <canvas data-row="${row.key}" data-id="${item.id}" width="120" height="60"></canvas>
            <span>${item.name}</span>
          </button>`
          )
          .join('')}
      </div>
    </section>`
  ).join('');

  rowsEl.querySelectorAll<HTMLButtonElement>('.studio-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.row as keyof TableSpec;
      (spec as unknown as Record<string, unknown>)[key] = btn.dataset.id!;
      paint();
    });
  });

  markingsEl.addEventListener('click', () => {
    spec.markings = !spec.markings;
    paint();
  });

  nameEl.addEventListener('input', () => {
    name = nameEl.value.trim() || 'My Table';
  });

  scrim.querySelector('#studioSave')!.addEventListener('click', () => {
    upsertCustomTable({ id, name: nameEl.value.trim() || 'My Table', spec });
    finish(id);
    close();
  });

  scrim.querySelector('#studioCancel')!.addEventListener('click', close);
  scrim.querySelector('#studioClose')!.addEventListener('click', close);
  scrim.querySelector('#studioDelete')?.addEventListener('click', () => {
    deleteCustomTable(id);
    // Falls back to the house table rather than to whatever this one was, which no longer exists.
    finish('classic');
    close();
  });

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });

  // Canvases need to be in the document and laid out before they have a size to draw into.
  requestAnimationFrame(() => {
    paint();
    nameEl.focus();
    nameEl.select();
  });

  /*
   * Repaint whenever the canvas's box changes, not merely when the window does.
   *
   * A canvas is rasterised for the size it had when it was drawn. The stage is a flex item, so
   * its height can settle *after* the first paint — a scrollbar appearing, a font landing — and
   * the table then sits in a box a few pixels shorter than the one it was drawn for, with its
   * bottom rail sliced off. Watching the element rather than the window is the only version of
   * this that cannot be got wrong.
   */
  const observer = new ResizeObserver(() => drawTablePreview(preview, theme()));
  observer.observe(preview);
  const cleanup = new MutationObserver(() => {
    if (!document.body.contains(scrim)) {
      observer.disconnect();
      cleanup.disconnect();
    }
  });
  cleanup.observe(document.body, { childList: true });
}
