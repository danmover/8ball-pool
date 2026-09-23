/**
 * The materials a table is built out of.
 *
 * Themes used to be seven flat lists of hex codes, which is why they read as *recolours* of one
 * table rather than as seven different tables. A real table is a small number of decisions —
 * what the cloth is, what the frame is cut from, what the fittings are plated in, what is
 * hanging over it — and each of those carries more than a colour: cloth has a weave and a nap,
 * wood has grain and varnish, metal has a highlight ramp that is the whole reason it reads as
 * metal at all.
 *
 * So the materials live here, one catalogue each, and a theme is a *choice* from each of them.
 * The presets in `tableThemes.ts` are then just four named choices apiece — and the Theme Studio
 * is the same four choices handed to the player. Neither one can produce a table the other
 * couldn't, which is the point: a custom table is a first-class table, not a lesser one.
 */

// ---------------------------------------------------------------- metal

/**
 * Plating for the fittings: diamond sights, pocket bezels, corner caps.
 *
 * Three stops rather than one colour, because metal is defined by how sharply it steps from
 * highlight to body to shadow. Brass ramps warm and wide; chrome ramps almost white to almost
 * black over a very short distance, which is exactly what makes it look polished.
 */
export interface Metal {
  id: string;
  name: string;
  /** Specular highlight — the lit edge. */
  light: string;
  /** Body colour. */
  mid: string;
  /** Shadowed underside. */
  dark: string;
  /** How tight the highlight is. High is polished, low is satin. */
  polish: number;
}

export const METALS: Metal[] = [
  { id: 'brass', name: 'Brass', light: '#ffe9a8', mid: '#d1a23c', dark: '#7a5610', polish: 0.6 },
  { id: 'chrome', name: 'Chrome', light: '#ffffff', mid: '#c9d4dc', dark: '#4a5560', polish: 0.95 },
  { id: 'gunmetal', name: 'Gunmetal', light: '#a8b2bc', mid: '#5a646e', dark: '#22282e', polish: 0.45 },
  { id: 'rosegold', name: 'Rose Gold', light: '#ffd9c9', mid: '#d98f72', dark: '#7d4530', polish: 0.65 },
  { id: 'copper', name: 'Copper', light: '#ffc79a', mid: '#b96a34', dark: '#5e2f13', polish: 0.5 },
  { id: 'pearl', name: 'Mother of Pearl', light: '#ffffff', mid: '#e6ecf2', dark: '#9aa8bb', polish: 0.8 },
  { id: 'obsidian', name: 'Black Nickel', light: '#6e7885', mid: '#2b3138', dark: '#0d0f12', polish: 0.7 },
  { id: 'neonchrome', name: 'Iridium', light: '#d8fffb', mid: '#59c6d6', dark: '#154650', polish: 0.9 },
];

const METAL_BY_ID = new Map(METALS.map((m) => [m.id, m]));

export function metalFor(id: string | undefined): Metal {
  return METAL_BY_ID.get(id ?? '') ?? METALS[0];
}

// ---------------------------------------------------------------- wood

/**
 * The frame stock.
 *
 * `grain` is how busy the figure is and `pore` how open the timber is — ash is stripey and
 * open, ebony is nearly featureless and closed. Those two numbers are what stop every wood
 * from being the same plank in a different colour.
 */
export interface Wood {
  id: string;
  name: string;
  rail: string;
  railDark: string;
  /** Figure strength, 0 plain .. 1 heavily figured. */
  grain: number;
  /** Open-pore speckle, 0 closed .. 1 open. */
  pore: number;
  /** Varnish, 0 oiled matte .. 1 mirror-gloss lacquer. */
  gloss: number;
}

