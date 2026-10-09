
// ───────────────────────── scene geometry ─────────────────────────
const NODE = { STATIC: 0, SHIP: 1, LID: 2, PALM: 3, NPALM: 16, CHAIN: 19, NCHAIN: 26, BALL: 45, NBALL: 16, BARREL: 61, NBARREL: 8, COIN: 69, NCOIN: 30 };
const NODE_COUNT = 100;
const COL = {
  hullBlack: [0.085, 0.075, 0.07], ochre: [0.78, 0.55, 0.17], red: [0.55, 0.12, 0.08], deck: [0.6, 0.42, 0.25],
  wood: [0.52, 0.33, 0.18], woodD: [0.33, 0.2, 0.11], iron: [0.12, 0.115, 0.11], gold: [1.0, 0.74, 0.25],
  canvas: [0.93, 0.88, 0.76], rope: [0.22, 0.16, 0.11], sand: [0.93, 0.83, 0.62], rock: [0.48, 0.44, 0.4],
  bone: [0.95, 0.9, 0.78],
};
const hexc = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const T0 = (x, z) => terrainFn(x, z);

// ── ship hull shape (ship local: +z bow, y=0 waterline) ──
const HULL = {
  z0: -0.78, z1: 0.8,
  W(u) { return u < 0.42 ? 0.235 * (0.8 + 0.2 * Math.sin(u / 0.42 * PI / 2)) : 0.235 * Math.pow(Math.max(Math.cos((u - 0.42) / 0.58 * PI / 2), 0), 0.72); },
  top(u) { return 0.2 + 0.14 * smooth(0.3, 0.22, u) + 0.05 * smooth(0.82, 0.93, u); },
  bot(u) { return -0.2 * (1 - Math.pow(Math.abs(u - 0.45) / 0.62, 3)); },
  sec(v) { return Math.pow(Math.sin(Math.min(v * 1.25, 1) * PI / 2), 0.55) * (1 - 0.08 * smooth(0.72, 1, v)); },
  pt(u, v, side) { return [side * this.W(u) * this.sec(v), lerp(this.bot(u), this.top(u), v), lerp(this.z0, this.z1, u)]; },
  uOf(z) { return (z - this.z0) / (this.z1 - this.z0); },
  deckY(u) { return this.top(u) - 0.045; },
};
const GUNS = [-0.34, -0.17, 0, 0.17, 0.34];           // gunport z positions (each side)
const SHIP_INFO = { buoy: [], muzzles: [], bow: [0, 0.07, 0.8], glows: [], mastTop: [0, 1.6, 0] };
for (const u of [0.1, 0.3, 0.5, 0.7, 0.88]) for (const s of [-1, 1]) SHIP_INFO.buoy.push([s * HULL.W(u) * 0.6, -0.08, lerp(HULL.z0, HULL.z1, u)]);

function buildHullSides(b, u0, u1, nu, nv, colf, skip) {
  for (const side of [-1, 1]) b.surf(nu, nv, (u, v) => HULL.pt(lerp(u0, u1, u), v, side), { flip: side < 0, col: colf ? (u, v, p) => colf(p, lerp(u0, u1, u), v) : undefined });
}

