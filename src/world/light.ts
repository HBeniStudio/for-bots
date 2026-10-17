import { LIGHT_MAX, lightEmission, lightOpacity } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, type Chunk } from './chunk';

/** One full day and night. Noon is time 0; midnight is halfway. */
export const DAY_LENGTH_SEC = 10 * 60;

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** World reads the light engine needs. `World` satisfies this. */
export interface LightVolume {
  getBlock(x: number, y: number, z: number): number;
  getChunk(cx: number, cz: number): Chunk | undefined;
}

interface Pos {
  x: number;
  y: number;
  z: number;
}

interface LitCell {
  chunk: Chunk;
  lx: number;
  y: number;
  lz: number;
}

interface Removed {
  x: number;
  y: number;
  z: number;
  level: number;
}

/**
 * Sun strength for a clock started at noon. 1 is full daylight, 0 is night.
 * The bright and dark parts are plateaus, with a short dusk and dawn between.
 */
export function sunlightFactor(timeSec: number): number {
  if (!Number.isFinite(timeSec)) return 1;
  let t = timeSec % DAY_LENGTH_SEC;
  if (t < 0) t += DAY_LENGTH_SEC;
  const raw = Math.cos((t / DAY_LENGTH_SEC) * Math.PI * 2);
  const day = 0.25;
  const night = -0.35;
  if (raw >= day) return 1;
  if (raw <= night) return 0;
  const u = (raw - night) / (day - night);
  return u * u * (3 - 2 * u);
}

/** Sky light scaled by the sun, then the brighter of that and torch light. */
export function combineLight(blockLight: number, skyLight: number, sun: number): number {
  const block = clampLight(blockLight);
  const sky = Math.round(clampLight(skyLight) * clamp01(sun));
  return block > sky ? block : sky;
}

export function skyLightAt(world: LightVolume, x: number, y: number, z: number): number {
  const cell = cellAt(world, x, y, z);
  return cell ? cell.chunk.getSkyLight(cell.lx, cell.y, cell.lz) : 0;
}

export function blockLightAt(world: LightVolume, x: number, y: number, z: number): number {
  const cell = cellAt(world, x, y, z);
  return cell ? cell.chunk.getBlockLight(cell.lx, cell.y, cell.lz) : 0;
}

export interface SampledLight {
  sky: number;
  block: number;
  combined: number;
}

const UNLIT: SampledLight = { sky: 0, block: 0, combined: 0 };

/**
 * Stored light at a cell. Above the world is open sky, so the top of the
 * column stays bright at noon. A chunk that is not loaded yet is unlit:
 * a face aimed off the loaded edge must not glow as if the missing neighbor
 * were sunlight. Propagation never writes those cells.
 */
export function sampleLight(world: LightVolume, x: number, y: number, z: number, sun: number): SampledLight {
  if (y >= CHUNK_Y) return openSky(sun);
  if (y < 0) return UNLIT;
  const cell = cellAt(world, x, y, z);
  if (!cell) return UNLIT;
  const sky = cell.chunk.getSkyLight(cell.lx, cell.y, cell.lz);
  const block = cell.chunk.getBlockLight(cell.lx, cell.y, cell.lz);
  return { sky, block, combined: combineLight(block, sky, sun) };
}

function openSky(sun: number): SampledLight {
  return { sky: LIGHT_MAX, block: 0, combined: combineLight(0, LIGHT_MAX, sun) };
}

const FACE_STEP = {
  top: [0, 1, 0],
  left: [0, 0, 1],
  right: [1, 0, 0],
} as const;

export type ShadedFace = keyof typeof FACE_STEP;

/**
 * Light used to shade a drawn face: the brighter of the block itself and the
 * air (or torch) just outside that face.
 */
