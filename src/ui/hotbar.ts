import { DIRT, FACE_COLORS, GRASS, GRAVEL, LEAVES, LOG, SAND, SNOW, STONE, WATER, type FaceColors } from '../world/blocks';

export const SLOT_COUNT = 9;

export const HOTBAR_IDS: readonly number[] = [GRASS, DIRT, STONE, SAND, WATER, SNOW, LOG, LEAVES, GRAVEL];

const LABELS = ['Grass', 'Dirt', 'Stone', 'Sand', 'Water', 'Snow', 'Log', 'Leaves', 'Gravel'] as const;

const SLOT = 48;
const GAP = 6;
const MARGIN = 16;

export class Hotbar {
  slot = 0;

  get selected(): number {
    return HOTBAR_IDS[this.slot] ?? GRASS;
  }

  get label(): string {
    return LABELS[this.slot] ?? 'Grass';
  }

  select(index: number): void {
    if (index >= 0 && index < SLOT_COUNT) this.slot = index;
  }

  /** Advance by `steps` slots, wrapping. Positive moves toward slot 9. */
  cycle(steps: number): void {
    if (!Number.isFinite(steps) || steps === 0) return;
    const delta = Math.trunc(steps);
    this.slot = (((this.slot + delta) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
  }

  /** Slot under a CSS-pixel point, or null when the point misses the bar. */
  slotAt(px: number, py: number, screenW: number, screenH: number): number | null {
    const origin = barOrigin(screenW, screenH);
    if (py < origin.y || py >= origin.y + SLOT) return null;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = origin.x + i * (SLOT + GAP);
      if (px >= x && px < x + SLOT) return i;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const origin = barOrigin(screenW, screenH);
    const total = SLOT_COUNT * SLOT + (SLOT_COUNT - 1) * GAP;
    ctx.fillStyle = 'rgba(12, 28, 36, 0.55)';
    ctx.fillRect(origin.x - 8, origin.y - 8, total + 16, SLOT + 16);

    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4fbff';
    ctx.fillText(this.label, origin.x + total / 2, origin.y - 14);
    ctx.textAlign = 'left';

    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = origin.x + i * (SLOT + GAP);
      const selected = i === this.slot;
      ctx.fillStyle = selected ? 'rgba(255, 244, 214, 0.92)' : 'rgba(232, 242, 246, 0.78)';
      ctx.fillRect(x, origin.y, SLOT, SLOT);
      ctx.strokeStyle = selected ? '#f0b429' : 'rgba(20, 36, 44, 0.45)';
      ctx.lineWidth = selected ? 3 : 1;
      ctx.strokeRect(x + 0.5, origin.y + 0.5, SLOT - 1, SLOT - 1);
      const colors = FACE_COLORS[HOTBAR_IDS[i]!] ?? null;
      if (colors) drawSwatch(ctx, x + SLOT / 2, origin.y + 20, colors);
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = '#1c2c34';
      ctx.fillText(String(i + 1), x + 4, origin.y + 12);
    }
  }
}

function barOrigin(screenW: number, screenH: number): { x: number; y: number } {
  const total = SLOT_COUNT * SLOT + (SLOT_COUNT - 1) * GAP;
  return {
    x: Math.round((screenW - total) / 2),
    y: Math.round(screenH - SLOT - MARGIN),
  };
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], color: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawSwatch(ctx: CanvasRenderingContext2D, cx: number, cy: number, colors: FaceColors): void {
  fillPoly(
    ctx,
    [
      [cx, cy + 2],
      [cx + 11, cy - 4],
      [cx + 11, cy + 8],
      [cx, cy + 14],
    ],
    colors.right,
  );
  fillPoly(
    ctx,
    [
      [cx - 11, cy - 4],
      [cx, cy + 2],
      [cx, cy + 14],
      [cx - 11, cy + 8],
    ],
    colors.left,
  );
  fillPoly(
    ctx,
    [
      [cx, cy - 10],
      [cx + 11, cy - 4],
      [cx, cy + 2],
      [cx - 11, cy - 4],
    ],
    colors.top,
  );
}
