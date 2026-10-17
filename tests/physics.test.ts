import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import { AIR, DIRT, STONE, WATER } from '../src/world/blocks';
import { World } from '../src/world/world';
import { breakTarget, canPlaceAt, pickBlock, placeOnTarget } from '../src/player/interact';
import { spawnPlayer, wishVector } from '../src/player/player';
import {
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HALF,
  PLAYER_HEIGHT,
  TERMINAL_VELOCITY,
  WALK_SPEED,
  moveAxis,
  overlapsSolid,
  stepBody,
  type Body,
} from '../src/player/physics';

function bodyAt(x: number, y: number, z: number, onGround = false): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround };
}

function floor(world: World, x0: number, x1: number, z: number, y: number): void {
  for (let x = x0; x <= x1; x++) world.setBlock(x, y, z, STONE);
}

describe('movement', () => {
  it('maps WASD onto the iso ground plane and keeps diagonal speed flat', () => {
    expect(wishVector(1, 0)).toEqual({ x: -1, z: -1 });
    expect(wishVector(-1, 0)).toEqual({ x: 1, z: 1 });
    expect(wishVector(0, 1)).toEqual({ x: 1, z: -1 });
    expect(wishVector(0, -1)).toEqual({ x: -1, z: 1 });

    const world = new World(1);
    const body = bodyAt(0.5, 30, 0.5);
    stepBody(body, world, 1 / 60, 1, 1, false);
    expect(Math.hypot(body.vx, body.vz)).toBeCloseTo(WALK_SPEED, 5);
    expect(body.vy).toBeCloseTo(-GRAVITY / 60, 5);
  });

  it('caps the fall at terminal velocity', () => {
    const world = new World(1);
    const body = bodyAt(0.5, 200, 0.5);
    let slowest = 0;
    for (let i = 0; i < 120; i++) {
      stepBody(body, world, 1 / 60, 0, 0, false);
      slowest = Math.min(slowest, body.vy);
      expect(body.vy).toBeGreaterThanOrEqual(-TERMINAL_VELOCITY - 1e-6);
    }
    expect(slowest).toBeCloseTo(-TERMINAL_VELOCITY, 5);
    expect(body.onGround).toBe(false);
    expect(body.y).toBeGreaterThan(10);
  });
});

describe('voxel collision', () => {
  it('lands on a floor and does not tunnel through it', () => {
    const world = new World(1);
    floor(world, 0, 2, 0, 4);
    const body = bodyAt(0.5, 12, 0.5);
    for (let i = 0; i < 240; i++) {
      stepBody(body, world, 1 / 60, 0, 0, false);
      expect(overlapsSolid(world, body)).toBe(false);
    }
    expect(body.onGround).toBe(true);
    expect(body.y).toBeCloseTo(5, 3);
    expect(body.vy).toBe(0);

    const dropped = bodyAt(0.5, 12, 0.5);
    dropped.vy = -TERMINAL_VELOCITY;
    expect(moveAxis(dropped, world, 'y', -40)).toBe(true);
    expect(dropped.y).toBeCloseTo(5, 3);
    expect(dropped.y + PLAYER_HEIGHT).toBeGreaterThan(5);
    expect(overlapsSolid(world, dropped)).toBe(false);
    expect(world.getBlock(0, 4, 0)).toBe(STONE);
  });

  it('stops at a wall instead of clipping through it', () => {
    const world = new World(1);
    floor(world, 0, 8, 0, 0);
    for (let y = 1; y <= 4; y++) world.setBlock(3, y, 0, STONE);
    const body = bodyAt(1, 1, 0.5, true);
    for (let i = 0; i < 180; i++) {
      stepBody(body, world, 1 / 60, 1, 0, false);
      expect(overlapsSolid(world, body)).toBe(false);
    }
    expect(body.x + PLAYER_HALF).toBeLessThanOrEqual(3 + 1e-3);
    expect(body.x + PLAYER_HALF).toBeGreaterThan(2.5);
    expect(body.y).toBeCloseTo(1, 3);
    expect(body.onGround).toBe(true);

    const ram = bodyAt(1, 1, 0.5, true);
    expect(moveAxis(ram, world, 'x', 20)).toBe(true);
    expect(ram.x + PLAYER_HALF).toBeLessThanOrEqual(3 + 1e-3);
    expect(ram.x).toBeGreaterThan(2);
    expect(overlapsSolid(world, ram)).toBe(false);
  });

  it('reaches a one-block ledge with a jump and not by walking', () => {
    const world = new World(1);
    floor(world, 0, 8, 0, 0);
    for (let x = 4; x <= 8; x++) world.setBlock(x, 1, 0, STONE);

    const walker = bodyAt(4 - PLAYER_HALF - 0.02, 1, 0.5, true);
    for (let i = 0; i < 120; i++) stepBody(walker, world, 1 / 60, 1, 0, false);
    expect(walker.x + PLAYER_HALF).toBeLessThanOrEqual(4 + 1e-3);
    expect(walker.y).toBeCloseTo(1, 3);

    const jumper = bodyAt(4 - PLAYER_HALF - 0.02, 1, 0.5, true);
    let landed = false;
    for (let i = 0; i < 180 && !landed; i++) {
      stepBody(jumper, world, 1 / 60, 1, 0, i === 0);
      expect(overlapsSolid(world, jumper)).toBe(false);
      landed = jumper.onGround && jumper.y >= 1.99 && jumper.x >= 4 + PLAYER_HALF;
    }
    expect(landed).toBe(true);
    expect(jumper.y).toBeCloseTo(2, 2);
    expect(jumper.x).toBeGreaterThan(4 + PLAYER_HALF);
  });

  it('cannot jump through a ceiling', () => {
    const world = new World(1);
    floor(world, 0, 2, 0, 0);
    world.setBlock(0, 3, 0, STONE);
    const body = bodyAt(0.5, 1, 0.5, true);

    const ram = bodyAt(0.5, 1, 0.5, true);
    expect(moveAxis(ram, world, 'y', 8)).toBe(true);
    expect(ram.y + PLAYER_HEIGHT).toBeLessThanOrEqual(3 + 1e-3);
    expect(ram.y).toBeGreaterThan(1);
    expect(ram.vy).toBe(0);
    expect(overlapsSolid(world, ram)).toBe(false);

    let peak = body.y;
    for (let i = 0; i < 90; i++) {
      stepBody(body, world, 1 / 60, 0, 0, i === 0);
      peak = Math.max(peak, body.y);
      expect(body.y + PLAYER_HEIGHT).toBeLessThanOrEqual(3 + 1e-3);
      expect(overlapsSolid(world, body)).toBe(false);
    }
    const open = JUMP_SPEED * JUMP_SPEED / (2 * GRAVITY);
    expect(open).toBeGreaterThan(1);
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.2 + 0.05);
    expect(world.getBlock(0, 3, 0)).toBe(STONE);
  });
});

