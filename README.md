# isovoxel

Single-player isometric voxel sandbox. It runs offline as one HTML file.

## Play

Open `dist/index.html` in any browser. The file is self-contained, so it works from `file://` and does not make network requests.

That file is produced by the build and is not committed. From this folder:

```sh
npm i && npm run build
```

Then open `dist/index.html`.

## Develop

```sh
npm i && npm run dev
```

Vite prints a local URL. `npm test` runs the Vitest suite. `npm run build` typechecks and writes a single `dist/index.html`.

## Controls

- WASD or the arrow keys walk. Space jumps.
- Drag looks around. The wheel changes the hotbar slot. Ctrl+wheel zooms.
- Left click breaks the targeted block. Right click places the selected block.
- Keys 1–9 select the hotbar.
- F3 toggles the debug HUD: FPS, coordinates, and the current biome.
- Esc opens the menu.

## Saving

The menu starts a new world from a seed (blank picks a random one), continues the saved world, or resets the save. The seed, edited blocks, player position, hotbar selection, and time of day are stored in `localStorage`. The game writes that save every 30 seconds and when the tab closes. Chunks you have not changed are left out; they grow back from the seed.
