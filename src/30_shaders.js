
// ───────────────────────── WGSL ─────────────────────────
const WGSL_COMMON = /* wgsl */`
struct Uni {
  viewProj: mat4x4f, lightVP: mat4x4f, block: mat4x4f, invBlock: mat4x4f, invVP: mat4x4f,
  cam: vec4f, sun: vec4f, sunCol: vec4f, skyTop: vec4f, skyBot: vec4f, amb: vec4f,
  fire: vec4f, fireCol: vec4f, jAbs: vec4f, jCol: vec4f, deform: vec4f, misc: vec4f, misc2: vec4f,
  grid: vec4f, moon: vec4f, bg: vec4f, camR: vec4f, camU: vec4f, lamp: vec4f, misc3: vec4f,
  world: vec4f, swell: vec4f,   // world: half, terrain N, size, terrain dx · swell: amp, wavelength, speed, window fade cells
};
struct Node { m: mat4x4f, p: vec4f };
@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var hf: texture_2d<f32>;        // water window: eta, foam (grid = N, dx, origin xz)
@group(0) @binding(3) var terrTex: texture_2d<f32>;   // global terrain height

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn hash31(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(p0: vec2f) -> f32 { var p = p0; var s = 0.0; var a = 0.5; for (var i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2f(1.7, -3.1); a *= 0.5; } return s; }
fn deformP(p: vec3f) -> vec3f {
  let h = clamp(p.y / U.deform.w, 0.0, 1.8);
  let sq = U.deform.z;
  return vec3f(p.x * (1.0 + sq * 0.5) + U.deform.x * h, p.y * (1.0 - sq), p.z * (1.0 + sq * 0.5) + U.deform.y * h);
}
fn toWorld(lp: vec3f) -> vec3f { return (U.block * vec4f(deformP(lp), 1.0)).xyz; }
fn wLoad(i: vec2i) -> vec4f { let n = i32(U.grid.x) - 1; return textureLoad(hf, clamp(i, vec2i(0), vec2i(n)), 0); }
fn waterRaw(xz: vec2f) -> vec2f {
  let g = (xz - U.grid.zw) / U.grid.y - 0.5;
  let f0 = floor(g); let f = g - f0; let i = vec2i(f0);
  let s = mix(mix(wLoad(i), wLoad(i + vec2i(1, 0)), f.x), mix(wLoad(i + vec2i(0, 1)), wLoad(i + vec2i(1, 1)), f.x), f.y);
  var fade = 1.0;
  if (U.swell.w > 0.0) { let e = min(g, vec2f(U.grid.x - 1.0) - g); fade = smoothstep(0.0, U.swell.w, min(e.x, e.y)); }
  return s.xy * fade;
}
fn swellAt(xz: vec2f) -> f32 {
  if (U.swell.x <= 0.0) { return 0.0; }
  let k = 6.2831853 / U.swell.y; let t = U.cam.w * U.swell.z;
  return U.swell.x * (0.5 * sin(k * dot(xz, vec2f(0.8, 0.6)) + t) + 0.3 * sin(k * 1.37 * dot(xz, vec2f(-0.4, 0.92)) + 1.3 * t)
    + 0.2 * sin(k * 0.71 * dot(xz, vec2f(0.95, -0.3)) + 0.8 * t));
}
fn etaAt(xz: vec2f) -> f32 { return waterRaw(xz).x + swellAt(xz); }
fn foamAt(xz: vec2f) -> f32 { return waterRaw(xz).y; }
fn tLoad(i: vec2i) -> f32 { let n = i32(U.world.y) - 1; return textureLoad(terrTex, clamp(i, vec2i(0), vec2i(n)), 0).x; }
fn terrAt(xz: vec2f) -> f32 {
  let g = (xz + U.world.x) / U.world.w - 0.5;
  let f0 = floor(g); let f = g - f0; let i = vec2i(f0);
  return mix(mix(tLoad(i), tLoad(i + vec2i(1, 0)), f.x), mix(tLoad(i + vec2i(0, 1)), tLoad(i + vec2i(1, 1)), f.x), f.y);
}
fn waterH(xz: vec2f) -> f32 { return U.jAbs.w + etaAt(xz); }
fn caustic(p: vec2f, t: f32) -> f32 {
  let q = p * 1.9 - vec2f(250.0);
  var i = q; var c = 1.0; let inten = 0.005;
  for (var n = 0; n < 4; n++) {
    let tt = t * (1.0 - 3.5 / f32(n + 1));
    i = q + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2f(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 3.0);
}
fn skyCol(d: vec3f) -> vec3f {
  var c = mix(U.skyBot.rgb, U.skyTop.rgb, smoothstep(-0.05, 0.7, d.y));
  c += U.sunCol.rgb * U.sun.w * 0.08 * pow(max(dot(d, U.sun.xyz), 0.0), 8.0) * step(0.0, U.sun.y);
  return c;
}
`;

