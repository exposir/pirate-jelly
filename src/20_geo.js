
// ───────────────────────── world constants ─────────────────────────
const WL = 1.45;                                     // water rest level (block local)
// world dimensions — set from config.world before anything is built
let BLOCK = 5.2, HALF = 2.6;                          // jelly block size
let TN = 128, TDX = BLOCK / TN;                       // global terrain grid
let GN = 128, GDX = BLOCK / GN;                       // water simulation window
const SWELL = { amp: 0, length: 1.6, speed: 1.2, fade: 0 };
const ISLETS = [];                                    // extra islands for large worlds: { x, z, r, h }
function setWorld(w) {
  BLOCK = w.size; HALF = BLOCK / 2; TN = w.terrainRes; TDX = BLOCK / TN; GN = w.waterRes;
  GDX = w.waterCell > 0 ? w.waterCell : BLOCK / GN;
  if (GN * GDX > BLOCK) GDX = BLOCK / GN;
  Object.assign(SWELL, w.swell, { fade: GN * GDX < BLOCK - 1e-6 ? w.windowFade : 0 });
  ISLETS.length = 0; for (const it of w.islets || []) ISLETS.push({ ...it });
}
const swellAt = (x, z, t) => {
  if (SWELL.amp <= 0) return 0;
  const k = TAU / SWELL.length, s = t * SWELL.speed;
  return SWELL.amp * (0.5 * Math.sin(k * (0.8 * x + 0.6 * z) + s) + 0.3 * Math.sin(k * 1.37 * (-0.4 * x + 0.92 * z) + 1.3 * s)
    + 0.2 * Math.sin(k * 0.71 * (0.95 * x - 0.3 * z) + 0.8 * s));
};
let G_BODY = 6.5;                                     // gravity for rigid bodies (configurable)
const LAYOUT = {
  island: [0.1, -1.55, 2.1, 1.1], hills: 1, cove: 0.13, skullScale: 1.28,
  ship: [-1.0, 1.25], anchor: [-1.05, 0.15],
  skull: [-1.82, -0.95, 0.85],                         // x, z, yaw
  fire: [0.3, -1.05], chest: [0.98, -1.18], xmark: [0.62, -0.8], shovel: [0.78, -0.74],
  rowboat: [-0.3, -0.58], wreck: [1.35, 1.25],
};

