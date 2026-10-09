#!/bin/sh
# 拼接分段源文件为单个 index.html
cd "$(dirname "$0")"
cat src/00_head.html src/10_math.js src/20_geo.js src/25_scene.js src/30_shaders.js src/40_sim.js src/50_main.js src/99_tail.html > index.html
echo "built index.html ($(wc -c < index.html) bytes)"
