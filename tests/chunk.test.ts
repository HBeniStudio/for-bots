import { describe, expect, it } from 'vitest';
import { AIR, DIRT, GRASS, STONE } from '../src/world/blocks';
import {
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  Chunk,
  blockIndex,
  inChunkBounds,
} from '../src/world/chunk';
import { World, worldToChunk } from '../src/world/world';
import { Camera } from '../src/render/camera';
import { collectDrawList, exposedFaces } from '../src/render/renderer';
import { compareBlockDepth } from '../src/render/iso';

describe('chunk get/set', () => {
  it('stores block ids in a 16×16×64 buffer', () => {
    const chunk = new Chunk(2, -3);
    expect(chunk.cx).toBe(2);
    expect(chunk.cz).toBe(-3);
    expect(chunk.blocks).toBeInstanceOf(Uint8Array);
    expect(chunk.blocks.length).toBe(CHUNK_X * CHUNK_Z * CHUNK_Y);
    expect(chunk.maxY).toBe(-1);

    expect(chunk.get(1, 2, 3)).toBe(AIR);
    chunk.set(1, 2, 3, STONE);
    expect(chunk.get(1, 2, 3)).toBe(STONE);
    expect(chunk.blocks[blockIndex(1, 2, 3)]).toBe(STONE);
    expect(chunk.maxY).toBe(2);

    chunk.set(1, 2, 3, GRASS);
    expect(chunk.get(1, 2, 3)).toBe(GRASS);
    chunk.set(4, 0, 5, DIRT);
    expect(chunk.get(4, 0, 5)).toBe(DIRT);
    expect(chunk.get(1, 2, 3)).toBe(GRASS);
  });

  it('ignores writes outside the chunk and reads them as air', () => {
    const chunk = new Chunk(0, 0);
    chunk.set(0, 0, 0, STONE);
    chunk.set(-1, 0, 0, DIRT);
    chunk.set(16, 0, 0, DIRT);
    chunk.set(0, -1, 0, DIRT);
    chunk.set(0, 64, 0, DIRT);
    chunk.set(0, 0, 16, DIRT);
    chunk.set(1.5, 0, 0, DIRT);
    expect(chunk.get(-1, 0, 0)).toBe(AIR);
    expect(chunk.get(16, 0, 0)).toBe(AIR);
    expect(chunk.get(0, 64, 0)).toBe(AIR);
    expect(chunk.get(0, 0, 0)).toBe(STONE);
    expect(inChunkBounds(15, 63, 15)).toBe(true);
    expect(inChunkBounds(16, 0, 0)).toBe(false);
  });

  it('recomputes the highest solid y when that block is cleared', () => {
    const chunk = new Chunk(0, 0);
    chunk.set(0, 4, 0, STONE);
    chunk.set(1, 2, 1, DIRT);
    expect(chunk.maxY).toBe(4);
    chunk.set(0, 4, 0, AIR);
    expect(chunk.maxY).toBe(2);
    chunk.set(1, 2, 1, AIR);
    expect(chunk.maxY).toBe(-1);
  });
});

describe('world-to-chunk mapping', () => {
  it('maps positive, zero, and negative coordinates', () => {
    expect(worldToChunk(0, 0)).toEqual({ cx: 0, cz: 0, lx: 0, lz: 0 });
    expect(worldToChunk(15, 15)).toEqual({ cx: 0, cz: 0, lx: 15, lz: 15 });
    expect(worldToChunk(16, 31)).toEqual({ cx: 1, cz: 1, lx: 0, lz: 15 });
    expect(worldToChunk(32, 5)).toEqual({ cx: 2, cz: 0, lx: 0, lz: 5 });
    expect(worldToChunk(-1, 0)).toEqual({ cx: -1, cz: 0, lx: 15, lz: 0 });
    expect(worldToChunk(-16, -16)).toEqual({ cx: -1, cz: -1, lx: 0, lz: 0 });
    expect(worldToChunk(-17, -33)).toEqual({ cx: -2, cz: -3, lx: 15, lz: 15 });
  });

  it('round-trips block coordinates through the chunk they land in', () => {
    const samples = [
      [0, 0],
      [15, 16],
      [-1, -1],
      [-17, 48],
      [64, -33],
    ];
    for (const [x, z] of samples) {
      const mapped = worldToChunk(x!, z!);
      expect(mapped.cx * CHUNK_X + mapped.lx).toBe(x);
      expect(mapped.cz * CHUNK_Z + mapped.lz).toBe(z);
      expect(mapped.lx).toBeGreaterThanOrEqual(0);
      expect(mapped.lx).toBeLessThan(CHUNK_X);
      expect(mapped.lz).toBeGreaterThanOrEqual(0);
      expect(mapped.lz).toBeLessThan(CHUNK_Z);
    }
  });

  it('gets and sets blocks across chunk borders, including negative chunks', () => {
    const world = new World();
    world.setBlock(-1, 3, -17, STONE);
    world.setBlock(16, 0, 0, DIRT);
    world.setBlock(0, 63, 0, GRASS);

    const neg = worldToChunk(-1, -17);
    expect(world.getChunk(neg.cx, neg.cz)?.get(neg.lx, 3, neg.lz)).toBe(STONE);
    expect(world.getBlock(-1, 3, -17)).toBe(STONE);

    const east = worldToChunk(16, 0);
    expect(east).toEqual({ cx: 1, cz: 0, lx: 0, lz: 0 });
    expect(world.getChunk(1, 0)?.get(0, 0, 0)).toBe(DIRT);
    expect(world.getBlock(16, 0, 0)).toBe(DIRT);

    expect(world.getBlock(0, 63, 0)).toBe(GRASS);
    expect(world.getBlock(0, 64, 0)).toBe(AIR);
    expect(world.getBlock(4, 1, 4)).toBe(AIR);
    expect(world.getChunk(99, 99)).toBeUndefined();

    world.setBlock(16, 0, 0, AIR);
    expect(world.getBlock(16, 0, 0)).toBe(AIR);
  });
});