export function exposedFaceLight(
  world: LightVolume,
  x: number,
  y: number,
  z: number,
  face: ShadedFace,
  sun: number,
): { light: number; block: number } {
  const own = sampleLight(world, x, y, z, sun);
  const [dx, dy, dz] = FACE_STEP[face];
  const outside = sampleLight(world, x + dx, y + dy, z + dz, sun);
  return {
    light: own.combined > outside.combined ? own.combined : outside.combined,
    block: own.block > outside.block ? own.block : outside.block,
  };
}

/**
 * Initial sunlight and torch light for a chunk that just received its blocks.
 * Spreads across the border into chunks that are already loaded, and pulls
 * their light back in.
 */
export function lightChunk(world: LightVolume, cx: number, cz: number): void {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return;
  chunk.light.fill(0);

  const baseX = cx * CHUNK_X;
  const baseZ = cz * CHUNK_Z;
  const blockSeeds: Pos[] = [];

  resetQueue();
  for (let lz = 0; lz < CHUNK_Z; lz++) {
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const x = baseX + lx;
      const z = baseZ + lz;
      const column = verticalSun(world, x, z);
      for (let y = 0; y < CHUNK_Y; y++) {
        const sky = column[y]!;
        if (sky > 0) {
          chunk.setSkyLight(lx, y, lz, sky);
          enqueue(x, y, z);
        }
        const emission = emittedAt(world, x, y, z);
        if (emission > 0) {
          chunk.setBlockLight(lx, y, lz, emission);
          blockSeeds.push({ x, y, z });
        }
      }
    }
  }

  for (let i = 0; i < CHUNK_X; i++) {
    absorbSky(world, baseX - 1, baseZ + i);
    absorbSky(world, baseX + CHUNK_X, baseZ + i);
    absorbSky(world, baseX + i, baseZ - 1);
    absorbSky(world, baseX + i, baseZ + CHUNK_Z);
  }
  propagateQueued(world, 'sky');

  resetQueue();
  for (const seed of blockSeeds) enqueue(seed.x, seed.y, seed.z);
  for (let i = 0; i < CHUNK_X; i++) {
    absorbBlock(world, baseX - 1, baseZ + i);
    absorbBlock(world, baseX + CHUNK_X, baseZ + i);
    absorbBlock(world, baseX + i, baseZ - 1);
    absorbBlock(world, baseX + i, baseZ + CHUNK_Z);
  }
  propagateQueued(world, 'block');
}

/**
 * Incremental relight after one cell changes. Block light uses a removal
 * pass and an add pass. Sunlight does the same along the edited column,
 * and both walks cross into any loaded neighbor chunk.
 */
export function refreshLighting(
  world: LightVolume,
  x: number,
  y: number,
  z: number,
  previous: number,
  next: number,
): void {
  if (previous === next) return;
  if (lightEmission(previous) !== lightEmission(next) || lightOpacity(previous) !== lightOpacity(next)) {
    refreshBlockLight(world, x, y, z);
  }
  if (lightOpacity(previous) !== lightOpacity(next)) refreshSkyColumn(world, x, z);
}

function refreshBlockLight(world: LightVolume, x: number, y: number, z: number): void {
  const cell = cellAt(world, x, y, z);
  if (!cell) return;
  const old = cell.chunk.getBlockLight(cell.lx, cell.y, cell.lz);
  cell.chunk.setBlockLight(cell.lx, cell.y, cell.lz, 0);
  const reseed: Pos[] = [];
  if (old > 0) reseed.push(...propagateRemoveBlock(world, [{ x, y, z, level: old }]));
  const emission = emittedAt(world, x, y, z);
  if (emission > 0) {
    cell.chunk.setBlockLight(cell.lx, cell.y, cell.lz, emission);
    reseed.push({ x, y, z });
  }
  propagateAdd(world, 'block', reseed);
}

