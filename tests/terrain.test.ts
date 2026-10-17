import { describe, expect, it } from 'vitest';
import {
  AIR,
  DIRT,
  FACE_COLORS,
  GRASS,
  GRAVEL,
  LEAVES,
  LOG,
  SAND,
  SNOW,
  STONE,
  TORCH,
  WATER,
} from '../src/world/blocks';
import { CHUNK_X, CHUNK_Z } from '../src/world/chunk';
import {
  DESERT,
  FOREST,
  PLAINS,
  SNOW_BIOME,
  classifyBiome,
  surfaceFor,
  treeDensity,
} from '../src/world/gen/biomes';
import { createNoise2D, fbm } from '../src/world/gen/noise';
import { SEA_LEVEL, columnAt } from '../src/world/gen/terrain';
import { TREE_RADIUS } from '../src/world/gen/trees';
import { World, worldToChunk } from '../src/world/world';

function bytes(world: World, cx: number, cz: number): number[] {
  return Array.from(world.generateChunk(cx, cz).blocks);
}

describe('terrain generator', () => {
  it('repeats every block of a chunk for the same seed', () => {
    const first = new World(42);
    const second = new World(42);
    const other = new World(99);
    expect(bytes(first, 0, 0)).toEqual(bytes(second, 0, 0));
    expect(bytes(first, -3, 5)).toEqual(bytes(second, -3, 5));
    expect(bytes(first, 0, 0)).not.toEqual(bytes(other, 0, 0));
    const again = bytes(first, 0, 0);
    expect(bytes(first, 0, 0)).toEqual(again);
  });

  it('builds a layered heightmap and fills water below sea level', () => {
    const noise = createNoise2D(5);
    const layered = fbm(noise, 12, -4, 4, 1 / 48);
    expect(layered).not.toBeCloseTo(fbm(noise, 12, -4, 1, 1 / 48));
    expect(Math.abs(layered)).toBeLessThanOrEqual(1);

    const seed = 7;
    let min = Infinity;
    let max = -Infinity;
    let wet: { x: number; z: number; height: number } | null = null;
    let land: { x: number; z: number; surface: number } | null = null;
    for (let z = -48; z <= 48; z += 3) {
      for (let x = -48; x <= 48; x += 3) {
        const column = columnAt(seed, x, z);
        min = Math.min(min, column.height);
        max = Math.max(max, column.height);
        if (!wet && column.height < SEA_LEVEL) wet = { x, z, height: column.height };
        if (!land && column.height > 6 && column.height >= SEA_LEVEL) {
          land = { x, z, surface: column.surface };
        }
      }
    }
    expect(max - min).toBeGreaterThanOrEqual(8);
    expect(wet).not.toBeNull();
    expect(land).not.toBeNull();

    const world = new World(seed);
    const shore = wet!;
    world.generateChunk(worldToChunk(shore.x, shore.z).cx, worldToChunk(shore.x, shore.z).cz);
    expect(world.getBlock(shore.x, shore.height, shore.z)).not.toBe(AIR);
    for (let y = shore.height + 1; y <= SEA_LEVEL; y++) {
      expect(world.getBlock(shore.x, y, shore.z)).toBe(WATER);
    }
    expect(world.getBlock(shore.x, SEA_LEVEL + 1, shore.z)).toBe(AIR);

    const hill = land!;
    const hillColumn = columnAt(seed, hill.x, hill.z);
    world.generateChunk(worldToChunk(hill.x, hill.z).cx, worldToChunk(hill.x, hill.z).cz);
    expect(world.getBlock(hill.x, 0, hill.z)).toBe(STONE);
    expect(world.getBlock(hill.x, hillColumn.height, hill.z)).toBe(hill.surface);
  });

  it('derives at least four biomes from temperature and moisture', () => {
    expect(classifyBiome(0.1, 0.8)).toBe(SNOW_BIOME);
    expect(classifyBiome(0.9, 0.1)).toBe(DESERT);
    expect(classifyBiome(0.5, 0.9)).toBe(FOREST);
    expect(classifyBiome(0.5, 0.2)).toBe(PLAINS);
    expect(surfaceFor(PLAINS)).toBe(GRASS);
    expect(surfaceFor(FOREST)).toBe(GRASS);
    expect(surfaceFor(DESERT)).toBe(SAND);
    expect(surfaceFor(SNOW_BIOME)).toBe(SNOW);
    expect(treeDensity(FOREST)).toBeGreaterThan(treeDensity(PLAINS));
    expect(treeDensity(PLAINS)).toBeGreaterThan(treeDensity(SNOW_BIOME));
    expect(treeDensity(SNOW_BIOME)).toBeGreaterThan(treeDensity(DESERT));

    const surfaces = new Map<number, number>();
    for (let z = -256; z <= 256; z += 8) {
      for (let x = -256; x <= 256; x += 8) {
        const column = columnAt(1, x, z);
        if (column.height < SEA_LEVEL) continue;
        surfaces.set(column.biome, column.surface);
      }
    }
    expect(surfaces.size).toBeGreaterThanOrEqual(4);
    expect(new Set(surfaces.values()).size).toBeGreaterThanOrEqual(3);

    const types = [GRASS, DIRT, STONE, SAND, WATER, SNOW, LOG, LEAVES, GRAVEL, TORCH];
    expect(types.length).toBeGreaterThanOrEqual(8);
    expect(types.length).toBeLessThanOrEqual(12);
    expect(new Set([AIR, ...types]).size).toBe(types.length + 1);
    for (const id of types) expect(FACE_COLORS[id]?.top).toBeTruthy();
  });

  it('does not cut trees off at chunk borders', () => {
    const seed = 11;
    const full = new World(seed);
    for (let cz = -2; cz <= 2; cz++) {
      for (let cx = -2; cx <= 2; cx++) full.generateChunk(cx, cz);
    }

    let leaf: { x: number; y: number; z: number } | null = null;
    for (const chunk of full.loadedChunks()) {
      if (leaf) break;
      const baseX = chunk.cx * CHUNK_X;
      const baseZ = chunk.cz * CHUNK_Z;
      for (let y = 0; y <= chunk.maxY && !leaf; y++) {
        for (let lz = 0; lz < CHUNK_Z && !leaf; lz++) {
          for (let lx = 0; lx < CHUNK_X && !leaf; lx++) {
            if (chunk.get(lx, y, lz) !== LEAVES) continue;
            const x = baseX + lx;
            const z = baseZ + lz;
            let foreign = false;
            let local = false;
            for (let dz = -TREE_RADIUS; dz <= TREE_RADIUS && !(foreign && local); dz++) {
              for (let dx = -TREE_RADIUS; dx <= TREE_RADIUS && !(foreign && local); dx++) {
                if (dx * dx + dz * dz > TREE_RADIUS * TREE_RADIUS) continue;
                for (let dy = -6; dy <= 2; dy++) {
                  if (full.getBlock(x + dx, y + dy, z + dz) !== LOG) continue;
                  const trunk = worldToChunk(x + dx, z + dz);
                  if (trunk.cx === chunk.cx && trunk.cz === chunk.cz) local = true;
                  else foreign = true;
                }
              }
            }
            if (foreign && !local) leaf = { x, y, z };
          }
        }
      }
    }
    expect(leaf).not.toBeNull();

    const at = worldToChunk(leaf!.x, leaf!.z);
    const alone = new World(seed);
    alone.generateChunk(at.cx, at.cz);
    expect(Array.from(alone.getChunk(at.cx, at.cz)!.blocks)).toEqual(
      Array.from(full.getChunk(at.cx, at.cz)!.blocks),
    );
    expect(alone.getBlock(leaf!.x, leaf!.y, leaf!.z)).toBe(LEAVES);
  });

  it('generates a few closest chunks per call around a focus', () => {
    const world = new World(3);
    expect(world.generateAround(8, 8, 3, 1)).toBe(1);
    expect(world.getChunk(0, 0)?.cx).toBe(0);
    expect(world.loadedChunks()).toHaveLength(1);

    expect(world.generateAround(8, 8, 3, 2)).toBe(2);
    expect(world.getChunk(-1, 0)).toBeDefined();
    expect(world.getChunk(0, -1)).toBeDefined();
    expect(world.getChunk(0, 1)).toBeUndefined();
    expect(world.getChunk(1, 0)).toBeUndefined();
    expect(world.generateAround(1000, 1000, 1, 0)).toBe(0);
  });
});