function buildShip(b) {
  b.node = NODE.SHIP; b.m(0, 0);
  const hullCol = (p, u, v) => {
    const y = p[1];
    if (y < 0.018) return COL.red;
    if (y > 0.062 && y < 0.128 && u > 0.18) return COL.ochre;
    if (y > 0.25 && y < 0.285 && u < 0.24) return COL.ochre;
    if (v > 0.965) return COL.ochre;
    return COL.hullBlack;
  };
  buildHullSides(b, 0, 1, 44, 16, hullCol);
  // transom
  b.surf(8, 10, (s, v) => { const x = (s * 2 - 1) * HULL.W(0) * HULL.sec(v); return [x, lerp(HULL.bot(0), HULL.top(0), v), HULL.z0]; },
    { flip: true, col: (s, v, p) => p[1] < 0.018 ? COL.red : (p[1] > 0.32 || (p[1] > 0.14 && p[1] < 0.16)) ? COL.ochre : COL.hullBlack });
  // deck
  b.surf(30, 6, (u, s) => { const uu = lerp(0.01, 0.985, u); return [(s * 2 - 1) * HULL.W(uu) * HULL.sec(0.96) * 0.97, HULL.deckY(uu), lerp(HULL.z0, HULL.z1, uu)]; },
    { col: (u, s) => (Math.floor(s * 6) % 2 ? COL.deck : vscale(COL.deck, 0.86)) });
  // quarterdeck front bulkhead
  b.push().c(COL.hullBlack).t(0, HULL.deckY(0.26) - 0.07, lerp(HULL.z0, HULL.z1, 0.26)).box(HULL.W(0.26) * 1.8, 0.14, 0.012).pop();
  b.push().c(COL.ochre).t(0, HULL.deckY(0.26) + 0.005, lerp(HULL.z0, HULL.z1, 0.26)).box(HULL.W(0.26) * 1.8, 0.012, 0.02).pop();
  // stern windows (night emissive) and gallery trim
  b.push().m(4, 1.0).c([0.95, 0.75, 0.35]);
  for (let i = 0; i < 5; i++) b.push().t((i - 2) * 0.072, 0.215, HULL.z0 - 0.004).box(0.05, 0.05, 0.004).pop();
  for (let i = 0; i < 3; i++) b.push().t((i - 1) * 0.08, 0.3, HULL.z0 - 0.004).box(0.045, 0.035, 0.004).pop();
  b.pop();
  b.push().c(COL.ochre).t(0, 0.183, HULL.z0 - 0.01).box(0.42, 0.014, 0.018).pop();
  b.push().c(COL.ochre).t(0, 0.255, HULL.z0 - 0.01).box(0.4, 0.012, 0.016).pop();
  // stern lantern
  const lt = [0, HULL.top(0) + 0.1, HULL.z0 + 0.02];
  b.push().c(COL.iron).t(0, HULL.top(0), HULL.z0 + 0.02).cyl(0.006, 0.006, 0.06, 6).pop();
  b.push().m(4, 1.6).c([1, 0.8, 0.4]).t(lt[0], lt[1] - 0.035, lt[2]).cyl(0.026, 0.02, 0.06, 8).pop();
  b.push().c(COL.iron).t(lt[0], lt[1] + 0.025, lt[2]).cyl(0.03, 0.004, 0.03, 8).pop();
  SHIP_INFO.glows.push({ p: lt, s: 0.22, c: [1, 0.7, 0.3] }, { p: [0, 0.25, HULL.z0 - 0.02], s: 0.32, c: [1, 0.6, 0.25] });
  // rudder
  b.push().c(COL.hullBlack).t(0, -0.02, HULL.z0 - 0.03).box(0.02, 0.26, 0.06).pop();
  // gunports + cannons
  for (const side of [-1, 1]) for (const z of GUNS) {
    const u = HULL.uOf(z), v = (0.095 - HULL.bot(u)) / (HULL.top(u) - HULL.bot(u)), x = side * HULL.W(u) * HULL.sec(v);
    b.push().t(x, 0.095, z).c([0.04, 0.03, 0.03]).box(0.012, 0.046, 0.05).pop();
    b.push().t(x + side * 0.004, 0.128, z).c(COL.red).rx(0).box(0.006, 0.012, 0.052).pop();
    b.push().m(1).c(COL.iron).t(x, 0.092, z).rz(-side * PI / 2).cyl(0.014, 0.011, 0.075, 8).pop();
    SHIP_INFO.muzzles.push({ side, p: [x + side * 0.085, 0.092, z] });
  }
  // rails & bow
  b.push().c(COL.woodD);
  for (const side of [-1, 1]) for (let i = 0; i < 18; i++) {
    const u = 0.03 + i / 17 * 0.9; const p = HULL.pt(u, 1, side);
    b.push().t(p[0] * 0.98, p[1] + 0.02, p[2]).cyl(0.004, 0.004, 0.035, 4, false).pop();
  }
  b.pop();
  // bowsprit
  const bs0 = [0, HULL.top(1) - 0.02, HULL.z1 - 0.04], bs1 = [0, HULL.top(1) + 0.2, HULL.z1 + 0.42];
  b.push().c(COL.wood).tube(t => vlerp(bs0, bs1, t), t => lerp(0.016, 0.008, t), 3, 8).pop();
  // masts
  const masts = [{ z: 0.42, h: 1.22, w: [0.62, 0.46] }, { z: -0.02, h: 1.42, w: [0.72, 0.54] }, { z: -0.47, h: 1.0, w: null }];
  const mastTop = [];
  for (const M of masts) {
    const y0 = HULL.deckY(HULL.uOf(M.z));
    M.y0 = y0;
    b.push().c(COL.wood).t(0, y0, M.z).cyl(0.021, 0.011, M.h, 10).pop();
    b.push().c(COL.woodD).t(0, y0 + M.h * 0.62, M.z).cyl(0.06, 0.06, 0.012, 10).pop();
    mastTop.push([0, y0 + M.h, M.z]);
    if (M.w) {
      const yards = [y0 + M.h * 0.4, y0 + M.h * 0.76], foot = [y0 + 0.1, yards[0] + 0.015];
      for (let k = 0; k < 2; k++) {
        const w = M.w[k];
        b.push().c(COL.woodD).t(-w / 2 - 0.02, yards[k], M.z).rz(-PI / 2).cyl(0.009, 0.009, w + 0.04, 6).pop();
        const wTop = w * 0.94, wBot = k === 0 ? w * 1.04 : M.w[0] * 0.96;
        b.push().m(6, 0).surf(10, 9, (s, v) => {
          const x = (s * 2 - 1), yy = lerp(yards[k] - 0.01, foot[k], v);
          const bil = 0.085 * (1 - x * x * 0.85) * (0.35 + 0.65 * Math.sin(PI * (v * 0.8 + 0.15)));
          return [x * lerp(wTop, wBot, v) / 2, yy, M.z - 0.02 - bil];
        }, {
          col: (s, v) => vscale(COL.canvas, 0.94 + 0.06 * Math.sin(s * 40) * 0.5 - 0.05 * v),
          w: (s, v) => (1 - (s * 2 - 1) ** 2) * Math.sin(PI * v),
        }).pop();
      }
    }
  }
  SHIP_INFO.masts = masts; SHIP_INFO.mastTop = mastTop[1];
  // mizzen gaff sail
  const mz = masts[2];
  { const A = [0, mz.y0 + 0.14, mz.z - 0.02], B = [0, mz.y0 + mz.h * 0.92, mz.z - 0.03], C = [0, mz.y0 + 0.16, mz.z - 0.46];
    b.push().m(6, 0).surf(8, 8, (s, v) => { const p = vlerp(vlerp(A, B, v), C, s * (1 - v)); p[0] += 0.05 * Math.sin(PI * s) * Math.sin(PI * v); return p; },
      { col: () => COL.canvas, w: (s, v) => Math.sin(PI * s) * Math.sin(PI * v) }).pop();
    b.push().c(COL.woodD).tube(t => vlerp(A, C, t), () => 0.007, 1, 6).pop(); }
  // jib
  { const A = [0, masts[0].y0 + masts[0].h * 0.72, masts[0].z + 0.01], B = vlerp(bs0, bs1, 0.95), C = [0, HULL.top(0.9) + 0.06, 0.62];
    b.push().m(6, 0).surf(6, 6, (s, v) => { const p = vlerp(vlerp(A, B, s), C, v * (1 - s * 0.0)); p[0] += 0.04 * Math.sin(PI * s) * Math.sin(PI * v); return vlerp(vlerp(A, B, s), vlerp(C, B, s), v).map((c, i) => i === 0 ? p[0] : c); },
      { col: () => COL.canvas, w: (s, v) => Math.sin(PI * s) * Math.sin(PI * v) }).pop(); }
  // rigging: shrouds, stays
  b.push().c(COL.rope).m(0);
  for (const M of masts) {
    const u = HULL.uOf(M.z), top = [0, M.y0 + M.h * 0.62, M.z];
    for (const side of [-1, 1]) for (const dz of [-0.08, 0, 0.08]) b.line(top, [side * HULL.W(u) * 0.98, HULL.top(u), M.z + dz], 0.0028, 3);
    b.line([0, M.y0 + M.h * 0.97, M.z], [0, M.y0 + M.h * 0.64, M.z], 0.003, 3);
  }
  b.line(mastTop[0], bs1, 0.003, 3);
  b.line(mastTop[1], [0, masts[0].y0 + masts[0].h * 0.62, masts[0].z], 0.003, 3);
  b.line(mastTop[2], [0, masts[1].y0 + masts[1].h * 0.62, masts[1].z], 0.003, 3);
  for (const side of [-1, 1]) b.line(mastTop[2], [side * 0.18, HULL.top(0.02), HULL.z0 + 0.04], 0.0028, 3);
  b.pop();
  // flag on main truck — streams aft (-z)
  const ft = mastTop[1];
  b.push().c(COL.woodD).t(0, ft[1], ft[2]).cyl(0.005, 0.004, 0.08, 5).pop();
  b.push().m(5, 0).surf(14, 7, (u, v) => [0, ft[1] + 0.075 - v * 0.15, ft[2] - 0.01 - u * 0.25], {
    col: (u, v) => [u, v, 0], w: (u) => u,
  }).pop();
  SHIP_INFO.anchorHawse = [0.05, HULL.top(0.97) - 0.06, HULL.z1 - 0.05];
}

