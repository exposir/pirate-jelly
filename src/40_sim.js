
// ───────────────────────── terrain (global heightfield) ─────────────────────────
function splatGrid(a, N, dx, ox, oz, x, z, r, amp, add = true) {
  const ci = (x - ox) / dx - 0.5, cj = (z - oz) / dx - 0.5, R = Math.ceil(r * 2 / dx);
  const i0 = Math.max(0, Math.floor(ci - R)), i1 = Math.min(N - 1, Math.ceil(ci + R)), j0 = Math.max(0, Math.floor(cj - R)), j1 = Math.min(N - 1, Math.ceil(cj + R));
  const k = 1 / (r * r);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const ddx = (i - ci) * dx, ddz = (j - cj) * dx, g = Math.exp(-(ddx * ddx + ddz * ddz) * k) * amp;
    if (add) a[j * N + i] += g; else a[j * N + i] = Math.max(a[j * N + i], g);
  }
}
function sampGrid(a, N, dx, ox, oz, x, z) {
  const gx = (x - ox) / dx - 0.5, gz = (z - oz) / dx - 0.5;
  const i0 = Math.floor(gx), j0 = Math.floor(gz), fx = gx - i0, fz = gz - j0;
  const c = (i, j) => a[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
  return lerp(lerp(c(i0, j0), c(i0 + 1, j0), fx), lerp(c(i0, j0 + 1), c(i0 + 1, j0 + 1), fx), fz);
}
class Terrain {
  // TN×TN heights covering the jelly block (centre BC); in infinite worlds it scrolls with the block
  constructor() { this.load(); }
  gen(x, z) { return terrainFn(x + ORIGIN[0], z + ORIGIN[1]); }
  load() {
    this.N = TN; this.dx = TDX; this.ox = BC[0] - HALF; this.oz = BC[1] - HALF;
    this.h = new Float32Array(TN * TN);
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) this.h[j * TN + i] = this.gen(this.ox + (i + 0.5) * TDX, this.oz + (j + 0.5) * TDX);
    this.dirty = true;
  }
  reset() { this.load(); }
  // re-centre on the block: shift by whole cells and generate only the newly exposed strips
  follow() {
    const N = this.N, dx = this.dx, ki = Math.round((BC[0] - HALF - this.ox) / dx), kj = Math.round((BC[1] - HALF - this.oz) / dx);
    if (!ki && !kj) return;
    if (Math.abs(ki) >= N || Math.abs(kj) >= N) { this.load(); return; }
    const o = new Float32Array(N * N), nox = this.ox + ki * dx, noz = this.oz + kj * dx;
    for (let j = 0; j < N; j++) {
      const sj = j + kj, inJ = sj >= 0 && sj < N;
      for (let i = 0; i < N; i++) {
        const si = i + ki;
        o[j * N + i] = inJ && si >= 0 && si < N ? this.h[sj * N + si] : this.gen(nox + (i + 0.5) * dx, noz + (j + 0.5) * dx);
      }
    }
    this.h = o; this.ox = nox; this.oz = noz; this.dirty = true;
  }
  at(x, z) { return sampGrid(this.h, this.N, this.dx, this.ox, this.oz, x, z); }
  normal(x, z) { const e = this.dx; return vnorm([this.at(x - e, z) - this.at(x + e, z), 2 * e, this.at(x, z - e) - this.at(x, z + e)]); }
  crater(x, z, r, depth) {
    splatGrid(this.h, this.N, this.dx, this.ox, this.oz, x, z, r, -depth);
    splatGrid(this.h, this.N, this.dx, this.ox, this.oz, x, z, r * 1.8, depth * 0.25);
    this.dirty = true;
  }
}
const inBlock = (x, z, m = 0) => Math.abs(x - BC[0]) < HALF - m && Math.abs(z - BC[1]) < HALF - m;

