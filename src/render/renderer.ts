import { AIR, FACE_COLORS } from '../world/blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, type Chunk } from '../world/chunk';
import { World } from '../world/world';
import { Camera } from './camera';
import { compareBlockDepth, type IsoPoint } from './iso';

export interface DrawnBlock {
  x: number;
  y: number;
  z: number;
  id: number;
  top: boolean;
  /** +z face, drawn on the screen-left of the cube. */
  left: boolean;
  /** +x face, drawn on the screen-right of the cube. */
  right: boolean;
}

export interface RenderStats {
  chunksLoaded: number;
  chunksDrawn: number;
  blocksDrawn: number;
}

export interface ExposedFaces {
  top: boolean;
  left: boolean;
  right: boolean;
}

/** Faces that border air. Fully buried blocks return null and are not drawn. */
export function exposedFaces(world: World, x: number, y: number, z: number): ExposedFaces | null {
  if (world.getBlock(x, y, z) === AIR) return null;
  const top = world.getBlock(x, y + 1, z) === AIR;
  const left = world.getBlock(x, y, z + 1) === AIR;
  const right = world.getBlock(x + 1, y, z) === AIR;
  if (!top && !left && !right) return null;
  return { top, left, right };
}

/** Chunk screen AABB vs the viewport. Empty chunks and off-screen chunks are skipped. */
export function isChunkVisible(chunk: Chunk, camera: Camera): boolean {
  if (chunk.maxY < 0) return false;
  const x0 = chunk.cx * CHUNK_X;
  const z0 = chunk.cz * CHUNK_Z;
  const x1 = x0 + CHUNK_X;
  const z1 = z0 + CHUNK_Z;
  const y1 = chunk.maxY + 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [x0, 0, z0],
    [x1, 0, z0],
    [x0, 0, z1],
    [x1, 0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x0, y1, z1],
    [x1, y1, z1],
  ];
  for (const [x, y, z] of corners) {
    const p = camera.worldToScreen(x, y, z);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX >= 0 && minX <= camera.screenW && maxY >= 0 && minY <= camera.screenH;
}

function neighbor(world: World, chunk: Chunk, lx: number, y: number, lz: number): number {
  if (y < 0 || y >= CHUNK_Y) return AIR;
  if (lx >= 0 && lx < CHUNK_X && lz >= 0 && lz < CHUNK_Z) return chunk.get(lx, y, lz);
  return world.getBlock(chunk.cx * CHUNK_X + lx, y, chunk.cz * CHUNK_Z + lz);
}

/**
 * Exposed blocks in visible chunks, already sorted back-to-front
 * (increasing x+z, then increasing y).
 */
export function collectDrawList(world: World, camera: Camera): DrawnBlock[] {
  const draw: DrawnBlock[] = [];
  for (const chunk of world.loadedChunks()) {
    if (!isChunkVisible(chunk, camera)) continue;
    const baseX = chunk.cx * CHUNK_X;
    const baseZ = chunk.cz * CHUNK_Z;
    for (let y = 0; y <= chunk.maxY; y++) {
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let lx = 0; lx < CHUNK_X; lx++) {
          const id = chunk.get(lx, y, lz);
          if (id === AIR) continue;
          const top = neighbor(world, chunk, lx, y + 1, lz) === AIR;
          const left = neighbor(world, chunk, lx, y, lz + 1) === AIR;
          const right = neighbor(world, chunk, lx + 1, y, lz) === AIR;
          if (!top && !left && !right) continue;
          draw.push({
            x: baseX + lx,
            y,
            z: baseZ + lz,
            id,
            top,
            left,
            right,
          });
        }
      }
    }
  }
  draw.sort(compareBlockDepth);
  return draw;
}

function fillFace(ctx: CanvasRenderingContext2D, pts: readonly IsoPoint[], color: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBlock(ctx: CanvasRenderingContext2D, camera: Camera, block: DrawnBlock): void {
  const colors = FACE_COLORS[block.id];
  if (!colors) return;
  const { x, y, z } = block;
  if (block.right) {
    fillFace(
      ctx,
      [
        camera.worldToScreen(x + 1, y + 1, z + 1),
        camera.worldToScreen(x + 1, y + 1, z),
        camera.worldToScreen(x + 1, y, z),
        camera.worldToScreen(x + 1, y, z + 1),
      ],
      colors.right,
    );
  }
  if (block.left) {
    fillFace(
      ctx,
      [
        camera.worldToScreen(x, y + 1, z + 1),
        camera.worldToScreen(x + 1, y + 1, z + 1),
        camera.worldToScreen(x + 1, y, z + 1),
        camera.worldToScreen(x, y, z + 1),
      ],
      colors.left,
    );
  }
  if (block.top) {
    fillFace(
      ctx,
      [
        camera.worldToScreen(x, y + 1, z),
        camera.worldToScreen(x + 1, y + 1, z),
        camera.worldToScreen(x + 1, y + 1, z + 1),
        camera.worldToScreen(x, y + 1, z + 1),
      ],
      colors.top,
    );
  }
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  blocks: readonly DrawnBlock[],
): RenderStats {
  ctx.clearRect(0, 0, camera.screenW, camera.screenH);
  for (const block of blocks) drawBlock(ctx, camera, block);

  let chunksDrawn = 0;
  const loaded = world.loadedChunks();
  for (const chunk of loaded) {
    if (isChunkVisible(chunk, camera)) chunksDrawn++;
  }
  return {
    chunksLoaded: loaded.length,
    chunksDrawn,
    blocksDrawn: blocks.length,
  };
}
