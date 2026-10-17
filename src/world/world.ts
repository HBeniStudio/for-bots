import { AIR } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, Chunk } from './chunk';

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

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.byKey.get(chunkKey(cx, cz));
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
