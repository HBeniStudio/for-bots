import { describe, expect, it } from 'vitest';
import { FACE_SHADE, shadeFaceColor, skyColor } from '../src/render/renderer';
import {
  AIR,
  BLOCK_IDS,
  LIGHT_MAX,
  LIGHT_SCALE,
  STONE,
  TORCH,
  TORCH_LIGHT,
  WATER,
  lightEmission,
  lightOpacity,
} from '../src/world/blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, Chunk } from '../src/world/chunk';
import {
  DAY_LENGTH_SEC,
  blockLightAt,
  combineLight,
  exposedFaceLight,
  lightChunk,
  skyLightAt,
  sunlightFactor,
} from '../src/world/light';
import { World } from '../src/world/world';

function litChunk(world: World, cx = 0, cz = 0): void {
  world.ensureChunk(cx, cz);
  lightChunk(world, cx, cz);
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
}

describe('sunlight', () => {
  it('fills a clear column from the sky and spreads sideways with falloff 1', () => {
    const world = new World(1);
    litChunk(world);
    expect(skyLightAt(world, 4, CHUNK_Y - 1, 4)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, 4, 0, 4)).toBe(LIGHT_MAX);

    world.setBlock(4, 20, 4, STONE);
    expect(skyLightAt(world, 4, 21, 4)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, 4, 20, 4)).toBe(0);
    // The stone stops the column; open neighbors pour light back in underneath.
    expect(skyLightAt(world, 4, 19, 4)).toBe(LIGHT_MAX - 1);
    expect(skyLightAt(world, 5, 19, 4)).toBe(LIGHT_MAX);

    world.setBlock(4, 20, 4, AIR);
    expect(skyLightAt(world, 4, 19, 4)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, 4, 0, 4)).toBe(LIGHT_MAX);
  });

  it('keeps a sealed room dark, then lets the sun back in when the roof opens', () => {
    const world = new World(1);
    litChunk(world);
    for (let x = 1; x <= 5; x++) {
      for (let y = 1; y <= 5; y++) {
        for (let z = 1; z <= 5; z++) {
          const shell = x === 1 || x === 5 || y === 1 || y === 5 || z === 1 || z === 5;
          if (shell) world.setBlock(x, y, z, STONE);
        }
      }
    }
    expect(skyLightAt(world, 3, 3, 3)).toBe(0);
    expect(blockLightAt(world, 3, 3, 3)).toBe(0);

    world.setBlock(3, 5, 3, AIR);
    expect(skyLightAt(world, 3, 3, 3)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, 2, 3, 3)).toBe(LIGHT_MAX - 1);

    world.setBlock(3, 5, 3, STONE);
    expect(skyLightAt(world, 3, 3, 3)).toBe(0);
    expect(skyLightAt(world, 2, 3, 3)).toBe(0);
  });

  it('lights a generated chunk from the sky down to the ground', () => {
    const world = new World(4);
    const chunk = world.generateChunk(2, -1);
    const x = chunk.cx * CHUNK_X + 3;
    const z = chunk.cz * CHUNK_Z + 5;
    expect(skyLightAt(world, x, CHUNK_Y - 1, z)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, x, chunk.maxY + 1, z)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, x, 0, z)).toBe(0);
  });

  it('filters sunlight down a water column', () => {
    const world = new World(1);
    litChunk(world);
    world.setBlock(2, 30, 2, WATER);
    world.setBlock(2, 29, 2, WATER);
    expect(lightOpacity(WATER)).toBe(2);
    expect(skyLightAt(world, 2, 30, 2)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, 2, 29, 2)).toBe(LIGHT_MAX - 2);
  });
});