const WGSL_SHADOW_BIND = `
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSamp: sampler_comparison;
fn shadowF(wp: vec3f, n: vec3f) -> f32 {
  let lc = U.lightVP * vec4f(wp + n * 0.012, 1.0);
  let uv = vec2f(lc.x * 0.5 + 0.5, 0.5 - lc.y * 0.5);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || lc.z > 1.0) { return 1.0; }
  var s = 0.0; let ts = 1.0 / 2048.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    s += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2f(f32(x), f32(y)) * ts * 1.4, lc.z - 0.0012);
  } }
  return s / 9.0;
}
// main lighting model shared by props, terrain and floor
fn lightSurf(wp: vec3f, lp: vec3f, n: vec3f, alb: vec3f, mat: i32, w: f32, V: vec3f, inBlock: bool) -> vec3f {
  let L = U.sun.xyz; let ndl = dot(n, L);
  let sh = mix(1.0, shadowF(wp, n), U.sunCol.w);
  var sunC = U.sunCol.rgb * U.sun.w;
  var under = -1.0;
  if (inBlock) {
    under = waterH(lp.xz) - lp.y;
    if (under > 0.0) {
      sunC *= exp(-U.jAbs.rgb * under * 0.7);
      let ca = caustic(lp.xz + U.sun.xz * under * 0.6, U.cam.w * 0.55);
      sunC *= 0.45 + 1.9 * ca * exp(-under * 0.8);
    }
  }
  var diff = max(ndl, 0.0);
  if (mat == 2) { diff = max(ndl, 0.0) * 0.75 + max(-ndl, 0.0) * 0.5; }
  if (mat == 6) { diff = abs(ndl) * 0.7 + 0.25; }
  if (mat == 7) { diff = (ndl * 0.5 + 0.5); diff = diff * diff * 1.1; }
  var col = alb * sunC * diff * sh;
  // moon fill (cool) — always without shadow, weak
  col += alb * vec3f(0.55, 0.65, 1.0) * U.moon.w * max(dot(n, U.moon.xyz) * 0.6 + 0.4, 0.0) * 0.15;
  let hemi = mix(U.amb.rgb * vec3f(0.7, 0.62, 0.52), U.amb.rgb, n.y * 0.5 + 0.5);
  var ao = 1.0;
  if (under > 0.0) { ao = 0.85; }
  col += alb * hemi * ao;
  // campfire point light
  let fl = U.fire.xyz - wp; let fd = max(length(fl), 0.05);
  let fatt = U.fire.w / (1.0 + fd * fd * 7.0);
  var fdiff = max(dot(n, fl / fd), 0.0);
  if (mat == 2 || mat == 6) { fdiff = abs(dot(n, fl / fd)) * 0.8 + 0.2; }
  col += alb * U.fireCol.rgb * fatt * fdiff;
  // ship lantern
  let ll = U.lamp.xyz - wp; let ld = max(length(ll), 0.05);
  col += alb * vec3f(1.0, 0.65, 0.3) * U.lamp.w / (1.0 + ld * ld * 30.0) * max(dot(n, ll / ld) * 0.7 + 0.3, 0.0);
  // specular
  let H = normalize(L + V);
  var ks = 0.04; var pw = 24.0; var sc = vec3f(1.0);
  if (mat == 1) { ks = 0.9; pw = 70.0; sc = alb * 1.4 + 0.1; }
  if (mat == 7) { ks = 0.6; pw = 90.0; }
  if (mat == 9) { ks = 1.5; pw = 200.0; }
  if (mat == 10 || mat == 11) { ks = 1.4; pw = 140.0; }
  let spec = ks * pow(max(dot(n, H), 0.0), pw) * (pw + 8.0) / 25.0;
  col += sc * sunC * spec * sh * step(0.0, ndl);
  if (ks > 0.3) {
    let Hf = normalize(fl / fd + V);
    col += sc * U.fireCol.rgb * fatt * ks * pow(max(dot(n, Hf), 0.0), pw) * 2.0;
  }
  if (mat == 7) {   // candy jelly: subsurface + rim
    let fr = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += alb * (sunC * 0.18 + hemi * 0.3 + U.fireCol.rgb * fatt * 0.5) + fr * skyCol(reflect(-V, n)) * 0.35;
  }
  if (mat == 9) { let fr = pow(1.0 - max(dot(n, V), 0.0), 2.0); col = alb * fr * (hemi * 1.5 + sunC * 0.3) + col * 0.2; }
  if (mat == 3) { col += alb * U.fireCol.rgb * (0.6 + 0.9 * U.fireCol.w) * w * (1.0 + U.misc.x); }
  if (mat == 4) { col += vec3f(1.0, 0.52, 0.18) * w * (0.08 + 2.6 * U.misc.x) * (0.8 + 0.2 * U.fireCol.w); }
  return col;
}
`;

