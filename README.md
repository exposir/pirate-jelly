# Pirate Jelly — Material Studies

An interactive WebGPU/WGSL diorama: a translucent jelly ocean block with a tropical island, Skull Rock, a camp with buried treasure and an anchored pirate ship. Everything is procedural — no models, textures, fonts or libraries.

**Live:** https://exposir.github.io/pirate-jelly/

- Shallow-water waves on a staggered grid (with a touch of surface tension), tiltable block with sloshing and jelly wobble
- Ship on 10 buoyancy points, elastic anchor rode, wind weathervaning, wake from displaced volume
- Cannonballs, barrels and doubloons as rigid bodies; particles for fire, smoke, spray, sand, sparkles and fireflies
- Time of day from noon to midnight; three jelly flavours (Lagoon, Rum, Kraken)

`index.html` is the single-file build. Sources live in `src/`; run `./build.sh` to concatenate them.
