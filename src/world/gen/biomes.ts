import { GRASS, SAND, SNOW } from '../blocks';

/** Stable biome ids. Do not renumber these. Biome "snow" is 3; block "snow" is a different id. */
export const PLAINS = 0;
export const FOREST = 1;
export const DESERT = 2;
export const SNOW_BIOME = 3;

export type BiomeId = typeof PLAINS | typeof FOREST | typeof DESERT | typeof SNOW_BIOME;

/**
 * Stable names for the biome ids above. Content JSON may use the name or the
 * number. Biome "snow" is {@link SNOW_BIOME}, not the snow block.
 */
export const BIOME_IDS = Object.freeze({
  plains: PLAINS,
  forest: FOREST,
  desert: DESERT,
  snow: SNOW_BIOME,
} as const);

export type BiomeName = keyof typeof BIOME_IDS;

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
