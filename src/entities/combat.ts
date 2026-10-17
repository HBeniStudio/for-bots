import type { BlockName } from '../world/blocks';
import type { BossPhase, Drop } from '../content/schema';

export const PLAYER_MAX_HEALTH = 20;
export const PLAYER_DAMAGE = 6;
/** Feet-to-feet reach of the player's melee swing. */
export const PLAYER_REACH = 2.6;
export const PLAYER_SWING = 0.45;
/** Seconds the player ignores damage after a hit. */
export const HURT_INVULN = 0.5;
/** Seconds between melee swings for an enemy or boss. */
export const ATTACK_COOLDOWN = 0.7;
export const RESPAWN_DELAY = 2;

export interface DropStack {
  block: BlockName;
  count: number;
}

/**
 * Active boss phase, or -1 while health is still above every threshold.
 * A phase applies once health / maxHealth is strictly below `belowHealth`.
 * Later phases replace earlier ones.
 */
export function bossPhaseIndex(phases: readonly Pick<BossPhase, 'belowHealth'>[], health: number, maxHealth: number): number {
  if (!(maxHealth > 0) || !Number.isFinite(health)) return -1;
  const fraction = health / maxHealth;
  let index = -1;
  for (let i = 0; i < phases.length; i++) {
    if (fraction < phases[i]!.belowHealth) index = i;
  }
  return index;
}

/** Roll each drop once. `rng` returns a number in [0, 1). */
export function rollDrops(drops: readonly Drop[], rng: () => number): DropStack[] {
  const stacks: DropStack[] = [];
  for (const drop of drops) {
    if (rng() >= drop.chance) continue;
    const span = drop.max - drop.min + 1;
    const count = drop.min + Math.floor(rng() * span);
    if (count > 0) stacks.push({ block: drop.block, count });
  }
  return stacks;
}