// ── palms ──
const PALMS = [
  { x: 1.2, z: -1.48, h: 1.0, lean: [-0.5, 0.55] },  // leans over the chest
  { x: 0.02, z: -1.4, h: 0.82, lean: [-0.1, 0.18] },
  { x: -0.42, z: -1.18, h: 0.72, lean: [0.12, 0.22] },
  { x: 0.55, z: -1.62, h: 0.95, lean: [0.08, 0.1] },
  { x: 1.68, z: -1.3, h: 0.78, lean: [0.25, 0.12] },
  { x: -0.98, z: -1.35, h: 0.88, lean: [-0.2, 0.15] },
  { x: -0.15, z: -1.95, h: 1.05, lean: [0.05, -0.1] },
  { x: 0.95, z: -2.05, h: 0.9, lean: [0.1, 0.05] },
  { x: -1.42, z: -1.55, h: 0.75, lean: [-0.25, 0.1] },
];
function palmPath(P, t) { return [P.lean[0] * P.h * t * t, P.h * t, P.lean[1] * P.h * t * t]; }
// flora counts (configurable)
const FLORA = { bushes: 22, ferns: 14, grassTufts: 20, shoreRocks: 16, kelpClumps: 8, trappedBubbles: 34, seabedCoins: 7, seed: 4242 };

// pour a config.scene object into the module-level layout tables
function applySceneConfig(sc) {
  const I = sc.island, C = sc.camp;
  Object.assign(LAYOUT, { island: [I.x, I.z, I.radiusX, I.radiusZ], hills: I.hills, cove: I.cove, ship: [...sc.ship], anchor: [...sc.anchor],
    skull: [sc.skull.x, sc.skull.z, sc.skull.yaw], skullScale: sc.skull.scale, fire: [...C.fire], chest: [...C.chest], xmark: [...C.xmark],
    shovel: [...C.shovel], rowboat: [...C.rowboat], wreck: [...sc.wreck] });
  PALMS.length = 0;
  for (const P of sc.palms.slice(0, NODE.NPALM)) PALMS.push({ x: P.x, z: P.z, h: P.height, lean: [...P.lean] });
  Object.assign(FLORA, sc.flora);
}
function buildPalm(b, P, idx, node = NODE.PALM + idx) {
  b.node = node;
  const lc = hexc(0xc98a3e), dc = hexc(0x8e5524);
  b.push().m(0).tube(t => palmPath(P, t), (t, u) => 0.042 * (1 - 0.42 * t) * (1 + 0.16 * Math.pow(1 - ((t * 15) % 1), 3)), 60, 9,
    { col: (u, t) => ((t * 15) % 1) < 0.28 ? dc : lc, w: (u, t) => t }).pop();
  const top = palmPath(P, 1);
  b.push().m(0, 1).c(hexc(0x5b3a1e));
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + idx; b.push().t(top[0] + Math.cos(a) * 0.035, top[1] - 0.035, top[2] + Math.sin(a) * 0.035).sphere(0.03, 0.032, 0.03, 8, 6).pop(); }
  b.pop();
  const n = 8, L0 = 0.46 + 0.08 * hash1(idx * 7.3);
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + idx * 0.7 + 0.25 * hash1(k + idx * 13), dir = [Math.cos(a), 0, Math.sin(a)], side = [-dir[2], 0, dir[0]];
    const L = L0 * (0.85 + 0.3 * hash1(k * 3.1 + idx)), droop = 0.7 + 0.35 * hash1(k * 5.7 + idx);
    const g0 = hexc(0x2f9c45), g1 = hexc(0x8ad85a);
    b.push().m(2).surf(6, 14, (x, s) => {
      const xx = x * 2 - 1, wv = 0.085 * Math.sin(PI * Math.pow(s, 0.75)) * (0.72 + 0.28 * Math.abs(Math.sin(s * 34)));
      const sp = vadd(top, [dir[0] * L * s, L * (0.32 * s - droop * s * s), dir[2] * L * s]);
      return vadd(sp, [side[0] * xx * wv, -Math.abs(xx) * wv * 0.45, side[2] * xx * wv]);
    }, { col: (x, s) => vlerp(g0, g1, s * 0.8 + 0.2 * Math.abs(x * 2 - 1)), w: (x, s) => 1 + s }).pop();
  }
  P.top = top;
}

