import { AIR } from './blocks';

/** Chunk footprint: 16 × 16 × 64 (x, z, y). World is Y-up. */
export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 64;

export function blockIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_X + y * CHUNK_X * CHUNK_Z;
}

function clampNibble(level: number): number {
  if (level <= 0) return 0;
  if (level >= 15) return 15;
  return level;
}

export function inChunkBounds(x: number, y: number, z: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(z) &&
    x >= 0 &&
    x < CHUNK_X &&
    z >= 0 &&
    z < CHUNK_Z &&
    y >= 0 &&
    y < CHUNK_Y
  );
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /**
   * Per-block light, one byte per cell. The high nibble is sunlight and the
   * low nibble is block light (torches). Each nibble is a level 0–15.
   */
  readonly light: Uint8Array;
  /** Highest local y that holds a non-air block, or -1 when the chunk is empty. */
  private maxSolidY = -1;
  /**
   * Bumps when a block in this chunk changes. The renderer caches meshes
   * against this value. Starts at 1 so a fresh chunk is not confused with 0.
   */
  geom = 1;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    const count = CHUNK_X * CHUNK_Z * CHUNK_Y;
    this.blocks = new Uint8Array(count);
    this.light = new Uint8Array(count);
  }

  get maxY(): number {
    return this.maxSolidY;
  }

  /** Mark cached render data stale without changing blocks. */
  touch(): void {
    this.geom += 1;
  }

  get(x: number, y: number, z: number): number {
    if (!inChunkBounds(x, y, z)) return AIR;
    return this.blocks[blockIndex(x, y, z)]!;
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (!inChunkBounds(x, y, z)) return 0;
    return this.light[blockIndex(x, y, z)]! >> 4;
  }

  setSkyLight(x: number, y: number, z: number, level: number): void {
    if (!inChunkBounds(x, y, z)) return;
    const i = blockIndex(x, y, z);
    this.light[i] = (clampNibble(level) << 4) | (this.light[i]! & 0x0f);
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (!inChunkBounds(x, y, z)) return 0;
    return this.light[blockIndex(x, y, z)]! & 0x0f;
  }

  setBlockLight(x: number, y: number, z: number, level: number): void {
    if (!inChunkBounds(x, y, z)) return;
    const i = blockIndex(x, y, z);
    this.light[i] = (this.light[i]! & 0xf0) | clampNibble(level);
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!inChunkBounds(x, y, z)) return;
    this.blocks[blockIndex(x, y, z)] = id;
    if (id !== AIR) {
      if (y > this.maxSolidY) this.maxSolidY = y;
    } else if (y === this.maxSolidY) {
      this.maxSolidY = this.scanMaxSolidY();
    }
    this.touch();
  }

  private scanMaxSolidY(): number {
    const stride = CHUNK_X * CHUNK_Z;
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      const base = y * stride;
      for (let i = 0; i < stride; i++) {
        if (this.blocks[base + i] !== AIR) return y;
      }
    }
    return -1;
  }
}
