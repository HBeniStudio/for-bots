/**
 * Creature JSON for `content/`. A file is one object or an array of objects.
 * `content/**\/*.json` is inlined into the single-file build. A missing or empty
 * `content/` directory loads as an empty catalog; nothing is fetched at runtime.
 *
 * Schema version is {@link SCHEMA_VERSION}. Version 1 is the original contract.
 * Version 2 adds an optional `sprite`. Files that omit `sprite` stay valid.
 *
 * `kind` is `"mob"` (passive), `"enemy"` (hostile), or `"boss"`.
 * Refer to frozen ids by name or number:
 *   blocks — air 0, grass 1, dirt 2, stone 3, sand 4, water 5, snow 6,
 *            log 7, leaves 8, gravel 9, torch 10
 *   biomes — plains 0, forest 1, desert 2, snow 3
 *            (biome snow is 3; block snow is 6)
 *   light  — integers 0 (unlit) through 15 (full sun)
 *
 * Shared fields:
 *   id       `/^[a-z][a-z0-9_]{0,31}$/`
 *   name     1–48 characters, not blank
 *   health   finite, 0 < health ≤ 100000
 *   speed    finite, 0 ≤ speed ≤ 32 (blocks per second)
 *   size     { width, height, depth }, each finite and > 0;
 *            width and depth ≤ 4, height ≤ 8
 *   drops    optional { block, min, max, chance }[]
 *            block is a block name or id other than air;
 *            integers 1 ≤ min ≤ max ≤ 64; 0 < chance ≤ 1; at most 16 drops
 *   spawn    { biomes, minLight, maxLight, weight }
 *            biomes: one or more unique biome names or ids
 *            minLight, maxLight: integers 0–15, minLight ≤ maxLight
 *            weight: finite, 0 < weight ≤ 10000
 *
 * Mob and enemy spawn also require `pack: [min, max]` (integers, 1 ≤ min ≤ max ≤ 8).
 * Boss spawn omits `pack`.
 * Mob adds `flees` (boolean).
 * Enemy and boss add `damage` (0 < damage ≤ 10000), `attackRange` (0 < range ≤ 64),
 * and `aggroRange` (attackRange ≤ range ≤ 64), all in blocks.
 * Boss adds `phases`: 1–8 of { belowHealth, speed, damage }. `belowHealth` is the
 * fraction of max health where that phase starts, in (0, 1), strictly decreasing.
 * sprite   optional { colors, rows } pixel art.
 *          colors: 1–10 `#rrggbb` strings.
 *          rows: 1–16 strings of equal length 1–16.
 *          `.` is transparent; `0`–`9` indexes `colors`.
 * Unknown fields are rejected.
 *
 * @example mob
 * { "id": "sheep", "name": "Sheep", "kind": "mob", "health": 8, "speed": 1.1,
 *   "size": { "width": 0.9, "height": 1.3, "depth": 0.9 }, "flees": true,
 *   "spawn": { "biomes": ["plains"], "minLight": 9, "maxLight": 15,
 *              "weight": 8, "pack": [2, 4] } }
 * @example enemy
 * { "id": "crawler", "name": "Crawler", "kind": "enemy", "health": 16, "speed": 2,
 *   "size": { "width": 0.8, "height": 1.2, "depth": 0.8 },
 *   "damage": 3, "attackRange": 1.2, "aggroRange": 12,
 *   "drops": [{ "block": "gravel", "min": 1, "max": 1, "chance": 1 }],
 *   "spawn": { "biomes": ["forest"], "minLight": 0, "maxLight": 7,
 *              "weight": 4, "pack": [1, 3] } }
 * @example boss
 * { "id": "warden", "name": "Warden", "kind": "boss", "health": 200, "speed": 1.4,
 *   "size": { "width": 1.4, "height": 3.2, "depth": 1.4 },
 *   "damage": 8, "attackRange": 2.5, "aggroRange": 20,
 *   "phases": [{ "belowHealth": 0.5, "speed": 2.1, "damage": 12 }],
 *   "spawn": { "biomes": ["snow"], "minLight": 0, "maxLight": 7, "weight": 1 } }
 */

