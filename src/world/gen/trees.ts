import { AIR, LEAVES, LOG } from '../blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, type Chunk } from '../chunk';
import { hash2 } from './noise';

/**
 * Widest leaf offset in x/z. Chunk generation pulls in trunks this far
 * outside the chunk so a canopy is never sliced on the border.
 * Tree cells keep trunks strictly farther apart than this, so two trunks
 * never share a block and a leaf belongs to at most one trunk.
 */
export const TREE_RADIUS = 2;

/** One candidate trunk per cell. Min trunk spacing is CELL - 4 = 3. */
const CELL = 7;

export interface TreeSite {
  x: number;
  z: number;
  trunkHeight: number;
}

/**
 * Trunks that can place a log or leaf inside the chunk, including trunks
 * that stand just outside it. `canGrow(x, z, roll)` is the biome/land test;
 * `roll` is in [0, 1).
 */
export function treeSitesForChunk(
  seed: number,
  cx: number,
  cz: number,
  canGrow: (x: number, z: number, roll: number) => boolean,
): TreeSite[] {
  const originX = cx * CHUNK_X;
  const originZ = cz * CHUNK_Z;
  const minX = originX - TREE_RADIUS;
  const maxX = originX + CHUNK_X - 1 + TREE_RADIUS;
  const minZ = originZ - TREE_RADIUS;
  const maxZ = originZ + CHUNK_Z - 1 + TREE_RADIUS;
  const cellX0 = Math.floor(minX / CELL);
  const cellX1 = Math.floor(maxX / CELL);
  const cellZ0 = Math.floor(minZ / CELL);
  const cellZ1 = Math.floor(maxZ / CELL);

  const sites: TreeSite[] = [];
  for (let cellZ = cellZ0; cellZ <= cellZ1; cellZ++) {
    for (let cellX = cellX0; cellX <= cellX1; cellX++) {
      const h = hash2(seed, cellX, cellZ);
      const x = cellX * CELL + 1 + (h % 5);
      const z = cellZ * CELL + 1 + ((h >>> 8) % 5);
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const roll = ((h >>> 16) % 1000) / 1000;
      if (!canGrow(x, z, roll)) continue;
      sites.push({ x, z, trunkHeight: 4 + ((h >>> 26) % 3) });
    }
  }
  return sites;
}

function tryPlace(chunk: Chunk, x: number, y: number, z: number, id: number): void {
  const lx = x - chunk.cx * CHUNK_X;
  const lz = z - chunk.cz * CHUNK_Z;
  if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return;
  if (y < 0 || y >= CHUNK_Y) return;
  if (chunk.get(lx, y, lz) !== AIR) return;
  chunk.set(lx, y, lz, id);
}

/**
 * Write logs, then leaves, for every site. Only blocks that land in `chunk`
 * are stored. Leaves replace air above the local ground and above sea level,
 * so the result does not depend on which neighbor was generated first.
 */
export function stampTrees(
  chunk: Chunk,
  sites: readonly TreeSite[],
  groundAt: (x: number, z: number) => number,
  seaLevel: number,
): void {
  for (const site of sites) {
    const ground = groundAt(site.x, site.z);
    for (let y = ground + 1; y <= ground + site.trunkHeight; y++) {
      tryPlace(chunk, site.x, y, site.z, LOG);
    }
  }

  for (const site of sites) {
    const ground = groundAt(site.x, site.z);
    const top = ground + site.trunkHeight;
    for (let y = top - 2; y <= top + 1; y++) {
      const radius = y >= top ? 1 : TREE_RADIUS;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dz * dz > radius * radius) continue;
          const x = site.x + dx;
          const z = site.z + dz;
          const groundHere = groundAt(x, z);
          if (y <= groundHere || y <= seaLevel) continue;
          tryPlace(chunk, x, y, z, LEAVES);
        }
      }
    }
  }
}
