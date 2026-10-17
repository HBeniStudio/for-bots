import { GRASS, SAND, SNOW } from '../blocks';

/**
 * Stable biome ids. Content JSON references these names or numbers.
 * Biome "snow" is 3; block "snow" is a different id. Do not renumber these.
 */
export const BIOME_IDS = Object.freeze({
  plains: 0,
  forest: 1,
  desert: 2,
  snow: 3,
} as const);

export type BiomeName = keyof typeof BIOME_IDS;

export const PLAINS = BIOME_IDS.plains;
export const FOREST = BIOME_IDS.forest;
export const DESERT = BIOME_IDS.desert;
export const SNOW_BIOME = BIOME_IDS.snow;

export type BiomeId = (typeof BIOME_IDS)[BiomeName];

/**
 * Classify a climate sample. Temperature and moisture are independent noise
 * fields in 0..1, not the heightmap.
 * Cold is snow, hot and dry is desert, wet is forest, and the rest is plains.
 */
export function classifyBiome(temperature: number, moisture: number): BiomeId {
  if (temperature < 0.34) return SNOW_BIOME;
  if (temperature > 0.62 && moisture < 0.42) return DESERT;
  if (moisture > 0.55) return FOREST;
  return PLAINS;
}

/** Top block before beaches, gravel pockets, and water rewrite it. */
export function surfaceFor(biome: BiomeId): number {
  switch (biome) {
    case DESERT:
      return SAND;
    case SNOW_BIOME:
      return SNOW;
    case FOREST:
    case PLAINS:
      return GRASS;
    default:
      return GRASS;
  }
}

/**
 * Chance that a tree cell in this biome actually grows a tree.
 * Forests are dense, plains and snow are scattered, deserts are bare.
 */
export function treeDensity(biome: BiomeId): number {
  switch (biome) {
    case FOREST:
      return 0.85;
    case PLAINS:
      return 0.18;
    case SNOW_BIOME:
      return 0.12;
    case DESERT:
      return 0;
    default:
      return 0;
  }
}
