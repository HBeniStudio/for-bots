import { AIR, FACE_COLORS, LIGHT_MAX } from '../world/blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, type Chunk } from '../world/chunk';
import { exposedFaceLight, sunlightFactor, type ShadedFace } from '../world/light';
import { World } from '../world/world';
import { Camera } from './camera';
import { compareBlockDepth, type IsoPoint } from './iso';
import { isBlockOnScreen, paintCachedView } from './picture';

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

/** Something drawn in painter's order with the blocks, such as the player. */
export interface DepthSprite {
  x: number;
  y: number;
  z: number;
  draw(ctx: CanvasRenderingContext2D): void;
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

const meshes = new WeakMap<Chunk, { geom: number; blocks: DrawnBlock[] }>();
const assembly = new WeakMap<World, { sig: string; list: DrawnBlock[] }>();
const signatures = new WeakMap<readonly DrawnBlock[], string>();

function chunkMesh(world: World, chunk: Chunk): readonly DrawnBlock[] {
  const hit = meshes.get(chunk);
  if (hit && hit.geom === chunk.geom) return hit.blocks;
  const blocks = buildChunkMesh(world, chunk);
  meshes.set(chunk, { geom: chunk.geom, blocks });
  return blocks;
}

function buildChunkMesh(world: World, chunk: Chunk): DrawnBlock[] {
  const draw: DrawnBlock[] = [];
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
  return draw;
}

/**
 * Exposed blocks in visible chunks, already sorted back-to-front
 * (increasing x+z, then increasing y). Meshes are cached until a chunk's
 * blocks change, and the merged list is cached until the visible set changes.
 */
export function collectDrawList(world: World, camera: Camera): DrawnBlock[] {
  const visible: Chunk[] = [];
  world.forEachChunk((chunk) => {
    if (isChunkVisible(chunk, camera)) visible.push(chunk);
  });
  visible.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
  let sig = '';
  for (const chunk of visible) sig += `${chunk.cx},${chunk.cz}:${chunk.geom}|`;
  const cached = assembly.get(world);
  if (cached && cached.sig === sig) return cached.list;
  const draw: DrawnBlock[] = [];
  for (const chunk of visible) {
    const mesh = chunkMesh(world, chunk);
    for (const block of mesh) draw.push(block);
  }
  draw.sort(compareBlockDepth);
  signatures.set(draw, sig);
  assembly.set(world, { sig, list: draw });
  return draw;
}

/** Fixed per-face darkening on top of the block palette. Top stays the brightest. */
export const FACE_SHADE = { top: 1, left: 0.9, right: 0.8 } as const;

const DAY_SKY: readonly [number, number, number] = [0x9f, 0xd4, 0xef];
const NIGHT_SKY: readonly [number, number, number] = [0x07, 0x0b, 0x16];
const NIGHT_TINT: readonly [number, number, number] = [0.62, 0.7, 0.95];

/** Sky backdrop. Noon matches the page background; midnight is near-black blue. */
export function skyColor(sun: number): string {
  return rgbHex(mixRgb(NIGHT_SKY, DAY_SKY, clamp01(sun)));
}

/**
 * Block face color after light level, the fixed face bias, and the night tint.
 * `blockLight` is the torch contribution inside `light`. A face lit only by a
 * torch keeps its warm color after sunset.
 */
export function shadeFaceColor(
  hex: string,
  light: number,
  face: ShadedFace,
  sun = 1,
  blockLight = 0,
): string {
  const [r, g, b] = parseHex(hex);
  const level = clampLight(light) / LIGHT_MAX;
  const gain = (0.05 + 0.95 * level) * FACE_SHADE[face];
  const night = 1 - clamp01(sun);
  const torchShare = light <= 0 ? 0 : Math.min(1, Math.max(0, blockLight) / light);
  const tintMix = night * (1 - torchShare);
  return rgbHex([
    r * gain * (1 + (NIGHT_TINT[0] - 1) * tintMix),
    g * gain * (1 + (NIGHT_TINT[1] - 1) * tintMix),
    b * gain * (1 + (NIGHT_TINT[2] - 1) * tintMix),
  ]);
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

function drawBlock(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  world: World,
  block: DrawnBlock,
  sun: number,
): void {
  const colors = FACE_COLORS[block.id];
  if (!colors) return;
  const { x, y, z } = block;
  const paint = (face: ShadedFace, color: string): string => {
    const lit = exposedFaceLight(world, x, y, z, face, sun);
    return shadeFaceColor(color, lit.light, face, sun, lit.block);
  };
  if (block.right) {
    fillFace(
      ctx,
      [
        camera.worldToScreen(x + 1, y + 1, z + 1),
        camera.worldToScreen(x + 1, y + 1, z),
        camera.worldToScreen(x + 1, y, z),
        camera.worldToScreen(x + 1, y, z + 1),
      ],
      paint('right', colors.right),
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
      paint('left', colors.left),
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
      paint('top', colors.top),
    );
  }
}

function paintAll(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  blocks: readonly DrawnBlock[],
  sprites: readonly DepthSprite[],
  sun: number,
): void {
  const queue = sprites.length > 1 ? [...sprites].sort(compareBlockDepth) : sprites;
  let spriteIndex = 0;
  for (const block of blocks) {
    if (!isBlockOnScreen(camera, block.x, block.y, block.z)) continue;
    while (spriteIndex < queue.length && compareBlockDepth(queue[spriteIndex]!, block) < 0) {
      queue[spriteIndex]!.draw(ctx);
      spriteIndex += 1;
    }
    drawBlock(ctx, camera, world, block, sun);
  }
  for (; spriteIndex < queue.length; spriteIndex += 1) queue[spriteIndex]!.draw(ctx);
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  blocks: readonly DrawnBlock[],
  sprites: readonly DepthSprite[] = [],
  timeSec = 0,
): RenderStats {
  const sun = sunlightFactor(timeSec);
  const sky = skyColor(sun);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, camera.screenW, camera.screenH);
  const cached = paintCachedView(
    ctx,
    camera,
    blocks,
    sprites,
    sun,
    signatures.get(blocks) ?? '',
    world.editSerial,
    world.seed,
    sky,
    (drawCtx, drawCamera, block, drawSun) => drawBlock(drawCtx, drawCamera, world, block, drawSun),
  );
  if (!cached) paintAll(ctx, world, camera, blocks, sprites, sun);

  let chunksDrawn = 0;
  world.forEachChunk((chunk) => {
    if (isChunkVisible(chunk, camera)) chunksDrawn += 1;
  });
  return {
    chunksLoaded: world.chunkCount,
    chunksDrawn,
    blocksDrawn: blocks.length,
  };
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function rgbHex(rgb: readonly [number, number, number]): string {
  const channel = (n: number): string => {
    const byte = n <= 0 ? 0 : n >= 255 ? 255 : Math.round(n);
    return byte.toString(16).padStart(2, '0');
  };
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function clampLight(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= LIGHT_MAX) return LIGHT_MAX;
  return n;
}
