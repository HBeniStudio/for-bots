import type { CreatureKind } from '../content/schema';

/** Horizontal distance at which a fleeing mob starts running. */
export const FLEE_RANGE = 8;

export type AiMode = 'idle' | 'wander' | 'flee' | 'chase' | 'attack';

export interface AiView {
  kind: CreatureKind;
  flees: boolean;
  mode: AiMode;
  distance: number;
  aggroRange: number;
  attackRange: number;
  fleeRange?: number;
}

/**
 * Stimulus for one tick. Idle and wander are the calm modes; flee, chase,
 * and attack replace them while the player is in range. Leaving a range
 * drops back to wander (or idle, if that was the calm mode).
 */
export function nextAiMode(view: AiView): AiMode {
  const fleeRange = view.fleeRange ?? FLEE_RANGE;
  if (view.kind === 'mob') {
    if (view.flees && view.distance <= fleeRange) return 'flee';
    if (view.mode === 'flee') return 'wander';
    return view.mode === 'idle' ? 'idle' : 'wander';
  }
  if (view.distance <= view.attackRange) return 'attack';
  if (view.distance <= view.aggroRange) return 'chase';
  if (view.mode === 'idle') return 'idle';
  return 'wander';
}
