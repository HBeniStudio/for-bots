import { DIRT, GRASS, GRAVEL, SAND, SNOW, STONE, WATER } from '../blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, type Chunk } from '../chunk';
import {
  DESERT,
  PLAINS,
  SNOW_BIOME,
  classifyBiome,
  surfaceFor,
  treeDensity,
  type BiomeId,
} from './biomes';
import { createNoise2D, fbm, hash2, mixSeed, type Noise2D } from './noise';
import { stampTrees, treeSitesForChunk } from './trees';

/** Water occupies every air block at or below this height. */
export const SEA_LEVEL = 28;

const HEIGHT_OCTAVES = 5;
const CLIMATE_OCTAVES = 3;

export interface Column {
  height: number;
  biome: BiomeId;
  /** Block placed at {@link height}. Water, if any, sits strictly above it. */
  surface: number;
}

interface Climate {
  temperature: number;
  moisture: number;
  biome: BiomeId;
}

class TerrainGen {
  private readonly heightNoise: Noise2D;
  private readonly tempNoise: Noise2D;
  private readonly moistNoise: Noise2D;

  constructor(readonly seed: number) {
    this.heightNoise = createNoise2D(mixSeed(seed, 0x51ed));
    this.tempNoise = createNoise2D(mixSeed(seed, 0x1a2b));
    this.moistNoise = createNoise2D(mixSeed(seed, 0xc0ff));
  }

  heightAt(x: number, z: number): number {
    const n = fbm(this.heightNoise, x, z, HEIGHT_OCTAVES, 1 / 76);
    const raw = SEA_LEVEL + Math.round(n * 16);
    return Math.min(CHUNK_Y - 8, Math.max(1, raw));
  }

  climateAt(x: number, z: number): Climate {
    const temperature = fbm(this.tempNoise, x, z, CLIMATE_OCTAVES, 1 / 150) * 0.5 + 0.5;
    const moisture = fbm(this.moistNoise, x + 400, z - 250, CLIMATE_OCTAVES, 1 / 150) * 0.5 + 0.5;
    return { temperature, moisture, biome: classifyBiome(temperature, moisture) };
  }

  column(x: number, z: number): Column {
    const height = this.heightAt(x, z);
    const { biome } = this.climateAt(x, z);
    let surface = surfaceFor(biome);
    if (height < SEA_LEVEL) {
      surface = SAND;
    } else if (biome !== SNOW_BIOME && biome !== DESERT && height <= SEA_LEVEL + 2) {
      surface = SAND;
    } else if (biome === PLAINS && hash2(this.seed, x, z) % 11 === 0) {
      surface = GRAVEL;
    }
    return { height, biome, surface };
  }

  fill(chunk: Chunk): void {
    const baseX = chunk.cx * CHUNK_X;
    const baseZ = chunk.cz * CHUNK_Z;
    const columns = new Map<string, Column>();
    const columnAt = (x: number, z: number): Column => {
      const key = `${x},${z}`;
      let column = columns.get(key);
      if (!column) {
        column = this.column(x, z);
        columns.set(key, column);
      }
      return column;
    };

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const x = baseX + lx;
        const z = baseZ + lz;
        const column = columnAt(x, z);
        const filler = column.biome === DESERT ? SAND : DIRT;
        const height = column.height;
        for (let y = 0; y <= height; y++) {
          let id = STONE;
          if (y === height) id = column.surface;
          else if (y > height - 4) id = filler;
          chunk.set(lx, y, lz, id);
        }
        if (height < SEA_LEVEL) {
          for (let y = height + 1; y <= SEA_LEVEL; y++) chunk.set(lx, y, lz, WATER);
        }
      }
    }

    const sites = treeSitesForChunk(this.seed, chunk.cx, chunk.cz, (x, z, roll) => {
      const column = columnAt(x, z);
      if (column.height < SEA_LEVEL) return false;
      // Beaches, gravel pockets, and sand stay treeless. Plains and forest
      // both wear grass; snow wears snow. Density then thins them out.
      if (column.surface !== GRASS && column.surface !== SNOW) return false;
      return roll < treeDensity(column.biome);
    });
    stampTrees(chunk, sites, (x, z) => columnAt(x, z).height, SEA_LEVEL);
  }
}

const cache = new Map<number, TerrainGen>();

function terrainFor(seed: number): TerrainGen {
  let gen = cache.get(seed);
  if (!gen) {
    gen = new TerrainGen(seed);
    cache.set(seed, gen);
  }
  return gen;
}

export function columnAt(seed: number, x: number, z: number): Column {
  return terrainFor(seed).column(x, z);
}

export function fillChunk(chunk: Chunk, seed: number): void {
  terrainFor(seed).fill(chunk);
}