function refreshSkyColumn(world: LightVolume, x: number, z: number): void {
  const cache = new Map<string, Uint8Array>();
  const column = verticalSun(world, x, z);
  cache.set(columnKey(x, z), column);

  const removed: Removed[] = [];
  const reseed: Pos[] = [];
  for (let y = 0; y < CHUNK_Y; y++) {
    const cell = cellAt(world, x, y, z);
    if (!cell) continue;
    const current = cell.chunk.getSkyLight(cell.lx, y, cell.lz);
    const want = column[y]!;
    if (current > want) {
      cell.chunk.setSkyLight(cell.lx, y, cell.lz, want);
      removed.push({ x, y, z, level: current });
      if (want > 0) reseed.push({ x, y, z });
    }
  }

  reseed.push(...propagateRemoveSky(world, removed, cache));

  for (let y = 0; y < CHUNK_Y; y++) {
    const cell = cellAt(world, x, y, z);
    if (!cell) continue;
    const want = column[y]!;
    if (want > cell.chunk.getSkyLight(cell.lx, y, cell.lz)) {
      cell.chunk.setSkyLight(cell.lx, y, cell.lz, want);
      reseed.push({ x, y, z });
    }
  }
  propagateAdd(world, 'sky', reseed);
}

function propagateRemoveBlock(world: LightVolume, queue: Removed[]): Pos[] {
  const reseed: Pos[] = [];
  let head = 0;
  while (head < queue.length) {
    const item = queue[head++]!;
    for (const [dx, dy, dz] of DIRS) {
      const x = item.x + dx;
      const y = item.y + dy;
      const z = item.z + dz;
      const cell = cellAt(world, x, y, z);
      if (!cell) continue;
      const level = cell.chunk.getBlockLight(cell.lx, cell.y, cell.lz);
      if (level === 0) continue;
      if (level < item.level) {
        cell.chunk.setBlockLight(cell.lx, cell.y, cell.lz, 0);
        queue.push({ x, y, z, level });
      } else {
        reseed.push({ x, y, z });
      }
    }
  }
  return reseed;
}

/**
 * Sky light of 15 is a plateau, so a neighbor is only "lit by" the removed
 * cell when its level is less than or equal. Direct sun columns are kept:
 * their vertical value still explains the stored light.
 */
function propagateRemoveSky(world: LightVolume, queue: Removed[], cache: Map<string, Uint8Array>): Pos[] {
  const reseed: Pos[] = [];
  let head = 0;
  while (head < queue.length) {
    const item = queue[head++]!;
    for (const [dx, dy, dz] of DIRS) {
      const x = item.x + dx;
      const y = item.y + dy;
      const z = item.z + dz;
      const cell = cellAt(world, x, y, z);
      if (!cell) continue;
      const level = cell.chunk.getSkyLight(cell.lx, cell.y, cell.lz);
      if (level === 0) continue;
      const base = verticalAt(world, cache, x, y, z);
      if (base >= level) {
        reseed.push({ x, y, z });
        continue;
      }
      if (level <= item.level) {
        cell.chunk.setSkyLight(cell.lx, cell.y, cell.lz, base);
        if (base > 0) reseed.push({ x, y, z });
        queue.push({ x, y, z, level });
      } else {
        reseed.push({ x, y, z });
      }
    }
  }
  return reseed;
}

const qx: number[] = [];
const qy: number[] = [];
const qz: number[] = [];

function resetQueue(): void {
  qx.length = 0;
  qy.length = 0;
  qz.length = 0;
}

function enqueue(x: number, y: number, z: number): void {
  qx.push(x);
  qy.push(y);
  qz.push(z);
}

/** Spread whatever is already in the shared queue. Not re-entrant. */
function propagateQueued(world: LightVolume, channel: 'sky' | 'block'): void {
  let head = 0;
  while (head < qx.length) {
    const x = qx[head]!;
    const y = qy[head]!;
    const z = qz[head]!;
    head += 1;
    const cell = cellAt(world, x, y, z);
    if (!cell) continue;
    const level = readChannel(cell, channel);
    if (level <= 1) continue;
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const nextCell = cellAt(world, nx, ny, nz);
      if (!nextCell) continue;
      const spread = spreadInto(level, world.getBlock(nx, ny, nz));
      if (spread > readChannel(nextCell, channel)) {
        writeChannel(nextCell, channel, spread);
        enqueue(nx, ny, nz);
      }
    }
  }
}