describe('torches', () => {
  it('emits 14 and flood-fills with a falloff of 1, stopping at stone', () => {
    const world = new World(1);
    litChunk(world);
    expect(lightEmission(TORCH)).toBe(14);
    expect(TORCH_LIGHT).toBe(14);
    expect(lightEmission(STONE)).toBe(0);

    world.setBlock(1, 8, 1, TORCH);
    expect(blockLightAt(world, 1, 8, 1)).toBe(14);
    expect(blockLightAt(world, 2, 8, 1)).toBe(13);
    expect(blockLightAt(world, 3, 8, 1)).toBe(12);
    expect(blockLightAt(world, 2, 9, 1)).toBe(12);
    expect(blockLightAt(world, 1, 8, 14)).toBe(1);
    expect(blockLightAt(world, 1, 8, 15)).toBe(0);

    // Six stone faces around one air cell. Light cannot step through them.
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      world.setBlock(6 + dx, 8 + dy, 6 + dz, STONE);
    }
    expect(blockLightAt(world, 6, 8, 6)).toBe(0);
    expect(blockLightAt(world, 7, 8, 6)).toBe(0);

    world.setBlock(1, 8, 1, AIR);
    expect(blockLightAt(world, 1, 8, 1)).toBe(0);
    expect(blockLightAt(world, 1, 8, 2)).toBe(0);
  });

  it('keeps the other torch when one of two sources is removed', () => {
    const world = new World(1);
    litChunk(world);
    world.setBlock(8, 4, 4, TORCH);
    world.setBlock(12, 4, 4, TORCH);
    expect(blockLightAt(world, 10, 4, 4)).toBe(12);
    expect(blockLightAt(world, 9, 4, 4)).toBe(13);

    world.setBlock(8, 4, 4, AIR);
    expect(blockLightAt(world, 10, 4, 4)).toBe(12);
    expect(blockLightAt(world, 9, 4, 4)).toBe(11);
    expect(blockLightAt(world, 12, 4, 4)).toBe(14);
  });
});

describe('chunk borders', () => {
  it('adds and removes torch light across a chunk border', () => {
    const world = new World(1);
    litChunk(world, 0, 0);
    litChunk(world, 1, 0);

    world.setBlock(15, 6, 3, TORCH);
    expect(blockLightAt(world, 15, 6, 3)).toBe(14);
    expect(blockLightAt(world, 16, 6, 3)).toBe(13);
    expect(blockLightAt(world, 17, 6, 3)).toBe(12);
    expect(world.getChunk(1, 0)?.getBlockLight(0, 6, 3)).toBe(13);

    world.setBlock(15, 6, 3, AIR);
    expect(blockLightAt(world, 16, 6, 3)).toBe(0);
    expect(blockLightAt(world, 17, 6, 3)).toBe(0);
    expect(blockLightAt(world, 14, 6, 3)).toBe(0);
  });

  it('lights a chunk that loads after the torch was placed', () => {
    const world = new World(1);
    litChunk(world, 0, 0);
    world.setBlock(15, 6, 1, TORCH);
    expect(blockLightAt(world, 16, 6, 1)).toBe(0);

    litChunk(world, 1, 0);
    expect(blockLightAt(world, 16, 6, 1)).toBe(13);
    expect(skyLightAt(world, 16, 6, 1)).toBe(LIGHT_MAX);
  });

  it('seals and reopens sunlight across the border', () => {
    const world = new World(1);
    litChunk(world, 0, 0);
    litChunk(world, 1, 0);
    for (let x = 14; x <= 17; x++) {
      for (let y = 2; y <= 6; y++) {
        for (let z = 0; z <= 3; z++) {
          const shell = x === 14 || x === 17 || y === 2 || y === 6 || z === 0 || z === 3;
          if (shell) world.setBlock(x, y, z, STONE);
        }
      }
    }
    expect(skyLightAt(world, 15, 4, 1)).toBe(0);
    expect(skyLightAt(world, 16, 4, 1)).toBe(0);

    world.setBlock(15, 6, 1, AIR);
    world.setBlock(16, 6, 1, AIR);
    expect(skyLightAt(world, 15, 4, 1)).toBe(LIGHT_MAX);
    expect(skyLightAt(world, 16, 4, 1)).toBe(LIGHT_MAX);

    world.setBlock(15, 6, 1, STONE);
    world.setBlock(16, 6, 1, STONE);
    expect(skyLightAt(world, 15, 4, 1)).toBe(0);
    expect(skyLightAt(world, 16, 4, 1)).toBe(0);
  });

  it('spreads torch light into a negative chunk', () => {
    const world = new World(1);
    litChunk(world, -1, 0);
    litChunk(world, 0, 0);
    world.setBlock(-1, 5, 0, TORCH);
    expect(blockLightAt(world, 0, 5, 0)).toBe(13);
    world.setBlock(-1, 5, 0, AIR);
    expect(blockLightAt(world, 0, 5, 0)).toBe(0);
  });
});