// ── props / ship / palms (node geometry) ──
const WGSL_NODES = WGSL_COMMON + `
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) col: vec3f, @location(3) ex: vec3f };
struct VOut {
  @builtin(position) clip: vec4f, @location(0) wp: vec3f, @location(1) lp: vec3f, @location(2) n: vec3f,
  @location(3) col: vec3f, @location(4) @interpolate(flat) mat: f32, @location(5) w: f32,
};
fn nodeXform(v: VIn) -> VOut {
  let nd = nodes[u32(v.ex.z + 0.5)];
  let t = U.cam.w; let mat = i32(v.ex.x + 0.5); let w = v.ex.y;
  var p = v.pos; var n = v.nrm;
  let bw = min(w, 1.0);
  p += nd.p.xyz * bw * bw;                                       // palm bending
  if (nd.p.w > 0.0) { p.x += U.misc2.z * sin(t * 1.3 + nd.p.w) * 0.018 * bw * bw; p.z += U.misc2.w * sin(t * 1.3 + nd.p.w) * 0.018 * bw * bw; }
  if (mat == 2 && w > 1.0) {
    let fl = w - 1.0;
    p.x += sin(t * 2.1 + p.y * 4.0 + p.z * 3.0) * 0.016 * fl;
    p.y += sin(t * 2.7 + p.x * 5.0) * 0.012 * fl;
    p.z += cos(t * 1.8 + p.x * 3.0) * 0.016 * fl;
  }
  if (mat == 6) { p.z += sin(t * 1.6 + p.y * 3.0 + p.x * 2.0) * 0.012 * w; }
  if (mat == 5) {
    let ph = w * 9.0 - t * 7.5;
    p.x += sin(ph) * 0.028 * w; p.y += sin(w * 4.0 - t * 5.0) * 0.008 * w;
    n = normalize(vec3f(1.0, 0.0, cos(ph) * 0.028 * 9.0 / 0.25 * w));
  }
  let lp = (nd.m * vec4f(p, 1.0)).xyz;
  let ln = normalize((nd.m * vec4f(n, 0.0)).xyz);
  var o: VOut;
  o.lp = lp; o.wp = toWorld(lp); o.n = normalize((U.block * vec4f(ln, 0.0)).xyz);
  o.col = v.col; o.mat = v.ex.x; o.w = w;
  o.clip = U.viewProj * vec4f(o.wp, 1.0);
  return o;
}
@vertex fn vsShadow(v: VIn) -> @builtin(position) vec4f { let o = nodeXform(v); return U.lightVP * vec4f(o.wp, 1.0); }
`;
const WGSL_NODES_MAIN = WGSL_NODES + WGSL_SHADOW_BIND + `
@vertex fn vs(v: VIn) -> VOut { return nodeXform(v); }
fn flagCol(uv: vec2f) -> vec3f {
  var c = vec3f(0.035, 0.03, 0.03);
  let p = (uv - vec2f(0.45, 0.48)) * vec2f(1.6, 1.0);
  let skull = length((p - vec2f(0.0, 0.07)) * vec2f(1.0, 1.1)) - 0.17;
  let jaw = max(abs(p.x) - 0.09, abs(p.y + 0.1) - 0.05);
  var shape = min(skull, jaw - 0.02);
  let e1 = length(p - vec2f(-0.065, 0.06)) - 0.045; let e2 = length(p - vec2f(0.065, 0.06)) - 0.045;
  let nose = length((p - vec2f(0.0, -0.02)) * vec2f(1.6, 1.0)) - 0.022;
  shape = max(shape, -min(min(e1, e2), nose));
  let teeth = max(abs(p.y + 0.11) - 0.03, abs(fract(p.x * 18.0) - 0.5) * 0.05 - 0.006);
  shape = max(shape, -max(teeth, abs(p.x) - 0.08));
  // crossbones
  let q = p + vec2f(0.0, 0.02);
  let r1 = vec2f(q.x * 0.707 - q.y * 0.707, q.x * 0.707 + q.y * 0.707);
  let r2 = vec2f(q.x * 0.707 + q.y * 0.707, -q.x * 0.707 + q.y * 0.707);
  var bones = 1e3;
  for (var k = 0; k < 2; k++) {
    var r = r1; if (k == 1) { r = r2; }
    let shaft = max(abs(r.x) - 0.36, abs(r.y) - 0.022);
    let k1 = length(vec2f(abs(r.x) - 0.37, abs(r.y) - 0.03)) - 0.035;
    bones = min(bones, min(shaft, k1));
  }
  shape = min(shape, max(bones, -(skull - 0.02)));
  c = mix(vec3f(0.95, 0.92, 0.85), c, smoothstep(-0.008, 0.008, shape));
  return c;
}
@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.mat + 0.5);
  var n = normalize(i.n); if (!ff) { n = -n; }
  var alb = i.col;
  if (mat == 5) { alb = flagCol(i.col.xy); }
  let V = normalize(U.cam.xyz - i.wp);
  var col = lightSurf(i.wp, i.lp, n, alb, mat, i.w, V, true);
  if (mat == 11) { col += alb * (0.6 + 0.8 * pow(max(sin(U.cam.w * 3.0 + i.lp.x * 90.0), 0.0), 20.0)); }
  return vec4f(col, distance(U.cam.xyz, i.wp));
}
`;