function propagateAdd(world: LightVolume, channel: 'sky' | 'block', seeds: readonly Pos[]): void {
  resetQueue();
  for (const seed of seeds) enqueue(seed.x, seed.y, seed.z);
  propagateQueued(world, channel);
}

/** Sunlight falling straight down. Clear blocks do not dim it; opaque blocks stop it. */
function verticalSun(world: LightVolume, x: number, z: number): Uint8Array {
  const column = new Uint8Array(CHUNK_Y);
  let light = LIGHT_MAX;
  let blocked = false;
  for (let y = CHUNK_Y - 1; y >= 0; y--) {
    if (blocked) continue;
    const opacity = lightOpacity(world.getBlock(x, y, z));
    if (opacity >= LIGHT_MAX) {
      blocked = true;
      continue;
    }
    column[y] = light;
    if (opacity > 0) {
      light = Math.max(0, light - opacity);
      if (light === 0) blocked = true;
    }
  }
  return column;
}

function verticalAt(world: LightVolume, cache: Map<string, Uint8Array>, x: number, y: number, z: number): number {
  const key = columnKey(x, z);
  let column = cache.get(key);
  if (!column) {
    column = verticalSun(world, x, z);
    cache.set(key, column);
  }
  return column[y] ?? 0;
}

function absorbColumn(world: LightVolume, x: number, z: number, channel: 'sky' | 'block'): void {
  if (!cellAt(world, x, 0, z)) return;
  for (let y = 0; y < CHUNK_Y; y++) {
    const level = channel === 'sky' ? skyLightAt(world, x, y, z) : blockLightAt(world, x, y, z);
    if (level > 0) enqueue(x, y, z);
  }
}

function absorbSky(world: LightVolume, x: number, z: number): void {
  absorbColumn(world, x, z, 'sky');
}

function absorbBlock(world: LightVolume, x: number, z: number): void {
  absorbColumn(world, x, z, 'block');
}

function emittedAt(world: LightVolume, x: number, y: number, z: number): number {
  const id = world.getBlock(x, y, z);
  if (lightOpacity(id) >= LIGHT_MAX) return 0;
  return lightEmission(id);
}

function spreadInto(level: number, blockId: number): number {
  const opacity = lightOpacity(blockId);
  if (opacity >= LIGHT_MAX) return 0;
  const next = level - Math.max(1, opacity);
  return next > 0 ? next : 0;
}

function readChannel(cell: LitCell, channel: 'sky' | 'block'): number {
  return channel === 'sky'
    ? cell.chunk.getSkyLight(cell.lx, cell.y, cell.lz)
    : cell.chunk.getBlockLight(cell.lx, cell.y, cell.lz);
}

function writeChannel(cell: LitCell, channel: 'sky' | 'block', level: number): void {
  if (channel === 'sky') cell.chunk.setSkyLight(cell.lx, cell.y, cell.lz, level);
  else cell.chunk.setBlockLight(cell.lx, cell.y, cell.lz, level);
}

function cellAt(world: LightVolume, x: number, y: number, z: number): LitCell | null {
  if (y < 0 || y >= CHUNK_Y) return null;
  const cx = Math.floor(x / CHUNK_X);
  const cz = Math.floor(z / CHUNK_Z);
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return null;
  return { chunk, lx: x - cx * CHUNK_X, y, lz: z - cz * CHUNK_Z };
}

function columnKey(x: number, z: number): string {
  return `${x},${z}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function clampLight(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= LIGHT_MAX) return LIGHT_MAX;
  return Math.round(n);
}
