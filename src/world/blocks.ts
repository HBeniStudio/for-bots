/**
 * Stable block ids. Air is 0 so a fresh chunk buffer is empty.
 * Content JSON references these names or numbers. Do not renumber them.
 */
export const BLOCK_IDS = Object.freeze({
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  water: 5,
  snow: 6,
  log: 7,
  leaves: 8,
  gravel: 9,
  torch: 10,
} as const);

export type BlockName = keyof typeof BLOCK_IDS;

export const AIR = BLOCK_IDS.air;
export const GRASS = BLOCK_IDS.grass;
export const DIRT = BLOCK_IDS.dirt;
export const STONE = BLOCK_IDS.stone;
export const SAND = BLOCK_IDS.sand;
export const WATER = BLOCK_IDS.water;
export const SNOW = BLOCK_IDS.snow;
/** Wood log. */
export const LOG = BLOCK_IDS.log;
export const LEAVES = BLOCK_IDS.leaves;
export const GRAVEL = BLOCK_IDS.gravel;
/** Placeholder light source for M4. The generator does not place it. */
export const TORCH = BLOCK_IDS.torch;

/**
 * Inclusive per-block light scale. 0 is unlit, 15 is full sunlight.
 * Content spawn rules use the same integers.
 */
export const LIGHT_SCALE = Object.freeze({ min: 0, max: 15 } as const);
export const LIGHT_MIN = LIGHT_SCALE.min;
export const LIGHT_MAX = LIGHT_SCALE.max;

export interface FaceColors {
  top: string;
  /** Screen-left face, the block's +z side. */
  left: string;
  /** Screen-right face, the block's +x side. */
  right: string;
}

/** Top is brightest; left and right are successively darker. Index by block id. */
const colors: (FaceColors | null)[] = [];
colors[GRASS] = { top: '#63b33b', left: '#8a6239', right: '#6d4c2c' };
colors[DIRT] = { top: '#8d633b', left: '#74522f', right: '#5c4124' };
colors[STONE] = { top: '#b0b0b0', left: '#8d8d8d', right: '#6e6e6e' };
colors[SAND] = { top: '#e4d29a', left: '#cbb678', right: '#b79d62' };
colors[WATER] = { top: '#4a90d9', left: '#3a78c0', right: '#2d62a8' };
colors[SNOW] = { top: '#f7fbff', left: '#d9e2ea', right: '#c5d0da' };
colors[LOG] = { top: '#a88455', left: '#6b4e32', right: '#543c26' };
colors[LEAVES] = { top: '#4f9d3a', left: '#3d7c2d', right: '#2f6322' };
colors[GRAVEL] = { top: '#a39e96', left: '#857f78', right: '#6c6761' };
colors[TORCH] = { top: '#ffe38a', left: '#f0a03a', right: '#d4781c' };

export const FACE_COLORS: readonly (FaceColors | null)[] = colors;

export function isAir(id: number): boolean {
  return id === AIR;
}
