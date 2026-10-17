import { describe, expect, it } from 'vitest';
import { loadContent, type ContentCatalog } from '../src/content/loader';
import { SCHEMA_VERSION, validateCreature, type CreatureDef } from '../src/content/schema';
import type { Entity } from '../src/entity/entity';
import { nextAiMode } from '../src/entities/ai';
import { bossPhaseIndex, PLAYER_MAX_HEALTH, rollDrops } from '../src/entities/combat';
import { Creature } from '../src/entities/creature';
import {
  ENTITY_LIMIT,
  TYPE_LIMIT,
  choosePack,
  matchesSpawn,
  planSpawn,
  weightedPick,
} from '../src/entities/spawn';
import { EntitySystem } from '../src/entities/system';
import { Player } from '../src/player/player';
import { overlapsSolid } from '../src/player/physics';
import { STONE } from '../src/world/blocks';
import { SNOW_BIOME, type BiomeId } from '../src/world/gen/biomes';
import { SEA_LEVEL, columnAt } from '../src/world/gen/terrain';
import { DAY_LENGTH_SEC } from '../src/world/light';
import { World, worldToChunk } from '../src/world/world';

const zero = (): number => 0;

function catalogOf(defs: readonly CreatureDef[]): ContentCatalog {
  return {
    mobs: defs.filter((def) => def.kind === 'mob'),
    enemies: defs.filter((def) => def.kind === 'enemy'),
    bosses: defs.filter((def) => def.kind === 'boss'),
    byId: new Map(defs.map((def) => [def.id, def])),
  };
}

function pave(world: World, y = 4): void {
  for (let z = -2; z <= 6; z++) {
    for (let x = -2; x <= 24; x++) world.setBlock(x, y, z, STONE);
  }
}

function findColumn(seed: number, biome: BiomeId): { x: number; z: number } {
  for (let x = 0; x < 160; x += 3) {
    for (let z = 0; z < 160; z += 3) {
      const column = columnAt(seed, x, z);
      if (column.biome === biome && column.height >= SEA_LEVEL) return { x, z };
    }
  }
  throw new Error(`no ${biome} column`);
}

describe('schema version', () => {
  it('keeps sprite optional and bumps the schema to 2', () => {
    expect(SCHEMA_VERSION).toBe(2);
    const bare = validateCreature({
      id: 'sheep',
      name: 'Sheep',
      kind: 'mob',
      health: 8,
      speed: 1.1,
      size: { width: 0.9, height: 1.3, depth: 0.9 },
      flees: true,
      spawn: { biomes: ['plains'], minLight: 9, maxLight: 15, weight: 8, pack: [2, 4] },
    });
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.value).not.toHaveProperty('sprite');

    const bad = validateCreature({
      id: 'sheep',
      name: 'Sheep',
      kind: 'mob',
      health: 8,
      speed: 1,
      size: { width: 0.9, height: 1, depth: 0.9 },
      flees: true,
      spawn: { biomes: ['plains'], minLight: 0, maxLight: 15, weight: 1, pack: [1, 1] },
      sprite: { colors: ['#fff'], rows: ['0'] },
    });
    expect(bad.ok).toBe(false);

    for (const def of loadContent().byId.values()) {
      expect(def.sprite, def.id).toBeDefined();
      const rows = def.sprite?.rows ?? [];
      expect(rows.length, def.id).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.length)).size, def.id).toBe(1);
    }
  });
});