// ───────────────────────── shallow water (staggered grid, CPU) ─────────────────────────
// Simulated in a window of GN×GN cells. When the window is smaller than the block it follows
// a focus point (the ship) by whole-cell shifts and fades into the analytic swell at its rim.
const G_WAVE = 5.0;
class Water {
  constructor(terrain) {
    const N = this.N = GN; this.dx = GDX; this.terrain = terrain;
    this.eta = new Float32Array(N * N); this.P = new Float32Array(N * N); this.foam = new Float32Array(N * N);
    this.lap = new Float32Array(N * N); this.sponge = new Float32Array(N * N);
    this.u = new Float32Array((N + 1) * N); this.v = new Float32Array(N * (N + 1));
    this.tex = new Float32Array(N * N * 4); this.g = G_WAVE; this.time = 0;
    this.windowed = N * GDX < BLOCK - 1e-6;
    this.ox = this.oz = this.windowed ? -N * GDX / 2 : -HALF;
    const F = Math.max(SWELL.fade, 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const e = Math.min(i, j, N - 1 - i, N - 1 - j);
      this.sponge[j * N + i] = this.windowed ? lerp(0.97, 1, smooth(0, F, e)) : 1;
    }
    this.reset();
  }
  reset() { this.eta.fill(0); this.u.fill(0); this.v.fill(0); this.foam.fill(0); this.P.fill(0); this.updateDepth(); }
  updateDepth() {
    const N = this.N, D = this.D = new Float32Array(N * N), wet = this.wet = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = this.ox + (i + 0.5) * this.dx, z = this.oz + (j + 0.5) * this.dx, k = j * N + i;
      const inside = inBlock(x, z);
      D[k] = inside ? Math.max(WL - this.terrain.at(x, z), 0) : 0; wet[k] = D[k] > 0.012 ? 1 : 0;
    }
  }
  // keep the window centred on a focus point (whole-cell shifts)
  follow(x, z) {
    if (!this.windowed) return;
    const N = this.N, dx = this.dx, half = N * dx / 2;
    const ki = Math.round((x - (this.ox + half)) / dx), kj = Math.round((z - (this.oz + half)) / dx);
    if (Math.abs(ki) < 6 && Math.abs(kj) < 6) return;
    const shift = (a, w, h) => {
      const o = new Float32Array(a.length);
      for (let j = 0; j < h; j++) { const sj = j + kj; if (sj < 0 || sj >= h) continue;
        for (let i = 0; i < w; i++) { const si = i + ki; if (si >= 0 && si < w) o[j * w + i] = a[sj * w + si]; } }
      a.set(o);
    };
    shift(this.eta, N, N); shift(this.foam, N, N); shift(this.u, N + 1, N); shift(this.v, N, N + 1);
    this.ox += ki * dx; this.oz += kj * dx;
    this.updateDepth();
  }
  samp(a, x, z) {
    const gx = (x - this.ox) / this.dx - 0.5, gz = (z - this.oz) / this.dx - 0.5, N = this.N;
    if (gx < -0.5 || gz < -0.5 || gx > N - 0.5 || gz > N - 0.5) return 0;
    const v = sampGrid(a, N, this.dx, this.ox, this.oz, x, z);
    return SWELL.fade > 0 ? v * smooth(0, SWELL.fade, Math.min(gx, gz, N - 1 - gx, N - 1 - gz)) : v;
  }
  height(x, z) { return WL + this.samp(this.eta, x, z) + swellAt(x, z, this.time); }
  ground(x, z) { return this.terrain.at(x, z); }
  groundN(x, z) { return this.terrain.normal(x, z); }
  slope(x, z) { const e = this.dx; return [(this.height(x + e, z) - this.height(x - e, z)) / (2 * e), (this.height(x, z + e) - this.height(x, z - e)) / (2 * e)]; }
  splat(a, x, z, r, amp, add = true) { splatGrid(a, this.N, this.dx, this.ox, this.oz, x, z, r, amp, add); }
  pressure(x, z, r, amp) { this.splat(this.P, x, z, r, amp); }
  splash(x, z, r, amp) {
    this.splat(this.eta, x, z, r, -amp); this.splat(this.eta, x, z, r * 2.2, amp * 0.22);
    this.splat(this.foam, x, z, r * 1.6, 1, false);
  }
  crater(x, z, r, depth) { this.terrain.crater(x, z, r, depth); this.updateDepth(); }
  step(dt, gx, gz, damp, tension) {
    const N = this.N, eta = this.eta, P = this.P, u = this.u, v = this.v, D = this.D, wet = this.wet, lap = this.lap, sp = this.sponge;
    const idx = 1 / this.dx, idx2 = idx * idx, kd = Math.exp(-damp * dt);
    if (tension > 0) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i; if (!wet[k]) { lap[k] = 0; continue; }
        const e = eta[k];
        const l = i > 0 && wet[k - 1] ? eta[k - 1] : e, r = i < N - 1 && wet[k + 1] ? eta[k + 1] : e;
        const d = j > 0 && wet[k - N] ? eta[k - N] : e, t = j < N - 1 && wet[k + N] ? eta[k + N] : e;
        lap[k] = (l + r + d + t - 4 * e) * idx2;
      }
    }
    for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
      const a = j * N + i - 1, b = a + 1, f = j * (N + 1) + i;
      if (!(wet[a] && wet[b])) { u[f] = 0; continue; }
      const du = -this.g * ((eta[b] + P[b]) - (eta[a] + P[a])) * idx + gx + tension * (lap[b] - lap[a]) * idx;
      u[f] = (u[f] + du * dt) * kd;
    }
    for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
      const a = (j - 1) * N + i, b = a + N, f = j * N + i;
      if (!(wet[a] && wet[b])) { v[f] = 0; continue; }
      const dv = -this.g * ((eta[b] + P[b]) - (eta[a] + P[a])) * idx + gz + tension * (lap[b] - lap[a]) * idx;
      v[f] = (v[f] + dv * dt) * kd;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; if (!wet[k]) { eta[k] *= 0.9; continue; }
      const fl = j * (N + 1) + i, fb = j * N + i;
      const Dl = i > 0 ? 0.5 * (D[k] + D[k - 1]) : 0, Dr = i < N - 1 ? 0.5 * (D[k] + D[k + 1]) : 0;
      const Db = j > 0 ? 0.5 * (D[k] + D[k - N]) : 0, Dt = j < N - 1 ? 0.5 * (D[k] + D[k + N]) : 0;
      const div = (Dr * u[fl + 1] - Dl * u[fl]) + (Dt * v[fb + N] - Db * v[fb]);
      eta[k] = clamp(eta[k] - dt * div * idx, -0.6, 0.6) * sp[k];
    }
    // a whisper of viscosity keeps the grid smooth
    if (this.windowed) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; u[j * (N + 1) + i] *= sp[k]; v[k] *= sp[k]; }
    const nu = 0.0025 * dt * idx2;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i; if (!wet[k]) continue;
      lap[k] = (eta[k - 1] + eta[k + 1] + eta[k - N] + eta[k + N] - 4 * eta[k]);
    }
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; if (wet[k]) eta[k] += nu * lap[k] * (wet[k - 1] & wet[k + 1] & wet[k - N] & wet[k + N]); }
  }
  finishFrame(dt) {
    const N = this.N, t = this.tex, eta = this.eta, foam = this.foam, D = this.D;
    let E = 0; const fd = Math.exp(-dt * 0.9);
    for (let k = 0; k < this.u.length; k++) E += this.u[k] * this.u[k] + this.v[k] * this.v[k];
    for (let k = 0; k < N * N; k++) {
      const e = eta[k];
      const shallow = D[k] < 0.25 ? 1 : 0.3;
      foam[k] = Math.max(foam[k] * fd, clamp((Math.abs(e) - 0.05) * 5 * shallow, 0, 1));
      t[k * 4] = e; t[k * 4 + 1] = foam[k];
    }
    this.P.fill(0);
    return E;
  }
}

