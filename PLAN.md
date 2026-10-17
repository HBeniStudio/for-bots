# isovoxel — PLAN

Minecraft-style voxel sandbox with fake-3D isometric graphics. Single player, offline, one HTML file.

**Stack:** TypeScript + Vite, Canvas 2D (no WebGL, no engine), `simplex-noise`. Build with `vite-plugin-singlefile` so `npm run build` outputs one self-contained `dist/index.html`.
**Out of MVP:** mobs, crafting, sound, multiplayer.
**Conventions:** world is Y-up; chunk = 16×16×64 (x,z,y); blocks stored as `Uint8Array` per chunk; block ids in `src/world/blocks.ts`. One cloud agent per milestone, one PR each, merged in order. Every milestone keeps `npm run build` and `npm test` (Vitest) green.

## M1 — Chunked world, iso renderer, camera
**Files:** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/world/chunk.ts`, `src/world/world.ts`, `src/world/blocks.ts`, `src/render/iso.ts` (world↔screen projection), `src/render/renderer.ts`, `src/render/camera.ts`, `tests/iso.test.ts`, `tests/chunk.test.ts`.
**Done when:**
- `npm run dev` shows a flat test world (≥3×3 chunks, 2+ block types) drawn as iso cubes with top/left/right faces.
- Depth sorting is correct: no block draws over one in front of it (back-to-front by x+z then y).
- Only faces exposed to air are drawn; off-screen chunks are skipped.
- Camera pans (WASD/arrows or drag) and zooms (wheel); holds ≥50 FPS on a 3×3 chunk view.
- Tests: projection round-trips; chunk get/set and world-to-chunk coordinate mapping.
- `npm run build` produces a single `dist/index.html` that runs from `file://`.

## M2 — Terrain generator
**Files:** `src/world/gen/noise.ts`, `src/world/gen/terrain.ts`, `src/world/gen/biomes.ts`, `src/world/gen/trees.ts`, update `src/world/blocks.ts`, `src/world/world.ts`, `tests/terrain.test.ts`.
**Done when:**
- Seeded generation: same seed ⇒ identical chunks (test).
- Heightmap from layered (fractal) simplex noise; water fills below sea level.
- Biomes from separate temperature + moisture noise; at least 4 biomes (e.g. plains, forest, desert, snow) with different surface blocks.
- 8–12 block types: grass, dirt, stone, sand, water, snow, wood log, leaves, + optional gravel, torch (placeholder for M4).
- Trees placed per biome density, never cut off at chunk borders (test).
- Chunks generate lazily around the camera without visible stalls.

## M3 — Movement and building
**Files:** `src/player/player.ts`, `src/player/physics.ts`, `src/player/input.ts`, `src/player/interact.ts` (target block pick), `src/ui/hotbar.ts`, update `src/main.ts`, `src/render/camera.ts`, `tests/physics.test.ts`.
**Done when:**
- Player is drawn and the camera follows them.
- Walk (WASD, mapped to iso directions), jump (Space), gravity, terminal velocity.
- AABB-vs-voxel collision per axis: no clipping through walls/floors, can step onto 1-block ledges by jumping, can't jump through ceilings (tests).
- Mouse picks the hovered block face (highlight drawn); left click breaks, right click places on that face; can't place inside the player.
- Hotbar with 9 slots (keys 1–9 + wheel) holding placeable block types.

## M4 — Lighting
**Files:** `src/world/light.ts`, update `src/world/chunk.ts` (light array), `src/render/renderer.ts`, `src/world/blocks.ts` (torch, light emission), `tests/light.test.ts`.
**Done when:**
- Per-block light levels 0–15: sunlight propagates down from sky and spreads; torch emits 14 and BFS flood-fills with falloff 1 per block (tests).
- Breaking/placing a block updates light incrementally (add + removal passes), across chunk borders (test).
- Faces shaded by light level plus fixed per-face shading (top brightest, left/right darker).
- Day/night cycle (~10 min) tints the scene and scales sunlight; torches stay bright at night.

## M5 — Save and polish
**Files:** `src/save/save.ts`, `src/ui/menu.ts`, `src/ui/hud.ts`, update `src/main.ts`, `README.md`, `tests/save.test.ts`.
**Done when:**
- World seed, modified chunks (diffs only), player position, hotbar and time of day saved to `localStorage` (auto every 30 s + on unload) and restored on load (round-trip test).
- Menu: New world (seed input), Continue, Reset save.
- HUD: FPS, coordinates, current biome (toggle F3).
- README covers install: open `dist/index.html` in any browser, or `npm i && npm run dev`.
- Final `dist/index.html` works offline from `file://` with no network requests.
