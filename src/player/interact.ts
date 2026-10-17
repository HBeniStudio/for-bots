import type { Camera } from '../render/camera';
import { AIR } from '../world/blocks';
import { CHUNK_Y } from '../world/chunk';
import { World, worldToChunk } from '../world/world';
import { blockOverlapsBody, type Body } from './physics';

/** The three faces the iso renderer actually draws. */
export type BlockFace = 'top' | '+x' | '+z';

export interface BlockTarget {
  x: number;
  y: number;
  z: number;
  face: BlockFace;
}

/**
 * Distance along one axis to the next voxel boundary, moving in `dir` (±1).
 * An origin that already sits on a boundary still has a full cell to cross:
 * the sample starts just inside a cell, so a zero step would stall.
 */
function bound(origin: number, dir: number): number {
  const frac = origin - Math.floor(origin);
  if (dir > 0) return frac === 0 ? 1 : 1 - frac;
  return frac === 0 ? 1 : frac;
}

/**
 * First non-air voxel under the cursor.
 * The view is orthographic along (1, 1, 1): decreasing world y walks from the
 * camera into the scene, and the crossed face is one of top / +x / +z.
 */
export function pickBlock(camera: Camera, world: World, sx: number, sy: number): BlockTarget | null {
  const yStart = CHUNK_Y - 1e-4;
  const start = camera.screenToWorld(sx, sy, yStart);
  let x = Math.floor(start.x);
  let y = Math.floor(yStart);
  let z = Math.floor(start.z);
  let tMaxX = bound(start.x, -1);
  let tMaxY = bound(yStart, -1);
  let tMaxZ = bound(start.z, -1);

  const hit = (face: BlockFace): BlockTarget | null => {
    if (y < 0 || y >= CHUNK_Y) return null;
    if (world.getBlock(x, y, z) === AIR) return null;
    return { x, y, z, face };
  };

  const first = hit('top');
  if (first) return first;

  // Each step crosses one cell. The ray spans the world height on three axes.
  for (let n = 0; n < CHUNK_Y * 3 + 8; n++) {
    const minT = Math.min(tMaxX, tMaxY, tMaxZ);
    if (minT > CHUNK_Y + 2) return null;
    let steppedY = false;
    let steppedZ = false;
    const eps = 1e-8;
    if (Math.abs(tMaxX - minT) <= eps) {
      x -= 1;
      tMaxX += 1;
    }
    if (Math.abs(tMaxY - minT) <= eps) {
      y -= 1;
      tMaxY += 1;
      steppedY = true;
    }
    if (Math.abs(tMaxZ - minT) <= eps) {
      z -= 1;
      tMaxZ += 1;
      steppedZ = true;
    }
    if (y < 0) return null;
    const face: BlockFace = steppedY ? 'top' : steppedZ ? '+z' : '+x';
    const found = hit(face);
    if (found) return found;
  }
  return null;
}

export function faceNeighbor(target: BlockTarget): { x: number; y: number; z: number } {
  switch (target.face) {
    case 'top':
      return { x: target.x, y: target.y + 1, z: target.z };
    case '+x':
      return { x: target.x + 1, y: target.y, z: target.z };
    case '+z':
      return { x: target.x, y: target.y, z: target.z + 1 };
  }
}

/** Air only, inside the world, and not inside the player's body. */
export function canPlaceAt(world: World, body: Body, x: number, y: number, z: number): boolean {
  if (y < 0 || y >= CHUNK_Y) return false;
  if (world.getBlock(x, y, z) !== AIR) return false;
  return !blockOverlapsBody(body, x, y, z);
}

export function breakTarget(world: World, target: BlockTarget): void {
  world.setBlock(target.x, target.y, target.z, AIR);
}

/** Place `id` on the targeted face. Returns false when the cell is blocked. */
export function placeOnTarget(world: World, body: Body, target: BlockTarget, id: number): boolean {
  if (id === AIR) return false;
  const cell = faceNeighbor(target);
  if (cell.y < 0 || cell.y >= CHUNK_Y) return false;
  const { cx, cz } = worldToChunk(cell.x, cell.z);
  if (!world.getChunk(cx, cz)) world.generateChunk(cx, cz);
  if (!canPlaceAt(world, body, cell.x, cell.y, cell.z)) return false;
  world.setBlock(cell.x, cell.y, cell.z, id);
  return true;
}

function faceCorners(target: BlockTarget): readonly (readonly [number, number, number])[] {
  const { x, y, z } = target;
  if (target.face === 'top') {
    return [
      [x, y + 1, z],
      [x + 1, y + 1, z],
      [x + 1, y + 1, z + 1],
      [x, y + 1, z + 1],
    ];
  }
  if (target.face === '+x') {
    return [
      [x + 1, y + 1, z + 1],
      [x + 1, y + 1, z],
      [x + 1, y, z],
      [x + 1, y, z + 1],
    ];
  }
  return [
    [x, y + 1, z + 1],
    [x + 1, y + 1, z + 1],
    [x + 1, y, z + 1],
    [x, y, z + 1],
  ];
}

/** White overlay on the hovered face so the break/place target is obvious. */
export function drawTarget(ctx: CanvasRenderingContext2D, camera: Camera, target: BlockTarget): void {
  const pts = faceCorners(target).map(([x, y, z]) => camera.worldToScreen(x, y, z));
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(1.5, camera.zoom * 2);
  ctx.stroke();
}
