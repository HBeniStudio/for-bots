import { DIRT, GRASS, STONE } from './world/blocks';
import { CHUNK_X, CHUNK_Z } from './world/chunk';
import { World } from './world/world';
import { Camera } from './render/camera';
import { collectDrawList, renderWorld, type DrawnBlock } from './render/renderer';

/** Flat 5×5 chunk pad (≥3×3) with grass, dirt, and stone. */
function createFlatTestWorld(): World {
  const world = new World();
  const radius = 2;
  const x0 = -radius * CHUNK_X;
  const z0 = -radius * CHUNK_Z;
  const x1 = (radius + 1) * CHUNK_X;
  const z1 = (radius + 1) * CHUNK_Z;

  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) world.ensureChunk(cx, cz);
  }

  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      world.setBlock(x, 0, z, STONE);
      world.setBlock(x, 1, z, DIRT);
      const onRoad = x === 8 || z === 8;
      world.setBlock(x, 2, z, onRoad ? STONE : GRASS);
    }
  }

  const layers: ReadonlyArray<{ y: number; r: number; id: number }> = [
    { y: 3, r: 3, id: DIRT },
    { y: 4, r: 2, id: DIRT },
    { y: 5, r: 1, id: GRASS },
    { y: 6, r: 0, id: STONE },
  ];
  for (const layer of layers) {
    for (let dz = -layer.r; dz <= layer.r; dz++) {
      for (let dx = -layer.r; dx <= layer.r; dx++) {
        world.setBlock(8 + dx, layer.y, 8 + dz, layer.id);
      }
    }
  }

  return world;
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

  const world = createFlatTestWorld();
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

    const viewChanged =
      camera.focusX !== listCameraX ||
      camera.focusZ !== listCameraZ ||
      camera.zoom !== listZoom ||
      camera.screenW !== listW ||
      camera.screenH !== listH;
    if (viewChanged) {
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
