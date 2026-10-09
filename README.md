# Pirate Jelly — Material Studies

An interactive WebGPU/WGSL diorama: a translucent jelly ocean block with a tropical island, Skull Rock, a camp with buried treasure and an anchored pirate ship. Everything is procedural — no models, textures, fonts or libraries.

| Page | What it is |
| --- | --- |
| [`/`](https://exposir.github.io/pirate-jelly/) | The original v1 (English UI). Frozen — not rebuilt. |
| [`/studio/`](https://exposir.github.io/pirate-jelly/studio/) | Pirate Jelly on the configurable series shell — Chinese UI with a live config editor (✎ 配置). |
| [`/game/`](https://exposir.github.io/pirate-jelly/game/) | Pirate Voyage — take the helm in a 20× larger jelly sea (arrow keys / WASD, Space to fire, on-screen helm on touch). |
| [`/starter/`](https://exposir.github.io/pirate-jelly/starter/) | Blank series template: the same shell around a minimal ray-marched jelly. Start new studies from here. |

## Configuration

Every study is driven by one `DEFAULT_CONFIG` object (`src/06_config_pirate.js`, `src/starter/06_config.js`):

- `ui` — eyebrow, two-line title, lede, how-to line (`[Space]` renders as a key cap), fallback card text
- `theme` — fonts, light / dark palettes, `darkAt` (night level where the page turns dark)
- `panel` — the right-hand control panel, declared as sections of `buttons` / `meter` / `counts` / `swatches` / `slider` items
- `state` — initial control values; `flavours`, `day` (time-of-day keyframes), `sim`, `camera`
- `world` — block size, terrain resolution, the water-simulation window (it follows the ship when smaller than the block), analytic swell, extra islets
- `voyage` — helm mode: thrust, reverse, rudder, follow-camera distance / elevation / lag
- `scene` — island, ship, anchor, Skull Rock, camp, wreck, palms and flora counts (editing these rebuilds the world)

Ways to change it at runtime:

1. **Editor** — click **✎ 配置**: a form or raw JSON view; changes apply live and are saved in the browser.
2. **JSON file** — export / import from the editor, or load one with `?config=<url-to-json>`.
3. **Share link** — **复制分享链接** encodes only the differences from the defaults into `#cfg=…`.

Priority on load: `#cfg=` > `?config=` > saved browser copy > defaults.

## A new study from the template

1. Copy `src/starter/06_config.js` and `src/starter/50_main.js`.
2. Edit the config (texts, theme, panel), then replace the scene code.
3. The scene's contract with the shell is small: `await Shell.mount({ defaults, actions, onState, onRebuild, rebuild, panelDeps, formatters })`, then report through `Shell.status`, `Shell.meter`, `Shell.count`, `Shell.buttonLabel`, `Shell.setDark`, and `Shell.fail` for the fallback card.
4. Add a `cat …` line to `build.sh`.

## Build

`./build.sh` concatenates `src/` into `studio/index.html` and `starter/index.html`.
