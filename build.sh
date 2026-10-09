#!/bin/sh
# Build the single-file pages from src/.
#   studio/index.html  — Pirate Jelly on the configurable series shell (Chinese UI + live editor)
#   starter/index.html — blank series template (shell + minimal scene) to start a new study
#   game/index.html    — Pirate Voyage: sail the ship around a 20× larger jelly sea
# The root index.html is the frozen original v1 and is not rebuilt.
cd "$(dirname "$0")"
mkdir -p studio starter game
cat src/00_head.html src/05_shell.js src/06_config_pirate.js src/10_math.js src/20_geo.js src/25_scene.js src/30_shaders.js src/40_sim.js src/50_main.js src/99_tail.html > studio/index.html
cat src/00_head.html src/05_shell.js src/06_config_pirate.js src/game/07_config.js src/10_math.js src/20_geo.js src/25_scene.js src/30_shaders.js src/40_sim.js src/50_main.js src/99_tail.html > game/index.html
cat src/00_head.html src/05_shell.js src/starter/06_config.js src/starter/50_main.js src/99_tail.html > starter/index.html
for f in studio starter game; do echo "built $f/index.html ($(wc -c < $f/index.html) bytes)"; done