// ── props ──
function rock(b, r, seed, col) {
  b.push().c(col || vscale(COL.rock, 0.85 + 0.3 * hash1(seed))).m(0).sphere(r, r * 0.7, r, 9, 6, p => 0.25 * noise3(p[0] * 2.5 + seed, p[1] * 2.5, p[2] * 2.5 - seed)).pop();
}
function barrelGeo(b, r = 0.07, h = 0.18, centered = true) {
  const y0 = centered ? -h / 2 : 0;
  b.lathe(14, 10, v => [r * (0.84 + 0.16 * Math.sin(PI * v)), y0 + v * h], {
    col: (u, v) => (Math.abs(v - 0.15) < 0.04 || Math.abs(v - 0.85) < 0.04) ? COL.iron : vscale(COL.wood, 0.9 + 0.2 * ((Math.floor(u * 14) % 2))),
  });
  b.push().c(COL.woodD).disc(r * 0.84, y0 + h, 14, 1).disc(r * 0.84, y0, 14, -1).pop();
}
function crateGeo(b, s = 0.16) {
  b.push().c(hexc(0xa4743f)).box(s, s, s).pop();
  b.push().c(hexc(0x6e4524));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.push().t(x * s / 2, 0, z * s / 2).box(0.022, s + 0.004, 0.022).pop();
  for (const y of [-1, 1]) for (const r of [0, 1]) b.push().t(0, y * s / 2, 0).ry(r * PI / 2).push().t(0, 0, s / 2).box(s, 0.022, 0.022).pop().push().t(0, 0, -s / 2).box(s, 0.022, 0.022).pop().pop();
  b.pop();
}
function coinGeo(b, r = 0.04) {
  b.push().m(1).c(COL.gold).cyl(r, r, 0.009, 14).pop();
  b.push().m(1).c(vscale(COL.gold, 0.8)).t(0, 0.0095, 0).cyl(r * 0.7, r * 0.7, 0.0005, 12, false).pop();
}
function bottleGeo(b) {
  b.push().m(10).c(hexc(0xc87d1c)).lathe(10, 10, v => v < 0.55 ? [0.026, v / 0.55 * 0.085] : [lerp(0.026, 0.009, smooth(0.55, 0.75, v)), 0.085 + (v - 0.55) / 0.45 * 0.07]).pop();
  b.push().c(hexc(0x7a5233)).t(0, 0.152, 0).cyl(0.01, 0.009, 0.02, 6).pop();
}