// ───────────────────────── particles ─────────────────────────
const PCAP = 4000, PF = 12;
class Particles {
  constructor() {
    this.n = 0;
    this.a = {};
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'max', 's0', 's1', 'r0', 'g0', 'b0', 'a0', 'r1', 'g1', 'b1', 'a1', 'kind', 'add', 'under', 'drag', 'grav', 'rot', 'rotv', 'lit', 'buoy', 'nf'])
      this.a[k] = new Float32Array(PCAP);
    this.out = new Float32Array(PCAP * PF);
  }
  emit(o) {
    if (this.n >= PCAP) return;
    const i = this.n++, a = this.a;
    a.x[i] = o.p[0]; a.y[i] = o.p[1]; a.z[i] = o.p[2];
    a.vx[i] = o.v ? o.v[0] : 0; a.vy[i] = o.v ? o.v[1] : 0; a.vz[i] = o.v ? o.v[2] : 0;
    a.life[i] = 0; a.max[i] = o.life || 1; a.s0[i] = o.s0 ?? 0.05; a.s1[i] = o.s1 ?? a.s0[i];
    const c0 = o.c0 || [1, 1, 1, 1], c1 = o.c1 || c0;
    a.r0[i] = c0[0]; a.g0[i] = c0[1]; a.b0[i] = c0[2]; a.a0[i] = c0[3]; a.r1[i] = c1[0]; a.g1[i] = c1[1]; a.b1[i] = c1[2]; a.a1[i] = c1[3];
    a.kind[i] = o.kind || 0; a.add[i] = o.add ? 1 : 0; a.under[i] = o.under ? 1 : 0; a.drag[i] = o.drag ?? 0.5; a.grav[i] = o.grav ?? 0;
    a.rot[i] = o.rot ?? Math.random() * TAU; a.rotv[i] = o.rotv ?? 0; a.lit[i] = o.lit ? 1 : 0; a.buoy[i] = o.buoy ? 1 : 0; a.nf[i] = o.nf ? 1 : 0;
  }
  kill(i) {
    const a = this.a, j = --this.n;
    if (i !== j) for (const k in a) a[k][i] = a[k][j];
  }
  step(dt, wind, water) {
    const a = this.a;
    for (let i = 0; i < this.n; i++) {
      a.life[i] += dt;
      if (a.life[i] >= a.max[i]) { this.kill(i); i--; continue; }
      const kd = Math.exp(-a.drag[i] * dt);
      a.vx[i] = a.vx[i] * kd + wind[0] * (1 - kd) * (a.add[i] ? 0.3 : 1);
      a.vz[i] = a.vz[i] * kd + wind[1] * (1 - kd) * (a.add[i] ? 0.3 : 1);
      a.vy[i] = a.vy[i] * kd - a.grav[i] * dt;
      a.x[i] += a.vx[i] * dt; a.y[i] += a.vy[i] * dt; a.z[i] += a.vz[i] * dt; a.rot[i] += a.rotv[i] * dt;
      if (a.buoy[i] && a.y[i] > water.height(a.x[i], a.z[i]) - 0.01) { this.kill(i); i--; continue; }
      if (a.grav[i] > 0 && !a.under[i] && inBlock(a.x[i], a.z[i]) && a.y[i] < water.ground(a.x[i], a.z[i])) { this.kill(i); i--; continue; }
    }
  }
  // pack into [under-alpha | alpha | additive]; returns counts
  pack(fireLight) {
    const a = this.a, o = this.out, lists = [[], [], []];
    for (let i = 0; i < this.n; i++) lists[a.under[i] ? 0 : a.add[i] ? 2 : 1].push(i);
    let w = 0;
    for (const L of lists) for (const i of L) {
      const t = a.life[i] / a.max[i], s = lerp(a.s0[i], a.s1[i], t);
      const fade = a.nf[i] ? 1 : Math.min(1, a.life[i] * 12) * (1 - smooth(0.6, 1, t));
      let r = lerp(a.r0[i], a.r1[i], t), g = lerp(a.g0[i], a.g1[i], t), bb = lerp(a.b0[i], a.b1[i], t);
      if (a.lit[i]) {   // smoke lit from below by the campfire
        const dx = a.x[i] - fireLight.p[0], dy = a.y[i] - fireLight.p[1], dz = a.z[i] - fireLight.p[2];
        const k = fireLight.i / (1 + (dx * dx + dy * dy + dz * dz) * 6) * 0.5;
        r = r * fireLight.amb[0] + k * 1.0; g = g * fireLight.amb[1] + k * 0.45; bb = bb * fireLight.amb[2] + k * 0.15;
      }
      o.set([a.x[i], a.y[i], a.z[i], s, r, g, bb, lerp(a.a0[i], a.a1[i], t) * fade, a.kind[i], a.rot[i], 0, 0], w * PF); w++;
    }
    return lists.map(l => l.length);
  }
}