import { BLOCK_IDS, LIGHT_MAX, LIGHT_MIN, type BlockName } from '../world/blocks';
import { BIOME_IDS, type BiomeName } from '../world/gen/biomes';

/**
 * Content schema version.
 * 1 — creature contract without sprites.
 * 2 — optional `sprite` pixel art. Omitting it is still valid.
 */
export const SCHEMA_VERSION = 2;

export { BIOME_IDS, type BiomeName } from '../world/gen/biomes';
export { BLOCK_IDS, LIGHT_MAX, LIGHT_MIN, LIGHT_SCALE, type BlockName } from '../world/blocks';

const ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const NAME_MAX = 48;
const HEALTH_MAX = 100_000;
const SPEED_MAX = 32;
const DAMAGE_MAX = 10_000;
const RANGE_MAX = 64;
const WEIGHT_MAX = 10_000;
const SIZE_WIDTH_MAX = 4;
const SIZE_HEIGHT_MAX = 8;
const DROP_COUNT_MAX = 64;
const DROP_LIST_MAX = 16;
const PACK_MAX = 8;
const PHASE_MAX = 8;

const BLOCK_NAMES = Object.keys(BLOCK_IDS) as BlockName[];
const BIOME_NAMES = Object.keys(BIOME_IDS) as BiomeName[];

const blockIdToName = new Map<number, BlockName>(BLOCK_NAMES.map((name) => [BLOCK_IDS[name], name]));
const biomeIdToName = new Map<number, BiomeName>(BIOME_NAMES.map((name) => [BIOME_IDS[name], name]));

export interface Size {
  width: number;
  height: number;
  depth: number;
}

/** Small pixel image. `rows[y][x]` is `.` or an index into {@link colors}. */
export interface SpriteDef {
  colors: readonly string[];
  rows: readonly string[];
}

export interface Drop {
  block: BlockName;
  min: number;
  max: number;
  chance: number;
}

export interface SpawnCommon {
  biomes: readonly BiomeName[];
  minLight: number;
  maxLight: number;
  weight: number;
}

export interface PackSpawn extends SpawnCommon {
  pack: readonly [number, number];
}

export interface BossPhase {
  belowHealth: number;
  speed: number;
  damage: number;
}

export interface MobDef {
  id: string;
  name: string;
  kind: 'mob';
  health: number;
  speed: number;
  size: Size;
  drops: readonly Drop[];
  flees: boolean;
  spawn: PackSpawn;
  sprite?: SpriteDef;
}

export interface EnemyDef {
  id: string;
  name: string;
  kind: 'enemy';
  health: number;
  speed: number;
  size: Size;
  drops: readonly Drop[];
  damage: number;
  attackRange: number;
  aggroRange: number;
  spawn: PackSpawn;
  sprite?: SpriteDef;
}

export interface BossDef {
  id: string;
  name: string;
  kind: 'boss';
  health: number;
  speed: number;
  size: Size;
  drops: readonly Drop[];
  damage: number;
  attackRange: number;
  aggroRange: number;
  phases: readonly BossPhase[];
  spawn: SpawnCommon;
  sprite?: SpriteDef;
}

export type CreatureDef = MobDef | EnemyDef | BossDef;
export type CreatureKind = CreatureDef['kind'];

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

const SHARED_FIELDS = ['id', 'name', 'kind', 'health', 'speed', 'size', 'drops', 'spawn', 'sprite'] as const;
const COMBAT_FIELDS = ['damage', 'attackRange', 'aggroRange'] as const;