function buildCamp(b, info) {
  b.node = 0;
  const [fx, fz] = LAYOUT.fire, fy = T0(fx, fz);
  info.fire = [fx, fy + 0.11, fz];
  // stones
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; b.push().t(fx + Math.cos(a) * 0.15, fy + 0.01, fz + Math.sin(a) * 0.15); rock(b, 0.04 + 0.01 * hash1(i), i * 3.7); b.pop(); }
  // teepee logs with glowing ends
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + 0.3, p0 = [fx + Math.cos(a) * 0.13, fy, fz + Math.sin(a) * 0.13], p1 = [fx + Math.cos(a) * 0.01, fy + 0.2, fz + Math.sin(a) * 0.01];
    b.push().m(0).tube(t => vlerp(p0, p1, t), () => 0.017, 4, 7, { col: (u, t) => t > 0.55 ? [0.25, 0.08, 0.03] : COL.woodD }).pop();
    b.push().m(3, 1).c([1.0, 0.38, 0.1]).tube(t => vlerp(vlerp(p0, p1, 0.62), vlerp(p0, p1, 0.86), t), () => 0.0175, 2, 7).pop();
  }
  // embers bed
  b.push().m(3, 0.8).c([1, 0.3, 0.08]).t(fx, fy + 0.005, fz).sphere(0.1, 0.018, 0.1, 10, 4).pop();
  // tripod + pot
  const apex = [fx, fy + 0.42, fz];
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.6; b.push().c(COL.woodD).line([fx + Math.cos(a) * 0.24, fy - 0.01, fz + Math.sin(a) * 0.24], apex, 0.007, 5).pop(); }
  b.push().c(COL.iron).line(apex, [fx, fy + 0.3, fz], 0.002, 3).pop();
  b.push().m(1).c(hexc(0x2d2a28)).t(fx, fy + 0.22, fz).lathe(12, 6, v => [0.055 * Math.sin(PI * (0.15 + v * 0.7)) + 0.02, v * 0.08]).pop();
  b.push().c(COL.iron).t(fx, fy + 0.3, fz).rx(PI / 2).tube(t => [Math.cos(t * PI) * 0.06, 0, -Math.sin(t * PI) * 0.06 * 0.0 + 0], () => 0.002, 6, 4).pop();
  // seat logs
  for (const [a, rot] of [[2.2, 0.4], [3.9, -0.2]]) {
    const x = fx + Math.cos(a) * 0.36, z = fz + Math.sin(a) * 0.36, y = T0(x, z);
    b.push().c(COL.wood).t(x, y + 0.03, z).ry(a + PI / 2 + rot).rz(PI / 2).t(0, -0.17, 0).cyl(0.035, 0.035, 0.34, 9).pop();
  }
  // rum bottles
  { const x = fx - 0.18, z = fz + 0.24; b.push().t(x, T0(x, z) - 0.005, z); bottleGeo(b); b.pop();
    const x2 = fx - 0.25, z2 = fz + 0.17; b.push().t(x2, T0(x2, z2) + 0.024, z2).ry(0.7).rz(PI / 2 - 0.08); bottleGeo(b); b.pop(); }
  // chest
  const [cx, cz] = LAYOUT.chest, cy = T0(cx, cz) - 0.01, yaw = PI / 4 + 0.15;
  info.chest = { p: [cx, cy, cz], yaw, w: 0.26, h: 0.13, d: 0.16 };
  b.push().t(cx, cy, cz).ry(yaw);
  { const w = 0.26, h = 0.13, d = 0.16;
    b.push().c(hexc(0x7a4a24));
    b.push().t(0, 0.005, 0).box(w, 0.01, d).pop();
    b.push().t(0, h / 2, d / 2).box(w, h, 0.012).pop(); b.push().t(0, h / 2, -d / 2).box(w, h, 0.012).pop();
    b.push().t(w / 2, h / 2, 0).box(0.012, h, d).pop(); b.push().t(-w / 2, h / 2, 0).box(0.012, h, d).pop();
    b.pop();
    b.push().c(COL.iron).m(1);
    for (const x of [-0.08, 0.08]) b.push().t(x, h / 2, 0).box(0.02, h + 0.004, d + 0.006).pop();
    b.pop();
    b.push().m(1).c(COL.gold).t(0, h - 0.03, d / 2 + 0.006).box(0.035, 0.04, 0.006).pop();
    // treasure inside
    b.push().m(1).c(COL.gold).t(0, h - 0.025, 0).sphere(w * 0.46, 0.035, d * 0.42, 12, 6, p => 0.08 * noise3(p[0] * 9, p[1] * 9, p[2] * 9)).pop();
    for (let i = 0; i < 9; i++) b.push().t(rr(-0.09, 0.09), h - 0.0, rr(-0.05, 0.05)).rx(rr(-0.5, 0.5)).rz(rr(-0.5, 0.5)).push(), coinGeo(b, 0.022), b.pop().pop();
    const gems = [0xff2f5a, 0x2fd06a, 0x3a7bff, 0xb04aff, 0xff2f5a];
    for (let i = 0; i < 5; i++) b.push().m(11).c(hexc(gems[i])).t(rr(-0.09, 0.09), h + 0.008, rr(-0.05, 0.05)).sphere(0.014, 0.014, 0.014, 6, 4).pop();
  }
  b.pop();
  // lid (hinged, own node). Built in hinge frame: hinge at back-top edge, lid extends +z
  b.node = NODE.LID;
  { const w = 0.26, d = 0.16, r = d / 2;
    b.push().c(hexc(0x7a4a24)).surf(10, 8, (x, t) => [(x - 0.5) * w, Math.sin(t * PI) * r * 0.75, r - Math.cos(t * PI) * r], { flip: true }).pop();
    for (const s of [-1, 1]) {
      const base = b.count; b.c(hexc(0x6a3e1e));
      b.vert([s * w / 2, 0, r], [s, 0, 0]);
      for (let i = 0; i <= 8; i++) { const t = i / 8; b.vert([s * w / 2, Math.sin(t * PI) * r * 0.75, r - Math.cos(t * PI) * r], [s, 0, 0]); }
      for (let i = 0; i < 8; i++) b.tri(base, base + 1 + i, base + 2 + i);
    }
    b.push().c(COL.iron).m(1);
    for (const x of [-0.08, 0.08]) b.surf(1, 8, (s, t) => [x + (s - 0.5) * 0.022, Math.sin(t * PI) * (r * 0.75 + 0.004), r - Math.cos(t * PI) * (r + 0.004)], { flip: true });
    b.pop();
  }
  b.node = 0;
  // shovel in a sand mound
  { const [sx, sz] = LAYOUT.shovel, sy = T0(sx, sz);
    b.push().c(COL.sand).t(sx, sy - 0.02, sz).sphere(0.11, 0.06, 0.09, 10, 6, p => 0.1 * noise3(p[0] * 4, 0, p[2] * 4)).pop();
    b.push().t(sx, sy + 0.02, sz).ry(-0.7).rz(0.25);
    b.push().c(hexc(0x8a8c90)).m(1).t(0, 0.02, 0).box(0.07, 0.09, 0.006).pop();
    b.push().c(COL.wood).t(0, 0.06, 0).cyl(0.008, 0.008, 0.3, 6).pop();
    b.push().c(COL.woodD).t(0, 0.37, 0).rz(PI / 2).t(0, -0.035, 0).cyl(0.007, 0.007, 0.07, 6).pop();
    b.pop(); }
  // barrels, crates, cannonball pile
  const [kx, kz] = LAYOUT.chest;   // stores are stacked beside the chest
  for (const [dx, dz, lying, rot] of [[0.4, 0.12, 0, 0], [0.52, 0.23, 0, 1], [0.35, 0.3, 1, 0.4]]) {
    const x = kx + dx, z = kz + dz, y = T0(x, z);
    b.push().t(x, y + (lying ? 0.06 : 0.09), z).ry(rot); if (lying) b.rz(PI / 2); barrelGeo(b); b.pop();
  }
  for (const [dx, dz, s, rot, st] of [[0.57, -0.07, 0.16, 0.3, 0], [0.44, -0.2, 0.14, 0.9, 0], [0.54, -0.09, 0.11, 0.1, 1]]) {
    const x = kx + dx, z = kz + dz, y = T0(x, z) + (st ? 0.16 : 0);
    b.push().t(x, y + s / 2 - 0.01, z).ry(rot); crateGeo(b, s); b.pop();
  }
  { const [px, pz] = [kx + 0.14, kz + 0.28], py = T0(px, pz), r = 0.034;
    b.push().m(1).c(COL.iron);
    for (let L = 0; L < 3; L++) for (let i = 0; i < 3 - L; i++) for (let j = 0; j < 3 - L; j++)
      b.push().t(px + (i - (2 - L) / 2) * 2 * r, py + r + L * r * 1.45, pz + (j - (2 - L) / 2) * 2 * r).sphere(r, r, r, 9, 6).pop();
    b.pop(); }
  // rowboat — bow up on the sand
  { const [rx, rz] = LAYOUT.rowboat, ry = T0(rx, rz);
    b.push().t(rx, Math.max(ry, WL - 0.03) + 0.02, rz).ry(PI + 0.35).rx(-0.08).s(0.34, 0.42, 0.34);
    for (const side of [-1, 1]) b.surf(16, 6, (u, v) => { const p = HULL.pt(lerp(0.0, 1, u), lerp(0.3, 1, v), side); return [p[0], p[1] - 0.2, p[2]]; },
      { flip: side < 0, col: (u, v, p) => p[1] > -0.025 ? hexc(0xe6dccb) : hexc(0x6b4a2e) });
    b.c(COL.wood);
    for (const z of [-0.3, 0.05, 0.35]) b.push().t(0, -0.06, z).box(0.36, 0.02, 0.09).pop();
    b.c(COL.woodD).push().t(0, -0.13, 0).box(0.25, 0.012, 1.3).pop();
    b.pop();
    b.push().c(COL.wood).line([rx - 0.08, ry + 0.07, rz - 0.15], [rx + 0.12, ry + 0.05, rz + 0.25], 0.006, 5).pop();
  }
}

