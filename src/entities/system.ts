import type { BiomeName, CreatureDef } from '../content/schema';
import { loadContent, type ContentCatalog } from '../content/loader';
import { AIR, BLOCK_IDS, LEAVES, LOG, WATER } from '../world/blocks';
import { CHUNK_Y } from '../world/chunk';
import { sampleLight, sunlightFactor } from '../world/light';
import { SEA_LEVEL, columnAt } from '../world/gen/terrain';
import { World, worldToChunk } from '../world/world';
import { isSolid, overlapsSolid, PLAYER_HEIGHT, type Body } from '../player/physics';
import type { Player } from '../player/player';
import type { Camera } from '../render/camera';
import type { DepthSprite } from '../render/renderer';
import { Creature } from './creature';
import {
  HURT_INVULN,
  PLAYER_DAMAGE,
  PLAYER_MAX_HEALTH,
  PLAYER_REACH,
  PLAYER_SWING,
  RESPAWN_DELAY,
  rollDrops,
  type DropStack,
} from './combat';
import { drawCreature, drawVitalBar } from './render';
import {
  biomeNameFromId,
  matchesSpawn,
  planSpawn,
  BOSS_LIMIT,
  ENTITY_LIMIT,
  TYPE_LIMIT,
} from './spawn';

const SPAWN_INTERVAL = 2.5;
const SPAWN_TRIES = 4;
const MIN_SPAWN_DISTANCE = 12;
const MAX_SPAWN_DISTANCE = 30;
const DESPAWN_DISTANCE = 64;

let activeSystem: EntitySystem | null = null;
let attackListenerInstalled = false;

function installAttackListener(): void {
  if (attackListenerInstalled) return;
  const win = (globalThis as { window?: Window }).window;
  if (!win?.addEventListener) return;
  attackListenerInstalled = true;
  win.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof HTMLCanvasElement)) return;
    activeSystem?.playerAttack();
  });
  win.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat || event.code !== 'KeyF') return;
    activeSystem?.playerAttack();
  });
}

export interface EntitySystemOptions {
  catalog?: ContentCatalog;
  rng?: () => number;
  /** When false, {@link EntitySystem.update} does not try to spawn. */
  spawning?: boolean;
  /** World clock in seconds. Noon is 0, matching the day/night cycle. */
  time?: number;
  respawnDelay?: number;
}

/**
 * Live creatures for one world. Construct with the player, then call
 * {@link update} once per frame and draw {@link sprites} with the world.
 */
export class EntitySystem {
  readonly player: Player;
  playerHealth = PLAYER_MAX_HEALTH;
  playerAlive = true;
  lastDrops: readonly DropStack[] = [];

  private readonly defs: readonly CreatureDef[];
  private readonly byId = new Map<string, CreatureDef>();
  private readonly rng: () => number;
  private readonly spawning: boolean;
  private readonly respawnDelay: number;
  private readonly list: Creature[] = [];
  private readonly spawnX: number;
  private readonly spawnY: number;
  private readonly spawnZ: number;
  private clock: number;
  private world: World | null = null;
  private spawnAccumulator = 0;
  private playerInvuln = 0;
  private attackCooldown = 0;
  private respawnIn = 0;
  private corpseX = 0;
  private corpseY = 0;
  private corpseZ = 0;

  constructor(player: Player, options: EntitySystemOptions = {}) {
    this.player = player;
    const catalog = options.catalog ?? loadContent();
    this.defs = [...catalog.mobs, ...catalog.enemies, ...catalog.bosses];
    for (const def of this.defs) this.byId.set(def.id, def);
    this.rng = options.rng ?? Math.random;
    this.spawning = options.spawning !== false;
    this.respawnDelay = options.respawnDelay ?? RESPAWN_DELAY;
    this.clock = options.time ?? 0;
    this.spawnX = player.pos.x;
    this.spawnY = player.pos.y;
    this.spawnZ = player.pos.z;
    activeSystem = this;
    installAttackListener();
  }

  get creatures(): readonly Creature[] {
    return this.list;
  }

  get total(): number {
    return this.list.length;
  }

  countOf(id: string): number {
    let count = 0;
    for (const creature of this.list) if (creature.def.id === id) count += 1;
    return count;
  }

  /** World time used for spawn light. The frame loop advances it by `dt`. */
  setTime(seconds: number): void {
    this.clock = seconds;
  }

