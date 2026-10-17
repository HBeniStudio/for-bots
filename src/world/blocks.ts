/** Block ids. Air is 0 so a fresh chunk buffer is empty. Do not renumber these. */
export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const WATER = 5;
export const SNOW = 6;
/** Wood log. */
export const LOG = 7;
export const LEAVES = 8;
export const GRAVEL = 9;
/** Light source. The generator does not place it. */
export const TORCH = 10;
/** Light level stored on a torch. Neighbors fall off by 1 per block. */
export const TORCH_LIGHT = 14;

/**
 * Stable names for the block ids above. Content JSON may use the name or the
 * number. The numeric values are the constants in this file.
 */
export const BLOCK_IDS = Object.freeze({
  air: AIR,
  grass: GRASS,
  dirt: DIRT,
  stone: STONE,
  sand: SAND,
  water: WATER,
  snow: SNOW,
  log: LOG,
  leaves: LEAVES,
  gravel: GRAVEL,
  torch: TORCH,
} as const);

export type BlockName = keyof typeof BLOCK_IDS;

/**
 * Inclusive per-block light scale. 0 is unlit, 15 is full sunlight.
 * Content spawn rules use the same integers.
 */
export const LIGHT_MIN = 0;
export const LIGHT_MAX = 15;
export const LIGHT_SCALE = Object.freeze({ min: LIGHT_MIN, max: LIGHT_MAX } as const);

/** Light a block emits, from {@link LIGHT_MIN} to {@link LIGHT_MAX}. Only torches emit. */
export function lightEmission(id: number): number {
  return id === TORCH ? TORCH_LIGHT : 0;
}

/**
 * How much vertical sunlight this block absorbs.
 * 0 is clear, so a skylit air column stays at 15. 15 is opaque.
 * Water and leaves sit in between and filter the column.
 */
export function lightOpacity(id: number): number {
  if (id === AIR || id === TORCH) return 0;
  if (id === LEAVES) return 1;
  if (id === WATER) return 2;
  return LIGHT_MAX;
}

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
