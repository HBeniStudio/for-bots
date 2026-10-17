import { SLOT_COUNT } from '../ui/hotbar';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, Chunk, blockIndex, inChunkBounds } from '../world/chunk';
import { fillChunk } from '../world/gen/terrain';
import { World, worldToChunk } from '../world/world';

/** localStorage key for the single saved world. */
export const SAVE_KEY = 'isovoxel.save';

/** Wall-clock seconds between automatic saves while a world is running. */
export const AUTOSAVE_SEC = 30;

const SAVE_VERSION = 1;

/** One changed block: local x, y, local z, block id. */
export type SaveCell = readonly [number, number, number, number];

export interface SaveChunk {
  cx: number;
  cz: number;
  cells: SaveCell[];
}

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  onGround: boolean;
}

/**
 * Everything that cannot be rebuilt from the seed.
 * Unmodified chunks are omitted. Light is omitted too: it is rebuilt from blocks.
 */
export interface SaveSnapshot {
  seed: number;
  timeSec: number;
  player: PlayerSave;
  hotbar: number;
  chunks: readonly SaveChunk[];
}

/** The slice of Storage this game uses. Tests pass a memory map. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface DirtyChunk {
  cx: number;
  cz: number;
  cells: Map<number, number>;
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Blocks the player changed, compared with the seeded terrain.
 * Putting a block back removes it from the diff, so a chunk that is fully
 * restored is not written at all.
 */
export class ChunkDiffs {
  private readonly chunks = new Map<string, DirtyChunk>();
  private readonly baselines = new Map<string, Uint8Array>();

  /**
   * `id` is the block now stored at the world cell. The chunk must already
   * have been generated; the baseline is a fresh fill of that same seed.
   */
  record(seed: number, x: number, y: number, z: number, id: number): void {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return;
    const { cx, cz, lx, lz } = worldToChunk(x, z);
    if (!inChunkBounds(lx, y, lz)) return;
    const index = blockIndex(lx, y, lz);
    const stored = id & 255;
    const base = this.baseline(seed, cx, cz)[index] ?? 0;
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (stored === base) {
      if (!existing) return;
      existing.cells.delete(index);
      if (existing.cells.size === 0) this.chunks.delete(key);
      return;
    }
    const cells = existing?.cells ?? new Map<number, number>();
    if (!existing) this.chunks.set(key, { cx, cz, cells });
    cells.set(index, stored);
  }

  toChunks(): SaveChunk[] {
    const chunks: SaveChunk[] = [];
    for (const dirty of this.chunks.values()) {
      const cells: SaveCell[] = [];
      const stride = CHUNK_X * CHUNK_Z;
      for (const [index, id] of dirty.cells) {
        const y = Math.floor(index / stride);
        const rem = index - y * stride;
        const lz = Math.floor(rem / CHUNK_X);
        const lx = rem - lz * CHUNK_X;
        cells.push([lx, y, lz, id]);
      }
      cells.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
      chunks.push({ cx: dirty.cx, cz: dirty.cz, cells });
    }
    chunks.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    return chunks;
  }

  private baseline(seed: number, cx: number, cz: number): Uint8Array {
    const key = `${seed}:${cx},${cz}`;
    let blocks = this.baselines.get(key);
    if (!blocks) {
      const chunk = new Chunk(cx, cz);
      fillChunk(chunk, seed);
      blocks = chunk.blocks;
      this.baselines.set(key, blocks);
    }
    return blocks;
  }
}

/**
 * Record later `setBlock` calls on chunks the generator already built.
 * A write into a chunk that does not exist yet is ignored: that call creates
 * an empty shell, not seeded terrain, and the game generates before it edits.
 */
export function attachEditLog(world: World): ChunkDiffs {
  const diffs = new ChunkDiffs();
  const inner = world.setBlock.bind(world);
  world.setBlock = (x: number, y: number, z: number, id: number): void => {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const { cx, cz } = worldToChunk(bx, bz);
    const existed = world.getChunk(cx, cz) !== undefined;
    inner(x, y, z, id);
    if (!existed || by < 0 || by >= CHUNK_Y) return;
    diffs.record(world.seed, bx, by, bz, world.getBlock(bx, by, bz));
  };
  return diffs;
}

/** Generate each saved chunk, then replay its edits so lighting updates too. */
export function applyChunkDiffs(world: World, chunks: readonly SaveChunk[]): void {
  for (const chunk of chunks) {
    world.generateChunk(chunk.cx, chunk.cz);
    const baseX = chunk.cx * CHUNK_X;
    const baseZ = chunk.cz * CHUNK_Z;
    for (const [lx, y, lz, id] of chunk.cells) {
      if (!inChunkBounds(lx, y, lz)) continue;
      world.setBlock(baseX + lx, y, baseZ + lz, id);
    }
  }
}