// ───────────────────────── SDF helpers ─────────────────────────
function sdEll(px, py, pz, rx, ry, rz) {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz), k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k0 * (k0 - 1) / (k1 || 1e-6);
}
function sdRBox(px, py, pz, bx, by, bz, r) {
  const qx = Math.abs(px) - bx, qy = Math.abs(py) - by, qz = Math.abs(pz) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function sdSeg(px, py, pz, a, b) {
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h);
}
const smin = (a, b, k) => { const h = clamp(.5 + .5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };
const smax = (a, b, k) => -smin(-a, -b, k);

const EYE = [0.165, 0.585, 0.36];
// skull mass without carvings — used to seat the grin on the actual face surface
function skullMass(x, y, z) {
  const ax = Math.abs(x);
  let d = sdEll(x, y - 0.8, z + 0.02, 0.45, 0.42, 0.45);                    // cranium
  d = smin(d, sdEll(x, y - 0.52, z - 0.06, 0.39, 0.31, 0.37), 0.14);          // face mass
  d = smin(d, sdEll(ax - 0.26, y - 0.47, z - 0.2, 0.13, 0.11, 0.13), 0.08);   // cheekbones
  d = smin(d, sdRBox(x, y - 0.27, z - 0.1, 0.21, 0.1, 0.22, 0.08), 0.12);     // jaw
  d = smin(d, sdEll(x, y + 0.02, z - 0.02, 0.66, 0.34, 0.6), 0.22);           // rocky foot
  return d;
}
const faceZ = (x, y) => { let z = 1.0; while (z > 0 && skullMass(x, y, z) > 0) z -= 0.004; return z; };
const smileAt = t => { const x = 0.235 * t, y = 0.29 + 0.075 * t * t; return [x, y, faceZ(x, y) - 0.012]; };
const SMILE = []; for (let i = 0; i <= 12; i++) SMILE.push(smileAt(i / 6 - 1));

// Skull Rock in its own frame: base at y=0, face toward +z, height ≈ 1.25
function skullSDF(x, y, z, detail = true) {
  const ax = Math.abs(x);
  let d = skullMass(x, y, z);
  d = smax(d, -sdEll(ax - EYE[0], y - EYE[1], z - EYE[2], 0.125, 0.14, 0.22), 0.035); // eye sockets
  const nose = smin(Math.hypot(ax - 0.034, y - 0.445, z - 0.44) - 0.04, sdEll(x, y - 0.41, z - 0.445, 0.026, 0.05, 0.07), 0.02);
  d = smax(d, -nose, 0.015);                                                    // heart nose
  let sm = 1e9; for (let i = 0; i < SMILE.length - 1; i++) sm = Math.min(sm, sdSeg(x, y, z, SMILE[i], SMILE[i + 1]));
  d = smax(d, -(sm - 0.046), 0.012);                                           // grin
  if (detail) {
    const cx = x - 0.05 - 0.035 * Math.sin(z * 15 + 1) - 0.015 * Math.sin(y * 24);
    const crack = Math.max(Math.abs(cx) - 0.011 * smooth(0.88, 1.15, y), 0.93 - y, Math.abs(z - 0.05) - 0.36);
    d = Math.max(d, -crack);                                                    // crack on top
    d += 0.022 * noise3(x * 7, y * 7, z * 7) + 0.009 * noise3(x * 19 + 3, y * 19, z * 19)
      + 0.005 * Math.sin(y * 52 + 3 * noise3(x * 3, y * 2, z * 3));             // strata ridges
  }
  return d;
}

// Surface nets: sdf → indexed triangles + vertex positions (grid res per axis)
function surfaceNets(f, mn, mx, res) {
  const [nx, ny, nz] = res, sx = (mx[0] - mn[0]) / nx, sy = (mx[1] - mn[1]) / ny, sz = (mx[2] - mn[2]) / nz;
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1, val = new Float32Array(NX * NY * NZ);
  const gi = (i, j, k) => i + NX * (j + NY * k);
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    val[gi(i, j, k)] = f(mn[0] + i * sx, mn[1] + j * sy, mn[2] + k * sz);
  const cell = new Int32Array(nx * ny * nz).fill(-1), ci = (i, j, k) => i + nx * (j + ny * k);
  const P = [], I = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[gi(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      ax += (a & 1) + (((b & 1) - (a & 1)) * t); ay += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      az += (a >> 2) + (((b >> 2) - (a >> 2)) * t); n++;
    }
    cell[ci(i, j, k)] = P.length;
    P.push([mn[0] + (i + ax / n) * sx, mn[1] + (j + ay / n) * sy, mn[2] + (k + az / n) * sz]);
  }
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = val[gi(i, j, k)] < 0, b = val[gi(i + 1, j, k)] < 0; if (a === b) continue;
    quad(cell[ci(i, j - 1, k - 1)], cell[ci(i, j, k - 1)], cell[ci(i, j, k)], cell[ci(i, j - 1, k)], !a);
  }
  for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
    const a = val[gi(i, j, k)] < 0, b = val[gi(i, j + 1, k)] < 0; if (a === b) continue;
    quad(cell[ci(i - 1, j, k - 1)], cell[ci(i - 1, j, k)], cell[ci(i, j, k)], cell[ci(i, j, k - 1)], !a);
  }
  for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const a = val[gi(i, j, k)] < 0, b = val[gi(i, j, k + 1)] < 0; if (a === b) continue;
    quad(cell[ci(i - 1, j - 1, k)], cell[ci(i, j - 1, k)], cell[ci(i, j, k)], cell[ci(i - 1, j, k)], !a);
  }
  return { P, I };
}

