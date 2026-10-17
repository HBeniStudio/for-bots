import { AIR } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, Chunk } from './chunk';
import { fillChunk } from './gen/terrain';
import { lightChunk, refreshLighting } from './light';

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
  /** Set when `generateAround` has nothing left at this center and radius. */
  private fullRing = '';
  private readonly relight: { cx: number; cz: number }[] = [];
  /** Bumps on player edits so the renderer can refresh immediately. */
  editSerial = 0;

  constructor(readonly seed = 0) {}

  get chunkCount(): number {
    return this.byKey.size;
  }

  forEachChunk(fn: (chunk: Chunk) => void): void {
    for (const chunk of this.byKey.values()) fn(chunk);
  }

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
    lightChunk(this, cx, cz);
    this.touchFacing(cx, cz);
    this.fullRing = '';
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
    const token = `${center.cx},${center.cz},${radius}`;
    if (this.fullRing === token) return 0;
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
    if (count === pending.length) this.fullRing = token;
    return count;
  }

  /**
   * Forget chunks farther than `radius` (Chebyshev) from the focus.
   * `keep` retains edited chunks so a later visit regenerates them from the
   * diff instead of the bare seed. Returns how many were dropped.
   */
  unloadBeyond(focusX: number, focusZ: number, radius: number, keep: (cx: number, cz: number) => boolean): number {
    if (radius < 0) return 0;
    const center = worldToChunk(Math.floor(focusX), Math.floor(focusZ));
    const drop: Chunk[] = [];
    for (const chunk of this.byKey.values()) {
      const dist = Math.max(Math.abs(chunk.cx - center.cx), Math.abs(chunk.cz - center.cz));
      if (dist <= radius) continue;
      if (keep(chunk.cx, chunk.cz)) continue;
      drop.push(chunk);
    }
    if (drop.length === 0) return 0;
    for (const chunk of drop) {
      const glow = hasBlockLight(chunk);
      this.byKey.delete(chunkKey(chunk.cx, chunk.cz));
      this.generated.delete(chunkKey(chunk.cx, chunk.cz));
      this.touchFacing(chunk.cx, chunk.cz);
      if (glow) {
        this.queueRelight(chunk.cx - 1, chunk.cz);
        this.queueRelight(chunk.cx + 1, chunk.cz);
        this.queueRelight(chunk.cx, chunk.cz - 1);
        this.queueRelight(chunk.cx, chunk.cz + 1);
      }
    }
    this.fullRing = '';
    return drop.length;
  }

  /** Rebuild lighting for one chunk queued by an unload. At most one per call. */
  serviceRelight(): boolean {
    while (this.relight.length > 0) {
      const job = this.relight.pop()!;
      if (!this.generated.has(chunkKey(job.cx, job.cz))) continue;
      lightChunk(this, job.cx, job.cz);
      this.getChunk(job.cx, job.cz)?.touch();
      return true;
    }
    return false;
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
    const chunk = this.ensureChunk(cx, cz);
    const previous = chunk.get(lx, by, lz);
    if (previous === id) return;
    chunk.set(lx, by, lz, id);
    if (lx === 0) this.getChunk(cx - 1, cz)?.touch();
    if (lz === 0) this.getChunk(cx, cz - 1)?.touch();
    refreshLighting(this, bx, by, bz, previous, id);
    this.editSerial += 1;
  }

  /** Chunks whose +x or +z face looks into (cx, cz). */
  private touchFacing(cx: number, cz: number): void {
    this.getChunk(cx - 1, cz)?.touch();
    this.getChunk(cx, cz - 1)?.touch();
  }

  private queueRelight(cx: number, cz: number): void {
    if (!this.generated.has(chunkKey(cx, cz))) return;
    this.relight.push({ cx, cz });
  }
}

function hasBlockLight(chunk: Chunk): boolean {
  const light = chunk.light;
  for (let i = 0; i < light.length; i++) {
    if ((light[i]! & 0x0f) !== 0) return true;
  }
  return false;
}
