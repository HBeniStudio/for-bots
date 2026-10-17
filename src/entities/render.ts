import type { CreatureDef, SpriteDef } from '../content/schema';
import { BLOCK_HEIGHT } from '../render/iso';
import type { Camera } from '../render/camera';
import type { Creature } from './creature';

const FALLBACK: Record<CreatureDef['kind'], SpriteDef> = {
  mob: {
    colors: ['#6b4a2e', '#e6d2b0', '#1a140f'],
    rows: ['..111..', '.11111.', '.12111.', '..111..', '..1.1..'],
  },
  enemy: {
    colors: ['#3a1818', '#a33b32', '#f2e2c4'],
    rows: ['..111..', '.11111.', '.12121.', '.11111.', '..1.1..'],
  },
  boss: {
    colors: ['#241428', '#6d3c86', '#f4e27a'],
    rows: ['.2.2.2.', '2222222', '2211122', '.22222.', '..2.2..'],
  },
};

export function spriteFor(def: CreatureDef): SpriteDef {
  if (def.sprite && def.sprite.rows.length > 0) return def.sprite;
  return FALLBACK[def.kind];
}

/** Billboard pixel sprite, feet planted on the world position. */
export function drawCreature(ctx: CanvasRenderingContext2D, camera: Camera, creature: Creature): void {
  const sprite = spriteFor(creature.def);
  const rows = sprite.rows;
  const cols = rows[0]?.length ?? 1;
  const rowCount = Math.max(1, rows.length);
  const worldPixels = creature.def.size.height * BLOCK_HEIGHT * camera.zoom;
  const pixel = Math.max(2, worldPixels / rowCount);
  const widthPx = pixel * cols;
  const heightPx = pixel * rowCount;
  const moving = Math.hypot(creature.body.vx, creature.body.vz) > 0.2;
  const bob = moving ? Math.sin(creature.anim * 12) * pixel * 0.35 : 0;
  const feet = camera.worldToScreen(creature.pos.x, creature.pos.y, creature.pos.z);

  ctx.save();
  ctx.translate(Math.round(feet.x), Math.round(feet.y));
  ctx.fillStyle = 'rgba(10, 14, 18, 0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(3, widthPx * 0.22), Math.max(1.5, pixel * 0.55), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.scale(creature.facing, 1);

  const left = -widthPx / 2;
  const top = -heightPx - bob;
  for (let row = 0; row < rowCount; row++) {
    const line = rows[row] ?? '';
    for (let col = 0; col < cols; col++) {
      const ch = line.charCodeAt(col);
      if (ch === 46 || Number.isNaN(ch)) continue;
      const color = sprite.colors[ch - 48];
      if (!color) continue;
      ctx.fillStyle = creature.hurtTimer > 0 ? '#fff7f4' : color;
      ctx.fillRect(left + col * pixel, top + row * pixel, pixel + 0.25, pixel + 0.25);
    }
  }

  if (creature.health < creature.maxHealth) {
    const barH = Math.max(2, pixel * 0.45);
    const barY = top - barH - pixel * 0.35;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(left, barY, widthPx, barH);
    const fraction = Math.max(0, creature.health / creature.maxHealth);
    ctx.fillStyle = fraction > 0.35 ? '#3ecf62' : '#e24d4d';
    ctx.fillRect(left, barY, widthPx * fraction, barH);
  }
  ctx.restore();
}

/** Small bar above a world point. Used for the player's own health. */
export function drawVitalBar(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  x: number,
  y: number,
  z: number,
  fraction: number,
): void {
  const origin = camera.worldToScreen(x, y, z);
  const width = Math.max(16, 26 * camera.zoom);
  const height = 4;
  const left = Math.round(origin.x - width / 2);
  const top = Math.round(origin.y - 8);
  const clamped = Math.max(0, Math.min(1, fraction));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = clamped > 0.35 ? '#3ecf62' : '#e24d4d';
  ctx.fillRect(left, top, width * clamped, height);
}
