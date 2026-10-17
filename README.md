# isovoxel

Single-player isometric voxel sandbox. It runs offline as one HTML file.

## Play

Open `dist/index.html` in any browser. The file is self-contained, so it works from `file://` and does not make network requests.

That file is produced by the build and is not committed. From this folder:

```sh
npm i && npm run build
```

Then open `dist/index.html`.

Pushes to `main` also publish that file:

- **GitHub Pages** serves it at [https://hbenistudio.github.io/for-bots/](https://hbenistudio.github.io/for-bots/). The site updates from the `Build and publish` workflow.
- **GitHub Releases** attach `index.html` to a tag. A push to `main` publishes tag `play-<short sha>`. A push of a `v*` tag (for example `v0.2.0`) publishes a release on that tag. Download `index.html` and open it locally.

Pages will not update until the repository setting **Settings → Pages → Build and deployment → Source** is **GitHub Actions**. That setting is not in this repo's files; an owner has to set it once.

## Develop

```sh
npm i && npm run dev
```

Vite prints a local URL. `npm test` runs the Vitest suite. `npm run build` typechecks and writes a single `dist/index.html`.

## Controls

- WASD or the arrow keys walk. Space jumps.
- Drag looks around. The wheel changes the hotbar slot. Ctrl+wheel zooms.
- Left click breaks the targeted block. Right click places the selected block.
- Keys 1–9 select the hotbar. Key 0 selects gravel, the last slot. Water is not solid; you sink to the floor under it.
- F3 toggles the debug HUD: FPS, coordinates, and the current biome.
- Esc opens the menu.

## Saving

The menu starts a new world from a seed (blank picks a random one), continues the saved world, or resets the save. The seed, edited blocks, player position, hotbar selection, and time of day are stored in `localStorage`. The game writes that save every 30 seconds and when the tab closes. Chunks you have not changed are left out; they grow back from the seed.
