import { AIR } from './blocks';

/** Chunk footprint: 16 × 16 × 64 (x, z, y). World is Y-up. */
export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 64;

export function blockIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_X + y * CHUNK_X * CHUNK_Z;
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
  /** Highest local y that holds a non-air block, or -1 when the chunk is empty. */
  private maxSolidY = -1;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_X * CHUNK_Z * CHUNK_Y);
  }

  get maxY(): number {
    return this.maxSolidY;
  }

  get(x: number, y: number, z: number): number {
    if (!inChunkBounds(x, y, z)) return AIR;
    return this.blocks[blockIndex(x, y, z)]!;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!inChunkBounds(x, y, z)) return;
    this.blocks[blockIndex(x, y, z)] = id;
    if (id !== AIR) {
      if (y > this.maxSolidY) this.maxSolidY = y;
    } else if (y === this.maxSolidY) {
      this.maxSolidY = this.scanMaxSolidY();
    }
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