describe('day and night', () => {
  it('runs a 10 minute cycle that scales sun and leaves torches bright', () => {
    expect(DAY_LENGTH_SEC).toBe(600);
    expect(sunlightFactor(0)).toBe(1);
    expect(sunlightFactor(DAY_LENGTH_SEC)).toBe(1);
    expect(sunlightFactor(DAY_LENGTH_SEC / 2)).toBe(0);
    expect(sunlightFactor(-DAY_LENGTH_SEC / 2)).toBe(0);
    const dusk = sunlightFactor(DAY_LENGTH_SEC / 4);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);

    expect(combineLight(0, 15, 1)).toBe(15);
    expect(combineLight(0, 15, 0)).toBe(0);
    expect(combineLight(14, 15, 0)).toBe(14);
    expect(combineLight(14, 15, 1)).toBe(15);

    const world = new World(1);
    litChunk(world);
    world.setBlock(4, 4, 4, TORCH);
    expect(exposedFaceLight(world, 4, 4, 4, 'top', 0).light).toBe(14);
    expect(exposedFaceLight(world, 4, 4, 4, 'top', 1).light).toBe(15);

    world.setBlock(14, 20, 14, STONE);
    expect(exposedFaceLight(world, 14, 20, 14, 'top', 1).light).toBe(15);
    expect(exposedFaceLight(world, 14, 20, 14, 'top', 0).light).toBe(0);
    // The +x face looks into a chunk that was never loaded.
    world.setBlock(15, 10, 4, STONE);
    expect(exposedFaceLight(world, 15, 10, 4, 'right', 1).light).toBe(15);
    expect(exposedFaceLight(world, 15, 10, 4, 'right', 0).light).toBe(0);
    expect(skyColor(1)).toBe('#9fd4ef');
    expect(skyColor(0)).not.toBe(skyColor(1));
  });
});

describe('face shading', () => {
  it('keeps the top brighter than the sides and brightens with light level', () => {
    expect(FACE_SHADE.top).toBeGreaterThan(FACE_SHADE.left);
    expect(FACE_SHADE.left).toBeGreaterThan(FACE_SHADE.right);

    const top = shadeFaceColor('#808080', 15, 'top', 1, 0);
    const left = shadeFaceColor('#808080', 15, 'left', 1, 0);
    const right = shadeFaceColor('#808080', 15, 'right', 1, 0);
    expect(luminance(top)).toBeGreaterThan(luminance(left));
    expect(luminance(left)).toBeGreaterThan(luminance(right));
    expect(luminance(shadeFaceColor('#808080', 15, 'top'))).toBeGreaterThan(
      luminance(shadeFaceColor('#808080', 8, 'top')),
    );
    expect(luminance(shadeFaceColor('#808080', 8, 'top'))).toBeGreaterThan(
      luminance(shadeFaceColor('#808080', 0, 'top')),
    );

    const torch = '#ff8000';
    expect(shadeFaceColor(torch, 14, 'top', 0, 14)).toBe(shadeFaceColor(torch, 14, 'top', 1, 14));
    expect(shadeFaceColor('#808080', 0, 'top', 0, 0)).not.toBe(shadeFaceColor('#808080', 0, 'top', 1, 0));
  });
});

describe('light storage', () => {
  it('stores both channels in one 0–15 array without moving block ids', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.light).toBeInstanceOf(Uint8Array);
    expect(chunk.light.length).toBe(chunk.blocks.length);
    chunk.setSkyLight(1, 2, 3, 15);
    chunk.setBlockLight(1, 2, 3, 14);
    expect(chunk.getSkyLight(1, 2, 3)).toBe(15);
    expect(chunk.getBlockLight(1, 2, 3)).toBe(14);
    chunk.setSkyLight(1, 2, 3, 0);
    expect(chunk.getBlockLight(1, 2, 3)).toBe(14);

    expect(BLOCK_IDS.torch).toBe(TORCH);
    expect(LIGHT_SCALE).toEqual({ min: 0, max: 15 });
    expect(AIR).toBe(0);
    expect(CHUNK_X).toBe(16);
  });
});