function buildIslandFlora(b, info) {
  b.node = 0;
  _seed = Math.max(1, Math.floor(FLORA.seed)) || 4242;
  const onIsland = (x, z) => T0(x, z);
  const nearCamp = (x, z) => Math.hypot(x - LAYOUT.fire[0], z - LAYOUT.fire[1]) < 0.5 || Math.hypot(x - LAYOUT.chest[0], z - LAYOUT.chest[1]) < 0.3
    || Math.hypot(x - LAYOUT.xmark[0], z - LAYOUT.xmark[1]) < 0.25 || Math.hypot(x - LAYOUT.chest[0] - 0.42, z - LAYOUT.chest[1] - 0.08) < 0.3 || Math.hypot(x - LAYOUT.rowboat[0], z - LAYOUT.rowboat[1]) < 0.3;
  const sample = (n, ok) => { const out = []; let guard = 0; while (out.length < n && guard++ < 6000) { const x = rr(-2.2, 2.5), z = rr(-2.55, -0.5), y = onIsland(x, z); if (ok(x, z, y) && !nearCamp(x, z)) out.push([x, y, z]); } return out; };
  info.bushes = [];
  // jelly bushes with flowers
  const greens = [0x2f9a48, 0x48b85a, 0x1f7d3f, 0x5cc46a];
  for (const [x, y, z] of sample(FLORA.bushes, (x, z, y) => y > WL + 0.2)) {
    const n = 3 + Math.floor(rnd() * 3), base = hexc(greens[Math.floor(rnd() * 4)]);
    for (let i = 0; i < n; i++) {
      const r = rr(0.06, 0.12), ox = rr(-0.1, 0.1), oz = rr(-0.1, 0.1);
      b.push().m(7).c(vscale(base, rr(0.85, 1.15))).t(x + ox, y + r * 0.55, z + oz).sphere(r, r * 0.85, r, 12, 8, p => 0.08 * noise3(p[0] * 3 + i, p[1] * 3, p[2] * 3)).pop();
    }
    const fc = [0xff6fa8, 0xffd23f, 0xff4b3a, 0xfff4e0][Math.floor(rnd() * 4)];
    for (let i = 0; i < 4; i++) b.push().m(7).c(hexc(fc)).t(x + rr(-0.12, 0.12), y + rr(0.12, 0.2), z + rr(-0.12, 0.12)).sphere(0.018, 0.012, 0.018, 6, 4).pop();
    info.bushes.push([x, y + 0.15, z]);
  }
  // ferns
  for (const [x, y, z] of sample(FLORA.ferns, (x, z, y) => y > WL + 0.16)) {
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + rnd(), dir = [Math.cos(a), 0, Math.sin(a)], side = [-dir[2], 0, dir[0]], L = rr(0.14, 0.2);
      b.push().m(2).surf(4, 8, (xx, s) => {
        const w = 0.03 * Math.sin(PI * s) * (0.6 + 0.4 * Math.abs(Math.sin(s * 28))), q = xx * 2 - 1;
        return [x + dir[0] * L * s + side[0] * q * w, y + L * (0.9 * s - 1.0 * s * s), z + dir[2] * L * s + side[2] * q * w];
      }, { col: (xx, s) => vlerp(hexc(0x2a7a35), hexc(0x6fc34e), s), w: (xx, s) => 1 + s * 0.6 }).pop();
    }
  }
  // beach grass tufts
  for (const [x, y, z] of sample(FLORA.grassTufts, (x, z, y) => y > WL + 0.05 && y < WL + 0.22)) {
    for (let k = 0; k < 7; k++) {
      const a = rnd() * TAU, lean = rr(0.15, 0.5), H = rr(0.08, 0.15), dir = [Math.cos(a), 0, Math.sin(a)], side = [-dir[2], 0, dir[0]];
      b.push().m(2).surf(1, 5, (xx, s) => {
        const w = 0.006 * (1 - s), q = xx * 2 - 1;
        return [x + dir[0] * lean * H * s * s + side[0] * q * w, y + H * s, z + dir[2] * lean * H * s * s + side[2] * q * w];
      }, { col: (xx, s) => vlerp(hexc(0x8a9a3a), hexc(0xd8d27a), s), w: (xx, s) => 1 + s }).pop();
    }
  }
  // shore rocks
  info.rocks = [];
  for (const [x, y, z] of sample(FLORA.shoreRocks, (x, z, y) => Math.abs(y - WL) < 0.07)) {
    const r = rr(0.05, 0.11); b.push().t(x, y + r * 0.2, z).ry(rnd() * TAU); rock(b, r, rnd() * 50); b.pop();
    info.rocks.push({ c: [x, y + r * 0.2, z], r: r * 0.85 });
  }
}

function buildSkull(b, info) {
  b.node = 0;
  const [sx, sz, yaw] = LAYOUT.skull, sy = T0(sx, sz) - 0.08;
  const SK = LAYOUT.skullScale;
  info.skull = { p: [sx, sy, sz], yaw, s: SK };
  const { P, I } = surfaceNets((x, y, z) => skullSDF(x, y, z), [-0.78, -0.12, -0.7], [0.78, 1.32, 0.72], [70, 64, 64]);
  const M = M4.mul(M4.mul(M4.T(sx, sy, sz), M4.RY(yaw)), M4.S(SK));
  const base = b.count;
  const e = 0.004;
  for (const p of P) {
    const [x, y, z] = p;
    const n = vnorm([skullSDF(x + e, y, z) - skullSDF(x - e, y, z), skullSDF(x, y + e, z) - skullSDF(x, y - e, z), skullSDF(x, y, z + e) - skullSDF(x, y, z - e)]);
    const wy = sy + y * SK;   // block-local height
    let c = vlerp(hexc(0x8f8477), hexc(0xb59a76), 0.5 + 0.5 * Math.sin(y * 26 + 2 * noise3(x * 2, y * 3, z * 2)));
    c = vscale(c, 0.85 + 0.25 * noise3(x * 9, y * 9, z * 9));
    const crack = Math.abs(x - 0.05 - 0.035 * Math.sin(z * 15 + 1)) < 0.03 && y > 0.9;
    if (crack) c = vscale(c, 0.45);
    const moss = smooth(0.45, 0.85, n[1]) * smooth(0.82, 1.0, y) * (0.6 + 0.4 * noise3(x * 6, y * 6, z * 6));
    c = vlerp(c, hexc(0x4f8f36), clamp(moss * 1.3, 0, 1));
    const wet = smooth(WL + 0.07, WL + 0.0, wy) * smooth(WL - 0.25, WL - 0.08, wy);
    c = vlerp(c, vscale(c, 0.5), wet);
    if (wy < WL - 0.08) c = vlerp(c, hexc(0x6e7d6a), 0.4);
    // eye sockets: smooth darkening + candle glow (continuous so the edges stay soft)
    const ex = (Math.abs(x) - EYE[0]) / 0.125, ey = (y - EYE[1]) / 0.14, ez = (z - EYE[2]) / 0.22;
    const eyeK = smooth(1.35, 0.95, Math.hypot(ex, ey, ez * 0.8)) * smooth(EYE[2] + 0.16, EYE[2] + 0.02, z);
    c = vscale(c, 1 - 0.8 * eyeK);
    const mat = 4, w = 0.2 * eyeK * smooth(EYE[2] + 0.12, EYE[2] - 0.1, z);
    const wp = M4.xp(M, p), wn = M4.xv(M, n);
    b.V.push(wp[0], wp[1], wp[2], wn[0], wn[1], wn[2], c[0], c[1], c[2], mat, w, 0);
  }
  for (const i of I) b.I.push(base + i);
  // teeth: two rows set into the grin
  b.push().apply(M).c(COL.bone).m(0);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
    const t = (i - 2.5) / 3.1, p = smileAt(t), sgn = row ? -1 : 1;
    b.push().t(p[0], p[1] + sgn * 0.02, p[2] + 0.004).ry(-t * 0.7);
    b.t(0, sgn * -0.004, 0).rz(rr(-0.08, 0.08)).box(0.042, 0.04 + 0.006 * Math.abs(t), 0.03);
    b.pop();
  }
  b.pop();
  const eyeW = (s) => M4.xp(M, [s * EYE[0], EYE[1], EYE[2] - 0.04]);
  info.skullEyes = [eyeW(-1), eyeW(1)];
}

