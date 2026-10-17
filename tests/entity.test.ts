import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/entity/entity';
import { Player, wishVector } from '../src/player/player';
import { bodyAabb, stepBody, type Body } from '../src/player/physics';
import { World } from '../src/world/world';

function bodyAt(x: number, y: number, z: number, onGround = false): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround };
}

describe('player as an entity', () => {
  it('keeps pos, vel, and aabb aligned with the physics body', () => {
    const player = new Player(1, 2, 3, true);
    const entity: Entity = player;
    expect(entity.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(entity.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(entity.aabb).toEqual(bodyAabb(player.body));

    entity.pos.x = 4.5;
    entity.vel.y = 3;
    expect(player.body.x).toBe(4.5);
    expect(player.body.vy).toBe(3);
    expect(entity.aabb).toEqual(bodyAabb(player.body));
    expect(player.body.onGround).toBe(true);
  });

  it('update(dt, world) matches the existing step, with or without input', () => {
    const world = new World(1);
    const idlePlayer = new Player(0.5, 20, 0.5, false);
    const idleBody = bodyAt(0.5, 20, 0.5);
    const entity: Entity = idlePlayer;
    entity.update(1 / 60, world);
    stepBody(idleBody, world, 1 / 60, 0, 0, false);
    expect(idlePlayer.body).toEqual(idleBody);

    const moving = new Player(0.5, 20, 0.5, true);
    const walked = bodyAt(0.5, 20, 0.5, true);
    const wish = wishVector(1, 0);
    moving.update(1 / 60, world, 1, 0, true);
    stepBody(walked, world, 1 / 60, wish.x, wish.z, true);
    expect(moving.body).toEqual(walked);
  });
});