describe('building', () => {
  it('places on the targeted face and refuses a cell inside the player', () => {
    const world = new World(1);
    world.generateChunk(0, 0);
    for (let y = 40; y <= 48; y++) world.setBlock(0, y, 0, AIR);
    world.setBlock(1, 40, 0, AIR);
    world.setBlock(0, 40, 0, STONE);
    const body = bodyAt(0.5, 41, 0.5, true);

    expect(canPlaceAt(world, body, 0, 41, 0)).toBe(false);
    expect(placeOnTarget(world, body, { x: 0, y: 40, z: 0, face: 'top' }, DIRT)).toBe(false);
    expect(world.getBlock(0, 41, 0)).toBe(AIR);

    expect(canPlaceAt(world, body, 1, 40, 0)).toBe(true);
    expect(placeOnTarget(world, body, { x: 0, y: 40, z: 0, face: '+x' }, DIRT)).toBe(true);
    expect(world.getBlock(1, 40, 0)).toBe(DIRT);

    breakTarget(world, { x: 0, y: 40, z: 0, face: 'top' });
    expect(world.getBlock(0, 40, 0)).toBe(AIR);
  });

  it('picks the hovered face and prefers the block nearer the camera', () => {
    const world = new World(1);
    world.setBlock(0, 5, 0, STONE);
    const camera = new Camera();
    camera.resize(800, 600);
    camera.zoom = 1;
    camera.focusX = 0.5;
    camera.focusY = 6;
    camera.focusZ = 0.5;

    const top = camera.worldToScreen(0.5, 6, 0.5);
    expect(pickBlock(camera, world, top.x, top.y)).toEqual({ x: 0, y: 5, z: 0, face: 'top' });

    const side = camera.worldToScreen(1, 5.5, 0.5);
    expect(pickBlock(camera, world, side.x, side.y)).toEqual({ x: 0, y: 5, z: 0, face: '+x' });

    const front = camera.worldToScreen(0.5, 5.5, 1);
    expect(pickBlock(camera, world, front.x, front.y)).toEqual({ x: 0, y: 5, z: 0, face: '+z' });

    world.setBlock(1, 6, 1, DIRT);
    const center = camera.worldToScreen(0.5, 6, 0.5);
    expect(pickBlock(camera, world, center.x, center.y)).toEqual({ x: 1, y: 6, z: 1, face: 'top' });
  });
});

describe('water', () => {
  it('sinks through water and lands on the floor beneath', () => {
    const world = new World(1);
    world.setBlock(0, 2, 0, STONE);
    world.setBlock(0, 4, 0, WATER);
    world.setBlock(0, 5, 0, WATER);
    const body = bodyAt(0.5, 8, 0.5);
    for (let i = 0; i < 240; i++) stepBody(body, world, 1 / 60, 0, 0, false);
    expect(overlapsSolid(world, body)).toBe(false);
    expect(body.onGround).toBe(true);
    expect(body.y).toBeCloseTo(3, 3);
    expect(body.y).toBeLessThan(4);
  });
});

describe('spawn', () => {
  it('stands on dry ground clear of solid blocks', () => {
    const world = new World(0x150701);
    const player = spawnPlayer(world);
    expect(overlapsSolid(world, player.body)).toBe(false);
    expect(player.body.onGround).toBe(true);
    expect(player.body.y).toBeGreaterThan(1);
    const { x, y, z } = player.body;
    expect(world.getBlock(Math.floor(x), y - 1, Math.floor(z))).not.toBe(AIR);
    expect(world.getBlock(Math.floor(x), y, Math.floor(z))).toBe(AIR);
  });
});

describe('camera follow', () => {
  it('tracks the player and keeps a drag offset', () => {
    const camera = new Camera();
    camera.resize(800, 600);
    camera.follow(10, 4, 12);
    expect(camera.focusX).toBeCloseTo(10, 6);
    expect(camera.focusY).toBeCloseTo(4, 6);
    expect(camera.focusZ).toBeCloseTo(12, 6);

    const centered = camera.worldToScreen(10, 4, 12);
    expect(centered.x).toBeCloseTo(400, 4);
    expect(centered.y).toBeCloseTo(300, 4);

    camera.drag(30, -12);
    const draggedX = camera.focusX;
    const draggedZ = camera.focusZ;
    camera.follow(12, 6, 14);
    expect(camera.focusX - 12).toBeCloseTo(draggedX - 10, 5);
    expect(camera.focusZ - 14).toBeCloseTo(draggedZ - 12, 5);
    expect(camera.focusY).toBeCloseTo(6, 6);
  });
});
