import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/content/loader';
import { validateCreature, validateCreatureList } from '../src/content/schema';
import { AIR, BLOCK_IDS, LIGHT_MAX, LIGHT_MIN, LIGHT_SCALE, TORCH } from '../src/world/blocks';
import { BIOME_IDS, PLAINS, SNOW_BIOME } from '../src/world/gen/biomes';

const sheep = {
  id: 'sheep',
  name: 'Sheep',
  kind: 'mob',
  health: 8,
  speed: 1.1,
  size: { width: 0.9, height: 1.3, depth: 0.9 },
  flees: true,
  drops: [{ block: 9, min: 1, max: 2, chance: 0.5 }],
  spawn: { biomes: [0, 'forest'], minLight: 9, maxLight: 15, weight: 8, pack: [2, 4] },
};

const crawler = {
  id: 'crawler',
  name: 'Crawler',
  kind: 'enemy',
  health: 16,
  speed: 2,
  size: { width: 0.8, height: 1.2, depth: 0.8 },
  damage: 3,
  attackRange: 1.2,
  aggroRange: 12,
  drops: [{ block: 'gravel', min: 1, max: 1, chance: 1 }],
  spawn: { biomes: ['forest'], minLight: 0, maxLight: 7, weight: 4, pack: [1, 3] },
};

const warden = {
  id: 'warden',
  name: 'Warden',
  kind: 'boss',
  health: 200,
  speed: 1.4,
  size: { width: 1.4, height: 3.2, depth: 1.4 },
  damage: 8,
  attackRange: 2.5,
  aggroRange: 20,
  phases: [{ belowHealth: 0.5, speed: 2.1, damage: 12 }],
  spawn: { biomes: ['snow'], minLight: 0, maxLight: 7, weight: 1 },
};

describe('frozen ids', () => {
  it('keeps M2 block and biome ids and the 0–15 light scale', () => {
    expect(BLOCK_IDS).toEqual({
      air: 0,
      grass: 1,
      dirt: 2,
      stone: 3,
      sand: 4,
      water: 5,
      snow: 6,
      log: 7,
      leaves: 8,
      gravel: 9,
      torch: 10,
    });
    expect(BIOME_IDS).toEqual({ plains: 0, forest: 1, desert: 2, snow: 3 });
    expect(Object.isFrozen(BLOCK_IDS)).toBe(true);
    expect(Object.isFrozen(BIOME_IDS)).toBe(true);
    expect(Object.isFrozen(LIGHT_SCALE)).toBe(true);
    expect(LIGHT_SCALE).toEqual({ min: 0, max: 15 });
    expect(LIGHT_MIN).toBe(0);
    expect(LIGHT_MAX).toBe(15);
    expect(AIR).toBe(BLOCK_IDS.air);
    expect(TORCH).toBe(BLOCK_IDS.torch);
    expect(PLAINS).toBe(BIOME_IDS.plains);
    expect(SNOW_BIOME).toBe(BIOME_IDS.snow);
    expect(BLOCK_IDS.snow).not.toBe(BIOME_IDS.snow);
  });
});