export const WOODS: Wood[] = [
  { id: 'oak', name: 'Golden Oak', rail: '#c99a63', railDark: '#7d5533', grain: 0.6, pore: 0.7, gloss: 0.45 },
  { id: 'walnut', name: 'Walnut', rail: '#8a5a3b', railDark: '#402517', grain: 0.75, pore: 0.5, gloss: 0.6 },
  { id: 'mahogany', name: 'Mahogany', rail: '#8f4530', railDark: '#4a1d12', grain: 0.55, pore: 0.4, gloss: 0.8 },
  { id: 'ebony', name: 'Ebony', rail: '#2e2a28', railDark: '#121010', grain: 0.2, pore: 0.15, gloss: 0.9 },
  { id: 'maple', name: 'Bird’s-Eye Maple', rail: '#e0c193', railDark: '#a2794d', grain: 0.9, pore: 0.3, gloss: 0.55 },
  { id: 'rosewood', name: 'Rosewood', rail: '#7a3b2a', railDark: '#3a1710', grain: 0.85, pore: 0.45, gloss: 0.7 },
  { id: 'teak', name: 'Weathered Teak', rail: '#a8794a', railDark: '#5c3f22', grain: 0.5, pore: 0.85, gloss: 0.15 },
  { id: 'ash', name: 'Pale Ash', rail: '#d8cbb8', railDark: '#9a8874', grain: 0.7, pore: 0.75, gloss: 0.3 },
  { id: 'steel', name: 'Brushed Steel', rail: '#8f99a4', railDark: '#454e58', grain: 0.15, pore: 0.05, gloss: 0.85 },
  { id: 'carbon', name: 'Carbon Fibre', rail: '#33383f', railDark: '#15181c', grain: 0.1, pore: 0.05, gloss: 0.95 },
  { id: 'lacquer', name: 'Violet Lacquer', rail: '#3d2a5c', railDark: '#1b1030', grain: 0.1, pore: 0.05, gloss: 1 },
];

const WOOD_BY_ID = new Map(WOODS.map((w) => [w.id, w]));

export function woodFor(id: string | undefined): Wood {
  return WOOD_BY_ID.get(id ?? '') ?? WOODS[0];
}

// ---------------------------------------------------------------- cloth

/**
 * The cloth.
 *
 * `weave` is the thread pitch — worsted tournament cloth is tight and fast-looking, napped
 * bar cloth is coarse and woolly — and it is the single most convincing detail on the whole
 * table, because at any real zoom the cloth is most of what you are looking at.
 */
export interface Cloth {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Cushion face, a touch deeper than the bed. */
  cushion: string;
  /** Thread pitch in texture pixels. Small is tight worsted, large is coarse nap. */
  weave: number;
  /** How strongly the nap bands read across the bed. */
  nap: number;
}

export const CLOTHS: Cloth[] = [
  { id: 'tournament', name: 'Tournament Green', light: '#5fd88a', dark: '#28a85c', cushion: '#0d4d29', weave: 3, nap: 0.5 },
  { id: 'championship', name: 'Championship Blue', light: '#4fa8e8', dark: '#1a5a94', cushion: '#08203a', weave: 3, nap: 0.5 },
  { id: 'burgundy', name: 'Burgundy', light: '#e26070', dark: '#9e2436', cushion: '#420d17', weave: 4, nap: 0.6 },
  { id: 'sand', name: 'Desert Sand', light: '#e8c98f', dark: '#c19a5c', cushion: '#5c4420', weave: 5, nap: 0.7 },
  { id: 'plum', name: 'Royal Plum', light: '#a06ee0', dark: '#5a2f96', cushion: '#2a0f4d', weave: 3, nap: 0.45 },
  { id: 'emerald', name: 'Deep Emerald', light: '#2fbf7a', dark: '#0f7346', cushion: '#053a24', weave: 2, nap: 0.35 },
  { id: 'charcoal', name: 'Charcoal', light: '#4a5058', dark: '#252a30', cushion: '#12151a', weave: 3, nap: 0.4 },
  { id: 'champagne', name: 'Champagne', light: '#f0e0bd', dark: '#c9b083', cushion: '#6b5a35', weave: 4, nap: 0.55 },
  { id: 'glacier', name: 'Glacier', light: '#cfe9f5', dark: '#8fc4dd', cushion: '#2c5f7c', weave: 4, nap: 0.5 },
  { id: 'moss', name: 'Faded Moss', light: '#8a9c5e', dark: '#5c6b3a', cushion: '#232a12', weave: 6, nap: 0.8 },
  { id: 'voidcloth', name: 'Void', light: '#3d2f7a', dark: '#1a1040', cushion: '#0d0722', weave: 2, nap: 0.25 },
  { id: 'crimsonvelvet', name: 'Crimson Velvet', light: '#c0303f', dark: '#6d1220', cushion: '#37060e', weave: 5, nap: 0.85 },
  { id: 'ivory', name: 'Ivory', light: '#f5efe2', dark: '#d3c9b4', cushion: '#6e6555', weave: 3, nap: 0.45 },
  { id: 'teal', name: 'Peacock Teal', light: '#2fc4c0', dark: '#0f6b72', cushion: '#053238', weave: 3, nap: 0.4 },
];

