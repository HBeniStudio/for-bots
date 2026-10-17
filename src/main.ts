import { CHUNK_X } from './world/chunk';
import { World } from './world/world';
import { Camera } from './render/camera';
import { collectDrawList, renderWorld, type DrawnBlock } from './render/renderer';
import { attachInput } from './player/input';
import { breakTarget, drawTarget, pickBlock, placeOnTarget } from './player/interact';
import { drawPlayer, spawnPlayer } from './player/player';
import { PLAYER_HEIGHT } from './player/physics';
import { Hotbar } from './ui/hotbar';

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
    const p = camera.screenToWorld(sx, sy, camera.focusY);
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
  held: string,
): void {
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const line = `${fps.toFixed(0)} fps  ·  ${chunksDrawn}/${chunksLoaded} chunks  ·  zoom ${zoom.toFixed(2)}  ·  ${held}`;
  const hint = 'WASD move   Space jump   drag look   LMB break   RMB place   1–9 / wheel select   Ctrl+wheel zoom';
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
  const player = spawnPlayer(world);
  const hotbar = new Hotbar();
  const input = attachInput(canvas, camera);

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.resize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener('resize', resize);
  resize();
  camera.follow(player.body.x, player.body.y + PLAYER_HEIGHT * 0.45, player.body.z);

  // Fill the opening view, but stop after a few milliseconds so the first
  // paint is not stuck behind a full neighborhood. The frame loop continues.
  const warmStart = performance.now();
  const warmRadius = viewChunkRadius(camera);
  while (performance.now() - warmStart < 12) {
    const aroundPlayer = world.generateAround(player.body.x, player.body.z, 1, STREAM_BUDGET);
    if (aroundPlayer > 0) continue;
    if (world.generateAround(camera.focusX, camera.focusZ, warmRadius, STREAM_BUDGET) === 0) break;
  }

  let last = performance.now();
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let drawList: DrawnBlock[] = collectDrawList(world, camera);
  let listCameraX = camera.focusX;
  let listCameraZ = camera.focusZ;
  let listCameraY = camera.focusY;
  let listZoom = camera.zoom;
  let listW = camera.screenW;
  let listH = camera.screenH;
  let dirty = false;

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const control = input.read();
    if (control.slot !== null) hotbar.select(control.slot);
    if (control.wheel !== 0) hotbar.cycle(control.wheel);

    // The player's own chunk comes first so a step never falls into air
    // that is only unloaded. Leftover budget streams the rest of the view.
    let generated = world.generateAround(player.body.x, player.body.z, 1, STREAM_BUDGET);
    if (generated < STREAM_BUDGET) {
      generated += world.generateAround(
        camera.focusX,
        camera.focusZ,
        viewChunkRadius(camera),
        STREAM_BUDGET - generated,
      );
    }

    player.update(world, dt, control.forward, control.strafe, control.jump);
    camera.follow(player.body.x, player.body.y + PLAYER_HEIGHT * 0.45, player.body.z);

    const barSlot = hotbar.slotAt(control.pointerX, control.pointerY, camera.screenW, camera.screenH);
    const target =
      control.pointerInside && barSlot === null
        ? pickBlock(camera, world, control.pointerX, control.pointerY)
        : null;
    if (barSlot !== null) {
      if (control.breakBlock) hotbar.select(barSlot);
    } else if (target && control.breakBlock) {
      breakTarget(world, target);
      dirty = true;
    } else if (target && control.placeBlock) {
      if (placeOnTarget(world, player.body, target, hotbar.selected)) dirty = true;
    }

    const viewChanged =
      Math.abs(camera.focusX - listCameraX) > 1e-4 ||
      Math.abs(camera.focusY - listCameraY) > 1e-4 ||
      Math.abs(camera.focusZ - listCameraZ) > 1e-4 ||
      camera.zoom !== listZoom ||
      camera.screenW !== listW ||
      camera.screenH !== listH;
    if (viewChanged || generated > 0 || dirty) {
      drawList = collectDrawList(world, camera);
      listCameraX = camera.focusX;
      listCameraY = camera.focusY;
      listCameraZ = camera.focusZ;
      listZoom = camera.zoom;
      listW = camera.screenW;
      listH = camera.screenH;
      dirty = false;
    }

    const stats = renderWorld(ctx, world, camera, drawList, [
      {
        x: player.body.x,
        y: player.body.y + PLAYER_HEIGHT * 0.5,
        z: player.body.z,
        draw: (drawCtx) => drawPlayer(drawCtx, camera, player),
      },
    ]);
    if (target) drawTarget(ctx, camera, target);
    hotbar.draw(ctx, camera.screenW, camera.screenH);
    drawHud(ctx, fps, camera.zoom, stats.chunksDrawn, stats.chunksLoaded, hotbar.label);

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