// ── terrain (heightfield + strata skirts) ──
const WGSL_TERRAIN = WGSL_COMMON + `
struct VOut { @builtin(position) clip: vec4f, @location(0) wp: vec3f, @location(1) lp: vec3f, @location(2) n: vec3f, @location(3) kind: f32 };
fn sideN(s: f32) -> vec3f {
  let k = i32(s + 0.5);
  if (k == 0) { return vec3f(1.0, 0.0, 0.0); } if (k == 1) { return vec3f(-1.0, 0.0, 0.0); }
  if (k == 2) { return vec3f(0.0, 0.0, 1.0); } return vec3f(0.0, 0.0, -1.0);
}
fn terrXform(v: vec4f) -> VOut {
  let xz = v.xy; let kind = v.z;
  let h = terrAt(xz);
  var lp = vec3f(xz.x, h, xz.y); var ln = vec3f(0.0, 1.0, 0.0);
  if (kind < 0.5) {
    let d = U.world.w;
    let hl = terrAt(xz - vec2f(d, 0.0)); let hr = terrAt(xz + vec2f(d, 0.0));
    let hd = terrAt(xz - vec2f(0.0, d)); let hu = terrAt(xz + vec2f(0.0, d));
    ln = normalize(vec3f(hl - hr, 2.0 * d, hd - hu));
  } else {
    ln = sideN(v.w);
    if (kind > 1.5) { lp.y = 0.0; }
  }
  var o: VOut;
  o.lp = lp; o.wp = toWorld(lp); o.n = normalize((U.block * vec4f(ln, 0.0)).xyz); o.kind = min(kind, 1.0);
  o.clip = U.viewProj * vec4f(o.wp, 1.0);
  return o;
}
@vertex fn vsShadow(@location(0) v: vec4f) -> @builtin(position) vec4f { let o = terrXform(v); return U.lightVP * vec4f(o.wp, 1.0); }
`;
const WGSL_TERRAIN_MAIN = WGSL_TERRAIN + WGSL_SHADOW_BIND + `
@vertex fn vs(@location(0) v: vec4f) -> VOut { return terrXform(v); }
fn strata(lp: vec3f, top: f32) -> vec3f {
  let wob = (fbm(vec2f(lp.x + lp.z, lp.y * 0.3) * 6.0) - 0.5) * 0.05;
  let y = lp.y + wob;
  var c = vec3f(0.24, 0.12, 0.07);                                           // chocolate bedrock
  c = mix(c, vec3f(0.3, 0.16, 0.09), smoothstep(0.0, 0.2, y) * 0.5 * vnoise(vec2f(lp.x + lp.z, y) * 30.0));
  c = mix(c, vec3f(0.74, 0.4, 0.15), smoothstep(0.19, 0.205, y));            // caramel clay
  c = mix(c, vec3f(0.66, 0.33, 0.11), smoothstep(0.26, 0.3, y) * smoothstep(0.36, 0.3, y) * 0.6);
  let shell = smoothstep(0.375, 0.385, y) * smoothstep(0.445, 0.435, y);    // shell band
  let sp = vnoise(vec2f(lp.x + lp.z, y) * 70.0);
  let shellC = mix(vec3f(0.97, 0.9, 0.84), vec3f(1.0, 0.72, 0.72), step(0.72, sp)) * (0.85 + 0.15 * step(0.3, sp));
  c = mix(c, shellC, shell);
  c = mix(c, vec3f(0.93, 0.83, 0.6) * (0.92 + 0.08 * vnoise(vec2f(lp.x + lp.z, y) * 50.0)), smoothstep(0.44, 0.455, y)); // vanilla sand
  let toTop = top - lp.y;
  if (top > U.jAbs.w + 0.16) { c = mix(c, vec3f(0.3, 0.55, 0.22), smoothstep(0.05, 0.015, toTop)); }
  return c;
}
fn surfaceCol(lp: vec3f, n: vec3f) -> vec3f {
  let WLv = U.jAbs.w; let h = lp.y;
  let nz = fbm(lp.xz * 7.0);
  var sand = vec3f(0.95, 0.85, 0.63) * (0.9 + 0.12 * nz);
  let rip = sin(lp.x * 38.0 + lp.z * 14.0 + 3.0 * fbm(lp.xz * 3.0));
  var sea = vec3f(0.9, 0.8, 0.58) * (0.88 + 0.06 * rip + 0.1 * nz);
  sea = mix(sea, vec3f(0.55, 0.62, 0.42), smoothstep(0.55, 0.8, fbm(lp.xz * 2.3 + 7.0)) * 0.5);
  var c = mix(sea, sand, smoothstep(WLv - 0.12, WLv - 0.02, h));
  c = mix(c, c * vec3f(0.78, 0.74, 0.68), smoothstep(WLv - 0.06, WLv, h) * smoothstep(WLv + 0.06, WLv + 0.01, h)); // wet sand
  let moss = mix(vec3f(0.22, 0.45, 0.16), vec3f(0.42, 0.62, 0.22), fbm(lp.xz * 9.0 + 3.0));
  let mossAmt = smoothstep(WLv + 0.15, WLv + 0.24, h + 0.05 * (nz - 0.5));
  c = mix(c, moss, mossAmt);
  let steep = smoothstep(0.55, 0.8, 1.0 - n.y) * step(WLv - 0.05, h);
  c = mix(c, vec3f(0.62, 0.4, 0.2) * (0.85 + 0.2 * nz), steep);
  // the X
  let xd = lp.xz - U.misc.zw;
  let r = length(xd);
  let a1 = abs(xd.x - xd.y) * 0.7071; let a2 = abs(xd.x + xd.y) * 0.7071;
  let xm = smoothstep(0.016, 0.008, min(a1, a2)) * smoothstep(0.1, 0.085, r);
  c = mix(c, vec3f(0.55, 0.32, 0.16), xm * 0.9);
  return c;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  var alb: vec3f;
  if (i.kind > 0.5) { alb = strata(i.lp, terrAt(i.lp.xz)); } else { alb = surfaceCol(i.lp, (U.invBlock * vec4f(n, 0.0)).xyz); }
  let V = normalize(U.cam.xyz - i.wp);
  var mat = 0; if (i.kind > 0.5 && i.lp.y < 0.2) { mat = 7; }
  let col = lightSurf(i.wp, i.lp, n, alb, mat, 0.0, V, true);
  return vec4f(col, distance(U.cam.xyz, i.wp));
}
`;

