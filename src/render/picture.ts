import { Camera } from './camera';
import { compareBlockDepth, worldToIso, type DepthPoint } from './iso';
import type { DrawnBlock, DepthSprite } from './renderer';

/** Extra pixels baked around the viewport so a short walk does not rebake. */
export const VIEW_MARGIN = 320;
/** While chunks are still streaming, rebake at this interval instead of every frame. */
const REBAKE_MS = 280;
const SUN_STEPS = 32;

export function sunBucket(sun: number): number {
  if (!Number.isFinite(sun) || sun <= 0) return 0;
  if (sun >= 1) return SUN_STEPS;
  return Math.round(sun * SUN_STEPS);
}

/**
 * Source origin for blitting a picture baked at `bake` onto a camera at `focus`.
 * `dx`/`dy` are the screen shift of world content (positive moves content down-right).
 */
export function blitOrigin(
  bakeX: number,
  bakeY: number,
  bakeZ: number,
  focusX: number,
  focusY: number,
  focusZ: number,
  zoom: number,
  margin = VIEW_MARGIN,
): { sx: number; sy: number; dx: number; dy: number } {
  const bake = worldToIso(bakeX, bakeY, bakeZ);
  const cur = worldToIso(focusX, focusY, focusZ);
  const dx = (bake.x - cur.x) * zoom;
  const dy = (bake.y - cur.y) * zoom;
  return { sx: margin - dx, sy: margin - dy, dx, dy };
}

/** True when a block's center is inside the viewport, with padding for the cube. */
export function isBlockOnScreen(camera: Camera, x: number, y: number, z: number): boolean {
  const p = camera.worldToScreen(x + 0.5, y + 0.5, z + 0.5);
  const pad = 96 * camera.zoom + 8;
  return p.x >= -pad && p.y >= -pad && p.x <= camera.screenW + pad && p.y <= camera.screenH + pad;
}

interface Picture {
  canvas: HTMLCanvasElement;
  sig: string;
  sunQ: number;
  zoom: number;
  screenW: number;
  screenH: number;
  focusX: number;
  focusY: number;
  focusZ: number;
  edit: number;
  seed: number;
  bakedAt: number;
}

let picture: Picture | null = null;

function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

type Paint = (ctx: CanvasRenderingContext2D, camera: Camera, block: DrawnBlock, sun: number) => void;

/**
 * Draw the world from a cached picture when the browser has a canvas.
 * Returns false when the caller should paint blocks directly.
 * Sprites are drawn on top and blocks in front of them are repainted so the
 * player still disappears behind terrain.
 */
export function paintCachedView(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  blocks: readonly DrawnBlock[],
  sprites: readonly DepthSprite[],
  sun: number,
  signature: string,
  editSerial: number,
  seed: number,
  sky: string,
  paint: Paint,
): boolean {
  if (!canvasAvailable() || blocks.length === 0) return false;
  const sunQ = sunBucket(sun);
  const now = performance.now();
  if (needsBake(camera, signature, sunQ, editSerial, seed, now)) {
    const baked = bake(camera, blocks, sun, signature, sunQ, editSerial, seed, sky, paint, now);
    if (!baked) return false;
    picture = baked;
  }
  const frame = picture;
  if (!frame) return false;
  const origin = blitOrigin(
    frame.focusX,
    frame.focusY,
    frame.focusZ,
    camera.focusX,
    camera.focusY,
    camera.focusZ,
    camera.zoom,
  );
  ctx.drawImage(
    frame.canvas,
    origin.sx,
    origin.sy,
    camera.screenW,
    camera.screenH,
    0,
    0,
    camera.screenW,
    camera.screenH,
  );
  occlude(ctx, camera, blocks, sprites, sun, paint);
  return true;
}

function needsBake(
  camera: Camera,
  signature: string,
  sunQ: number,
  editSerial: number,
  seed: number,
  now: number,
): boolean {
  const frame = picture;
  if (!frame) return true;
  if (frame.seed !== seed) return true;
  if (frame.zoom !== camera.zoom || frame.screenW !== camera.screenW || frame.screenH !== camera.screenH) return true;
  if (frame.sunQ !== sunQ) return true;
  const shift = blitOrigin(frame.focusX, frame.focusY, frame.focusZ, camera.focusX, camera.focusY, camera.focusZ, camera.zoom);
  if (Math.abs(shift.dx) > VIEW_MARGIN || Math.abs(shift.dy) > VIEW_MARGIN) return true;
  if (frame.edit !== editSerial) return true;
  if (frame.sig !== signature && now - frame.bakedAt >= REBAKE_MS) return true;
  return false;
}

function bake(
  camera: Camera,
  blocks: readonly DrawnBlock[],
  sun: number,
  signature: string,
  sunQ: number,
  editSerial: number,
  seed: number,
  sky: string,
  paint: Paint,
  now: number,
): Picture | null {
  const width = Math.ceil(camera.screenW + VIEW_MARGIN * 2);
  const height = Math.ceil(camera.screenH + VIEW_MARGIN * 2);
  let canvas = picture?.canvas ?? null;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const baked = canvas.getContext('2d');
  if (!baked) return null;
  const view = new Camera();
  view.zoom = camera.zoom;
  view.focusX = camera.focusX;
  view.focusY = camera.focusY;
  view.focusZ = camera.focusZ;
  view.screenW = width;
  view.screenH = height;
  baked.setTransform(1, 0, 0, 1, 0, 0);
  baked.fillStyle = sky;
  baked.fillRect(0, 0, width, height);
  for (const block of blocks) {
    if (!isBlockOnScreen(view, block.x, block.y, block.z)) continue;
    paint(baked, view, block, sun);
  }
  return {
    canvas,
    sig: signature,
    sunQ,
    zoom: camera.zoom,
    screenW: camera.screenW,
    screenH: camera.screenH,
    focusX: camera.focusX,
    focusY: camera.focusY,
    focusZ: camera.focusZ,
    edit: editSerial,
    seed,
    bakedAt: now,
  };
}

function occlude(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  blocks: readonly DrawnBlock[],
  sprites: readonly DepthSprite[],
  sun: number,
  paint: Paint,
): void {
  if (sprites.length === 0 || blocks.length === 0) {
    for (const sprite of sprites) sprite.draw(ctx);
    return;
  }
  const ordered = sprites.length > 1 ? [...sprites].sort(compareBlockDepth) : sprites;
  const slop = 64 * camera.zoom + 12;
  for (const sprite of ordered) {
    sprite.draw(ctx);
    const p = camera.worldToScreen(sprite.x, sprite.y, sprite.z);
    const padX = 56 * camera.zoom + 8;
    const padY = 120 * camera.zoom + 8;
    const x0 = p.x - padX;
    const x1 = p.x + padX;
    const y0 = p.y - padY;
    const y1 = p.y + padX * 0.5;
    if (x1 < 0 || y1 < 0 || x0 > camera.screenW || y0 > camera.screenH) continue;
    for (let i = firstInFront(blocks, sprite); i < blocks.length; i++) {
      const block = blocks[i]!;
      const q = camera.worldToScreen(block.x + 0.5, block.y + 0.5, block.z + 0.5);
      if (q.x < x0 - slop || q.x > x1 + slop || q.y < y0 - slop || q.y > y1 + slop) continue;
      paint(ctx, camera, block, sun);
    }
  }
}

function firstInFront(blocks: readonly DrawnBlock[], sprite: DepthPoint): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareBlockDepth(blocks[mid]!, sprite) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
