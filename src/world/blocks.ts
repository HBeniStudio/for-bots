/** Block ids. Air is 0 so a fresh chunk buffer is empty. */
export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;

export interface FaceColors {
  top: string;
  /** Screen-left face, the block's +z side. */
  left: string;
  /** Screen-right face, the block's +x side. */
  right: string;
}

/** Top is brightest; left and right are successively darker. Index by block id. */
export const FACE_COLORS: readonly (FaceColors | null)[] = [
  null,
  { top: '#63b33b', left: '#8a6239', right: '#6d4c2c' },
  { top: '#8d633b', left: '#74522f', right: '#5c4124' },
  { top: '#b0b0b0', left: '#8d8d8d', right: '#6e6e6e' },
];

export function isAir(id: number): boolean {
  return id === AIR;
}
