import { loadContent } from './content/loader';
import { attachInput } from './player/input';
import { breakTarget, drawTarget, pickBlock, placeOnTarget } from './player/interact';
import { PLAYER_HEIGHT } from './player/physics';
import { Player, drawPlayer, spawnPlayer } from './player/player';
import { EntitySystem } from './entities/system';
import { Camera } from './render/camera';
import { collectDrawList, renderWorld, type DrawnBlock } from './render/renderer';
import {
  applyChunkDiffs,
  attachEditLog,
  bindUnloadSave,
  browserStore,
  clearSnapshot,
  memoryStore,
  parseSeed,
  readSnapshot,
  writeSnapshot,
  SaveClock,
  type KeyValueStore,
  type SaveSnapshot,
} from './save/save';
import { Hud, biomeAt, dayPhase } from './ui/hud';
import { Hotbar } from './ui/hotbar';
import { mountMenu } from './ui/menu';
import { CHUNK_X } from './world/chunk';
import { World } from './world/world';

/** How many new chunks one animation frame may build. */
const STREAM_BUDGET = 2;

interface Session {
  save(): void;
  stop(): void;
}

type Boot =
  | { kind: 'new'; seed: number }
  | { kind: 'load'; snapshot: SaveSnapshot };

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

function gameSurface(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (!canvas) throw new Error('missing #game canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  return { canvas, ctx };
}

function main(): void {
  // Creature JSON is checked at startup. An empty or missing content/ is valid.
  loadContent();

  const { canvas, ctx } = gameSurface();

  const persistent = browserStore();
  const store: KeyValueStore = persistent ?? memoryStore();
  let view: Camera | null = null;

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view?.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  let running: Session | null = null;

  const openMenu = (): void => {
    running?.save();
    running?.stop();
    running = null;
    menu.setSave(readSnapshot(store), persistent !== null);
    menu.show();
  };

  const startNew = (seedText: string): void => {
    if (readSnapshot(store) && !window.confirm('Start a new world and replace the saved one?')) return;
    running?.stop();
    running = null;
    menu.hide();
    running = startSession({ kind: 'new', seed: parseSeed(seedText) });
    running.save();
  };

  const continueGame = (): void => {
    const snapshot = readSnapshot(store);
    if (!snapshot) {
      menu.setSave(null, persistent !== null);
      return;
    }
    running?.stop();
    running = null;
    menu.hide();
    running = startSession({ kind: 'load', snapshot });
  };

  const resetSave = (): void => {
    if (!readSnapshot(store)) {
      menu.setSave(null, persistent !== null);
      return;
    }
    if (!window.confirm('Delete the saved world?')) return;
    clearSnapshot(store);
    menu.setSave(null, persistent !== null);
  };

  const menu = mountMenu(document.body, {
    onNewWorld: startNew,
    onContinue: continueGame,
    onReset: resetSave,
  });

  function startSession(boot: Boot): Session {
    const snapshot = boot.kind === 'load' ? boot.snapshot : null;
    const world = new World(boot.kind === 'load' ? boot.snapshot.seed : boot.seed);
    const diffs = attachEditLog(world);
    if (snapshot) applyChunkDiffs(world, snapshot.chunks);

    const player = snapshot
      ? new Player(snapshot.player.x, snapshot.player.y, snapshot.player.z, snapshot.player.onGround)
      : spawnPlayer(world);
    // The body overlaps neighboring chunks at a corner. Unloaded cells are air,
    // so the neighborhood has to exist before the first physics step.
    world.generateAround(player.body.x, player.body.z, 1, 9);

    const hotbar = new Hotbar();
    if (snapshot) hotbar.select(snapshot.hotbar);
    const camera = new Camera();
    view = camera;
    resize();
    const hud = new Hud();
    const input = attachInput(canvas, camera);
    camera.follow(player.body.x, player.body.y + PLAYER_HEIGHT * 0.45, player.body.z);

    let timeSec = snapshot ? snapshot.timeSec : 0;
    const entities = new EntitySystem(player, { time: timeSec });
    const persist = (): void => {
      writeSnapshot(store, {
        seed: world.seed,
        timeSec,
        player: {
          x: player.body.x,
          y: player.body.y,
          z: player.body.z,
          onGround: player.body.onGround,
        },
        hotbar: hotbar.slot,
        chunks: diffs.toChunks(),
      });
    };
    const unbindUnload = bindUnloadSave(window, persist);
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.code === 'F3') {
        event.preventDefault();
        hud.toggle();
        return;
      }
      if (event.code === 'Escape') {
        event.preventDefault();
        openMenu();
      }
    };
    window.addEventListener('keydown', onKey);

    const warmStart = performance.now();
    const warmRadius = viewChunkRadius(camera);
    while (performance.now() - warmStart < 12) {
      const aroundPlayer = world.generateAround(player.body.x, player.body.z, 1, STREAM_BUDGET);
      if (aroundPlayer > 0) continue;
      if (world.generateAround(camera.focusX, camera.focusZ, warmRadius, STREAM_BUDGET) === 0) break;
    }

    let alive = true;
    let last = performance.now();
    let marked = last;
    const clock = new SaveClock();
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
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      timeSec += dt;
      if (clock.tick((now - marked) / 1000)) persist();
      marked = now;

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

      player.update(dt, world, control.forward, control.strafe, control.jump);
      entities.update(dt, world);
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

      const stats = renderWorld(
        ctx,
        world,
        camera,
        drawList,
        [
          {
            x: player.body.x,
            y: player.body.y + PLAYER_HEIGHT * 0.5,
            z: player.body.z,
            draw: (drawCtx) => drawPlayer(drawCtx, camera, player),
          },
          ...entities.sprites(camera),
        ],
        timeSec,
      );
      if (target) drawTarget(ctx, camera, target);
      hotbar.draw(ctx, camera.screenW, camera.screenH);
      hud.draw(ctx, {
        fps,
        x: player.body.x,
        y: player.body.y,
        z: player.body.z,
        biome: biomeAt(world.seed, player.body.x, player.body.z),
        seed: world.seed,
        zoom: camera.zoom,
        chunksDrawn: stats.chunksDrawn,
        chunksLoaded: stats.chunksLoaded,
        phase: dayPhase(timeSec),
        held: hotbar.label,
      });

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

    let stopped = false;
    return {
      save: persist,
      stop() {
        if (stopped) return;
        stopped = true;
        alive = false;
        unbindUnload();
        window.removeEventListener('keydown', onKey);
        input.dispose();
        if (view === camera) view = null;
      },
    };
  }

  menu.setSave(readSnapshot(store), persistent !== null);
  menu.show();
}

main();
