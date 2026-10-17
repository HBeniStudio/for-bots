import { AIR } from '../world/blocks';
import { CHUNK_Y } from '../world/chunk';

/** Horizontal size. Narrow enough to walk through a one-block gap. */
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HALF = PLAYER_WIDTH / 2;

/** Blocks per second squared, applied downward. */
export const GRAVITY = 28;
/**
 * Upward speed on jump. Clears a one-block ledge (~1.4 blocks of rise)
 * and falls short of a two-block ledge.
 */
export const JUMP_SPEED = 9.4;
/** Fastest downward speed, in blocks per second. */
export const TERMINAL_VELOCITY = 36;
export const WALK_SPEED = 4.8;

/**
 * Largest single sweep. The player's overlap with a one-block wall is wider
 * than this, so a substep cannot start and end on opposite sides of a solid.
 */
const MAX_STEP = 0.45;
/** Ignore overlaps thinner than this so resting exactly on a face is not a hit. */
const SKIN = 1e-4;

export interface Body {
  /** Center of the feet on x. */
  x: number;
  /** Feet height. */
  y: number;
  /** Center of the feet on z. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /**
   * Full extents in blocks. Omitted fields use the player size, so existing
   * bodies keep the original collider.
   */
  width?: number;
  depth?: number;
  height?: number;
}

export interface VoxelQuery {
  getBlock(x: number, y: number, z: number): number;
}

export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Every block except air stops the player, including water (there is no swim). */
export function isSolid(id: number): boolean {
  return id !== AIR;
}

export function bodyAabb(body: Body): Aabb {
  const halfW = (body.width ?? PLAYER_WIDTH) / 2;
  const halfD = (body.depth ?? PLAYER_WIDTH) / 2;
  const height = body.height ?? PLAYER_HEIGHT;
  return {
    minX: body.x - halfW,
    maxX: body.x + halfW,
    minY: body.y,
    maxY: body.y + height,
    minZ: body.z - halfD,
    maxZ: body.z + halfD,
  };
}

/** True when the body volume intersects the closed cell at integer (bx, by, bz). */
export function blockOverlapsBody(body: Body, bx: number, by: number, bz: number): boolean {
  const a = bodyAabb(body);
  return (
    a.minX < bx + 1 - SKIN &&
    a.maxX > bx + SKIN &&
    a.minY < by + 1 - SKIN &&
    a.maxY > by + SKIN &&
    a.minZ < bz + 1 - SKIN &&
    a.maxZ > bz + SKIN
  );
}

/** True when the body intersects a solid voxel. Cells below the world are solid. */
export function overlapsSolid(world: VoxelQuery, body: Body): boolean {
  const a = bodyAabb(body);
  const x0 = Math.floor(a.minX);
  const x1 = Math.floor(a.maxX - SKIN);
  const y0 = Math.floor(a.minY);
  const y1 = Math.floor(a.maxY - SKIN);
  const z0 = Math.floor(a.minZ);
  const z1 = Math.floor(a.maxZ - SKIN);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!blockOverlapsBody(body, x, y, z)) continue;
        if (y < 0) return true;
        if (y >= CHUNK_Y) continue;
        if (isSolid(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function snapFeet(body: Body, world: VoxelQuery): void {
  const snapped = Math.round(body.y);
  if (Math.abs(body.y - snapped) > 0.02) return;
  const prev = body.y;
  body.y = snapped;
  if (overlapsSolid(world, body)) body.y = prev;
}

/**
 * Move along one axis and stop at the first solid face.
 * The body must start outside solid voxels. X and Z do not affect `onGround`.
 */
export function moveAxis(body: Body, world: VoxelQuery, axis: 'x' | 'y' | 'z', delta: number): boolean {
  if (delta === 0) return false;
  const dir = Math.sign(delta);
  let remaining = delta;
  while (Math.abs(remaining) > 1e-9) {
    const sub = dir * Math.min(Math.abs(remaining), MAX_STEP);
    const start = body[axis];
    body[axis] = start + sub;
    if (!overlapsSolid(world, body)) {
      remaining -= sub;
      if (axis === 'y') body.onGround = false;
      continue;
    }
    let lo = 0;
    let hi = sub;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) * 0.5;
      body[axis] = start + mid;
      if (overlapsSolid(world, body)) hi = mid;
      else lo = mid;
    }
    body[axis] = start + lo;
    if (axis === 'x') body.vx = 0;
    else if (axis === 'z') body.vz = 0;
    else {
      body.vy = 0;
      body.onGround = delta < 0;
      if (body.onGround) snapFeet(body, world);
    }
    return true;
  }
  return false;
}

/**
 * Integrate one tick. Wish velocity replaces horizontal speed (input, not
 * momentum). Axes resolve independently so a wall slides instead of sticking,
 * in order x, then z, then y.
 */
export function stepBody(
  body: Body,
  world: VoxelQuery,
  dt: number,
  wishX: number,
  wishZ: number,
  jump: boolean,
  speed = WALK_SPEED,
): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const len = Math.hypot(wishX, wishZ);
  const pace = speed > 0 ? speed : 0;
  if (len > 1e-8 && pace > 0) {
    body.vx = (wishX / len) * pace;
    body.vz = (wishZ / len) * pace;
  } else {
    body.vx = 0;
    body.vz = 0;
  }
  if (jump && body.onGround) {
    body.vy = JUMP_SPEED;
    body.onGround = false;
  }
  body.vy = Math.max(-TERMINAL_VELOCITY, body.vy - GRAVITY * dt);
  moveAxis(body, world, 'x', body.vx * dt);
  moveAxis(body, world, 'z', body.vz * dt);
  moveAxis(body, world, 'y', body.vy * dt);
}
