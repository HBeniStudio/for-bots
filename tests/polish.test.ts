import { describe, expect, it } from 'vitest';
import { Creature } from '../src/entities/creature';
import { drawCreature } from '../src/entities/render';
import { slotIndexFromCode } from '../src/player/input';
import { drawPlayer, spawnPlayer } from '../src/player/player';
import { Camera } from '../src/render/camera';
import { VIEW_MARGIN, blitOrigin, isBlockOnScreen, sunBucket } from '../src/render/picture';
import { GRAVEL, TORCH } from '../src/world/blocks';
import { HOTBAR_IDS, SLOT_COUNT } from '../src/ui/hotbar';
import { World } from '../src/world/world';
import type { CreatureDef } from '../src/content/schema';

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
}

function recordingContext(): { ctx: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      fills.push(String(ctx.fillStyle));
    },
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    ellipse() {},
    fillRect() {
      fills.push(String(ctx.fillStyle));
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

const HARE: CreatureDef = {
  id: 'hare',
  name: 'Hare',
  kind: 'mob',
  health: 4,
  speed: 1,
  size: { width: 0.6, height: 0.8, depth: 0.6 },
  flees: true,
  drops: [],
  spawn: { biomes: ['plains'], minLight: 0, maxLight: 15, weight: 1, pack: [1, 1] },
  sprite: { colors: ['#f4f7fb'], rows: ['0'] },
};

describe('hotbar', () => {
  it('offers gravel on the last slot, reached by the 0 key', () => {
    expect(HOTBAR_IDS).toContain(GRAVEL);
    expect(HOTBAR_IDS.length).toBe(SLOT_COUNT);
    expect(HOTBAR_IDS[SLOT_COUNT - 1]).toBe(GRAVEL);
    expect(HOTBAR_IDS.indexOf(TORCH)).toBe(8);
    expect(slotIndexFromCode('Digit1')).toBe(0);
    expect(slotIndexFromCode('Digit9')).toBe(8);
    expect(slotIndexFromCode('Digit0')).toBe(SLOT_COUNT - 1);
    expect(slotIndexFromCode('Numpad0')).toBe(SLOT_COUNT - 1);
    expect(slotIndexFromCode('KeyG')).toBeNull();
  });
});

describe('night shading', () => {
  it('darkens the player at midnight and leaves them bright at noon', () => {
    const world = new World(1);
    const player = spawnPlayer(world);
    const camera = new Camera();
    camera.resize(320, 240);
    camera.follow(player.body.x, player.body.y + 1, player.body.z);
    const day = recordingContext();
    drawPlayer(day.ctx, camera, player, world, 0);
    const night = recordingContext();
    drawPlayer(night.ctx, camera, player, world, 300);
    expect(day.fills.length).toBeGreaterThan(0);
    expect(luminance(night.fills[0]!)).toBeLessThan(luminance(day.fills[0]!) * 0.5);
  });

  it('darkens a creature sprite the same way the world darkens', () => {
    const creature = new Creature(HARE, 1, 2, 3, () => 0);
    const camera = new Camera();
    camera.resize(200, 200);
    camera.follow(1, 2, 3);
    const day = recordingContext();
    drawCreature(day.ctx, camera, creature, { sun: 1, light: 15, block: 0 });
    const night = recordingContext();
    drawCreature(night.ctx, camera, creature, { sun: 0, light: 0, block: 0 });
    const dayBody = day.fills.find((color) => color.startsWith('#'));
    const nightBody = night.fills.find((color) => color.startsWith('#'));
    expect(dayBody).toBeTruthy();
    expect(luminance(nightBody!)).toBeLessThan(luminance(dayBody!) * 0.5);
  });
});

describe('view cache', () => {
  it('keeps a still camera on the baked origin and shifts when the focus moves', () => {
    const still = blitOrigin(4, 2, 4, 4, 2, 4, 1);
    expect(still.sx).toBe(VIEW_MARGIN);
    expect(still.sy).toBe(VIEW_MARGIN);
    expect(still.dx).toBeCloseTo(0, 5);
    const moved = blitOrigin(0, 0, 0, 1, 0, 0, 1);
    expect(moved.dx).not.toBe(0);
    expect(moved.sx).toBeCloseTo(VIEW_MARGIN - moved.dx, 5);
  });

  it('quantizes sunlight and culls blocks far outside the viewport', () => {
    expect(sunBucket(0)).toBe(0);
    expect(sunBucket(1)).toBe(32);
    expect(sunBucket(0.5)).toBe(16);
    const camera = new Camera();
    camera.resize(200, 200);
    camera.zoom = 1;
    camera.focusX = 0;
    camera.focusY = 0;
    camera.focusZ = 0;
    expect(isBlockOnScreen(camera, 0, 0, 0)).toBe(true);
    expect(isBlockOnScreen(camera, 400, 0, 400)).toBe(false);
  });
});