// ── backdrop + paper floor ──
const WGSL_BG = WGSL_COMMON + WGSL_SHADOW_BIND + `
struct BOut { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex fn vsBg(@builtin(vertex_index) vi: u32) -> BOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: BOut; o.clip = vec4f(p, 0.0, 1.0); o.ndc = p; return o;
}
fn viewDir(ndc: vec2f) -> vec3f {
  let a = U.invVP * vec4f(ndc, 0.0, 1.0); let b = U.invVP * vec4f(ndc, 1.0, 1.0);
  return normalize(b.xyz / b.w - a.xyz / a.w);
}
fn backdrop(ndc: vec2f) -> vec3f {
  let asp = U.misc2.x / U.misc2.y;
  let y = ndc.y * 0.5 + 0.5;
  var c = mix(U.bg.rgb, U.skyTop.rgb, smoothstep(0.25, 1.05, y));
  // warm glow where a low sun sits
  let sp = vec2f(-0.35 * asp, 0.55);
  let sg = exp(-length((ndc * vec2f(asp, 1.0)) - sp) * 1.6);
  c += U.sunCol.rgb * U.misc3.x * 0.16 * sg;
  // stars
  if (U.misc.y > 0.01) {
    let q = vec2f(ndc.x * asp, ndc.y) * 70.0;
    let cell = floor(q); let h = hash21(cell);
    if (h > 0.965) {
      let f = fract(q) - 0.5 - (vec2f(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.6;
      let tw = 0.55 + 0.45 * sin(U.cam.w * (0.7 + h * 3.0) + h * 40.0);
      c += vec3f(0.92, 0.94, 1.0) * smoothstep(0.09, 0.0, length(f)) * U.misc.y * tw * smoothstep(0.35, 0.8, y) * (h - 0.965) * 30.0;
    }
  }
  // moon, pinned to the upper left of the backdrop
  if (U.moon.w > 0.0) {
    let mp = vec2f(-0.58 * asp, 0.62);
    let md = length(ndc * vec2f(asp, 1.0) - mp);
    let crater = 0.82 + 0.18 * vnoise(ndc * 160.0);
    c = mix(c, vec3f(0.97, 0.95, 0.86) * crater * 1.25, smoothstep(0.062, 0.056, md) * U.moon.w);
    c += vec3f(0.45, 0.55, 0.9) * exp(-md * 7.0) * U.moon.w * 0.25;
  }
  return c;
}
@fragment fn fsBg(i: BOut) -> @location(0) vec4f { return vec4f(backdrop(i.ndc), 1e4); }
struct FOut { @builtin(position) clip: vec4f, @location(0) wp: vec3f };
@vertex fn vsFloor(@builtin(vertex_index) vi: u32) -> FOut {
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let p = vec3f(q[vi].x * 60.0, 0.0, q[vi].y * 60.0);
  var o: FOut; o.wp = p; o.clip = U.viewProj * vec4f(p, 1.0); return o;
}
fn boxHit(ro: vec3f, rd: vec3f, bmin: vec3f, bmax: vec3f) -> vec2f {
  let inv = 1.0 / rd; let t0 = (bmin - ro) * inv; let t1 = (bmax - ro) * inv;
  let tmin = min(t0, t1); let tmax = max(t0, t1);
  return vec2f(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
@fragment fn fsFloor(i: FOut) -> @location(0) vec4f {
  let wp = i.wp; let n = vec3f(0.0, 1.0, 0.0);
  let fib = fbm(wp.xz * 9.0) * 0.6 + fbm(wp.xz * vec2f(40.0, 3.0)) * 0.4;
  var alb = vec3f(0.93, 0.9, 0.85) * (0.94 + 0.06 * fib);
  let lp = (U.invBlock * vec4f(wp, 1.0)).xyz;
  // light through the jelly block: tint + caustics
  let ld = normalize((U.invBlock * vec4f(U.sun.xyz, 0.0)).xyz);
  let hit = boxHit(lp, ld, vec3f(-U.world.x, 0.0, -U.world.x), vec3f(U.world.x, U.jAbs.w, U.world.x));
  var sunC = U.sunCol.rgb * U.sun.w;
  let sh = mix(1.0, shadowF(wp, n), U.sunCol.w);
  if (hit.y > max(hit.x, 0.0)) {
    let len = hit.y - max(hit.x, 0.0);
    let ex = lp + ld * hit.y;
    let ca = caustic(ex.xz * 1.0, U.cam.w * 0.55);
    sunC *= mix(vec3f(1.0), exp(-U.jAbs.rgb * len * 0.6) * (0.3 + 1.5 * ca), smoothstep(0.0, 0.25, len));
  }
  var col = alb * sunC * max(n.y * U.sun.y, 0.0) * sh;
  col += alb * vec3f(0.55, 0.65, 1.0) * U.moon.w * 0.05;
  // contact shadow around the block foot
  let q = abs(lp.xz) - vec2f(U.world.x);
  let dd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
  let ao = 1.0 - 0.5 * exp(-max(dd, 0.0) * 5.0);
  col += alb * U.amb.rgb * ao;
  let fl = U.fire.xyz - wp; let fd = length(fl);
  col += alb * U.fireCol.rgb * U.fire.w / (1.0 + fd * fd * 7.0) * max(fl.y / fd, 0.0) * 0.6;
  let dist = length(wp.xz);
  let ndc = vec2f(i.clip.x / U.misc2.x * 2.0 - 1.0, 1.0 - i.clip.y / U.misc2.y * 2.0);
  col = mix(col, backdrop(ndc), smoothstep(7.0, 22.0, dist));
  return vec4f(col, distance(U.cam.xyz, wp));
}
`;

