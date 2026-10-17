import type { Entity, Vec3 } from '../entity/entity';
import type { CreatureDef } from '../content/schema';
import { bodyAabb, stepBody, type Body, type VoxelQuery } from '../player/physics';
import { nextAiMode, type AiMode } from './ai';
import { ATTACK_COOLDOWN, bossPhaseIndex } from './combat';

function axisView(body: Body, x: 'x' | 'vx', y: 'y' | 'vy', z: 'z' | 'vz'): Vec3 {
  return {
    get x() {
      return body[x];
    },
    set x(v: number) {
      body[x] = v;
    },
    get y() {
      return body[y];
    },
    set y(v: number) {
      body[y] = v;
    },
    get z() {
      return body[z];
    },
    set z(v: number) {
      body[z] = v;
    },
  };
}

export interface SenseTarget {
  readonly pos: Vec3;
}

/**
 * One content creature. Movement goes through the player voxel collider;
 * `width` / `depth` / `height` on the body select this creature's size.
 */
export class Creature implements Entity {
  readonly def: CreatureDef;
  readonly body: Body;
  readonly pos: Vec3;
  readonly vel: Vec3;
  health: number;
  readonly maxHealth: number;
  mode: AiMode = 'wander';
  /** -1 is the creature's base stats. Bosses advance this as health falls. */
  phaseIndex = -1;
  hurtTimer = 0;
  anim = 0;
  /** 1 faces screen-right. */
  facing = 1;

  private readonly rng: () => number;
  private target: SenseTarget | null = null;
  private locomotion: 'idle' | 'wander' = 'wander';
  private timer = 1.5;
  private wishX = 1;
  private wishZ = 0;
  private attackCooldown = 0;
  private pendingHit = 0;

  constructor(def: CreatureDef, x: number, y: number, z: number, rng: () => number = Math.random) {
    this.def = def;
    this.rng = rng;
    this.maxHealth = def.health;
    this.health = def.health;
    const body: Body = {
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
    this.body = body;
    this.pos = axisView(body, 'x', 'y', 'z');
    this.vel = axisView(body, 'vx', 'vy', 'vz');
    this.syncPhase();
  }

  get aabb() {
    return bodyAabb(this.body);
  }

  get moveSpeed(): number {
    if (this.def.kind === 'boss' && this.phaseIndex >= 0) return this.def.phases[this.phaseIndex]!.speed;
    return this.def.speed;
  }

  get attackDamage(): number {
    if (this.def.kind === 'mob') return 0;
    if (this.def.kind === 'boss' && this.phaseIndex >= 0) return this.def.phases[this.phaseIndex]!.damage;
    return this.def.damage;
  }

  observe(target: SenseTarget | null): void {
    this.target = target;
  }

  /** Apply damage. Returns true when this hit drops health to zero. */
  hurt(amount: number): boolean {
    if (this.health <= 0 || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.12;
    this.syncPhase();
    return this.health <= 0;
  }

  /** Damage this creature wants to deal to the player this tick. */
  consumeHit(): number {
    const hit = this.pendingHit;
    this.pendingHit = 0;
    return hit;
  }

  update(dt: number, world: VoxelQuery): void {
    if (this.health <= 0 || !Number.isFinite(dt) || dt <= 0) return;
    this.anim += dt;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.syncPhase();
    this.mode = this.pickMode();
    const wish = this.steer();
    const beforeX = this.body.x;
    const beforeZ = this.body.z;
    stepBody(this.body, world, dt, wish.x, wish.z, false, this.moveSpeed);
    if (this.mode === 'wander' && this.body.onGround) {
      const moved = Math.hypot(this.body.x - beforeX, this.body.z - beforeZ);
      if (moved < 0.01 && Math.hypot(wish.x, wish.z) > 0) {
        this.wishX = -this.wishX || 1;
        this.wishZ = -this.wishZ;
      }
    }
    if (this.body.vx - this.body.vz > 0.05) this.facing = 1;
    else if (this.body.vx - this.body.vz < -0.05) this.facing = -1;
    this.pendingHit = 0;
    if (this.mode === 'attack' && this.target && this.attackCooldown <= 0 && this.distanceTo(this.target) <= this.attackRange()) {
      this.attackCooldown = ATTACK_COOLDOWN;
      this.pendingHit = this.attackDamage;
    }
    this.tickLocomotion(dt);
  }

  private syncPhase(): void {
    if (this.def.kind !== 'boss') {
      this.phaseIndex = -1;
      return;
    }
    this.phaseIndex = bossPhaseIndex(this.def.phases, this.health, this.maxHealth);
  }

  private attackRange(): number {
    return this.def.kind === 'mob' ? 0 : this.def.attackRange;
  }

  private distanceTo(target: SenseTarget): number {
    return Math.hypot(target.pos.x - this.pos.x, target.pos.y - this.pos.y, target.pos.z - this.pos.z);
  }

  private pickMode(): AiMode {
    const target = this.target;
    if (!target) return this.locomotion;
    const flees = this.def.kind === 'mob' && this.def.flees;
    const stimulus = nextAiMode({
      kind: this.def.kind,
      flees,
      mode: this.mode,
      distance: this.distanceTo(target),
      aggroRange: this.def.kind === 'mob' ? 0 : this.def.aggroRange,
      attackRange: this.attackRange(),
    });
    if (stimulus === 'flee' || stimulus === 'chase' || stimulus === 'attack') return stimulus;
    return this.locomotion;
  }

  private steer(): { x: number; z: number } {
    if (this.mode === 'idle' || this.mode === 'attack' || !this.target) {
      if (this.mode === 'wander') return { x: this.wishX, z: this.wishZ };
      return { x: 0, z: 0 };
    }
    if (this.mode === 'wander') return { x: this.wishX, z: this.wishZ };
    const dx = this.target.pos.x - this.pos.x;
    const dz = this.target.pos.z - this.pos.z;
    if (Math.hypot(dx, dz) < 1e-4) return this.mode === 'flee' ? { x: 1, z: 0 } : { x: 0, z: 0 };
    if (this.mode === 'flee') return { x: -dx, z: -dz };
    return { x: dx, z: dz };
  }

  private tickLocomotion(dt: number): void {
    if (this.mode === 'flee' || this.mode === 'chase' || this.mode === 'attack') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.locomotion === 'wander') {
      this.locomotion = 'idle';
      this.timer = 0.5 + this.rng() * 1.1;
      return;
    }
    this.locomotion = 'wander';
    this.timer = 1.1 + this.rng() * 1.6;
    const angle = this.rng() * Math.PI * 2;
    this.wishX = Math.cos(angle);
    this.wishZ = Math.sin(angle);
  }
}
