import { CHUNK_X } from './world/chunk';
import { World } from './world/world';
import { Camera } from './render/camera';
import { collectDrawList, renderWorld, type DrawnBlock } from './render/renderer';

const WORLD_SEED = 0x150701;

/** How many new chunks one animation frame may build. */
const STREAM_BUDGET = 2;

/**
 * Chunk radius that covers the screen, plus one chunk so a pan doesn't
 * immediately show an unloaded edge. Capped so a zoom-out can't ask for
 * the whole world in one go.
 */
function viewChunkRadius(camera: Camera): number {
  let reach = 0;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [camera.screenW, 0],
    [0, camera.screenH],
    [camera.screenW, camera.screenH],
  ];
  for (const [sx, sy] of corners) {
    const p = camera.screenToWorld(sx, sy, 0);
    reach = Math.max(reach, Math.abs(p.x - camera.focusX), Math.abs(p.z - camera.focusZ));
  }
  return Math.min(8, Math.max(2, Math.ceil(reach / CHUNK_X) + 1));
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  fps: number,
  zoom: number,
  chunksDrawn: number,
  chunksLoaded: number,
): void {
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const line = `${fps.toFixed(0)} fps  ·  ${chunksDrawn}/${chunksLoaded} chunks  ·  zoom ${zoom.toFixed(2)}`;
  const hint = 'WASD / arrows / drag to pan   ·   wheel to zoom';
  const width = Math.max(ctx.measureText(line).width, ctx.measureText(hint).width);
  ctx.fillStyle = 'rgba(12, 28, 36, 0.55)';
  ctx.fillRect(10, 10, width + 20, 46);
  ctx.fillStyle = '#f4fbff';
  ctx.fillText(line, 20, 28);
  ctx.fillStyle = '#d5eaf3';
  ctx.fillText(hint, 20, 46);
}

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('missing #game canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  const world = new World(WORLD_SEED);
  const camera = new Camera();
  const keys = new Set<string>();

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.resize(window.innerWidth, window.innerHeight);
  };

  const pointerPos = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    const p = pointerPos(event);
    lastX = p.x;
    lastY = p.y;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const p = pointerPos(event);
    camera.drag(p.x - lastX, p.y - lastY);
    lastX = p.x;
    lastY = p.y;
  });
  const endDrag = (): void => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const dy = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const p = pointerPos(event);
      camera.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    keys.add(event.key);
    if (event.key.startsWith('Arrow')) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.key);
  });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);

  resize();
  // Fill the opening view, but stop after a few milliseconds so the first
  // paint is not stuck behind a full neighborhood. The frame loop continues.
  const warmStart = performance.now();
  const warmRadius = viewChunkRadius(camera);
  while (performance.now() - warmStart < 12) {
    if (world.generateAround(camera.focusX, camera.focusZ, warmRadius, STREAM_BUDGET) === 0) break;
  }

  let last = performance.now();
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let drawList: DrawnBlock[] = collectDrawList(world, camera);
  let listCameraX = camera.focusX;
  let listCameraZ = camera.focusZ;
  let listZoom = camera.zoom;
  let listW = camera.screenW;
  let listH = camera.screenH;

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    let forward = 0;
    let strafe = 0;
    if (keys.has('w') || keys.has('W') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('s') || keys.has('S') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('d') || keys.has('D') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('a') || keys.has('A') || keys.has('ArrowLeft')) strafe -= 1;
    if (forward !== 0 || strafe !== 0) {
      const len = Math.hypot(forward, strafe);
      camera.panPixels(forward / len, strafe / len, 480 * dt);
    }

    const generated = world.generateAround(
      camera.focusX,
      camera.focusZ,
      viewChunkRadius(camera),
      STREAM_BUDGET,
    );

    const viewChanged =
      camera.focusX !== listCameraX ||
      camera.focusZ !== listCameraZ ||
      camera.zoom !== listZoom ||
      camera.screenW !== listW ||
      camera.screenH !== listH;
    if (viewChanged || generated > 0) {
      drawList = collectDrawList(world, camera);
      listCameraX = camera.focusX;
      listCameraZ = camera.focusZ;
      listZoom = camera.zoom;
      listW = camera.screenW;
      listH = camera.screenH;
    }

    const stats = renderWorld(ctx, world, camera, drawList);
    drawHud(ctx, fps, camera.zoom, stats.chunksDrawn, stats.chunksLoaded);

    fpsAccum += dt;
    fpsFrames += 1;
    if (fpsAccum >= 0.3) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main();