describe('creature schema', () => {
  it('accepts a mob, an enemy, and a boss and normalizes ids to names', () => {
    const mob = validateCreature(sheep);
    const enemy = validateCreature(crawler);
    const boss = validateCreature(warden);
    expect(mob.ok).toBe(true);
    expect(enemy.ok).toBe(true);
    expect(boss.ok).toBe(true);
    if (!mob.ok || !enemy.ok || !boss.ok) return;

    expect(mob.value).toEqual({
      id: 'sheep',
      name: 'Sheep',
      kind: 'mob',
      health: 8,
      speed: 1.1,
      size: { width: 0.9, height: 1.3, depth: 0.9 },
      drops: [{ block: 'gravel', min: 1, max: 2, chance: 0.5 }],
      flees: true,
      spawn: {
        biomes: ['plains', 'forest'],
        minLight: 9,
        maxLight: 15,
        weight: 8,
        pack: [2, 4],
      },
    });
    expect(enemy.value.kind).toBe('enemy');
    expect(enemy.value.drops[0]).toEqual({ block: 'gravel', min: 1, max: 1, chance: 1 });
    expect(enemy.value.spawn.minLight).toBe(LIGHT_MIN);
    expect(boss.value.kind).toBe('boss');
    if (boss.value.kind !== 'boss') return;
    expect(boss.value.phases).toEqual([{ belowHealth: 0.5, speed: 2.1, damage: 12 }]);
    expect(boss.value.spawn.biomes).toEqual(['snow']);
    expect(boss.value.drops).toEqual([]);
    expect('pack' in boss.value.spawn).toBe(false);
  });

  it('rejects invalid creatures', () => {
    const cases: { name: string; value: unknown; error: string }[] = [
      { name: 'not an object', value: null, error: 'expected an object' },
      { name: 'bad kind', value: { ...sheep, kind: 'npc' }, error: 'kind:' },
      { name: 'unknown field', value: { ...sheep, hp: 4 }, error: 'unknown field "hp"' },
      {
        name: 'light above the scale',
        value: { ...sheep, spawn: { ...sheep.spawn, maxLight: LIGHT_MAX + 1 } },
        error: 'spawn.maxLight',
      },
      {
        name: 'light below the scale',
        value: { ...sheep, spawn: { ...sheep.spawn, minLight: LIGHT_MIN - 1 } },
        error: 'spawn.minLight',
      },
      {
        name: 'air drop',
        value: { ...sheep, drops: [{ block: 'air', min: 1, max: 1, chance: 1 }] },
        error: 'air is not a drop',
      },
      {
        name: 'boss pack',
        value: { ...warden, spawn: { ...warden.spawn, pack: [1, 1] } },
        error: 'unknown field "pack"',
      },
      {
        name: 'phase order',
        value: {
          ...warden,
          phases: [
            { belowHealth: 0.25, speed: 1, damage: 1 },
            { belowHealth: 0.5, speed: 2, damage: 2 },
          ],
        },
        error: 'strictly decreasing',
      },
      {
        name: 'aggro inside attack range',
        value: { ...crawler, aggroRange: 0.5 },
        error: 'aggroRange ≥ attackRange',
      },
    ];

    for (const entry of cases) {
      const result = validateCreature(entry.value);
      expect(result.ok, entry.name).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join('\n'), entry.name).toContain(entry.error);
    }

    const list = validateCreatureList([sheep, null]);
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.errors.join('\n')).toContain('[1]: expected an object');
  });
});

describe('content loader', () => {
  it('loads bundled JSON when content/ is missing and validates a file map', () => {
    const bundled = loadContent();
    expect(bundled.byId.size).toBe(bundled.mobs.length + bundled.enemies.length + bundled.bosses.length);

    const empty = loadContent({});
    expect(empty.mobs).toEqual([]);
    expect(empty.enemies).toEqual([]);
    expect(empty.bosses).toEqual([]);
    expect(empty.byId.size).toBe(0);

    const catalog = loadContent({
      'content/mobs/sheep.json': sheep,
      'content/crawler.json': [crawler],
      'content/bosses/warden.json': warden,
    });
    expect(catalog.mobs.map((mob) => mob.id)).toEqual(['sheep']);
    expect(catalog.enemies.map((enemy) => enemy.id)).toEqual(['crawler']);
    expect(catalog.bosses.map((boss) => boss.id)).toEqual(['warden']);
    expect(catalog.byId.get('crawler')?.kind).toBe('enemy');

    expect(() => loadContent({ 'content/bad.json': { kind: 'mob' } })).toThrow(/Invalid content content\/bad\.json/);
    expect(() =>
      loadContent({
        'content/a.json': sheep,
        'content/b.json': { ...sheep, name: 'Clone' },
      }),
    ).toThrow(/"sheep" is already defined in content\/a.json/);
  });
});