function fail(errors: readonly string[]): ValidationResult<never> {
  return { ok: false, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  const ok = new Set<string>(allowed);
  const prefix = path === '' ? '' : `${path}: `;
  for (const key of Object.keys(value)) {
    if (!ok.has(key)) errors.push(`${prefix}unknown field "${key}"`);
  }
}

function readFinite(value: unknown, path: string, errors: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: expected a finite number`);
    return undefined;
  }
  return value;
}

function readBound(
  value: unknown,
  path: string,
  errors: string[],
  min: number,
  max: number,
  exclusiveMin: boolean,
  label: string,
  exclusiveMax = false,
): number | undefined {
  const n = readFinite(value, path, errors);
  if (n === undefined) return undefined;
  const above = exclusiveMin ? n > min : n >= min;
  const below = exclusiveMax ? n < max : n <= max;
  if (!above || !below) {
    errors.push(`${path}: ${label}`);
    return undefined;
  }
  return n;
}

function readInt(
  value: unknown,
  path: string,
  errors: string[],
  min: number,
  max: number,
  label: string,
): number | undefined {
  const n = readBound(value, path, errors, min, max, false, label);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n)) {
    errors.push(`${path}: ${label}`);
    return undefined;
  }
  return n;
}

function readId(value: unknown, errors: string[]): string | undefined {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    errors.push('id: expected /^[a-z][a-z0-9_]{0,31}$/');
    return undefined;
  }
  return value;
}

function readName(value: unknown, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > NAME_MAX) {
    errors.push(`name: expected 1–${NAME_MAX} non-blank characters`);
    return undefined;
  }
  return value;
}

function readBlock(value: unknown, path: string, errors: string[]): BlockName | undefined {
  let name: BlockName | undefined;
  if (typeof value === 'string' && (BLOCK_NAMES as readonly string[]).includes(value)) {
    name = value as BlockName;
  } else if (typeof value === 'number' && Number.isInteger(value)) {
    name = blockIdToName.get(value);
  }
  if (!name) {
    errors.push(`${path}: expected a block name or id (${BLOCK_NAMES.join(', ')})`);
    return undefined;
  }
  if (name === 'air') {
    errors.push(`${path}: air is not a drop`);
    return undefined;
  }
  return name;
}

function readBiome(value: unknown, path: string, errors: string[]): BiomeName | undefined {
  if (typeof value === 'string' && (BIOME_NAMES as readonly string[]).includes(value)) {
    return value as BiomeName;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    const name = biomeIdToName.get(value);
    if (name) return name;
  }
  errors.push(`${path}: expected a biome name or id (${BIOME_NAMES.join(', ')})`);
  return undefined;
}

function readSize(value: unknown, errors: string[]): Size | undefined {
  if (!isRecord(value)) {
    errors.push('size: expected { width, height, depth }');
    return undefined;
  }
  rejectUnknown(value, ['width', 'height', 'depth'], 'size', errors);
  const width = readBound(value.width, 'size.width', errors, 0, SIZE_WIDTH_MAX, true, `expected 0 < width ≤ ${SIZE_WIDTH_MAX}`);
  const height = readBound(
    value.height,
    'size.height',
    errors,
    0,
    SIZE_HEIGHT_MAX,
    true,
    `expected 0 < height ≤ ${SIZE_HEIGHT_MAX}`,
  );
  const depth = readBound(value.depth, 'size.depth', errors, 0, SIZE_WIDTH_MAX, true, `expected 0 < depth ≤ ${SIZE_WIDTH_MAX}`);
  if (width === undefined || height === undefined || depth === undefined) return undefined;
  return { width, height, depth };
}

function readDrops(value: unknown, errors: string[]): readonly Drop[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('drops: expected an array');
    return undefined;
  }
  if (value.length > DROP_LIST_MAX) {
    errors.push(`drops: expected at most ${DROP_LIST_MAX} entries`);
    return undefined;
  }
  const drops: Drop[] = [];
  let ok = true;
  for (let i = 0; i < value.length; i++) {
    const path = `drops[${i}]`;
    const entry = value[i];
    if (!isRecord(entry)) {
      errors.push(`${path}: expected an object`);
      ok = false;
      continue;
    }
    rejectUnknown(entry, ['block', 'min', 'max', 'chance'], path, errors);
    const block = readBlock(entry.block, `${path}.block`, errors);
    const min = readInt(entry.min, `${path}.min`, errors, 1, DROP_COUNT_MAX, `expected an integer 1–${DROP_COUNT_MAX}`);
    const max = readInt(entry.max, `${path}.max`, errors, 1, DROP_COUNT_MAX, `expected an integer 1–${DROP_COUNT_MAX}`);
    const chance = readBound(entry.chance, `${path}.chance`, errors, 0, 1, true, 'expected 0 < chance ≤ 1');
    if (min !== undefined && max !== undefined && min > max) {
      errors.push(`${path}: expected min ≤ max`);
    }
    if (block === undefined || min === undefined || max === undefined || chance === undefined || (min !== undefined && max !== undefined && min > max)) {
      ok = false;
      continue;
    }
    drops.push({ block, min, max, chance });
  }
  return ok ? drops : undefined;
}

function readPack(value: unknown, errors: string[]): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    errors.push(`spawn.pack: expected [min, max] with 1 ≤ min ≤ max ≤ ${PACK_MAX}`);
    return undefined;
  }
  const min = readInt(value[0], 'spawn.pack[0]', errors, 1, PACK_MAX, `expected an integer 1–${PACK_MAX}`);
  const max = readInt(value[1], 'spawn.pack[1]', errors, 1, PACK_MAX, `expected an integer 1–${PACK_MAX}`);
  if (min === undefined || max === undefined) return undefined;
  if (min > max) {
    errors.push('spawn.pack: expected min ≤ max');
    return undefined;
  }
  return [min, max];
}

function readSpawn(value: unknown, kind: CreatureKind, errors: string[]): SpawnCommon | PackSpawn | undefined {
  if (!isRecord(value)) {
    errors.push('spawn: expected an object');
    return undefined;
  }
  const allowed = ['biomes', 'minLight', 'maxLight', 'weight'];
  if (kind !== 'boss') allowed.push('pack');
  rejectUnknown(value, allowed, 'spawn', errors);

  let biomes: BiomeName[] | undefined;
  if (!Array.isArray(value.biomes) || value.biomes.length === 0) {
    errors.push('spawn.biomes: expected a non-empty array of biomes');
  } else {
    const names: BiomeName[] = [];
    const seen = new Set<BiomeName>();
    let biomeOk = true;
    for (let i = 0; i < value.biomes.length; i++) {
      const name = readBiome(value.biomes[i], `spawn.biomes[${i}]`, errors);
      if (!name) {
        biomeOk = false;
        continue;
      }
      if (seen.has(name)) {
        errors.push(`spawn.biomes: duplicate "${name}"`);
        biomeOk = false;
        continue;
      }
      seen.add(name);
      names.push(name);
    }
    if (biomeOk) biomes = names;
  }

  const lightLabel = `expected an integer ${LIGHT_MIN}–${LIGHT_MAX}`;
  const minLight = readInt(value.minLight, 'spawn.minLight', errors, LIGHT_MIN, LIGHT_MAX, lightLabel);
  const maxLight = readInt(value.maxLight, 'spawn.maxLight', errors, LIGHT_MIN, LIGHT_MAX, lightLabel);
  if (minLight !== undefined && maxLight !== undefined && minLight > maxLight) {
    errors.push('spawn: expected minLight ≤ maxLight');
  }
  const weight = readBound(value.weight, 'spawn.weight', errors, 0, WEIGHT_MAX, true, `expected 0 < weight ≤ ${WEIGHT_MAX}`);
  const pack = kind === 'boss' ? undefined : readPack(value.pack, errors);

  if (
    !biomes ||
    minLight === undefined ||
    maxLight === undefined ||
    minLight > maxLight ||
    weight === undefined ||
    (kind !== 'boss' && !pack)
  ) {
    return undefined;
  }
  const common: SpawnCommon = { biomes, minLight, maxLight, weight };
  if (kind === 'boss') return common;
  return { ...common, pack: pack! };
}

function readPhases(value: unknown, errors: string[]): readonly BossPhase[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > PHASE_MAX) {
    errors.push(`phases: expected 1–${PHASE_MAX} phases`);
    return undefined;
  }
  const phases: BossPhase[] = [];
  let ok = true;
  let previous = 1;
  for (let i = 0; i < value.length; i++) {
    const path = `phases[${i}]`;
    const entry = value[i];
    if (!isRecord(entry)) {
      errors.push(`${path}: expected an object`);
      ok = false;
      continue;
    }
    rejectUnknown(entry, ['belowHealth', 'speed', 'damage'], path, errors);
    const belowHealth = readBound(
      entry.belowHealth,
      `${path}.belowHealth`,
      errors,
      0,
      1,
      true,
      'expected a fraction in (0, 1)',
      true,
    );
    if (belowHealth !== undefined && belowHealth >= previous) {
      errors.push(`${path}.belowHealth: phases must be strictly decreasing`);
    }
    const speed = readBound(entry.speed, `${path}.speed`, errors, 0, SPEED_MAX, false, `expected 0 ≤ speed ≤ ${SPEED_MAX}`);
    const damage = readBound(
      entry.damage,
      `${path}.damage`,
      errors,
      0,
      DAMAGE_MAX,
      true,
      `expected 0 < damage ≤ ${DAMAGE_MAX}`,
    );
    if (belowHealth === undefined || belowHealth >= previous || speed === undefined || damage === undefined) {
      ok = false;
      continue;
    }
    previous = belowHealth;
    phases.push({ belowHealth, speed, damage });
  }
  return ok ? phases : undefined;
}

function readCombat(value: Record<string, unknown>, errors: string[]): { damage: number; attackRange: number; aggroRange: number } | undefined {
  const damage = readBound(value.damage, 'damage', errors, 0, DAMAGE_MAX, true, `expected 0 < damage ≤ ${DAMAGE_MAX}`);
  const attackRange = readBound(
    value.attackRange,
    'attackRange',
    errors,
    0,
    RANGE_MAX,
    true,
    `expected 0 < attackRange ≤ ${RANGE_MAX}`,
  );
  const aggroRange = readBound(
    value.aggroRange,
    'aggroRange',
    errors,
    0,
    RANGE_MAX,
    true,
    `expected 0 < aggroRange ≤ ${RANGE_MAX}`,
  );
  if (attackRange !== undefined && aggroRange !== undefined && aggroRange < attackRange) {
    errors.push('aggroRange: expected aggroRange ≥ attackRange');
  }
  if (damage === undefined || attackRange === undefined || aggroRange === undefined || aggroRange < attackRange) {
    return undefined;
  }
  return { damage, attackRange, aggroRange };
}

interface Shared {
  id: string;
  name: string;
  health: number;
  speed: number;
  size: Size;
  drops: readonly Drop[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function readSprite(value: unknown, errors: string[]): SpriteDef | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('sprite: expected { colors, rows }');
    return undefined;
  }
  rejectUnknown(value, ['colors', 'rows'], 'sprite', errors);
  const before = errors.length;

  let colors: string[] | undefined;
  if (!Array.isArray(value.colors) || value.colors.length < 1 || value.colors.length > 10) {
    errors.push('sprite.colors: expected 1–10 hex colors');
  } else {
    const parsed: string[] = [];
    let colorOk = true;
    for (let i = 0; i < value.colors.length; i++) {
      const color = value.colors[i];
      if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
        errors.push(`sprite.colors[${i}]: expected #rrggbb`);
        colorOk = false;
        continue;
      }
      parsed.push(color.toLowerCase());
    }
    if (colorOk) colors = parsed;
  }

  let rows: string[] | undefined;
  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 16) {
    errors.push('sprite.rows: expected 1–16 rows');
  } else if (colors) {
    const parsed: string[] = [];
    let width = -1;
    let rowOk = true;
    for (let r = 0; r < value.rows.length; r++) {
      const row = value.rows[r];
      if (typeof row !== 'string' || row.length < 1 || row.length > 16) {
        errors.push(`sprite.rows[${r}]: expected a string of length 1–16`);
        rowOk = false;
        continue;
      }
      if (width < 0) width = row.length;
      else if (row.length !== width) {
        errors.push(`sprite.rows[${r}]: expected length ${width}`);
        rowOk = false;
      }
      for (let c = 0; c < row.length; c++) {
        const ch = row.charAt(c);
        if (ch === '.') continue;
        const index = ch.charCodeAt(0) - 48;
        if (index < 0 || index > 9 || index >= colors.length) {
          errors.push(`sprite.rows[${r}]: unknown pixel "${ch}"`);
          rowOk = false;
          break;
        }
      }
      parsed.push(row);
    }
    if (rowOk) rows = parsed;
  }

  if (errors.length > before || !colors || !rows) return undefined;
  return { colors, rows };
}

