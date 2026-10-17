import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import {
  BLOCK_HEIGHT,
  TILE_DEPTH,
  TILE_WIDTH,
  compareBlockDepth,
  isoToWorld,
  worldToIso,
} from '../src/render/iso';
import { STONE } from '../src/world/blocks';
import { World } from '../src/world/world';
import { isChunkVisible } from '../src/render/renderer';

describe('iso projection', () => {
  it('places the axes in screen space', () => {
    expect(worldToIso(0, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldToIso(1, 0, 0)).toEqual({ x: TILE_WIDTH / 2, y: TILE_DEPTH / 2 });
    expect(worldToIso(0, 0, 1)).toEqual({ x: -TILE_WIDTH / 2, y: TILE_DEPTH / 2 });
    expect(worldToIso(0, 1, 0)).toEqual({ x: 0, y: -BLOCK_HEIGHT });
  });

  it('round-trips world → iso → world on a fixed y plane', () => {
    const samples = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 2, 1],
      [3.5, 4, -2.25],
      [-8, 1, 15],
      [-17.5, 6, -0.5],
      [100, 63, -40],
    ];
    for (const [x, y, z] of samples) {
      const iso = worldToIso(x!, y!, z!);
      const back = isoToWorld(iso.x, iso.y, y!);
      expect(back.x).toBeCloseTo(x!, 8);
      expect(back.z).toBeCloseTo(z!, 8);
    }
  });

  it('round-trips iso → world → iso', () => {
    const planes = [0, 1, -3, 12.5];
    const screens = [
      [0, 0],
      [32, 16],
      [-80, 40],
      [12.5, -7.25],
      [400, 220],
    ];
    for (const y of planes) {
      for (const [ix, iy] of screens) {
        const world = isoToWorld(ix!, iy!, y);
        const iso = worldToIso(world.x, y, world.z);
        expect(iso.x).toBeCloseTo(ix!, 8);
        expect(iso.y).toBeCloseTo(iy!, 8);
      }
    }
  });

  it('round-trips through the camera, including pan and zoom', () => {
    const camera = new Camera();
    camera.resize(1280, 720);
    camera.focusX = -12.5;
    camera.focusZ = 40;
    camera.zoom = 0.65;
    const samples = [
      [0, 0, 0],
      [8, 2, 8],
      [-20, 5, 3],
      [4.25, 1, -6.5],
    ];
    for (const [x, y, z] of samples) {
      const screen = camera.worldToScreen(x!, y!, z!);
      const back = camera.screenToWorld(screen.x, screen.y, y!);
      expect(back.x).toBeCloseTo(x!, 6);
      expect(back.z).toBeCloseTo(z!, 6);
    }

    for (const [sx, sy, y] of [
      [10, 10, 0],
      [640, 360, 2],
      [1270, 700, 4],
    ]) {
      const world = camera.screenToWorld(sx!, sy!, y!);
      const screen = camera.worldToScreen(world.x, y!, world.z);
      expect(screen.x).toBeCloseTo(sx!, 5);
      expect(screen.y).toBeCloseTo(sy!, 5);
    }
  });

  it('keeps the grabbed world point under the pointer while dragging', () => {
    const camera = new Camera();
    camera.resize(400, 300);
    camera.focusX = 10;
    camera.focusZ = 4;
    camera.zoom = 0.8;
    const before = camera.screenToWorld(180, 140, 0);
    camera.drag(40, -25);
    const after = camera.screenToWorld(220, 115, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });

  it('zooms toward the cursor', () => {
    const camera = new Camera();
    camera.resize(800, 600);
    camera.zoom = 0.8;
    const before = camera.screenToWorld(100, 80, 0);
    camera.zoomAt(100, 80, 1.3);
    const after = camera.screenToWorld(100, 80, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    expect(camera.zoom).toBeCloseTo(0.8 * 1.3, 6);
  });

  it('sorts back-to-front by x+z, then by y', () => {
    expect(compareBlockDepth({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeLessThan(0);
    expect(compareBlockDepth({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeLessThan(0);
    expect(compareBlockDepth({ x: 0, y: 0, z: 1 }, { x: 0, y: 5, z: 1 })).toBeLessThan(0);
    expect(compareBlockDepth({ x: 0, y: 5, z: 1 }, { x: 0, y: 0, z: 1 })).toBeGreaterThan(0);
    // A higher block that is farther (smaller x+z) still draws first.
    expect(compareBlockDepth({ x: 0, y: 10, z: 0 }, { x: 2, y: 0, z: 1 })).toBeLessThan(0);
    expect(compareBlockDepth({ x: -4, y: 0, z: -3 }, { x: -1, y: 0, z: -1 })).toBeLessThan(0);
    expect(compareBlockDepth({ x: 2, y: 1, z: 2 }, { x: 3, y: 1, z: 1 })).toBe(0);

    const order = [
      { x: 1, y: 2, z: 0 },
      { x: -2, y: 9, z: -2 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: -1 },
    ];
    const sorted = [...order].sort(compareBlockDepth);
    const keys = sorted.map((p) => [p.x + p.z, p.y]);
    const expected = [...keys].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
    expect(keys).toEqual(expected);
  });

  it('skips chunks that sit fully off screen', () => {
    const world = new World();
    const near = world.ensureChunk(0, 0);
    near.set(0, 0, 0, STONE);
    const far = world.ensureChunk(40, 40);
    far.set(0, 0, 0, STONE);
    const empty = world.ensureChunk(0, 1);

    const camera = new Camera();
    camera.resize(320, 240);
    camera.focusX = 8;
    camera.focusZ = 8;
    camera.zoom = 1;

    expect(isChunkVisible(near, camera)).toBe(true);
    expect(isChunkVisible(far, camera)).toBe(false);
    expect(isChunkVisible(empty, camera)).toBe(false);
  });
});