// ── jelly: ocean surface + cut walls (refractive) ──
const WGSL_JELLY = WGSL_COMMON + `
@group(1) @binding(0) var sceneTex: texture_2d<f32>;
@group(1) @binding(1) var linSamp: sampler;
struct JOut { @builtin(position) clip: vec4f, @location(0) wp: vec3f, @location(1) lp: vec3f, @location(2) n: vec3f, @location(3) kind: f32 };
fn sideN(s: f32) -> vec3f {
  let k = i32(s + 0.5);
  if (k == 0) { return vec3f(1.0, 0.0, 0.0); } if (k == 1) { return vec3f(-1.0, 0.0, 0.0); }
  if (k == 2) { return vec3f(0.0, 0.0, 1.0); } return vec3f(0.0, 0.0, -1.0);
}
@vertex fn vs(@location(0) v: vec4f) -> JOut {
  let xz = v.xy; let kind = v.z;
  var lp = vec3f(xz.x, U.jAbs.w + etaAt(xz), xz.y); var ln = vec3f(0.0, 1.0, 0.0);
  if (kind < 0.5) {
    let d = U.grid.y;
    let hl = etaAt(xz - vec2f(d, 0.0)); let hr = etaAt(xz + vec2f(d, 0.0));
    let hd = etaAt(xz - vec2f(0.0, d)); let hu = etaAt(xz + vec2f(0.0, d));
    ln = normalize(vec3f(hl - hr, 2.0 * d, hd - hu));
  } else {
    ln = sideN(v.w);
    lp += ln * 0.004;
    if (kind > 1.5) { lp.y = 0.0; }
  }
  var o: JOut;
  o.lp = lp; o.wp = toWorld(lp); o.n = normalize((U.block * vec4f(ln, 0.0)).xyz); o.kind = min(kind, 1.0);
  o.clip = U.viewProj * vec4f(o.wp, 1.0);
  return o;
}
fn proj(p: vec3f) -> vec2f { let c = U.viewProj * vec4f(p, 1.0); return vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5); }
@fragment fn fs(i: JOut) -> @location(0) vec4f {
  let V = normalize(U.cam.xyz - i.wp);
  let fragD = distance(U.cam.xyz, i.wp);
  var n = normalize(i.n);
  let isTop = i.kind < 0.5;
  let t = U.cam.w;
  // micro ripples on the jelly skin
  if (isTop) {
    let r = vec2f(fbm(i.lp.xz * 9.0 + vec2f(t * 0.25, 0.0)), fbm(i.lp.xz * 9.0 + vec2f(5.2, t * 0.21))) - 0.5;
    n = normalize(n + (U.block * vec4f(r.x, 0.0, r.y, 0.0)).xyz * 0.12);
  }
  let uv0 = i.clip.xy / U.misc2.xy;
  let s0 = textureSampleLevel(sceneTex, linSamp, uv0, 0.0);
  let th0 = clamp(s0.a - fragD, 0.0, 3.0);
  let off = (proj(i.wp - n * 0.35) - proj(i.wp)) * U.jCol.w * min(th0, 1.2);
  var s = textureSampleLevel(sceneTex, linSamp, uv0 + off, 0.0);
  if (s.a < fragD) { s = s0; }
  let th = clamp(s.a - fragD, 0.0, 6.0);
  let tr = exp(-U.jAbs.rgb * th);
  let sunC = U.sunCol.rgb * U.sun.w;
  let lit = U.amb.rgb * 0.9 + sunC * 0.35 + U.fireCol.rgb * U.fire.w * 0.05 + vec3f(0.4, 0.5, 0.8) * U.moon.w * 0.1;
  var col = s.rgb * tr + U.jCol.rgb * lit * (1.0 - tr);
  // god rays: sample the volume behind the skin, project to the surface along the sun
  let ld = normalize((U.invBlock * vec4f(U.sun.xyz, 0.0)).xyz);
  let lv = normalize((U.invBlock * vec4f(-V, 0.0)).xyz);
  var shaft = 0.0;
  for (var k = 1; k <= 5; k++) {
    let p = i.lp + lv * (min(th, 2.5) * f32(k) / 5.5);
    let up = (U.jAbs.w - p.y) / max(ld.y, 0.2);
    if (up > 0.0) { shaft += caustic((p.xz + ld.xz * up) * 0.8, t * 0.55) * exp(-up * 1.2); }
  }
  col += sunC * U.jCol.rgb * shaft * 0.06 * (1.0 - tr.g * 0.5) * step(0.0, U.sun.y);
  // fresnel reflection
  let R = reflect(-V, n);
  let cosT = max(dot(n, V), 0.0);
  var F = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
  var refl = skyCol(R);
  refl += sunC * pow(max(dot(R, U.sun.xyz), 0.0), 600.0) * 30.0 * step(0.0, U.sun.y);
  refl += vec3f(0.7, 0.8, 1.0) * U.moon.w * pow(max(dot(R, U.moon.xyz), 0.0), 400.0) * 18.0;
  let fl = U.fire.xyz - i.wp; let fd = length(fl);
  refl += U.fireCol.rgb * U.fire.w * pow(max(dot(R, fl / fd), 0.0), 120.0) * 10.0 / (1.0 + fd * fd * 0.5);
  let ll = U.lamp.xyz - i.wp; let lld = length(ll);
  refl += vec3f(1.0, 0.65, 0.3) * U.lamp.w * pow(max(dot(R, ll / lld), 0.0), 200.0) * 8.0;
  if (!isTop) { F *= 0.45; }
  col = mix(col, refl, F);
  // shoreline foam lace + splash foam
  if (isTop) {
    let depth = U.jAbs.w + etaAt(i.lp.xz) - terrAt(i.lp.xz);
    let lace = fbm(i.lp.xz * 22.0 + vec2f(t * 0.3, -t * 0.2));
    let band = smoothstep(0.07, 0.0, depth) * smoothstep(0.35, 0.65, lace + 0.25 * sin(depth * 120.0 - t * 2.0));
    let foam = clamp(band + foamAt(i.lp.xz) * smoothstep(0.4, 0.7, lace + 0.2), 0.0, 1.0);
    col = mix(col, vec3f(0.98, 0.98, 0.95) * (U.amb.rgb * 1.2 + sunC * 0.7 + U.fireCol.rgb * U.fire.w * 0.1), foam * 0.85);
  }
  // bright crescent rims on the cut edges
  let e = vec2f(U.world.x) - abs(i.lp.xz);
  var rim = 0.0;
  if (isTop) { rim = exp(-min(e.x, e.y) * 55.0); }
  else {
    let topY = U.jAbs.w + etaAt(i.lp.xz);
    rim = exp(-max(topY - i.lp.y, 0.0) * 70.0) * 0.8 + exp(-max(e.x, e.y) * 60.0) * 0.5;
  }
  let rimC = U.jCol.rgb * 0.3 + vec3f(0.7) * (U.amb.rgb + sunC * 0.6) + U.fireCol.rgb * U.fire.w * 0.15;
  col += rimC * rim * 0.9;
  return vec4f(col, 1.0);
}
`;