function buildSeabed(b, info) {
  b.node = 0;
  _seed = 777 + (Math.floor(FLORA.seed) % 1000);
  // wreck — fore half of a ship on her side
  const [wx, wz] = LAYOUT.wreck, wy = T0(wx, wz);
  b.push().t(wx, wy + 0.17, wz).ry(-0.6).rz(1.25).s(0.9);
  const rot = hexc(0x5a4632), algae = hexc(0x4f6b3a);
  const wcol = (p) => vlerp(rot, algae, clamp(0.5 + 0.5 * noise3(p[0] * 6, p[1] * 6, p[2] * 6), 0, 1) * 0.7);
  for (let j = 0; j < 9; j++) {
    for (const side of [-1, 1]) {
      if (hash1(j * 7 + side * 3) < 0.28) continue;
      const u0 = 0.5 + 0.12 * hash1(j * 3.3 + side), v0 = j / 9, v1 = (j + 0.82) / 9;
      b.surf(10, 1, (u, v) => HULL.pt(lerp(u0, 1, u), lerp(v0, v1, v), side), { flip: side < 0, col: (u, v, p) => wcol(p) });
    }
  }
  for (let k = 0; k < 7; k++) {
    const u = 0.5 + k * 0.065;
    b.push().c(hexc(0x6b5238)).tube(t => { const s = t * 2 - 1; return HULL.pt(u, Math.abs(s) * 0.98, Math.sign(s) || 1); }, () => 0.012, 14, 5).pop();
  }
  b.push().c(hexc(0x6b5238)).line(HULL.pt(0.5, 0.97, -1), HULL.pt(0.5, 0.97, 1), 0.012, 5).line(HULL.pt(0.72, 0.97, -1), HULL.pt(0.72, 0.97, 1), 0.012, 5).pop();
  b.pop();
  // broken mast + yard
  b.push().c(hexc(0x5f4a33)).t(wx - 0.55, T0(wx - 0.55, wz - 0.2) + 0.03, wz - 0.2).ry(0.4).rz(PI / 2 - 0.12).t(0, -0.45, 0).cyl(0.025, 0.018, 0.85, 8).pop();
  b.push().c(hexc(0x5f4a33)).t(wx - 0.35, T0(wx - 0.35, wz + 0.15) + 0.02, wz + 0.15).ry(-0.9).rz(PI / 2).t(0, -0.25, 0).cyl(0.012, 0.012, 0.5, 6).pop();
  info.wreck = [{ c: [wx, wy + 0.15, wz], r: 0.3 }, { c: [wx - 0.25, wy + 0.12, wz - 0.2], r: 0.22 }, { c: [wx + 0.25, wy + 0.12, wz + 0.2], r: 0.22 }];
  // kelp
  const kelpSpots = [[1.9, 0.3], [0.55, 1.95], [-1.65, 1.6], [2.05, 1.85], [-2.1, 0.4], [1.0, 0.25], [-0.9, 1.9], [2.2, -0.4]].slice(0, FLORA.kelpClumps);
  for (let g = 0; kelpSpots.length < FLORA.kelpClumps && g < 5000; g++) { const x = rr(-HALF + 0.3, HALF - 0.3), z = rr(-HALF + 0.3, HALF - 0.3); if (T0(x, z) < WL - 0.3) kelpSpots.push([x, z]); }
  for (const [kx, kz] of kelpSpots) for (let s = 0; s < 4; s++) {
    const x = kx + rr(-0.12, 0.12), z = kz + rr(-0.12, 0.12), y0 = T0(x, z), H = (WL - 0.1 - y0) * rr(0.6, 0.95), ph = rnd() * 6;
    if (H < 0.1) continue;
    const k0 = hexc(0x5d7a22), k1 = hexc(0xb7c74a);
    b.push().m(2).surf(2, 18, (xx, t) => {
      const w = 0.028 * (0.4 + 0.6 * Math.sin(PI * Math.min(t * 1.4, 1))), q = xx * 2 - 1;
      return [x + 0.05 * Math.sin(t * 7 + ph) + q * w, y0 + H * t, z + 0.04 * Math.cos(t * 5 + ph) + q * w * 0.4];
    }, { col: (xx, t) => vlerp(k0, k1, t), w: (xx, t) => 1 + t * 1.6 }).pop();
  }
  // doubloons on the floor
  for (let i = 0; i < FLORA.seabedCoins; i++) {
    const x = wx + rr(-0.6, 0.4), z = wz + rr(-0.5, 0.45), y = T0(x, z);
    b.push().t(x, y + 0.004, z).rx(rr(-0.15, 0.15)).rz(rr(-0.15, 0.15)); coinGeo(b, 0.035); b.pop();
  }
  // bubbles trapped in the jelly
  for (let i = 0; i < FLORA.trappedBubbles; i++) {
    const x = rr(-HALF + 0.2, HALF - 0.2), z = HALF > 3 ? rr(-HALF + 0.2, HALF - 0.2) : rr(-0.3, 2.4), y0 = T0(x, z); if (y0 > WL - 0.15) continue;
    const r = rr(0.006, 0.026), y = rr(y0 + 0.05, WL - 0.06);
    b.push().m(9).c([0.9, 0.97, 1]).t(x, y, z).sphere(r, r, r, 8, 6).pop();
  }
  // anchor on the bottom
  const [ax, az] = LAYOUT.anchor, ay = T0(ax, az);
  b.push().t(ax, ay + 0.035, az).ry(0.9).rz(1.3).m(1).c(COL.iron);
  b.cyl(0.013, 0.013, 0.3, 8);
  b.tube(t => { const a = PI * (1.15 + t * 0.7); return [Math.cos(a) * 0.12, 0.12 + Math.sin(a) * 0.12, 0]; }, () => 0.012, 10, 6);
  for (const s of [-1, 1]) { const a = PI * (s < 0 ? 1.15 : 1.85); b.push().t(Math.cos(a) * 0.12, 0.12 + Math.sin(a) * 0.12, 0).rz(s * 0.6).box(0.05, 0.06, 0.012).pop(); }
  b.push().t(0, 0.26, 0).rx(PI / 2).t(0, -0.11, 0).cyl(0.009, 0.009, 0.22, 6).pop();
  b.push().t(0, 0.31, 0).tube(t => [Math.cos(t * TAU) * 0.022, Math.sin(t * TAU) * 0.022, 0], () => 0.005, 12, 5).pop();
  b.pop();
  const AM = M4.mul(M4.mul(M4.T(ax, ay + 0.035, az), M4.RY(0.9)), M4.RZ(1.3));
  info.anchorRing = M4.xp(AM, [0, 0.31, 0]);
}