describe('spawn rules', () => {
  const catalog = loadContent();
  const hare = catalog.byId.get('meadow_hare')!;
  const lurker = catalog.byId.get('field_lurker')!;
  const briar = catalog.byId.get('briar_heart')!;
  const wolf = catalog.byId.get('rime_wolf')!;
  const jarl = catalog.byId.get('glacier_jarl')!;

  it('matches biome and the inclusive light window', () => {
    expect(matchesSpawn(hare, 'plains', 9)).toBe(true);
    expect(matchesSpawn(hare, 'plains', 15)).toBe(true);
    expect(matchesSpawn(hare, 'plains', 8)).toBe(false);
    expect(matchesSpawn(hare, 'desert', 15)).toBe(false);
    expect(matchesSpawn(lurker, 'plains', 7)).toBe(true);
    expect(matchesSpawn(lurker, 'plains', 8)).toBe(false);
    expect(matchesSpawn(briar, 'forest', 6)).toBe(true);
    expect(matchesSpawn(briar, 'forest', 7)).toBe(false);
    expect(matchesSpawn(briar, 'plains', 0)).toBe(false);
  });

  it('weights the pick, sizes the pack, and stops at the caps', () => {
    expect(weightedPick([wolf, jarl], zero).id).toBe('rime_wolf');
    expect(weightedPick([wolf, jarl], () => 0.99).id).toBe('glacier_jarl');
    expect(choosePack(hare, zero, 10)).toBe(2);
    expect(choosePack(hare, () => 0.999, 10)).toBe(4);
    expect(choosePack(hare, () => 0.999, 1)).toBe(1);
    expect(choosePack(jarl, zero, 5)).toBe(1);

    expect(planSpawn([hare], 'plains', 12, new Map(), 0, zero)).toEqual({ id: 'meadow_hare', count: 2 });
    expect(planSpawn([hare], 'plains', 12, new Map(), ENTITY_LIMIT, zero)).toBeNull();
    expect(planSpawn([hare], 'plains', 12, new Map([['meadow_hare', TYPE_LIMIT]]), 2, zero)).toBeNull();
    expect(planSpawn([jarl], 'snow', 0, new Map(), 0, zero)).toEqual({ id: 'glacier_jarl', count: 1 });
    expect(planSpawn([jarl], 'snow', 0, new Map([['glacier_jarl', 1]]), 1, zero)).toBeNull();
    expect(planSpawn([hare, lurker], 'plains', 15, new Map(), 0, zero)?.id).toBe('meadow_hare');
    expect(planSpawn([hare, lurker], 'plains', 3, new Map(), 0, zero)?.id).toBe('field_lurker');
  });

  it('spawns a daylight pack and refuses the same column at the wrong light', () => {
    const seed = 3;
    const world = new World(seed);
    const spot = findColumn(seed, 0);
    const { cx, cz } = worldToChunk(spot.x, spot.z);
    world.generateChunk(cx, cz);
    const player = new Player(0, 80, 0, true);
    const system = new EntitySystem(player, {
      catalog: catalogOf([hare]),
      rng: zero,
      spawning: false,
      time: 0,
    });

    let column: { x: number; z: number } | null = null;
    for (let z = cz * 16; z < cz * 16 + 16 && !column; z++) {
      for (let x = cx * 16; x < cx * 16 + 16; x++) {
        if (system.trySpawnColumn(world, x, z) > 0) {
          column = { x, z };
          break;
        }
      }
    }
    expect(column).not.toBeNull();
    expect(system.countOf('meadow_hare')).toBeGreaterThan(0);

    let guard = 0;
    while (system.countOf('meadow_hare') < TYPE_LIMIT && guard < 12) {
      system.trySpawnColumn(world, column!.x, column!.z);
      guard += 1;
    }
    expect(system.countOf('meadow_hare')).toBe(TYPE_LIMIT);
    expect(system.total).toBeLessThanOrEqual(ENTITY_LIMIT);
    expect(system.trySpawnColumn(world, column!.x, column!.z)).toBe(0);

    let night: EntitySystem | null = null;
    let bossColumn: { x: number; z: number } | null = null;
    const jarlOptions = {
      catalog: catalogOf([jarl]),
      rng: zero,
      spawning: false,
    };
    for (let x = 0; x < 80 && !bossColumn; x++) {
      for (let z = 0; z < 80 && !bossColumn; z++) {
        const column = columnAt(seed, x, z);
        if (column.biome !== SNOW_BIOME || column.height < SEA_LEVEL) continue;
        const chunk = worldToChunk(x, z);
        world.generateChunk(chunk.cx, chunk.cz);
        const candidate = new EntitySystem(player, { ...jarlOptions, time: DAY_LENGTH_SEC / 2 });
        if (candidate.trySpawnColumn(world, x, z) === 0) continue;
        const noon = new EntitySystem(player, { ...jarlOptions, time: 0 });
        if (noon.trySpawnColumn(world, x, z) !== 0) continue;
        night = candidate;
        bossColumn = { x, z };
      }
    }
    expect(bossColumn).not.toBeNull();
    expect(night?.countOf('glacier_jarl')).toBe(1);
    expect(night?.trySpawnColumn(world, bossColumn!.x, bossColumn!.z)).toBe(0);
  });
});