// ── particles (billboards) ──
const WGSL_PART = WGSL_COMMON + `
struct PIn { @location(0) ps: vec4f, @location(1) col: vec4f, @location(2) ex: vec4f };
struct POut { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f, @location(2) @interpolate(flat) kind: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, p: PIn) -> POut {
  let c = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let wp = toWorld(p.ps.xyz);
  let a = p.ex.y; let ca = cos(a); let sa = sin(a);
  let r = vec2f(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
  let w = wp + (U.camR.xyz * r.x + U.camU.xyz * r.y) * p.ps.w;
  var o: POut; o.clip = U.viewProj * vec4f(w, 1.0); o.uv = c; o.col = p.col; o.kind = p.ex.x;
  return o;
}
@fragment fn fs(i: POut) -> @location(0) vec4f {
  let d = length(i.uv);
  let k = i32(i.kind + 0.5);
  var a = 0.0;
  if (k == 0) { a = smoothstep(1.0, 0.2, d); a *= 0.75 + 0.25 * vnoise(i.uv * 3.0 + i.col.rg * 9.0); }
  else if (k == 1) { a = exp(-d * d * 5.0) + 0.6 * smoothstep(0.35, 0.0, d); }
  else if (k == 2) { a = exp(-d * d * 7.0) * 0.6 + max(0.0, 1.0 - abs(i.uv.x) * 14.0) * max(0.0, 1.0 - abs(i.uv.y)) + max(0.0, 1.0 - abs(i.uv.y) * 14.0) * max(0.0, 1.0 - abs(i.uv.x)); }
  else { a = smoothstep(1.0, 0.75, d) * (0.25 + 0.75 * smoothstep(0.55, 0.95, d)); }
  a = clamp(a, 0.0, 1.0) * i.col.a;
  return vec4f(i.col.rgb * a, a);
}
`;

