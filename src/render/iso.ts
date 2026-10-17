/**
 * 2:1 isometric projection, Y-up.
 * +x runs down-right, +z runs down-left, +y runs up the screen.
 * The three visible faces of a cube are the top, the +z face (screen left),
 * and the +x face (screen right).
 */
export const TILE_WIDTH = 64;
export const TILE_DEPTH = 32;
export const BLOCK_HEIGHT = 32;

const HALF_WIDTH = TILE_WIDTH / 2;
const HALF_DEPTH = TILE_DEPTH / 2;

export interface IsoPoint {
  x: number;
  y: number;
}

export interface DepthPoint {
  x: number;
  y: number;
  z: number;
}

/** Project a world-space point to iso pixels at zoom 1, before the camera. */
export function worldToIso(x: number, y: number, z: number): IsoPoint {
  return {
    x: (x - z) * HALF_WIDTH,
    y: (x + z) * HALF_DEPTH - y * BLOCK_HEIGHT,
  };
}

/**
 * Inverse of {@link worldToIso} on the plane of constant world y.
 * Screen y grows downward, so this recovers the ground position at that height.
 */
export function isoToWorld(ix: number, iy: number, y: number): { x: number; z: number } {
  const hx = ix / HALF_WIDTH;
  const hz = (iy + y * BLOCK_HEIGHT) / HALF_DEPTH;
  return {
    x: (hx + hz) / 2,
    z: (hz - hx) / 2,
  };
}

/**
 * Painter's order. Negative when `a` is farther than `b` and must be drawn first.
 * Primary key is x+z (back of the iso view toward the front); y breaks ties
 * so a lower block is painted before the one stacked on it.
 */
export function compareBlockDepth(a: DepthPoint, b: DepthPoint): number {
  const sum = a.x + a.z - (b.x + b.z);
  if (sum !== 0) return sum;
  return a.y - b.y;
}
