import type { Aabb, VoxelQuery } from '../player/physics';

/** World-space vector. Y is up. Position is in blocks; velocity is blocks per second. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A body that moves through the voxel world.
 * `pos` is the center of the feet. `aabb` is the current solid bounds
 * (the same box the player collider uses). `update` integrates one tick;
 * implementations may accept extra arguments after `world`.
 */
export interface Entity {
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly aabb: Aabb;
  update(dt: number, world: VoxelQuery): void;
}
