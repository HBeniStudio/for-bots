import { describe, expect, it } from 'vitest';
import { AIR, STONE, TORCH, TORCH_LIGHT } from '../src/world/blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from '../src/world/chunk';
import { blockLightAt } from '../src/world/light';
import { World, worldToChunk } from '../src/world/world';
import {
  AUTOSAVE_SEC,
  SAVE_KEY,
  SaveClock,
  applyChunkDiffs,
  attachEditLog,
  bindUnloadSave,
  clearSnapshot,
  hasSnapshot,
  memoryStore,
  parseSeed,
  readSnapshot,
  writeSnapshot,
  type SaveSnapshot,
} from '../src/save/save';

function findOpenAir(world: World, x: number, z: number): number {
  for (let y = CHUNK_Y - 1; y >= 0; y--) {
    if (world.getBlock(x, y, z) === AIR && world.getBlock(x + 1, y, z) === AIR) return y;
  }
  throw new Error(`no open air at ${x},${z}`);
}

function findSolid(world: World, x: number, z: number): number {
  for (let y = CHUNK_Y - 1; y >= 0; y--) {
    if (world.getBlock(x, y, z) !== AIR) return y;
  }
  throw new Error(`no solid at ${x},${z}`);
}

describe('save game', () => {
  it('round-trips the seed, chunk diffs, player, hotbar, and time of day', () => {
    const store = memoryStore();
    const seed = 12345;
    const world = new World(seed);
    const diffs = attachEditLog(world);

    const home = worldToChunk(4, 4);
    world.generateChunk(home.cx, home.cz);
    const digY = findSolid(world, 2, 2);
    expect(world.getBlock(2, digY, 2)).not.toBe(AIR);
    world.setBlock(2, digY, 2, AIR);

    const torchY = findOpenAir(world, 4, 4);
    expect(world.getBlock(4, torchY, 4)).toBe(AIR);
    world.setBlock(4, torchY, 4, TORCH);

    const revertY = findOpenAir(world, 6, 6);
    const revertBefore = world.getBlock(6, revertY, 6);
    world.setBlock(6, revertY, 6, STONE);
    world.setBlock(6, revertY, 6, revertBefore);

    const far = worldToChunk(20, 2);
    world.generateChunk(far.cx, far.cz);
    const farY = findOpenAir(world, 20, 2);
    const farBefore = world.getBlock(20, farY, 2);
    const farNext = farBefore === STONE ? AIR : STONE;
    world.setBlock(20, farY, 2, farNext);

    const negX = -2;
    const negZ = -3;
    const neg = worldToChunk(negX, negZ);
    world.generateChunk(neg.cx, neg.cz);
    const negY = findOpenAir(world, negX, negZ);
    world.setBlock(negX, negY, negZ, TORCH);

    world.generateChunk(-4, 6);
    const untouched = Array.from(world.getChunk(-4, 6)!.blocks);

    const snapshot: SaveSnapshot = {
      seed,
      timeSec: 125.5,
      player: { x: 12.25, y: 30.5, z: -4.75, onGround: false },
      hotbar: 4,
      chunks: diffs.toChunks(),
    };
    const editedCells = snapshot.chunks.reduce((count, chunk) => count + chunk.cells.length, 0);
    expect(editedCells).toBe(4);
    expect(snapshot.chunks.some((chunk) => chunk.cx === -4 && chunk.cz === 6)).toBe(false);
    const homeChunk = snapshot.chunks.find((chunk) => chunk.cx === home.cx && chunk.cz === home.cz);
    expect(homeChunk?.cells.some(([lx, y, lz]) => lx === 6 && y === revertY && lz === 6)).toBe(false);
    for (const chunk of snapshot.chunks) {
      expect(chunk.cells.length).toBeGreaterThan(0);
      expect(chunk.cells.length).toBeLessThan(CHUNK_X * CHUNK_Y * CHUNK_Z);
    }

    expect(writeSnapshot(store, snapshot)).toBe(true);
    const raw = JSON.parse(store.getItem(SAVE_KEY)!) as {
      v: number;
      chunks: { cx: number; cz: number; cells: number[][] }[];
    };
    expect(raw.v).toBe(1);
    expect(raw.chunks).toHaveLength(snapshot.chunks.length);
    expect(raw.chunks.some((chunk) => chunk.cx === -4)).toBe(false);

    const loaded = readSnapshot(store);
    expect(loaded).toEqual(snapshot);

    const restored = new World(loaded!.seed);
    const restoredDiffs = attachEditLog(restored);
    applyChunkDiffs(restored, loaded!.chunks);
    expect(Array.from(restored.getChunk(home.cx, home.cz)!.blocks)).toEqual(
      Array.from(world.getChunk(home.cx, home.cz)!.blocks),
    );
    expect(Array.from(restored.getChunk(far.cx, far.cz)!.blocks)).toEqual(
      Array.from(world.getChunk(far.cx, far.cz)!.blocks),
    );
    expect(Array.from(restored.getChunk(neg.cx, neg.cz)!.blocks)).toEqual(
      Array.from(world.getChunk(neg.cx, neg.cz)!.blocks),
    );
    expect(Array.from(restored.generateChunk(-4, 6).blocks)).toEqual(untouched);
    expect(restored.getBlock(2, digY, 2)).toBe(AIR);
    expect(restored.getBlock(4, torchY, 4)).toBe(TORCH);
    expect(restored.getBlock(20, farY, 2)).toBe(farNext);
    expect(restored.getBlock(negX, negY, negZ)).toBe(TORCH);
    expect(blockLightAt(restored, 4, torchY, 4)).toBe(TORCH_LIGHT);
    expect(blockLightAt(restored, 5, torchY, 4)).toBe(TORCH_LIGHT - 1);
    expect(restoredDiffs.toChunks()).toEqual(snapshot.chunks);

    const again = memoryStore();
    expect(
      writeSnapshot(again, {
        seed: loaded!.seed,
        timeSec: loaded!.timeSec,
        player: loaded!.player,
        hotbar: loaded!.hotbar,
        chunks: restoredDiffs.toChunks(),
      }),
    ).toBe(true);
    expect(readSnapshot(again)).toEqual(snapshot);
  });

  it('rejects a corrupt save and reset removes a good one', () => {
    const store = memoryStore();
    const snapshot: SaveSnapshot = {
      seed: 3,
      timeSec: 0,
      player: { x: 1, y: 2, z: 3, onGround: true },
      hotbar: 1,
      chunks: [],
    };
    writeSnapshot(store, snapshot);
    expect(hasSnapshot(store)).toBe(true);

    store.setItem(
      SAVE_KEY,
      JSON.stringify({
        v: 1,
        seed: 3,
        timeSec: 4,
        player: { x: 1, y: 2, z: 3 },
        hotbar: 1,
        chunks: [{ cx: 0, cz: 0, cells: [[0, 10, 0, STONE], [20, 10, 0, STONE], [1, 10, 1, 500]] }],
      }),
    );
    const partial = readSnapshot(store);
    expect(partial?.player.onGround).toBe(true);
    expect(partial?.chunks).toEqual([{ cx: 0, cz: 0, cells: [[0, 10, 0, STONE]] }]);

    for (const raw of ['{', 'null', '[]', JSON.stringify({ v: 2, seed: 1 }), JSON.stringify({ v: 1, seed: -1 })]) {
      store.setItem(SAVE_KEY, raw);
      expect(readSnapshot(store)).toBeNull();
      expect(hasSnapshot(store)).toBe(false);
    }

    writeSnapshot(store, snapshot);
    clearSnapshot(store);
    expect(readSnapshot(store)).toBeNull();

    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
      removeItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(writeSnapshot(broken, snapshot)).toBe(false);
    expect(readSnapshot(broken)).toBeNull();
    expect(() => clearSnapshot(broken)).not.toThrow();
  });

  it('does not record a write into a chunk the generator has not built', () => {
    const world = new World(9);
    const diffs = attachEditLog(world);
    world.setBlock(3, 10, 3, AIR);
    world.setBlock(3, 11, 3, STONE);
    expect(world.getChunk(0, 0)).toBeDefined();
    expect(diffs.toChunks()).toEqual([]);
  });

  it('saves on a 30 second clock and when the page unloads', () => {
    expect(AUTOSAVE_SEC).toBe(30);
    const clock = new SaveClock();
    expect(clock.tick(10)).toBe(false);
    expect(clock.tick(10)).toBe(false);
    expect(clock.tick(10)).toBe(true);
    expect(clock.tick(10)).toBe(false);
    expect(clock.tick(AUTOSAVE_SEC)).toBe(true);
    expect(clock.tick(0)).toBe(false);
    expect(clock.tick(-1)).toBe(false);
    expect(clock.tick(Number.NaN)).toBe(false);
    expect(clock.tick(AUTOSAVE_SEC * 4)).toBe(true);
    expect(clock.tick(1)).toBe(false);

    const target = new EventTarget();
    let calls = 0;
    const unbind = bindUnloadSave(target, () => {
      calls += 1;
    });
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(new Event('beforeunload'));
    expect(calls).toBe(2);
    unbind();
    target.dispatchEvent(new Event('pagehide'));
    expect(calls).toBe(2);
  });

  it('parses numeric, hex, word, and blank seeds', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('  0 ')).toBe(0);
    expect(parseSeed('+12')).toBe(12);
    expect(parseSeed('-1')).toBe(0xffffffff);
    expect(parseSeed('0x10')).toBe(16);
    expect(parseSeed('forest')).toBe(parseSeed('forest'));
    expect(parseSeed('forest')).not.toBe(parseSeed('desert'));
    expect(parseSeed('   ', () => 0)).toBe(0);
    expect(parseSeed('', () => 0.5)).toBe(0x80000000);
  });
});