// ───────────────────────── terrain ─────────────────────────
function islandR(x, z) {
  const [cx, cz, rx, rz] = LAYOUT.island;
  let r = Math.hypot((x - cx) / rx, (z - cz) / rz);
  r += 0.07 * fbm2(x * 1.3 + 4, z * 1.3 - 2, 3);                              // ragged shoreline
  r += LAYOUT.cove * Math.exp(-((x - LAYOUT.fire[0]) ** 2 / 0.22 + (z - LAYOUT.fire[1] - 0.43) ** 2 / 0.05));   // the cove bites in
  return r;
}
function terrainFn(x, z) {
  let sea = 0.64 + 0.05 * fbm2(x * 0.9, z * 0.9, 3) - 0.07 * clamp(z / 2.6, -1, 1);
  if (HALF > 3) sea += 0.12 * fbm2(x * 0.18 + 9, z * 0.18 - 4, 3);         // broad swales across a big sea
  const [sx, sz] = LAYOUT.skull;
  sea = lerp(sea, WL - 0.17 + 0.03 * noise2(x * 3, z * 3), Math.exp(-((x - sx) ** 2 + (z - sz) ** 2) / 0.32)); // shoal
  const r = islandR(x, z);
  const beach = WL + 0.05 + 0.14 * smooth(0.82, 0.25, r) + 0.015 * noise2(x * 5, z * 5);
  let h = lerp(sea, Math.max(sea, WL - 0.16 + 0.03 * noise2(x * 4, z * 4)), smooth(1.42, 1.02, r));   // shallow reef shelf
  h = lerp(h, beach, smooth(1.02, 0.82, r));
  // jungle hills, mostly at the back of the island
  const hill = (hx, hz, hr, hh) => hh * Math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / (hr * hr));
  let hills = hill(-0.55, -1.95, 0.62, 0.62) + hill(0.75, -2.05, 0.58, 0.5) + hill(-1.25, -1.62, 0.42, 0.3) + hill(1.55, -1.75, 0.4, 0.22);
  hills *= (1 + 0.35 * fbm2(x * 2.2, z * 2.2, 3)) * LAYOUT.hills;
  h += hills * smooth(0.78, 0.45, r);
  // islets: sandy humps with a green crown
  for (const I of ISLETS) {
    const d = Math.hypot(x - I.x, z - I.z) / I.r + 0.12 * fbm2(x * 2 + I.x, z * 2 + I.z, 2);
    if (d > 1.6) continue;
    let ih = lerp(sea, WL - 0.14, smooth(1.55, 1.1, d));
    ih = lerp(ih, WL + 0.05, smooth(1.1, 0.9, d));
    ih += I.h * smooth(0.8, 0.15, d) * (1 + 0.3 * fbm2(x * 3, z * 3, 2));
    h = Math.max(h, ih);
  }
  return h;
}

