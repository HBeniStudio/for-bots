import type { BiomeName, CreatureDef } from '../content/schema';
import { BIOME_IDS } from '../world/gen/biomes';

/** Hard cap so a crowded view cannot spawn without bound. */
export const ENTITY_LIMIT = 32;
/** Cap for one mob or enemy id. */
export const TYPE_LIMIT = 6;
/** Bosses stay rare: one of each id. */
export const BOSS_LIMIT = 1;

export interface SpawnLimits {
  global: number;
  perType: number;
  perBoss: number;
}

export const DEFAULT_LIMITS: SpawnLimits = {
  global: ENTITY_LIMIT,
  perType: TYPE_LIMIT,
  perBoss: BOSS_LIMIT,
};

export interface SpawnChoice {
  id: string;
  count: number;
}

export function biomeNameFromId(id: number): BiomeName | null {
  for (const name of Object.keys(BIOME_IDS) as BiomeName[]) {
    if (BIOME_IDS[name] === id) return name;
  }
  return null;
}

/** True when this column's biome and light are inside the creature's spawn rule. */
export function matchesSpawn(def: CreatureDef, biome: BiomeName, light: number): boolean {
  if (!def.spawn.biomes.includes(biome)) return false;
  return light >= def.spawn.minLight && light <= def.spawn.maxLight;
}

export function roomFor(
  def: CreatureDef,
  counts: ReadonlyMap<string, number>,
  total: number,
  limits: SpawnLimits = DEFAULT_LIMITS,
): number {
  const globalRoom = limits.global - total;
  if (globalRoom <= 0) return 0;
  const have = counts.get(def.id) ?? 0;
  const cap = def.kind === 'boss' ? limits.perBoss : limits.perType;
  return Math.max(0, Math.min(globalRoom, cap - have));
}

/** How many of `def` to place, clamped by the remaining cap. Bosses ignore pack. */
export function choosePack(def: CreatureDef, rng: () => number, room: number): number {
  if (room <= 0) return 0;
  if (def.kind === 'boss' || !('pack' in def.spawn)) return Math.min(1, room);
  const [min, max] = def.spawn.pack;
  const span = max - min + 1;
  const want = min + Math.floor(rng() * span);
  return Math.min(room, want);
}

export function weightedPick<T extends { spawn: { weight: number } }>(items: readonly T[], rng: () => number): T {
  let total = 0;
  for (const item of items) total += item.spawn.weight;
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.spawn.weight;
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

/**
 * Pick a creature that may spawn here, and how many. Null when nothing
 * matches the column or every match is already at its cap.
 */
export function planSpawn(
  catalog: readonly CreatureDef[],
  biome: BiomeName,
  light: number,
  counts: ReadonlyMap<string, number>,
  total: number,
  rng: () => number,
  limits: SpawnLimits = DEFAULT_LIMITS,
): SpawnChoice | null {
  const eligible = catalog.filter((def) => matchesSpawn(def, biome, light) && roomFor(def, counts, total, limits) > 0);
  if (eligible.length === 0) return null;
  const picked = weightedPick(eligible, rng);
  const count = choosePack(picked, rng, roomFor(picked, counts, total, limits));
  if (count <= 0) return null;
  return { id: picked.id, count };
}