  /**
   * Step AI, physics, melee, death, and spawning.
   * `world` is the voxel world the creatures walk on.
   */
  update(dt: number, world: World): void {
    this.world = world;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.clock += dt;
    this.playerInvuln = Math.max(0, this.playerInvuln - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (!this.playerAlive) {
      this.player.pos.x = this.corpseX;
      this.player.pos.y = this.corpseY;
      this.player.pos.z = this.corpseZ;
      this.player.vel.x = 0;
      this.player.vel.y = 0;
      this.player.vel.z = 0;
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
    }

    for (const creature of this.list) {
      if (creature.pos.y < -2) continue;
      creature.observe(this.player);
      creature.update(dt, world);
      const hit = creature.consumeHit();
      if (hit > 0) this.damagePlayer(hit);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const creature = this.list[i]!;
      if (creature.health <= 0) this.kill(creature, world);
      else if (creature.pos.y < -2) this.list.splice(i, 1);
    }
    this.despawnDistant();

    if (!this.spawning || !this.playerAlive) return;
    this.spawnAccumulator += dt;
    if (this.spawnAccumulator < SPAWN_INTERVAL) return;
    this.spawnAccumulator = 0;
    this.spawnPass(world);
  }

  /** Melee the nearest creature inside reach. Returns true when a hit lands. */
  playerAttack(amount = PLAYER_DAMAGE): boolean {
    if (!this.playerAlive || this.attackCooldown > 0) return false;
    let best: Creature | null = null;
    let bestDistance = PLAYER_REACH;
    for (const creature of this.list) {
      if (creature.health <= 0) continue;
      const distance = Math.hypot(
        creature.pos.x - this.player.pos.x,
        creature.pos.y - this.player.pos.y,
        creature.pos.z - this.player.pos.z,
      );
      if (distance <= bestDistance) {
        best = creature;
        bestDistance = distance;
      }
    }
    if (!best) return false;
    this.attackCooldown = PLAYER_SWING;
    this.hurtCreature(best, amount);
    return true;
  }

  damagePlayer(amount: number): void {
    if (!this.playerAlive || this.playerInvuln > 0 || !(amount > 0)) return;
    this.playerHealth = Math.max(0, this.playerHealth - amount);
    this.playerInvuln = HURT_INVULN;
    if (this.playerHealth > 0) return;
    this.playerAlive = false;
    this.respawnIn = this.respawnDelay;
    this.corpseX = this.player.pos.x;
    this.corpseY = this.player.pos.y;
    this.corpseZ = this.player.pos.z;
  }

  hurtCreature(creature: Creature, amount: number): boolean {
    const died = creature.hurt(amount);
    if (!died) return false;
    if (this.world) this.kill(creature, this.world);
    else this.dropWithoutWorld(creature);
    return true;
  }

  /**
   * Try to spawn one pack on this column. Returns how many creatures appeared.
   * The chunk must already be generated. Light uses the system clock.
   */
  trySpawnColumn(world: World, x: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const anchor = this.columnRule(world, bx, bz);
    if (!anchor) return 0;
    const choice = planSpawn(this.defs, anchor.biome, anchor.light, this.counts(), this.list.length, this.rng);
    if (!choice) return 0;
    const def = this.byId.get(choice.id);
    if (!def) return 0;
    for (let radius = 0; radius <= 2; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const rule = radius === 0 ? anchor : this.columnRule(world, bx + dx, bz + dz);
          if (!rule || rule.biome !== anchor.biome || !matchesSpawn(def, rule.biome, rule.light)) continue;
          const placed = this.placePack(world, def, bx + dx, rule.feet, bz + dz, choice.count);
          if (placed > 0) return placed;
        }
      }
    }
    return 0;
  }

  spawnCreature(def: CreatureDef, x: number, y: number, z: number): Creature | null {
    if (this.list.length >= ENTITY_LIMIT) return null;
    const cap = def.kind === 'boss' ? BOSS_LIMIT : TYPE_LIMIT;
    if (this.countOf(def.id) >= cap) return null;
    const creature = new Creature(def, x, y, z, this.rng);
    this.list.push(creature);
    return creature;
  }

  /** Depth-sorted sprites for the iso renderer, including a player health bar. */
  sprites(camera: Camera): DepthSprite[] {
    const sprites: DepthSprite[] = [];
    for (const creature of this.list) {
      sprites.push({
        x: creature.pos.x,
        y: creature.pos.y + creature.def.size.height * 0.5,
        z: creature.pos.z,
        draw: (ctx) => drawCreature(ctx, camera, creature),
      });
    }
    if (this.playerHealth < PLAYER_MAX_HEALTH || !this.playerAlive) {
      const x = this.player.pos.x;
      const y = this.player.pos.y + PLAYER_HEIGHT;
      const z = this.player.pos.z;
      const fraction = this.playerHealth / PLAYER_MAX_HEALTH;
      sprites.push({
        x,
        y,
        z,
        draw: (ctx) => drawVitalBar(ctx, camera, x, y + 0.2, z, fraction),
      });
    }
    return sprites;
  }

  private respawn(): void {
    this.playerAlive = true;
    this.playerHealth = PLAYER_MAX_HEALTH;
    this.playerInvuln = 1;
    this.player.pos.x = this.spawnX;
    this.player.pos.y = this.spawnY;
    this.player.pos.z = this.spawnZ;
    this.player.vel.x = 0;
    this.player.vel.y = 0;
    this.player.vel.z = 0;
    this.player.body.onGround = true;
  }

  private columnRule(world: World, x: number, z: number): { biome: BiomeName; light: number; feet: number } | null {
    const column = columnAt(world.seed, x, z);
    if (column.height < SEA_LEVEL) return null;
    const biome = biomeNameFromId(column.biome);
    if (!biome) return null;
    const { cx, cz } = worldToChunk(x, z);
    if (!world.getChunk(cx, cz)) return null;
    const feet = findFeet(world, x, z, null);
    if (!feet) return null;
    const light = sampleLight(world, x, feet.y, z, sunlightFactor(this.clock)).combined;
    return { biome, light, feet: feet.y };
  }

  private counts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const creature of this.list) counts.set(creature.def.id, (counts.get(creature.def.id) ?? 0) + 1);
    return counts;
  }

  private spawnPass(world: World): void {
    if (this.list.length >= ENTITY_LIMIT) return;
    const originX = this.player.pos.x;
    const originZ = this.player.pos.z;
    for (let attempt = 0; attempt < SPAWN_TRIES; attempt++) {
      const angle = this.rng() * Math.PI * 2;
      const distance = MIN_SPAWN_DISTANCE + this.rng() * (MAX_SPAWN_DISTANCE - MIN_SPAWN_DISTANCE);
      const x = Math.floor(originX + Math.cos(angle) * distance);
      const z = Math.floor(originZ + Math.sin(angle) * distance);
      if (this.trySpawnColumn(world, x, z) > 0) return;
    }
  }

  private placePack(world: World, def: CreatureDef, bx: number, feetY: number, bz: number, count: number): number {
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2;
      const radius = i === 0 ? 0 : Math.max(0.85, def.size.width);
      const px = bx + 0.5 + Math.cos(angle) * radius;
      const pz = bz + 0.5 + Math.sin(angle) * radius;
      const hinted = i === 0 && canStand(world, bx + 0.5, feetY, bz + 0.5, def) ? feetY : null;
      const spot =
        hinted !== null
          ? { x: bx + 0.5, y: hinted, z: bz + 0.5 }
          : standAt(world, Math.floor(px), Math.floor(pz), def);
      if (!spot) continue;
      this.list.push(new Creature(def, spot.x, spot.y, spot.z, this.rng));
      placed += 1;
    }
    return placed;
  }

  private despawnDistant(): void {
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const creature = this.list[i]!;
      if (creature.mode === 'chase' || creature.mode === 'attack') continue;
      const distance = Math.hypot(creature.pos.x - px, creature.pos.z - pz);
      if (distance > DESPAWN_DISTANCE) this.list.splice(i, 1);
    }
  }

  private kill(creature: Creature, world: World): void {
    const index = this.list.indexOf(creature);
    if (index >= 0) this.list.splice(index, 1);
    const stacks = rollDrops(creature.def.drops, this.rng);
    this.lastDrops = stacks;
    placeDrops(world, creature.pos.x, creature.pos.y, creature.pos.z, stacks);
  }

  private dropWithoutWorld(creature: Creature): void {
    const index = this.list.indexOf(creature);
    if (index >= 0) this.list.splice(index, 1);
    this.lastDrops = rollDrops(creature.def.drops, this.rng);
  }
}

