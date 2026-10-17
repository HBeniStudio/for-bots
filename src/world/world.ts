import { AIR } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, Chunk } from './chunk';
import { fillChunk } from './gen/terrain';

export interface ChunkCoord {
  cx: number;
  cz: number;
  lx: number;
  lz: number;
}

/**
 * Map a world x/z position into chunk coordinates and the offset inside that chunk.
 * Uses floor division so negative world coordinates stay contiguous:
 * world -1 → chunk -1, local 15.
 */
export function worldToChunk(wx: number, wz: number): ChunkCoord {
  const cx = Math.floor(wx / CHUNK_X);
  const cz = Math.floor(wz / CHUNK_Z);
  return {
    cx,
    cz,
    lx: wx - cx * CHUNK_X,
    lz: wz - cz * CHUNK_Z,
  };
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class World {
  private readonly byKey = new Map<string, Chunk>();
  /** Chunks whose terrain has been written. Hand-built chunks are not in here. */
  private readonly generated = new Set<string>();

  constructor(readonly seed = 0) {}

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.byKey.get(chunkKey(cx, cz));
  }

  /**
   * Generate one chunk from the world seed. A second call is a no-op, so
   * neighbor order cannot change the blocks.
   */
  generateChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const chunk = this.ensureChunk(cx, cz);
    if (this.generated.has(key)) return chunk;
    fillChunk(chunk, this.seed);
    this.generated.add(key);
    return chunk;
  }

  /**
   * Generate missing chunks within `radius` (Chebyshev) of the focus, closest
   * first, at most `budget` new chunks. Returns how many were built. Callers
   * spread a large view across frames so generation does not stall the loop.
   */
  generateAround(focusX: number, focusZ: number, radius: number, budget: number): number {
    if (budget <= 0 || radius < 0) return 0;
    const center = worldToChunk(Math.floor(focusX), Math.floor(focusZ));
    const pending: { cx: number; cz: number; d: number }[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        if (this.generated.has(chunkKey(cx, cz))) continue;
        pending.push({ cx, cz, d: dx * dx + dz * dz });
      }
    }
    pending.sort((a, b) => a.d - b.d || a.cx - b.cx || a.cz - b.cz);
    const count = Math.min(budget, pending.length);
    for (let i = 0; i < count; i++) {
      const next = pending[i]!;
      this.generateChunk(next.cx, next.cz);
    }
    return count;
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let chunk = this.byKey.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.byKey.set(key, chunk);
    }
    return chunk;
  }

  loadedChunks(): Chunk[] {
    return [...this.byKey.values()];
  }

  getBlock(x: number, y: number, z: number): number {
    const by = Math.floor(y);
    if (by < 0 || by >= CHUNK_Y) return AIR;
    const { cx, cz, lx, lz } = worldToChunk(Math.floor(x), Math.floor(z));
    const chunk = this.byKey.get(chunkKey(cx, cz));
    if (!chunk) return AIR;
    return chunk.get(lx, by, lz);
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    if (by < 0 || by >= CHUNK_Y) return;
    const { cx, cz, lx, lz } = worldToChunk(bx, bz);
    this.ensureChunk(cx, cz).set(lx, by, lz, id);
  }
}