// ───────────────────────── rigid bodies ─────────────────────────
const BODY = {
  ball: { r: 0.055, dens: 6.0, drag: 2.2, e: 0.25, fr: 0.25 },
  barrel: { r: 0.085, dens: 0.42, drag: 2.6, e: 0.3, fr: 0.4 },
  coin: { r: 0.04, dens: 3.5, drag: 5.5, e: 0.2, fr: 0.7 },
};
class Body {
  constructor(kind, node) { this.kind = kind; this.node = node; this.alive = false; Object.assign(this, BODY[kind]); }
  spawn(p, v) {
    this.alive = true; this.p = [...p]; this.v = [...v]; this.q = Q.id(); this.w = [0, 0, 0]; this.held = false;
    this.under = false; this.contact = false; this.sub = 0; this.age = 0; this.restT = 0;
    if (this.kind === 'barrel') this.q = Q.axis([0, 0, 1], PI / 2);
    if (this.kind === 'coin') this.w = [rr(-14, 14), rr(-4, 4), rr(-14, 14)];
  }
}

// ───────────────────────── ship (10-point buoyancy rigid body) ─────────────────────────
const SHIP_PROBES = [[0, -0.12, 0.84], [0, -0.12, 0.45], [0.2, -0.1, 0.05], [-0.2, -0.1, 0.05], [0, -0.12, -0.4], [0, -0.1, -0.76]];
class Ship {
  constructor() { this.reset(); }
  reset() {
    const [x, z] = LAYOUT.ship, [ax, az] = LAYOUT.anchor;
    this.yaw0 = Math.atan2(ax - x, az - z);
    this.pos = [x, WL, z]; this.vel = [0, 0, 0]; this.q = Q.axis([0, 1, 0], this.yaw0); this.w = [0, 0, 0];
    this.I = [0.22, 0.24, 0.12]; this.m = 1;
    this.drag = null; this.gunIdx = 0; this.recoil = 0; this.anchored = true; this.control = null;
    this.ropeLen = null;
  }
  toWorld(lp) { return vadd(this.pos, Q.rot(this.q, lp)); }
  toLocal(p) { return Q.rot(Q.conj(this.q), vsub(p, this.pos)); }
  applyImpulse(J, at) {
    this.vel = vmad(this.vel, J, 1 / this.m);
    const r = vsub(at, this.pos), t = vcross(r, J);
    this.w = vadd(this.w, this.invI(t));
  }
  invI(t) { const tl = Q.rot(Q.conj(this.q), t); return Q.rot(this.q, [tl[0] / this.I[0], tl[1] / this.I[1], tl[2] / this.I[2]]); }
  step(dt, water, gl, wind, anchorRing) {
    const F = vscale(gl, this.m); let T = [0, 0, 0];
    const up = vscale(vnorm(gl), -1), gmag = vlen(gl);
    const k = this.m * gmag / (SHIP_INFO.buoy.length * 0.08);
    const force = (f, at) => { F[0] += f[0]; F[1] += f[1]; F[2] += f[2]; T = vadd(T, vcross(vsub(at, this.pos), f)); };
    for (const bp of SHIP_INFO.buoy) {
      const p = this.toWorld(bp), h = water.height(p[0], p[2]), s = clamp(h - p[1], 0, 0.3);
      if (s > 0) {
        const vp = vadd(this.vel, vcross(this.w, vsub(p, this.pos)));
        force(vscale(up, k * s - 0.55 * vdot(vp, up)), p);
        water.pressure(p[0], p[2], 0.13, s * 0.45);
      }
      const g = water.ground(p[0], p[2]) + 0.0;
      if (p[1] - 0.12 < g) force(vscale(up, (g - p[1] + 0.12) * 40), p);
    }
    // shoals & beaches: the keel can't climb out of the water — push back along the slope
    for (const lp of SHIP_PROBES) {
      const p = this.toWorld(lp), g = water.ground(p[0], p[2]), pen = g - (WL - 0.16);
      if (pen <= 0) continue;
      const n = water.groundN(p[0], p[2]); let h = [n[0], 0, n[2]]; const hl = Math.hypot(h[0], h[2]);
      h = hl > 1e-4 ? vscale(h, 1 / hl) : vscale(vnorm([this.pos[0] - p[0], 0, this.pos[2] - p[2]]), 1);
      const vp = vadd(this.vel, vcross(this.w, vsub(p, this.pos))), vn = vdot(vp, h);
      force(vscale(h, pen * 60 - Math.min(vn, 0) * 6), [p[0], this.pos[1], p[2]]);
    }
    for (const [rx, rz, rr2] of this.rocks || []) {   // Skull Rock and sea stacks as round pillars
      if (Math.abs(rx - this.pos[0]) > 2 || Math.abs(rz - this.pos[2]) > 2) continue;
      for (const lp of SHIP_PROBES) {
        const p = this.toWorld(lp), dx = p[0] - rx, dz = p[2] - rz, d = Math.hypot(dx, dz);
        if (d < rr2 && d > 1e-4) { const h = [dx / d, 0, dz / d], vn = vdot(this.vel, h); force(vscale(h, (rr2 - d) * 60 - Math.min(vn, 0) * 6), [p[0], this.pos[1], p[2]]); }
      }
    }
    // waves push the hull downhill
    const sl = water.slope(this.pos[0], this.pos[2]);
    F[0] -= sl[0] * gmag * 0.6; F[2] -= sl[1] * gmag * 0.6;
    // breeze on the sails (center of effort aloft → heel)
    force([wind[0] * 0.32, 0, wind[1] * 0.32], this.toWorld([0, 0.75, 0.05]));
    // anisotropic hull drag (keel resists sideways motion)
    const vb = Q.rot(Q.conj(this.q), this.vel);
    const fb = Q.rot(this.q, [-vb[0] * 2.6, -vb[1] * 0.6, -vb[2] * 1.1]);
    F[0] += fb[0] - this.vel[0] * 0.5; F[1] += fb[1]; F[2] += fb[2] - this.vel[2] * 0.5;
    const wb = Q.rot(Q.conj(this.q), this.w);
    T = vadd(T, Q.rot(this.q, [-wb[0] * 0.25, -wb[1] * 0.35, -wb[2] * 0.2]));
    // helm: thrust along the keel, rudder turns the bow (more bite with way on)
    const C = this.control;
    if (C) {
      const fwd = Q.rot(this.q, [0, 0, 1]), sp = vdot(this.vel, fwd);
      const th = C.thrust > 0 ? C.thrust * C.power : C.thrust * C.reverse;
      F[0] += fwd[0] * th; F[2] += fwd[2] * th;
      const yaw = C.turn * C.rudder * (0.6 + Math.min(Math.abs(sp), 1.2)) * (sp < -0.05 ? -1 : 1);
      T = vadd(T, vscale(up, yaw));
      T = vadd(T, vscale(fwd, -C.turn * Math.min(Math.abs(sp), 1) * 0.015));         // a little heel into the turn
    }
    // ballast: the keel weight rights the hull (keeps her from turning turtle)
    T = vadd(T, vscale(vcross(Q.rot(this.q, [0, 1, 0]), up), 3.5));
    // elastic anchor rode from the bow hawse
    const hw = this.toWorld(SHIP_INFO.anchorHawse), d = vsub(hw, anchorRing), L = vlen(d);
    if (this.ropeLen === null) this.ropeLen = L * 0.985;
    this.rope = L / this.ropeLen;
    if (this.anchored && L > this.ropeLen) {
      const n = vscale(d, 1 / L), vh = vadd(this.vel, vcross(this.w, vsub(hw, this.pos)));
      force(vscale(n, -(L - this.ropeLen) * 6 - Math.max(vdot(vh, n), 0) * 3), hw);
    }
    // player towing
    if (this.drag) {
      const gp = this.toWorld(this.drag.local), dd = vsub(this.drag.target, gp); dd[1] = 0;
      const vg = vadd(this.vel, vcross(this.w, vsub(gp, this.pos)));
      force([dd[0] * 7 - vg[0] * 1.5, 0, dd[2] * 7 - vg[2] * 1.5], [gp[0], this.pos[1], gp[2]]);
    }
    // stay inside the jelly
    if (!INFINITE) for (const c of [0, 2]) {
      const lim = HALF - 0.45, o = this.pos[c];
      if (Math.abs(o) > lim) F[c] -= (o - Math.sign(o) * lim) * 20 + this.vel[c] * 2;
    }
    this.vel = vmad(this.vel, F, dt / this.m);
    this.w = vadd(this.w, vscale(this.invI(T), dt));
    this.pos = vmad(this.pos, this.vel, dt);
    this.q = Q.integ(this.q, this.w, dt);
    this.recoil *= Math.exp(-dt * 6);
  }
}

// chain: catenary-ish quadratic curve from hawse to anchor ring
function chainLinks(a, b, ground, n) {
  const mid = vlerp(a, b, 0.5), dist = vlen(vsub(a, b));
  const sag = Math.max(0.06, 1.25 - dist) * 0.55;
  const c = [mid[0], Math.max(mid[1] - sag, ground(mid[0], mid[2]) + 0.03), mid[2]];
  const out = [];
  const P = t => { const s = 1 - t; return [s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1], s * s * a[2] + 2 * s * t * c[2] + t * t * b[2]]; };
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, p = P(t), q = P(Math.min(t + 0.01, 1)), q0 = P(Math.max(t - 0.01, 0));
    let T = vnorm(vsub(q, q0)); const ref = Math.abs(T[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let X = vnorm(vcross(ref, T)), Y = vcross(T, X);
    if (i & 1) [X, Y] = [Y, vscale(X, -1)];
    out.push(M4.basis(X, Y, T, p));
  }
  return out;
}