function readShared(value: Record<string, unknown>, errors: string[]): Shared | undefined {
  const id = readId(value.id, errors);
  const name = readName(value.name, errors);
  const health = readBound(value.health, 'health', errors, 0, HEALTH_MAX, true, `expected 0 < health ≤ ${HEALTH_MAX}`);
  const speed = readBound(value.speed, 'speed', errors, 0, SPEED_MAX, false, `expected 0 ≤ speed ≤ ${SPEED_MAX}`);
  const size = readSize(value.size, errors);
  const drops = readDrops(value.drops, errors);
  if (!id || !name || health === undefined || speed === undefined || !size || !drops) return undefined;
  return { id, name, health, speed, size, drops };
}

/** Validate one creature object. Numeric block and biome ids become their stable names. */
export function validateCreature(value: unknown): ValidationResult<CreatureDef> {
  if (!isRecord(value)) return fail(['expected an object']);
  const kind = value.kind;
  if (kind !== 'mob' && kind !== 'enemy' && kind !== 'boss') {
    return fail(['kind: expected "mob", "enemy", or "boss"']);
  }

  const errors: string[] = [];
  const allowed: string[] = [...SHARED_FIELDS];
  if (kind === 'mob') allowed.push('flees');
  if (kind === 'enemy' || kind === 'boss') allowed.push(...COMBAT_FIELDS);
  if (kind === 'boss') allowed.push('phases');
  rejectUnknown(value, allowed, '', errors);

  const shared = readShared(value, errors);
  const spawn = readSpawn(value.spawn, kind, errors);
  const sprite = readSprite(value.sprite, errors);

  if (kind === 'mob') {
    if (typeof value.flees !== 'boolean') errors.push('flees: expected a boolean');
    if (errors.length > 0 || !shared || !spawn || typeof value.flees !== 'boolean' || !('pack' in spawn)) {
      return fail(errors);
    }
    const mob: MobDef = { ...shared, kind, flees: value.flees, spawn };
    if (sprite) mob.sprite = sprite;
    return { ok: true, value: mob };
  }

  const combat = readCombat(value, errors);
  if (kind === 'enemy') {
    if (errors.length > 0 || !shared || !spawn || !combat || !('pack' in spawn)) return fail(errors);
    const enemy: EnemyDef = { ...shared, kind, ...combat, spawn };
    if (sprite) enemy.sprite = sprite;
    return { ok: true, value: enemy };
  }

  const phases = readPhases(value.phases, errors);
  if (errors.length > 0 || !shared || !spawn || !combat || !phases || 'pack' in spawn) return fail(errors);
  const boss: BossDef = { ...shared, kind, ...combat, phases, spawn };
  if (sprite) boss.sprite = sprite;
  return { ok: true, value: boss };
}

/** Validate one creature or an array of them, in file order. */
export function validateCreatureList(value: unknown): ValidationResult<readonly CreatureDef[]> {
  if (Array.isArray(value)) {
    const creatures: CreatureDef[] = [];
    const errors: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const result = validateCreature(value[i]);
      if (result.ok) creatures.push(result.value);
      else {
        for (const error of result.errors) {
          errors.push(error.includes(':') ? `[${i}].${error}` : `[${i}]: ${error}`);
        }
      }
    }
    if (errors.length > 0) return fail(errors);
    return { ok: true, value: creatures };
  }
  const one = validateCreature(value);
  if (!one.ok) return one;
  return { ok: true, value: [one.value] };
}