// dynamic object pools (one node per instance)
function buildPools(b) {
  for (let i = 0; i < NODE.NCHAIN; i++) {
    b.node = NODE.CHAIN + i;
    b.push().m(1).c(hexc(0x34312e)).tube(t => { const a = t * TAU; return [0, Math.sin(a) * 0.012, Math.cos(a) * 0.022]; }, () => 0.0045, 12, 5).pop();
  }
  for (let i = 0; i < NODE.NBALL; i++) { b.node = NODE.BALL + i; b.push().m(1).c(hexc(0x24221f)).sphere(0.055, 0.055, 0.055, 12, 8).pop(); }
  for (let i = 0; i < NODE.NBARREL; i++) { b.node = NODE.BARREL + i; b.push().m(0); barrelGeo(b); b.pop(); }
  for (let i = 0; i < NODE.NCOIN; i++) { b.node = NODE.COIN + i; b.push().t(0, -0.0045, 0); coinGeo(b, 0.04); b.pop(); }
  b.node = 0;
}

function buildIslets(b) {
  _seed = 9001;
  ISLETS.forEach((I, n) => {
    const np = Math.max(1, Math.round(I.r * 2.6));
    for (let k = 0; k < np; k++) {
      const a = rnd() * TAU, d = rr(0, I.r * 0.45), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d;
      const P = { x, z, h: rr(0.65, 1.0), lean: [rr(-0.3, 0.3), rr(-0.3, 0.3)] };
      b.push().t(x, T0(x, z) - 0.02, z); buildPalm(b, P, 100 + n * 10 + k, 0); b.pop();
    }
    b.node = 0;
    for (let k = 0; k < Math.round(I.r * 5); k++) {
      const a = rnd() * TAU, d = rr(I.r * 0.75, I.r * 1.05), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, r = rr(0.05, 0.12);
      b.push().t(x, T0(x, z) + r * 0.2, z).ry(rnd() * TAU); rock(b, r, rnd() * 50); b.pop();
    }
    for (let k = 0; k < Math.round(I.r * 3); k++) {
      const a = rnd() * TAU, d = rr(0, I.r * 0.5), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, y = T0(x, z), r = rr(0.07, 0.13);
      b.push().m(7).c(vscale(hexc([0x2f9a48, 0x48b85a, 0x1f7d3f][k % 3]), rr(0.85, 1.15))).t(x, y + r * 0.5, z).sphere(r, r * 0.85, r, 12, 8).pop();
    }
  });
}

function buildWorld() {
  const t0 = performance.now();
  const b = new MB(), info = {};
  buildShip(b);
  PALMS.forEach((P, i) => buildPalm(b, P, i));
  buildCamp(b, info);
  buildIslandFlora(b, info);
  buildSkull(b, info);
  buildSeabed(b, info);
  buildIslets(b);
  buildPools(b);
  info.buildMs = performance.now() - t0;
  return { V: new Float32Array(b.V), I: new Uint32Array(b.I), info };
}

// terrain + jelly grids: vertex = (x, z, kind, side). kind 0 top, 1 wall top, 2 wall bottom
function buildGridMesh(res) {
  const V = [], I = [];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) V.push(-HALF + i / (res - 1) * BLOCK, -HALF + j / (res - 1) * BLOCK, 0, 0);
  for (let j = 0; j < res - 1; j++) for (let i = 0; i < res - 1; i++) { const a = j * res + i; I.push(a, a + res, a + 1, a + 1, a + res, a + res + 1); }
  // four walls (side: 0 +x, 1 -x, 2 +z, 3 -z), each a strip of res columns
  for (let s = 0; s < 4; s++) {
    const base = V.length / 4;
    for (let i = 0; i < res; i++) {
      const t = -HALF + i / (res - 1) * BLOCK;
      const [x, z] = s === 0 ? [HALF, t] : s === 1 ? [-HALF, t] : s === 2 ? [t, HALF] : [t, -HALF];
      V.push(x, z, 1, s, x, z, 2, s);
    }
    for (let i = 0; i < res - 1; i++) { const a = base + i * 2; if (s === 0 || s === 3) I.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); else I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  return { V: new Float32Array(V), I: new Uint32Array(I) };
}