describe('ai', () => {
  const catalog = loadContent();
  const hare = catalog.byId.get('meadow_hare')!;
  const lurker = catalog.byId.get('field_lurker')!;
  const briar = catalog.byId.get('briar_heart')!;

  it('switches mobs to flee and enemies between wander, chase, and attack', () => {
    expect(nextAiMode({ kind: 'mob', flees: true, mode: 'wander', distance: 3, aggroRange: 0, attackRange: 0 })).toBe('flee');
    expect(nextAiMode({ kind: 'mob', flees: true, mode: 'flee', distance: 20, aggroRange: 0, attackRange: 0 })).toBe('wander');
    expect(nextAiMode({ kind: 'mob', flees: false, mode: 'wander', distance: 1, aggroRange: 0, attackRange: 0 })).toBe('wander');
    expect(nextAiMode({ kind: 'enemy', flees: false, mode: 'wander', distance: 30, aggroRange: 9, attackRange: 1.3 })).toBe('wander');
    expect(nextAiMode({ kind: 'enemy', flees: false, mode: 'wander', distance: 6, aggroRange: 9, attackRange: 1.3 })).toBe('chase');
    expect(nextAiMode({ kind: 'enemy', flees: false, mode: 'chase', distance: 1, aggroRange: 9, attackRange: 1.3 })).toBe('attack');
    expect(nextAiMode({ kind: 'enemy', flees: false, mode: 'attack', distance: 12, aggroRange: 9, attackRange: 1.3 })).toBe('wander');
    expect(nextAiMode({ kind: 'boss', flees: false, mode: 'idle', distance: 2, aggroRange: 18, attackRange: 2.2 })).toBe('attack');
  });

  it('flees, chases, and strikes using the shared collider', () => {
    const world = new World(1);
    pave(world);
    const player = new Player(0.5, 5, 0.5, true);
    const prey = new Creature(hare, 4.5, 5, 0.5, zero);
    prey.observe(player);
    for (let i = 0; i < 20; i++) prey.update(1 / 30, world);
    expect(prey.mode).toBe('flee');
    expect(prey.pos.x).toBeGreaterThan(4.5);
    expect(overlapsSolid(world, prey.body)).toBe(false);

    const hunter = new Creature(lurker, 0.5, 5, 0.5, zero);
    const quarry = new Player(8.5, 5, 0.5, true);
    hunter.observe(quarry);
    for (let i = 0; i < 20; i++) hunter.update(1 / 30, world);
    expect(hunter.mode).toBe('chase');
    expect(hunter.pos.x).toBeGreaterThan(0.8);

    const striker = new Creature(lurker, 1.5, 5, 0.5, zero);
    striker.observe(player);
    striker.update(1 / 30, world);
    expect(striker.mode).toBe('attack');
    expect(lurker.kind).toBe('enemy');
    if (lurker.kind !== 'enemy') return;
    expect(striker.consumeHit()).toBe(lurker.damage);
    striker.update(1 / 60, world);
    expect(striker.consumeHit()).toBe(0);

    const system = new EntitySystem(player, { spawning: false, rng: zero });
    system.update(0, world);
    system.spawnCreature(lurker, 1.5, 5, 0.5);
    const before = system.playerHealth;
    system.update(1 / 30, world);
    expect(system.playerHealth).toBe(before - (lurker.kind === 'enemy' ? lurker.damage : 0));
  });

  it('lands on a floor without entering solid voxels', () => {
    const world = new World(1);
    pave(world);
    const hareCreature = new Creature(hare, 0.5, 16, 0.5, zero);
    const entity: Entity = hareCreature;
    entity.pos.y = 16;
    for (let i = 0; i < 180; i++) entity.update(1 / 60, world);
    expect(hareCreature.body.onGround).toBe(true);
    expect(hareCreature.pos.y).toBeCloseTo(5, 2);
    expect(overlapsSolid(world, hareCreature.body)).toBe(false);
    expect(entity.aabb.maxX - entity.aabb.minX).toBeCloseTo(hare.size.width);
    expect(entity.aabb.maxY - entity.aabb.minY).toBeCloseTo(hare.size.height);
    expect(entity.aabb.maxZ - entity.aabb.minZ).toBeCloseTo(hare.size.depth);

    const wide = new Creature(hare, 0.5, 5, 0.5, zero);
    const boss = new Creature(briar, 0.5, 5, 0.5, zero);
    world.setBlock(1, 5, 0, STONE);
    expect(overlapsSolid(world, wide.body)).toBe(false);
    expect(overlapsSolid(world, boss.body)).toBe(true);
  });
});

