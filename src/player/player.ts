import type { Entity, Vec3 } from '../entity/entity';
import type { Camera } from '../render/camera';
import { shadeFaceColor } from '../render/renderer';
import type { FaceColors } from '../world/blocks';
import { LEAVES, LOG } from '../world/blocks';
import { CHUNK_Y } from '../world/chunk';
import { SEA_LEVEL, columnAt } from '../world/gen/terrain';
import { sampleLight, sunlightFactor, type ShadedFace } from '../world/light';
import { World, worldToChunk } from '../world/world';
import { bodyAabb, isSolid, stepBody, type Body, type VoxelQuery } from './physics';

interface Part {
  /** Offset of the part's base from the feet. */
  oy: number;
  w: number;
  h: number;
  d: number;
  colors: FaceColors;
}

/** Drawn a little inside the hitbox so the silhouette matches the collider. */
const PARTS: readonly Part[] = [
  {
    oy: 0,
    w: 0.36,
    h: 0.84,
    d: 0.28,
    colors: { top: '#6b4b38', left: '#553b2c', right: '#3f2c20' },
  },
  {
    oy: 0.74,
    w: 0.52,
    h: 0.58,
    d: 0.32,
    colors: { top: '#ff9347', left: '#e36d28', right: '#c45416' },
  },
  {
    oy: 1.26,
    w: 0.4,
    h: 0.44,
    d: 0.4,
    colors: { top: '#ffe0c2', left: '#f0c4a4', right: '#e0ae8c' },
  },
];

/**
 * Screen-space movement mapped onto the ground.
 * `forward` +1 is toward the top of the screen (−x and −z).
 * `strafe` +1 is toward the right of the screen (+x and −z).
 */
export function wishVector(forward: number, strafe: number): { x: number; z: number } {
  return {
    x: strafe - forward,
    z: -strafe - forward,
  };
}

export class Player implements Entity {
  readonly body: Body;
  /** Feet position. Writes go through to {@link body}. */
  readonly pos: Vec3;
  /** Blocks per second. Writes go through to {@link body}. */
  readonly vel: Vec3;

  constructor(x: number, y: number, z: number, onGround = false) {
    const body: Body = { x, y, z, vx: 0, vy: 0, vz: 0, onGround };
    this.body = body;
    this.pos = {
      get x() {
        return body.x;
      },
      set x(v: number) {
        body.x = v;
      },
      get y() {
        return body.y;
      },
      set y(v: number) {
        body.y = v;
      },
      get z() {
        return body.z;
      },
      set z(v: number) {
        body.z = v;
      },
    };
    this.vel = {
      get x() {
        return body.vx;
      },
      set x(v: number) {
        body.vx = v;
      },
      get y() {
        return body.vy;
      },
      set y(v: number) {
        body.vy = v;
      },
      get z() {
        return body.vz;
      },
      set z(v: number) {
        body.vz = v;
      },
    };
  }

  /** Current collider. Same box {@link bodyAabb} reports for {@link body}. */
  get aabb() {
    return bodyAabb(this.body);
  }

  /**
   * Integrate one tick. `forward`, `strafe`, and `jump` are the player's
   * input for this tick; omitted input is idle, which matches {@link Entity}.
   */
  update(dt: number, world: VoxelQuery, forward = 0, strafe = 0, jump = false): void {
    const wish = wishVector(forward, strafe);
    stepBody(this.body, world, dt, wish.x, wish.z, jump);
  }
}

function standHeight(world: World, x: number, z: number): number | null {
  for (let y = CHUNK_Y - 4; y >= 1; y--) {
    const floor = world.getBlock(x, y - 1, z);
    // Canopy is a poor spawn: stand on terrain, not logs or leaves.
    if (!isSolid(floor) || floor === LEAVES || floor === LOG) continue;
    if (isSolid(world.getBlock(x, y, z))) continue;
    if (isSolid(world.getBlock(x, y + 1, z))) continue;
    if (isSolid(world.getBlock(x, y + 2, z))) continue;
    return y;
  }
  return null;
}

/** First dry column with headroom, spiraling out from the start chunk. */
export function spawnPlayer(world: World): Player {
  const originX = 8;
  const originZ = 8;
  for (let r = 0; r <= 48; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r !== 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = originX + dx;
        const z = originZ + dz;
        if (columnAt(world.seed, x, z).height < SEA_LEVEL) continue;
        const { cx, cz } = worldToChunk(x, z);
        world.generateChunk(cx, cz);
        const y = standHeight(world, x, z);
        if (y === null) continue;
        return new Player(x + 0.5, y, z + 0.5, true);
      }
    }
  }
  const { cx, cz } = worldToChunk(originX, originZ);
  world.generateChunk(cx, cz);
  return new Player(originX + 0.5, CHUNK_Y - 4, originZ + 0.5, false);
}

function fillFace(
  ctx: CanvasRenderingContext2D,
  pts: readonly { x: number; y: number }[],
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(24, 16, 10, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawPart(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  x: number,
  y: number,
  z: number,
  part: Part,
  tint: (hex: string, face: ShadedFace) => string,
): void {
  const x0 = x - part.w / 2;
  const x1 = x + part.w / 2;
  const y0 = y + part.oy;
  const y1 = y0 + part.h;
  const z0 = z - part.d / 2;
  const z1 = z + part.d / 2;
  const s = (px: number, py: number, pz: number) => camera.worldToScreen(px, py, pz);
  fillFace(
    ctx,
    [s(x1, y1, z1), s(x1, y1, z0), s(x1, y0, z0), s(x1, y0, z1)],
    tint(part.colors.right, 'right'),
  );
  fillFace(
    ctx,
    [s(x0, y1, z1), s(x1, y1, z1), s(x1, y0, z1), s(x0, y0, z1)],
    tint(part.colors.left, 'left'),
  );
  fillFace(
    ctx,
    [s(x0, y1, z0), s(x1, y1, z0), s(x1, y1, z1), s(x0, y1, z1)],
    tint(part.colors.top, 'top'),
  );
}

/**
 * Iso character. Caller depth-sorts this draw against the world.
 * With a world, the body uses the same light and night tint as the blocks
 * around the torso, so the player darkens after sunset and warms near a torch.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  player: Player,
  world?: World,
  timeSec = 0,
): void {
  const { x, y, z } = player.body;
  const sun = sunlightFactor(timeSec);
  let tint: (hex: string, face: ShadedFace) => string = (hex) => hex;
  if (world) {
    const lit = sampleLight(world, Math.floor(x), Math.floor(y + 1), Math.floor(z), sun);
    tint = (hex, face) => shadeFaceColor(hex, lit.combined, face, sun, lit.block);
  }
  for (const part of PARTS) drawPart(ctx, camera, x, y, z, part, tint);
}