// ───────────────────────── mesh builder ─────────────────────────
// vertex: pos3 nrm3 col3 mat w node  (12 floats)
const VSTRIDE = 12;
class MB {
  constructor() { this.V = []; this.I = []; this.M = M4.id(); this.NM = null; this.st = []; this.col = [1, 1, 1]; this.mat = 0; this.node = 0; this.wc = 0; this.wf = null; }
  get count() { return this.V.length / VSTRIDE; }
  push() { this.st.push([this.M, this.col, this.mat, this.wc, this.wf]); return this; }
  pop() { [this.M, this.col, this.mat, this.wc, this.wf] = this.st.pop(); this.NM = null; return this; }
  apply(m) { this.M = M4.mul(this.M, m); this.NM = null; return this; }
  t(x, y, z) { return this.apply(M4.T(x, y, z)); }
  rx(a) { return this.apply(M4.RX(a)); } ry(a) { return this.apply(M4.RY(a)); } rz(a) { return this.apply(M4.RZ(a)); }
  s(x, y = x, z = x) { return this.apply(M4.S(x, y, z)); }
  c(r, g, b) { this.col = Array.isArray(r) ? r : [r, g, b]; return this; }
  hex(h) { this.col = [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]; return this; }
  m(mat, w = this.wc) { this.mat = mat; this.wc = w; return this; }
  vert(p, n, col = this.col, w) {
    if (!this.NM) this.NM = M4.inv(this.M);
    const P = M4.xp(this.M, p), im = this.NM;
    const N = vnorm([im[0] * n[0] + im[1] * n[1] + im[2] * n[2], im[4] * n[0] + im[5] * n[1] + im[6] * n[2], im[8] * n[0] + im[9] * n[1] + im[10] * n[2]]);
    const ww = w !== undefined ? w : this.wf ? this.wf(P, p) : this.wc;
    this.V.push(P[0], P[1], P[2], N[0], N[1], N[2], col[0], col[1], col[2], this.mat, ww, this.node);
    return this.count - 1;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
  // parametric surface f(u,v) → point; optional colour fn
  surf(nu, nv, f, o = {}) {
    const base = this.count, e = 1e-3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, p = f(u, v);
      let du = vsub(f(Math.min(u + e, 1), v), f(Math.max(u - e, 0), v)), dv = vsub(f(u, Math.min(v + e, 1)), f(u, Math.max(v - e, 0)));
      if (vlen(du) < 1e-7) du = vsub(f(Math.min(u + e, 1), clamp(v + (v < .5 ? .02 : -.02), 0, 1)), f(Math.max(u - e, 0), clamp(v + (v < .5 ? .02 : -.02), 0, 1)));
      if (vlen(dv) < 1e-7) dv = vsub(f(clamp(u + .02, 0, 1), Math.min(v + e, 1)), f(clamp(u + .02, 0, 1), Math.max(v - e, 0)));
      let n = vnorm(vcross(du, dv)); if (o.flip) n = vscale(n, -1);
      this.vert(p, n, o.col ? o.col(u, v, p) : this.col, o.w ? o.w(u, v, p) : undefined);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      if (o.flip) this.I.push(a, c, b, a, d, c); else this.I.push(a, b, c, a, c, d);
    }
    return this;
  }
  // lathe around y: prof(v) → [r, y]
  lathe(seg, nv, prof, o = {}) {
    return this.surf(seg, nv, (u, v) => { const [r, y] = prof(v), a = u * TAU; return [Math.cos(a) * r, y, -Math.sin(a) * r]; }, o);
  }
  cyl(r0, r1, h, seg = 12, cap = true) {
    this.lathe(seg, 1, v => [lerp(r0, r1, v), v * h]);
    if (cap) { this.disc(r1, h, seg, 1); this.disc(r0, 0, seg, -1); }
    return this;
  }
  disc(r, y, seg, dir) {
    const c = this.vert([0, y, 0], [0, dir, 0]), b = this.count;
    for (let i = 0; i <= seg; i++) { const a = i / seg * TAU; this.vert([Math.cos(a) * r, y, -Math.sin(a) * r], [0, dir, 0]); }
    for (let i = 0; i < seg; i++) dir > 0 ? this.tri(c, b + i, b + i + 1) : this.tri(c, b + i + 1, b + i);
    return this;
  }
  sphere(rx, ry = rx, rz = rx, seg = 14, rings = 9, disp) {
    return this.surf(seg, rings, (u, v) => {
      const a = u * TAU, b = v * PI, s = Math.sin(b);
      let p = [Math.cos(a) * s, -Math.cos(b), -Math.sin(a) * s];
      const k = disp ? 1 + disp(p) : 1;
      return [p[0] * rx * k, p[1] * ry * k, p[2] * rz * k];
    });
  }
  box(sx, sy, sz) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const F = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    for (const [n, u, v] of F) {
      const b = this.count;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        this.vert([n[0] * hx + u[0] * su * hx + v[0] * sv * hx, n[1] * hy + u[1] * su * hy + v[1] * sv * hy, n[2] * hz + u[2] * su * hz + v[2] * sv * hz], n);
      this.I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return this;
  }
  // tube along path(t) with radius r(t)
  tube(path, rad, nt, seg = 8, o = {}) {
    return this.surf(seg, nt, (u, v) => {
      const p = path(v), q = path(Math.min(v + 0.01, 1)), q0 = path(Math.max(v - 0.01, 0));
      const T = vnorm(vsub(q, q0)), ref = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const N = vnorm(vcross(T, ref)), B = vcross(N, T), a = u * TAU, r = rad(v, u);
      return vadd(p, vadd(vscale(N, Math.cos(a) * r), vscale(B, Math.sin(a) * r)));
    }, o);
  }
  line(a, b, r = 0.004, seg = 4) { return this.tube(t => vlerp(a, b, t), () => r, 1, seg); }
}