// ── final composite ──
const WGSL_POST = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> P: vec4f;   // time, gamma flag, vignette, grain
struct O { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> O {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: O; o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o;
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
@fragment fn fs(i: O) -> @location(0) vec4f {
  var c = textureSampleLevel(src, samp, i.uv, 0.0).rgb;
  // tiny glow from bright pixels
  var g = vec3f(0.0);
  let px = 1.0 / vec2f(textureDimensions(src));
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.785398; let o = vec2f(cos(a), sin(a)) * px * 6.0;
    g += max(textureSampleLevel(src, samp, i.uv + o, 0.0).rgb - vec3f(1.2), vec3f(0.0));
    g += max(textureSampleLevel(src, samp, i.uv + o * 2.5, 0.0).rgb - vec3f(1.2), vec3f(0.0)) * 0.6;
  }
  c += g * 0.06;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3f(lum), c, 1.12), vec3f(0.0));
  c = aces(c * 0.92);
  let v = length(i.uv - 0.5);
  c *= 1.0 - P.z * smoothstep(0.35, 0.95, v);
  let gr = fract(sin(dot(i.uv * 1000.0 + P.x, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += gr * P.w;
  if (P.y > 0.5) { c = pow(c, vec3f(1.0 / 2.2)); }
  return vec4f(c, 1.0);
}
`;
