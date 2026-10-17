/** Block ids. Air is 0 so a fresh chunk buffer is empty. */
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
/** Placeholder light source for M4. The generator does not place it. */
export const TORCH = 10;

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
