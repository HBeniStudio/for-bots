import { createNoise2D as createSimplex2D, type NoiseFunction2D } from 'simplex-noise';

/** 2D noise in about [-1, 1], seeded so the same inputs always match. */
export type Noise2D = NoiseFunction2D;

/**
 * Mulberry32. Returns values in [0, 1), which is what simplex-noise uses to
 * shuffle its permutation table.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a world seed with a salt so each noise field gets its own permutation. */
export function mixSeed(seed: number, salt: number): number {
  return Math.imul((seed >>> 0) ^ salt, 0x9e3779b1) >>> 0;
}

/** Deterministic 2D simplex noise. Same seed ⇒ same function. */
export function createNoise2D(seed: number): Noise2D {
  return createSimplex2D(mulberry32(seed));
}

/**
 * Layered simplex (fractal Brownian motion). Each octave doubles the
 * frequency and halves the amplitude. `octaves` < 1 returns 0. The result
 * stays inside about [-1, 1].
 */
export function fbm(
  noise: Noise2D,
  x: number,
  z: number,
  octaves: number,
  frequency: number,
): number {
  let sum = 0;
  let amplitude = 1;
  let freq = frequency;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x * freq, z * freq);
    norm += amplitude;
    amplitude *= 0.5;
    freq *= 2;
  }
  return norm === 0 ? 0 : sum / norm;
}

/** Unsigned 32-bit hash of a seed and a world/cell coordinate. */
export function hash2(seed: number, x: number, z: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x9e3779b1);
  h = Math.imul(h ^ (z | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