const CLOTH_BY_ID = new Map(CLOTHS.map((c) => [c.id, c]));

export function clothFor(id: string | undefined): Cloth {
  return CLOTH_BY_ID.get(id ?? '') ?? CLOTHS[0];
}

// ---------------------------------------------------------------- lighting

/**
 * What is hanging over the table.
 *
 * This is the setting that changes a room the most for the least, because it drives both the
 * pool of light on the floor *and* the specular the cloth catches — the same table under a
 * warm pendant and under a cold spot genuinely does not look like the same table.
 */
export interface Lamp {
  id: string;
  name: string;
  /** Colour of the light itself. */
  color: string;
  /** How hard it falls off. High is a tight theatrical spot; low is a soft wash. */
  focus: number;
  /** Brightness of the specular on the cloth. */
  strength: number;
}

export const LAMPS: Lamp[] = [
  { id: 'pendant', name: 'Warm Pendant', color: '#ffd9a0', focus: 0.55, strength: 1 },
  { id: 'spot', name: 'Cold Spot', color: '#dff0ff', focus: 0.85, strength: 1.1 },
  { id: 'neon', name: 'Neon Tube', color: '#7cf5ff', focus: 0.35, strength: 1.25 },
  { id: 'candle', name: 'Candlelight', color: '#ffb066', focus: 0.4, strength: 0.7 },
  { id: 'daylight', name: 'Daylight', color: '#fff6e8', focus: 0.15, strength: 0.85 },
  { id: 'ultraviolet', name: 'Ultraviolet', color: '#b07cff', focus: 0.6, strength: 1.15 },
  { id: 'ember', name: 'Ember', color: '#ff7a4d', focus: 0.5, strength: 0.9 },
];

const LAMP_BY_ID = new Map(LAMPS.map((l) => [l.id, l]));

export function lampFor(id: string | undefined): Lamp {
  return LAMP_BY_ID.get(id ?? '') ?? LAMPS[0];
}

// ---------------------------------------------------------------- leather

/** Pocket leather. Two stops: the visible bezel and the throat behind it. */
export interface Leather {
  id: string;
  name: string;
  pocket: string;
  pocketDark: string;
}

export const LEATHERS: Leather[] = [
  { id: 'tan', name: 'Tan Hide', pocket: '#4a3524', pocketDark: '#140d07' },
  { id: 'oxblood', name: 'Oxblood', pocket: '#3d1a18', pocketDark: '#120505' },
  { id: 'black', name: 'Black Calf', pocket: '#22201f', pocketDark: '#070606' },
  { id: 'cognac', name: 'Cognac', pocket: '#6b4526', pocketDark: '#1f120a' },
  { id: 'slate', name: 'Slate Suede', pocket: '#3a4550', pocketDark: '#131a20' },
  { id: 'ivoryhide', name: 'Bone', pocket: '#b6a888', pocketDark: '#4a4235' },
];

const LEATHER_BY_ID = new Map(LEATHERS.map((l) => [l.id, l]));

export function leatherFor(id: string | undefined): Leather {
  return LEATHER_BY_ID.get(id ?? '') ?? LEATHERS[0];
}
