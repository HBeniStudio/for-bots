import { DAY_LENGTH_SEC, sunlightFactor } from '../world/light';
import { BIOME_IDS, type BiomeName } from '../world/gen/biomes';
import { columnAt } from '../world/gen/terrain';

const BIOME_LABEL = new Map<number, string>(
  (Object.keys(BIOME_IDS) as BiomeName[]).map((name) => [
    BIOME_IDS[name],
    name.charAt(0).toUpperCase() + name.slice(1),
  ]),
);

export interface HudState {
  fps: number;
  x: number;
  y: number;
  z: number;
  biome: string;
  seed: number;
  zoom: number;
  chunksDrawn: number;
  chunksLoaded: number;
  phase: string;
  held: string;
}

/** Climate biome under a feet position. Names follow the frozen biome ids. */
export function biomeAt(seed: number, x: number, z: number): string {
  const id = columnAt(seed, Math.floor(x), Math.floor(z)).biome;
  return BIOME_LABEL.get(id) ?? 'Unknown';
}

/** Same day/night labels the lighting cycle uses. Noon is time 0. */
export function dayPhase(timeSec: number): string {
  const sun = sunlightFactor(timeSec);
  if (sun >= 0.95) return 'day';
  if (sun <= 0.05) return 'night';
  const wrapped = ((timeSec % DAY_LENGTH_SEC) + DAY_LENGTH_SEC) % DAY_LENGTH_SEC;
  return wrapped < DAY_LENGTH_SEC / 2 ? 'dusk' : 'dawn';
}

/**
 * Controls stay on screen. F3 toggles the debug readout: FPS, coordinates,
 * and the current biome, plus the chunk and clock stats.
 */
export class Hud {
  debug = false;

  toggle(): void {
    this.debug = !this.debug;
  }

  draw(ctx: CanvasRenderingContext2D, state: HudState): void {
    const lines = [
      'WASD move   Space jump   drag look   LMB break   RMB place   1–9 / wheel select   Ctrl+wheel zoom   F3 debug   Esc menu',
    ];
    if (this.debug) {
      lines.push(
        `${state.fps.toFixed(0)} fps   ·   ${state.chunksDrawn}/${state.chunksLoaded} chunks   ·   zoom ${state.zoom.toFixed(2)}   ·   ${state.phase}   ·   ${state.held}`,
        `xyz  ${formatCoords(state.x, state.y, state.z)}`,
        `biome  ${state.biome}   ·   seed ${state.seed >>> 0}`,
      );
    }

    ctx.save();
    ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let width = 0;
    for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
    const padX = 10;
    const padY = 8;
    const lineH = 18;
    const left = 10;
    const top = 10;
    ctx.fillStyle = 'rgba(12, 28, 36, 0.55)';
    ctx.fillRect(left, top, width + padX * 2, padY * 2 + lines.length * lineH);
    let textY = top + padY + 13;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? '#d5eaf3' : '#f4fbff';
      ctx.fillText(lines[i]!, left + padX, textY);
      textY += lineH;
    }
    ctx.restore();
  }
}

function formatCoords(x: number, y: number, z: number): string {
  const precise = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '0.00');
  const block = (value: number): string => (Number.isFinite(value) ? Math.floor(value).toString() : '0');
  return `${precise(x)}  ${precise(y)}  ${precise(z)}   (${block(x)}, ${block(y)}, ${block(z)})`;
}