export function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/**
 * The page's localStorage, or null when this browser will not persist
 * (private mode, or a runtime with no Storage). A one-byte probe catches
 * implementations that expose the object but throw on every write.
 */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${SAVE_KEY}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function writeSnapshot(store: KeyValueStore, snapshot: SaveSnapshot): boolean {
  try {
    store.setItem(SAVE_KEY, JSON.stringify(encodeSnapshot(snapshot)));
    return true;
  } catch {
    return false;
  }
}

export function readSnapshot(store: KeyValueStore): SaveSnapshot | null {
  let raw: string | null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return decodeSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function hasSnapshot(store: KeyValueStore): boolean {
  return readSnapshot(store) !== null;
}

export function clearSnapshot(store: KeyValueStore): void {
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // A store that refuses the delete is already empty for the next read.
  }
}

/**
 * True once accumulated play time reaches {@link AUTOSAVE_SEC}.
 * A large gap, such as a tab that was in the background, saves once.
 */
export class SaveClock {
  private elapsed = 0;

  tick(dtSec: number): boolean {
    if (!Number.isFinite(dtSec) || dtSec <= 0) return false;
    this.elapsed += dtSec;
    if (this.elapsed < AUTOSAVE_SEC) return false;
    this.elapsed = 0;
    return true;
  }
}

/** Fire `save` when the page is going away. Returns a function that detaches it. */
export function bindUnloadSave(target: EventTarget, save: () => void): () => void {
  const onUnload = (): void => {
    save();
  };
  target.addEventListener('pagehide', onUnload);
  target.addEventListener('beforeunload', onUnload);
  return () => {
    target.removeEventListener('pagehide', onUnload);
    target.removeEventListener('beforeunload', onUnload);
  };
}

/**
 * Blank text picks `random()` in [0, 1) and turns it into a uint32.
 * Integers and hex pass through as uint32. Anything else is hashed so a
 * word is still a stable seed.
 */
export function parseSeed(text: string, random: () => number = Math.random): number {
  const trimmed = text.trim();
  if (!trimmed) {
    const roll = random();
    const n = Number.isFinite(roll) ? Math.floor(roll * 0x100000000) : 0;
    return n >>> 0;
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed) || /^[+-]?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n >>> 0;
  }
  return hashString(trimmed);
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function encodeSnapshot(snapshot: SaveSnapshot): unknown {
  return {
    v: SAVE_VERSION,
    seed: snapshot.seed >>> 0,
    timeSec: snapshot.timeSec,
    player: {
      x: snapshot.player.x,
      y: snapshot.player.y,
      z: snapshot.player.z,
      onGround: snapshot.player.onGround,
    },
    hotbar: snapshot.hotbar,
    chunks: snapshot.chunks.map((chunk) => ({
      cx: chunk.cx,
      cz: chunk.cz,
      cells: chunk.cells.map((cell) => [cell[0], cell[1], cell[2], cell[3]]),
    })),
  };
}

function decodeSnapshot(value: unknown): SaveSnapshot | null {
  if (!isRecord(value) || value.v !== SAVE_VERSION) return null;
  const seed = value.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  const timeSec = value.timeSec;
  if (typeof timeSec !== 'number' || !Number.isFinite(timeSec)) return null;
  const player = decodePlayer(value.player);
  if (!player) return null;
  const hotbar = value.hotbar;
  if (typeof hotbar !== 'number' || !Number.isInteger(hotbar) || hotbar < 0 || hotbar >= SLOT_COUNT) {
    return null;
  }
  if (!Array.isArray(value.chunks)) return null;
  const chunks: SaveChunk[] = [];
  for (const entry of value.chunks) {
    const chunk = decodeChunk(entry);
    if (!chunk) return null;
    if (chunk.cells.length > 0) chunks.push(chunk);
  }
  return { seed, timeSec, player, hotbar, chunks };
}

function decodePlayer(value: unknown): PlayerSave | null {
  if (!isRecord(value)) return null;
  const { x, y, z, onGround } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (onGround !== undefined && typeof onGround !== 'boolean') return null;
  return { x, y, z, onGround: onGround ?? true };
}

function decodeChunk(value: unknown): SaveChunk | null {
  if (!isRecord(value)) return null;
  const { cx, cz, cells } = value;
  if (typeof cx !== 'number' || typeof cz !== 'number' || !Number.isInteger(cx) || !Number.isInteger(cz)) {
    return null;
  }
  if (!Array.isArray(cells)) return null;
  const kept = new Map<number, SaveCell>();
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 4) continue;
    const [lx, y, lz, id] = cell as [unknown, unknown, unknown, unknown];
    if (typeof lx !== 'number' || typeof y !== 'number' || typeof lz !== 'number' || typeof id !== 'number') {
      continue;
    }
    if (!inChunkBounds(lx, y, lz) || !Number.isInteger(id) || id < 0 || id > 255) continue;
    kept.set(blockIndex(lx, y, lz), [lx, y, lz, id]);
  }
  return { cx, cz, cells: [...kept.values()] };
}