describe('boss phases', () => {
  it('switches at the content thresholds and keeps the boundary on the previous phase', () => {
    const briar = loadContent().byId.get('briar_heart');
    expect(briar?.kind).toBe('boss');
    if (!briar || briar.kind !== 'boss') return;
    expect(bossPhaseIndex(briar.phases, 0.66, 1)).toBe(-1);
    expect(bossPhaseIndex(briar.phases, 0.66 - 1e-9, 1)).toBe(0);
    expect(bossPhaseIndex(briar.phases, 0.33, 1)).toBe(0);
    expect(bossPhaseIndex(briar.phases, 0.33 - 1e-9, 1)).toBe(1);

    const boss = new Creature(briar, 0, 5, 0, zero);
    expect(boss.phaseIndex).toBe(-1);
    expect(boss.moveSpeed).toBe(briar.speed);
    expect(boss.attackDamage).toBe(briar.damage);
    expect(boss.hurt(61)).toBe(false);
    expect(boss.health).toBe(119);
    expect(boss.phaseIndex).toBe(-1);
    boss.hurt(1);
    expect(boss.health).toBe(118);
    expect(boss.phaseIndex).toBe(0);
    expect(boss.moveSpeed).toBe(1.5);
    expect(boss.attackDamage).toBe(9);
    boss.hurt(59);
    expect(boss.health).toBe(59);
    expect(boss.phaseIndex).toBe(1);
    expect(boss.moveSpeed).toBe(2.1);
    expect(boss.attackDamage).toBe(12);
  });
});

describe('damage and death', () => {
  it('hurts the player, ignores a second hit during invulnerability, then respawns', () => {
    const world = new World(1);
    const player = new Player(2, 6, 2, true);
    const system = new EntitySystem(player, { spawning: false, respawnDelay: 1, rng: zero });
    system.damagePlayer(5);
    expect(system.playerHealth).toBe(15);
    expect(system.playerAlive).toBe(true);
    system.damagePlayer(5);
    expect(system.playerHealth).toBe(15);
    system.update(0.6, world);
    system.damagePlayer(5);
    expect(system.playerHealth).toBe(10);

    system.update(0.6, world);
    player.pos.x = 12;
    system.damagePlayer(100);
    expect(system.playerAlive).toBe(false);
    expect(system.playerHealth).toBe(0);
    system.damagePlayer(5);
    expect(system.playerHealth).toBe(0);
    system.update(1.1, world);
    expect(system.playerAlive).toBe(true);
    expect(system.playerHealth).toBe(PLAYER_MAX_HEALTH);
    expect(player.pos.x).toBeCloseTo(2);
    expect(player.pos.y).toBeCloseTo(6);
    expect(player.pos.z).toBeCloseTo(2);
  });

  it('removes a dead creature and places its drops', () => {
    const rolled = rollDrops([{ block: 'stone', min: 2, max: 4, chance: 1 }], zero);
    expect(rolled).toEqual([{ block: 'stone', count: 2 }]);
    expect(rollDrops([{ block: 'stone', min: 1, max: 1, chance: 0.5 }], () => 0.5)).toEqual([]);

    const def = validateCreature({
      id: 'pinch',
      name: 'Pinch',
      kind: 'mob',
      health: 4,
      speed: 1,
      size: { width: 0.6, height: 0.8, depth: 0.6 },
      flees: false,
      drops: [{ block: 'stone', min: 2, max: 2, chance: 1 }],
      spawn: { biomes: ['plains'], minLight: 0, maxLight: 15, weight: 1, pack: [1, 1] },
    });
    expect(def.ok).toBe(true);
    if (!def.ok) return;

    const world = new World(1);
    pave(world);
    const player = new Player(0.5, 5, 0.5, true);
    const system = new EntitySystem(player, { spawning: false, rng: zero });
    system.update(0, world);
    const creature = system.spawnCreature(def.value, 0.5, 5, 0.5);
    expect(creature).not.toBeNull();
    expect(system.playerAttack(100)).toBe(true);
    expect(system.total).toBe(0);
    expect(system.lastDrops).toEqual([{ block: 'stone', count: 2 }]);
    expect(world.getBlock(0, 5, 0)).toBe(STONE);
    expect(world.getBlock(0, 6, 0)).toBe(STONE);
    expect(world.getBlock(0, 4, 0)).toBe(STONE);
  });
});