function isStandable(id: number): boolean {
  return isSolid(id) && id !== WATER && id !== LEAVES && id !== LOG;
}

function bodyFor(def: CreatureDef, x: number, y: number, z: number): Body {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    width: def.size.width,
    depth: def.size.depth,
    height: def.size.height,
  };
}

function canStand(world: World, x: number, y: number, z: number, def: CreatureDef): boolean {
  if (!isStandable(world.getBlock(x, y - 1, z))) return false;
  return !overlapsSolid(world, bodyFor(def, x, y, z));
}

/** Feet height on a loaded column. Without `def`, two clear blocks are enough to sample light. */
function findFeet(world: World, bx: number, bz: number, def: CreatureDef | null): { y: number } | null {
  const column = columnAt(world.seed, bx, bz);
  const top = Math.min(CHUNK_Y - 2, column.height + 8);
  const bottom = Math.max(1, column.height - 1);
  for (let y = top; y >= bottom; y--) {
    if (def) {
      if (canStand(world, bx + 0.5, y, bz + 0.5, def)) return { y };
      continue;
    }
    if (!isStandable(world.getBlock(bx, y - 1, bz))) continue;
    if (world.getBlock(bx, y, bz) !== AIR) continue;
    if (world.getBlock(bx, y + 1, bz) !== AIR) continue;
    return { y };
  }
  return null;
}

function standAt(world: World, bx: number, bz: number, def: CreatureDef): { x: number; y: number; z: number } | null {
  const feet = findFeet(world, bx, bz, def);
  if (!feet) return null;
  return { x: bx + 0.5, y: feet.y, z: bz + 0.5 };
}

function placeDrops(world: World, x: number, y: number, z: number, stacks: readonly DropStack[]): void {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  let by = Math.max(0, Math.floor(y));
  for (const stack of stacks) {
    const id = BLOCK_IDS[stack.block];
    for (let n = 0; n < stack.count; n++) {
      while (by < CHUNK_Y && world.getBlock(bx, by, bz) !== AIR) by += 1;
      if (by >= CHUNK_Y) return;
      world.setBlock(bx, by, bz, id);
      by += 1;
    }
  }
}