describe('exposed faces and draw order', () => {
  it('draws only faces that border air, including across a chunk edge', () => {
    const world = new World();
    world.setBlock(0, 0, 0, STONE);
    world.setBlock(1, 0, 0, STONE);
    const open = exposedFaces(world, 0, 0, 0);
    expect(open).toEqual({ top: true, left: true, right: false });

    world.setBlock(15, 2, 15, DIRT);
    world.setBlock(16, 2, 15, GRASS);
    expect(exposedFaces(world, 15, 2, 15)?.right).toBe(false);
    expect(exposedFaces(world, 16, 2, 15)?.right).toBe(true);

    world.setBlock(2, 0, 2, STONE);
    world.setBlock(3, 0, 2, STONE);
    world.setBlock(2, 0, 3, STONE);
    world.setBlock(2, 1, 2, STONE);
    expect(exposedFaces(world, 2, 0, 2)).toBeNull();
  });

  it('omits off-screen chunks and sorts the rest back-to-front', () => {
    const world = new World();
    world.setBlock(0, 0, 0, STONE);
    world.setBlock(1, 1, 0, DIRT);
    world.setBlock(0, 0, 1, GRASS);
    world.setBlock(2, 0, 2, STONE);
    world.setBlock(3, 0, 2, STONE);
    world.setBlock(2, 0, 3, STONE);
    world.setBlock(2, 1, 2, STONE);
    world.setBlock(800, 0, 800, STONE);

    const camera = new Camera();
    camera.resize(640, 480);
    camera.focusX = 8;
    camera.focusZ = 8;
    camera.zoom = 1;

    const list = collectDrawList(world, camera);
    const keys = list.map((b) => `${b.x},${b.y},${b.z}`);
    expect(keys).not.toContain('800,0,800');
    expect(keys).not.toContain('2,0,2');
    expect(keys).toContain('0,0,0');
    expect(keys).toContain('1,1,0');

    for (let i = 1; i < list.length; i++) {
      expect(compareBlockDepth(list[i - 1]!, list[i]!)).toBeLessThanOrEqual(0);
    }

    const origin = list.find((b) => b.x === 0 && b.y === 0 && b.z === 0);
    // +z neighbor is grass, so the screen-left face is hidden; +x is open.
    expect(origin).toMatchObject({ top: true, left: false, right: true });
  });

  it('reuses the draw list until a block changes', () => {
    const world = new World();
    world.setBlock(0, 0, 0, STONE);
    const camera = new Camera();
    camera.resize(640, 480);
    camera.focusX = 8;
    camera.focusZ = 8;
    const first = collectDrawList(world, camera);
    expect(collectDrawList(world, camera)).toBe(first);
    world.setBlock(0, 1, 0, DIRT);
    const next = collectDrawList(world, camera);
    expect(next).not.toBe(first);
    expect(next.some((block) => block.y === 1 && block.id === DIRT)).toBe(true);
  });
});

describe('chunk streaming', () => {
  it('drops distant chunks, keeps the ones asked to stay, and regenerates from the seed', () => {
    const world = new World(4);
    world.generateChunk(0, 0);
    const far = world.generateChunk(9, 9);
    world.generateChunk(20, -3);
    const before = far.blocks.slice();
    expect(before.some((id) => id !== AIR)).toBe(true);
    world.setBlock(20 * 16 + 1, 6, -3 * 16 + 2, STONE);
    const dropped = world.unloadBeyond(8, 8, 2, (cx, cz) => cx === 20 && cz === -3);
    expect(dropped).toBe(1);
    expect(world.getChunk(0, 0)).toBeDefined();
    expect(world.getChunk(9, 9)).toBeUndefined();
    expect(world.getChunk(20, -3)?.get(1, 6, 2)).toBe(STONE);
    const again = world.generateChunk(9, 9);
    expect(Array.from(again.blocks)).toEqual(Array.from(before));
  });
});
