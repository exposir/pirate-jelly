
// ───────────────────────── app ─────────────────────────
const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const TEST = QS.has('test');
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
let REDUCED = mqReduce.matches || QS.has('reduced');
mqReduce.addEventListener?.('change', e => { REDUCED = e.matches; });

const CFG = () => Shell.cfg;
const lin = h => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));   // sRGB hex → linear
const fail = msg => Shell.fail(msg);
function flavourAt(i) {
  const L = CFG().flavours, f = L[clamp(i, 0, L.length - 1)];
  return { abs: lin(f.tint).map(t => -Math.log(Math.max(t, 0.004)) * f.density), col: lin(f.glow) };
}
function dayAt(t) {
  const K = CFG().day, n = K.length;
  if (n === 1) return dayKey(K[0], K[0], 0);
  const x = clamp(t, 0, 1) * (n - 1), i = Math.min(Math.floor(x), n - 2);
  return dayKey(K[i], K[i + 1], smooth(0, 1, x - i), K[Math.round(x)].name);
}
function dayKey(a, b, f, name = a.name) {
  const L = k => lerp(a[k], b[k], f), C = k => vlerp(lin(a[k]), lin(b[k]), f), lift = c => c.map(v => v * 1.3);
  return { sunEl: L('sunElevation'), sunAz: L('sunAzimuth'), sunI: L('sunIntensity'), sunC: C('sunColor'), bg: lift(C('backdrop')), top: lift(C('sky')),
    amb: C('ambient'), moon: L('moon'), night: L('night'), stars: L('stars'), fire: L('fire'), glow: L('glow'), name };
}

async function main() {
  const actions = {};
  let hooks = { onState() { }, onRebuild() { }, onConfig() { } };
  await Shell.mount({
    defaults: DEFAULT_CONFIG, actions, rebuild: ['scene', 'world'], panelDeps: ['flavours', 'day'],
    formatters: { dayName: v => dayAt(v / 1000).name },
    onState: (k, v) => hooks.onState(k, v), onRebuild: c => hooks.onRebuild(c), onConfig: (p, c) => hooks.onConfig(p, c),
  });
  setWorld(CFG().world); applySceneConfig(CFG().scene);
  const VOY = () => !!CFG().voyage?.enabled;
  if (!navigator.gpu) return fail();
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch (e) { }
  if (!adapter) return fail('浏览器支持 WebGPU，但没有拿到可用的<b>显卡适配器</b>。');
  let device;
  try { device = await adapter.requestDevice(); } catch (e) { return fail('显卡适配器拒绝创建设备：' + e.message); }
  device.lost.then(info => { console.error('[pirate-jelly] device lost', info.reason, info.message, performance.now().toFixed(0)); if (info.reason !== 'destroyed') fail('GPU 设备丢失（' + info.message + '），请刷新重试。'); });
  device.onuncapturederror = e => console.error('[pirate-jelly] GPU error:', e.error.message);

  const canvas = $('gl'), ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const HDR = 'rgba16float', DEPTH = 'depth32float', SHADOW = 2048;

  // ── world (rebuildable from config.scene) ──
  let grid = buildGridMesh(TN);
  let terrain = new Terrain(), water = new Water(terrain);
  const ship = new Ship(), parts = new Particles();
  const bodies = [];
  for (let i = 0; i < NODE.NBALL; i++) bodies.push(new Body('ball', NODE.BALL + i));
  for (let i = 0; i < NODE.NBARREL; i++) bodies.push(new Body('barrel', NODE.BARREL + i));
  for (let i = 0; i < NODE.NCOIN; i++) bodies.push(new Body('coin', NODE.COIN + i));
  const chest = { ang: 0, vel: 0, target: 0, open: false };
  let world, info, palms, statics;
  function makeWorld() {
    world = buildWorld(); info = world.info;
    palms = PALMS.map((P, i) => ({ ...P, base: [P.x, terrainFn(P.x, P.z) - 0.02, P.z], bend: [0, 0, 0], bv: [0, 0, 0], target: null, phase: 1 + i * 1.7 }));
    const C = LAYOUT.chest;
    statics = [...(info.rocks || []), ...(info.wreck || []),
      { c: vadd(info.chest.p, [0, 0.08, 0]), r: 0.16 }, { c: info.fire, r: 0.17 },
      { c: [C[0] + 0.42, T0(C[0] + 0.42, C[1] + 0.18) + 0.09, C[1] + 0.18], r: 0.14 }, { c: [C[0] + 0.52, T0(C[0] + 0.52, C[1] - 0.12) + 0.1, C[1] - 0.12], r: 0.15 },
      { c: [C[0] + 0.14, T0(C[0] + 0.14, C[1] + 0.28) + 0.05, C[1] + 0.28], r: 0.09 }];
  }
  makeWorld();

  // ── GPU resources ──
  const buf = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength + 3 & ~3), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  let nodeVB = buf(world.V, GPUBufferUsage.VERTEX), nodeIB = buf(world.I, GPUBufferUsage.INDEX);
  let gridVB = buf(grid.V, GPUBufferUsage.VERTEX), gridIB = buf(grid.I, GPUBufferUsage.INDEX);
  const UF = new Float32Array(172);
  const uniBuf = device.createBuffer({ size: UF.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const nodeF = new Float32Array(NODE_COUNT * 20);
  const nodeBuf = device.createBuffer({ size: nodeF.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const partBuf = device.createBuffer({ size: PCAP * PF * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const postF = new Float32Array(4);
  const postBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const texOf = (n, f) => device.createTexture({ size: [n, n], format: f, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let hfTex = texOf(GN, 'rgba32float'), terrTex = texOf(TN, 'r32float');
  const shadowTex = device.createTexture({ size: [SHADOW, SHADOW], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const linSamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const cmpSamp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, FR = GPUShaderStage.FRAGMENT;
  const bgl0 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
    { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
    { binding: 3, visibility: VF, texture: { sampleType: 'unfilterable-float' } }] });
  const bglShadow = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: FR, texture: { sampleType: 'depth' } },
    { binding: 1, visibility: FR, sampler: { type: 'comparison' } }] });
  const bglScene = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: FR, texture: { sampleType: 'float' } },
    { binding: 1, visibility: FR, sampler: { type: 'filtering' } }] });
  const bglPost = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: FR, texture: { sampleType: 'float' } },
    { binding: 1, visibility: FR, sampler: { type: 'filtering' } },
    { binding: 2, visibility: FR, buffer: { type: 'uniform' } }] });
  const makeBg0 = () => device.createBindGroup({ layout: bgl0, entries: [{ binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: nodeBuf } },
    { binding: 2, resource: hfTex.createView() }, { binding: 3, resource: terrTex.createView() }] });
  let bg0 = makeBg0();
  const bgShadow = device.createBindGroup({ layout: bglShadow, entries: [{ binding: 0, resource: shadowTex.createView() }, { binding: 1, resource: cmpSamp }] });
  const L0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });
  const L1 = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bglShadow] });
  const LJ = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bglScene] });
  const LP = device.createPipelineLayout({ bindGroupLayouts: [bglPost] });

  let shaderErrors = 0;
  const mod = async (code, label) => {
    const m = device.createShaderModule({ code, label });
    const ci = await m.getCompilationInfo();
    for (const msg of ci.messages) {
      const line = code.split('\n')[msg.lineNum - 1];
      console[msg.type === 'error' ? 'error' : 'warn'](`[pirate-jelly] WGSL ${label} ${msg.type} @${msg.lineNum}:${msg.linePos} ${msg.message}\n  ${line}`);
      if (msg.type === 'error') shaderErrors++;
    }
    return m;
  };
  const [mNodesSh, mNodes, mTerrSh, mTerr, mBg, mJelly, mPart, mPost] = await Promise.all([
    mod(WGSL_NODES, 'nodes-shadow'), mod(WGSL_NODES_MAIN, 'nodes'), mod(WGSL_TERRAIN, 'terrain-shadow'), mod(WGSL_TERRAIN_MAIN, 'terrain'),
    mod(WGSL_BG, 'backdrop'), mod(WGSL_JELLY, 'jelly'), mod(WGSL_PART, 'particles'), mod(WGSL_POST, 'post')]);
  if (shaderErrors) return fail('着色器编译失败，详情见控制台。');

  const nodeLayout = [{ arrayStride: 48, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'float32x3' }] }];
  const gridLayout = [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }];
  const partLayout = [{ arrayStride: PF * 4, stepMode: 'instance', attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] }];
  const depthW = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' };
  const shadowDS = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.5 };
  const P = (o) => device.createRenderPipeline(o);
  const pNodeSh = P({ layout: L0, vertex: { module: mNodesSh, entryPoint: 'vsShadow', buffers: nodeLayout }, fragment: { module: mNodesSh, entryPoint: 'fsShadow', targets: [] }, primitive: { cullMode: 'none' }, depthStencil: shadowDS });
  const pTerrSh = P({ layout: L0, vertex: { module: mTerrSh, entryPoint: 'vsShadow', buffers: gridLayout }, primitive: { cullMode: 'none' }, depthStencil: shadowDS });
  const tgtHDR = [{ format: HDR }];
  const pBg = P({ layout: L1, vertex: { module: mBg, entryPoint: 'vsBg' }, fragment: { module: mBg, entryPoint: 'fsBg', targets: tgtHDR }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' } });
  const pFloor = P({ layout: L1, vertex: { module: mBg, entryPoint: 'vsFloor' }, fragment: { module: mBg, entryPoint: 'fsFloor', targets: tgtHDR }, depthStencil: depthW });
  const pTerr = P({ layout: L1, vertex: { module: mTerr, entryPoint: 'vs', buffers: gridLayout }, fragment: { module: mTerr, entryPoint: 'fs', targets: tgtHDR }, primitive: { cullMode: 'none' }, depthStencil: depthW });
  const pNodes = P({ layout: L1, vertex: { module: mNodes, entryPoint: 'vs', buffers: nodeLayout }, fragment: { module: mNodes, entryPoint: 'fs', targets: tgtHDR }, primitive: { cullMode: 'none' }, depthStencil: depthW });
  const pJelly = P({ layout: LJ, vertex: { module: mJelly, entryPoint: 'vs', buffers: gridLayout }, fragment: { module: mJelly, entryPoint: 'fs', targets: tgtHDR }, primitive: { cullMode: 'back' }, depthStencil: depthW });
  const blendAlpha = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const blendAdd = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
  const partP = blend => P({ layout: L0, vertex: { module: mPart, entryPoint: 'vs', buffers: partLayout },
    fragment: { module: mPart, entryPoint: 'fs', targets: [{ format: HDR, blend, writeMask: GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE }] },
    primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less' } });
  const pPartA = partP(blendAlpha), pPartAdd = partP(blendAdd);
  const pPost = P({ layout: LP, vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format }] } });

  // ── size-dependent targets ──
  let W = 0, H = 0, sceneTex, hdr2, depthTex, bgScene, bgPost;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, TEST ? 1 : 2);
    const w = Math.max(2, Math.floor(canvas.clientWidth * dpr)), h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h;
    sceneTex?.destroy(); hdr2?.destroy(); depthTex?.destroy();
    sceneTex = device.createTexture({ size: [w, h], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    hdr2 = device.createTexture({ size: [w, h], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    depthTex = device.createTexture({ size: [w, h], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    bgScene = device.createBindGroup({ layout: bglScene, entries: [{ binding: 0, resource: sceneTex.createView() }, { binding: 1, resource: linSamp }] });
    bgPost = device.createBindGroup({ layout: bglPost, entries: [{ binding: 0, resource: hdr2.createView() }, { binding: 1, resource: linSamp }, { binding: 2, resource: { buffer: postBuf } }] });
  }

  // ── state ──
  const S = {
    time: 0, paused: false, flavour: Shell.state.flavour ?? 0, firm: (Shell.state.firmness ?? 62) / 100, damp: (Shell.state.damping ?? 30) / 100, day: (Shell.state.day ?? 80) / 1000,
    tilt: [0, 0], tiltV: [0, 0], tiltTarget: null, shear: [0, 0], shearV: [0, 0], squash: 0, squashV: 0,
    shots: 0, roar: 0, vig: 0, wind: [0, 0.3], fireFlick: 1,
    cam: { az: 0.78, el: 0.47, dist: 12.5, target: [0, 1.35, 0.1] },
  };
  const camHome = () => {
    const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight), c = CFG().camera;
    S.cam.az = c.azimuth; S.cam.el = c.elevation; S.cam.target = [...c.target];
    S.cam.dist = asp < 1 ? Math.min(c.distance / Math.max(asp, 0.45) * 0.9, 24) : c.distance;
    if (VOY()) {
      const v = CFG().voyage.camera, f = Q.rot(ship.q, [0, 0, 1]);
      S.camOff = 0; S.camHold = 0; S.followAz = Math.atan2(-f[0], -f[2]); S.cam.el = v.elevation;
      S.cam.dist = asp < 1 ? v.distance * 1.4 : v.distance; S.cam.target = null;
    }
  };
  camHome();
  let blockM = M4.id(), invBlockM = M4.id(), gLocal = [0, -G_BODY, 0];
  let view, projM, viewProj, invVP, camPos, camR, camU, camF;

  function computeBlock() {
    const [tx, tz] = S.tilt;
    const lift = HALF * (Math.abs(Math.sin(tx)) + Math.abs(Math.sin(tz)));
    const R = M4.mul(M4.RX(tx), M4.RZ(tz));
    blockM = M4.mul(M4.mul(M4.T(0, lift, 0), R), M4.T(-BC[0], 0, -BC[1]));
    invBlockM = M4.inv(blockM);
    gLocal = M4.xv(M4.inv(R), [0, -G_BODY, 0]);
  }
  function computeCamera() {
    const c = S.cam, ce = Math.cos(c.el);
    camPos = vadd(c.target, [c.dist * ce * Math.sin(c.az), c.dist * Math.sin(c.el), c.dist * ce * Math.cos(c.az)]);
    view = M4.lookAt(camPos, c.target, [0, 1, 0]);
    const asp = W / H;
    const fov = CFG().camera.fov; projM = M4.persp(asp < 1 ? fov * 1.1 : fov, asp, 0.1, 80);
    viewProj = M4.mul(projM, view); invVP = M4.inv(viewProj);
    camR = [view[0], view[4], view[8]]; camU = [view[1], view[5], view[9]]; camF = [-view[2], -view[6], -view[10]];
  }
  const local = p => M4.xp(invBlockM, p), worldP = p => M4.xp(blockM, p);

  // ── actions ──
  const sfxShake = (s) => { S.shearV[0] += rr(-1, 1) * s; S.shearV[1] += rr(-1, 1) * s; S.squashV += s * 0.6; };
  function freeBody(kind) {
    const list = bodies.filter(b => b.kind === kind);
    return list.find(b => !b.alive) || list.reduce((a, b) => (a.age > b.age ? a : b));
  }
  function fireCannon() {
    const toCam = vsub(local(camPos), ship.pos);
    const sideW = Q.rot(ship.q, [1, 0, 0]);
    const side = VOY() ? (ship.gunIdx % 2 ? 1 : -1) : vdot(sideW, toCam) >= 0 ? 1 : -1;
    const guns = SHIP_INFO.muzzles.filter(m => m.side === side);
    const g = guns[(VOY() ? ship.gunIdx++ >> 1 : ship.gunIdx++) % guns.length];
    const B = CFG().sim.bodies, mp = ship.toWorld(g.p), dir = vnorm(Q.rot(ship.q, [side, B.cannonElevation, 0.05]));
    const b = freeBody('ball'); b.spawn(mp, vadd(vscale(dir, B.cannonSpeed), ship.vel)); b.fromShip = 0.25;
    ship.applyImpulse(vscale(dir, -0.28), ship.toWorld([g.p[0], 0.25, g.p[2]]));
    ship.recoil = 1;
    S.shots++;
    const n = REDUCED ? 0.5 : 1;
    for (let i = 0; i < 8 * n; i++) parts.emit({ p: vmad(mp, dir, 0.02 * i), v: vmad(vscale(dir, rr(0.4, 1.4)), [rr(-.2, .2), rr(-.2, .2), rr(-.2, .2)], 1), life: rr(0.08, 0.16), s0: rr(0.07, 0.12), s1: 0.02, c0: [3, 2.2, 0.9, 1], c1: [2, 0.6, 0.1, 0.6], kind: 1, add: 1, drag: 4 });
    for (let i = 0; i < 16 * n; i++) parts.emit({ p: vmad(mp, dir, rr(0, 0.15)), v: vmad(vscale(dir, rr(0.3, 1.6)), [rr(-.15, .15), rr(0, .25), rr(-.15, .15)], 1), life: rr(1.8, 3.2), s0: rr(0.04, 0.07), s1: rr(0.2, 0.34), c0: [0.95, 0.94, 0.92, 0.75], c1: [0.9, 0.9, 0.9, 0], kind: 0, drag: 1.6, grav: -0.04, rotv: rr(-1, 1) });
    sfxShake(0.15);
  }
  function dropCoins(n, at) {
    for (let i = 0; i < n; i++) {
      const b = freeBody('coin');
      if (at) b.spawn(vadd(at, [rr(-0.03, 0.03), 0.04, rr(-0.03, 0.03)]), [rr(-0.5, 0.5), rr(2.2, 2.8), rr(-0.5, 0.5)]);
      else b.spawn([rr(-1.4, 2.1), WL + rr(0.7, 1.1), rr(-0.1, 2.1)], [0, 0, 0]);
    }
  }
  function dropBarrel() {
    const b = freeBody('barrel'); b.spawn([rr(-1.2, 2.0), WL + 0.9, rr(0.2, 2.1)], [0, 0, 0]); b.w = [rr(-2, 2), rr(-2, 2), 0];
  }
  function popX() {
    const x = LAYOUT.xmark[0] - ORIGIN[0], z = LAYOUT.xmark[1] - ORIGIN[1], y = water.ground(x, z);
    dropCoins(3, [x, y, z]);
    for (let i = 0; i < 26; i++) parts.emit({ p: [x + rr(-.05, .05), y + 0.02, z + rr(-.05, .05)], v: [rr(-.7, .7), rr(1, 2.2), rr(-.7, .7)], life: rr(0.5, 1), s0: rr(0.012, 0.025), s1: 0.03, c0: [0.92, 0.8, 0.58, 0.9], kind: 0, grav: 5, drag: 0.6 });
  }
  function roar() {
    S.roar = 1;
    for (let i = 0; i < 50; i++) parts.emit({ p: vadd(info.fire, [rr(-.05, .05), 0, rr(-.05, .05)]), v: [rr(-.6, .6), rr(1.2, 2.8), rr(-.6, .6)], life: rr(0.8, 1.8), s0: rr(0.008, 0.016), s1: 0.004, c0: [3, 1.6, 0.4, 1], c1: [2, 0.4, 0.05, 0.8], kind: 1, add: 1, drag: 1.2, grav: 1.2 });
  }
  function resetAll() {
    if (ORIGIN[0] || ORIGIN[1] || BC[0] || BC[1]) { hooks.onRebuild(CFG()); return; }
    terrain.reset(); water.reset(); ship.reset(); for (const b of bodies) b.alive = false; parts.n = 0;
    if (VOY()) camHome();
    chest.ang = chest.vel = chest.target = 0; chest.open = false; S.shots = 0; S.tilt = [0, 0]; S.tiltV = [0, 0];
    S.shear = [0, 0]; S.shearV = [0, 0]; S.squash = S.squashV = 0;
    for (const p of palms) { p.bend = [0, 0, 0]; p.bv = [0, 0, 0]; }
  }

  // ── simulation ──
  const DT = 1 / 120;
  let ptrWater = null;
  function stepBody(b, dt) {
    if (!b.alive) return;
    b.age += dt;
    if (b.held) { b.v = [0, 0, 0]; return; }
    const wasAbove = b.p[1] - b.r * 0.2 > water.height(b.p[0], b.p[2]);
    b.v = vmad(b.v, gLocal, dt);
    const h = water.height(b.p[0], b.p[2]);
    const f = clamp((h - (b.p[1] - b.r)) / (2 * b.r), 0, 1);
    b.sub = f;
    if (f > 0) {
      b.v = vmad(b.v, gLocal, -dt * f / b.dens);
      const kd = Math.exp(-b.drag * f * dt * (b.kind === 'ball' ? (b.v[1] < 0 ? 1 : 1) : 1));
      b.v = vscale(b.v, kd);
      if (b.kind === 'coin') { b.v[0] += Math.sin(b.age * 9 + b.node) * dt * 0.8; b.v[2] += Math.cos(b.age * 7 + b.node) * dt * 0.8; }
      if (b.kind === 'barrel' && f < 1) water.pressure(b.p[0], b.p[2], 0.1, f * 0.05);
      if (b.kind !== 'barrel' && b.p[1] < h - 0.05 && vlen(b.v) > 0.3 && Math.random() < dt * 14 * (REDUCED ? 0.4 : 1))
        parts.emit({ p: vadd(b.p, [rr(-.02, .02), 0.03, rr(-.02, .02)]), v: [rr(-.05, .05), rr(0.15, 0.3), rr(-.05, .05)], life: rr(1.5, 3), s0: rr(0.008, 0.016), kind: 3, c0: [0.85, 0.95, 1, 0.8], under: 1, buoy: 1, drag: 1 });
    }
    // water entry splash
    const nowBelow = b.p[1] - b.r * 0.2 <= h;
    if (wasAbove && nowBelow && b.v[1] < -0.6) {
      const s = Math.min(-b.v[1] * (b.kind === 'ball' ? 1 : 0.4), 5);
      water.splash(b.p[0], b.p[2], 0.07 + b.r * 0.5, 0.025 * s);
      const n = Math.floor((b.kind === 'ball' ? 22 : 9) * (REDUCED ? 0.5 : 1));
      for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = rr(0.3, 1) * s * 0.35;
        parts.emit({ p: [b.p[0], h + 0.01, b.p[2]], v: [Math.cos(a) * sp, rr(0.8, 2.2) * Math.min(s, 3) * 0.6, Math.sin(a) * sp], life: rr(0.5, 1.1), s0: rr(0.012, 0.03), s1: 0.01, c0: [0.93, 0.97, 1, 0.9], kind: 0, grav: 6, drag: 0.4 }); }
      for (let i = 0; i < n * 0.6; i++) parts.emit({ p: vadd(b.p, [rr(-.05, .05), rr(-.1, 0), rr(-.05, .05)]), v: [rr(-.2, .2), rr(0.1, 0.3), rr(-.2, .2)], life: rr(1, 2.5), s0: rr(0.008, 0.02), kind: 3, c0: [0.9, 0.97, 1, 0.9], under: 1, buoy: 1, drag: 1.5 });
      if (b.kind === 'ball') sfxShake(0.08);
    }
    b.p = vmad(b.p, b.v, dt);
    b.contact = false;
    // terrain
    const g = water.ground(b.p[0], b.p[2]);
    if (b.p[1] - b.r < g) {
      const n = water.groundN(b.p[0], b.p[2]), vn = vdot(b.v, n);
      b.p[1] = g + b.r;
      if (vn < 0) {
        const imp = -vn, under = b.p[1] < water.height(b.p[0], b.p[2]);
        if (b.kind === 'ball' && imp > 2.0 && !under) {
          water.crater(b.p[0], b.p[2], 0.08, 0.05);
          for (let i = 0; i < 24 * (REDUCED ? 0.5 : 1); i++) { const a = rnd() * TAU;
            parts.emit({ p: [b.p[0], g + 0.02, b.p[2]], v: [Math.cos(a) * rr(.2, .8), rr(0.8, 2.0), Math.sin(a) * rr(.2, .8)], life: rr(0.5, 1), s0: rr(0.012, 0.03), s1: 0.03, c0: [0.92, 0.8, 0.58, 0.95], kind: 0, grav: 5, drag: 0.7 }); }
          sfxShake(0.1);
        } else if (imp > 0.6 && under) {
          for (let i = 0; i < 8; i++) parts.emit({ p: [b.p[0], g + 0.02, b.p[2]], v: [rr(-.25, .25), rr(0.05, 0.2), rr(-.25, .25)], life: rr(1, 2), s0: 0.03, s1: 0.09, c0: [0.85, 0.75, 0.55, 0.35], c1: [0.85, 0.75, 0.55, 0], kind: 0, under: 1, drag: 2 });
        }
        b.v = vmad(b.v, n, -(1 + b.e) * vn);
      }
      const vt = vmad(b.v, n, -vdot(b.v, n));
      b.v = vmad(b.v, vt, -Math.min(1, b.fr * 12 * dt));
      b.contact = true; b.cn = n;
    }
    // walls of the block
    for (const c of [0, 2]) { const o = BC[c >> 1], d = b.p[c] - o; if (Math.abs(d) > HALF - b.r) { b.p[c] = o + Math.sign(d) * (HALF - b.r); if (b.v[c] * Math.sign(d) > 0) { b.v[c] *= -0.35; S.shearV[c ? 1 : 0] += b.v[c] * 0.02; } } }
    if (b.p[1] < b.r) { b.p[1] = b.r; b.v[1] = Math.abs(b.v[1]) * 0.2; }
    // skull rock (SDF)
    { const [sx, sy, sz] = info.skull.p, yaw = info.skull.yaw, c = Math.cos(-yaw), s = Math.sin(-yaw);
      const k = info.skull.s, dx = b.p[0] - sx, dz = b.p[2] - sz, lx = (c * dx + s * dz) / k, lz = (-s * dx + c * dz) / k, ly = (b.p[1] - sy) / k;
      if (Math.abs(lx) < 0.9 && ly < 1.4 && Math.abs(lz) < 0.9) {
        const d = skullSDF(lx, ly, lz, false) * k - b.r;
        if (d < 0) {
          const e = 0.01, gx = skullSDF(lx + e, ly, lz, false) - skullSDF(lx - e, ly, lz, false), gy = skullSDF(lx, ly + e, lz, false) - skullSDF(lx, ly - e, lz, false), gz = skullSDF(lx, ly, lz + e, false) - skullSDF(lx, ly, lz - e, false);
          const nl = vnorm([gx, gy, gz]), n = [c * nl[0] - s * nl[2], nl[1], s * nl[0] + c * nl[2]];
          b.p = vmad(b.p, n, -d); const vn = vdot(b.v, n); if (vn < 0) b.v = vmad(b.v, n, -(1 + b.e) * vn); b.contact = true; b.cn = n;
        }
      } }
    // props, rocks, palm trunks
    const pushSphere = (c, r) => {
      const d = vsub(b.p, c), L = vlen(d), m = r + b.r;
      if (L < m && L > 1e-5) { const n = vscale(d, 1 / L); b.p = vmad(c, n, m); const vn = vdot(b.v, n); if (vn < 0) b.v = vmad(b.v, n, -(1 + b.e) * vn); b.contact = true; b.cn = n; }
    };
    for (const s of statics) pushSphere(s.c, s.r);
    for (const pm of palms) {
      const a = pm.base, top = vadd(a, vadd(palmPath(pm, 1), pm.bend)), ab = vsub(top, a);
      const t = clamp(vdot(vsub(b.p, a), ab) / vdot(ab, ab), 0, 1);
      pushSphere(vmad(a, ab, t), 0.045);
    }
    // ship hull (ellipsoid in ship frame)
    if (b.fromShip > 0) b.fromShip -= dt;
    else {
      const lp = ship.toLocal(b.p), R = [0.25 + b.r, 0.3 + b.r, 0.82 + b.r];
      const q = [lp[0] / R[0], (lp[1] - 0.05) / R[1], lp[2] / R[2]], k = vlen(q);
      if (k < 1) {
        const nl = vnorm([q[0] / R[0], q[1] / R[1], q[2] / R[2]]), n = Q.rot(ship.q, nl);
        const pen = (1 - k) * Math.min(R[0], R[1]);
        b.p = vmad(b.p, n, pen);
        const vs = vadd(ship.vel, vcross(ship.w, vsub(b.p, ship.pos))), vr = vsub(b.v, vs), vn = vdot(vr, n);
        if (vn < 0) {
          const mb = b.kind === 'ball' ? 0.35 : b.kind === 'barrel' ? 0.12 : 0.02, J = -(1 + b.e) * vn * mb;
          b.v = vmad(b.v, n, J / mb * 0.9); ship.applyImpulse(vscale(n, -J), b.p);
        }
      }
    }
    // orientation
    let w = b.w;
    if (b.contact && b.cn) { const roll = vscale(vcross(b.cn, b.v), 1 / b.r); w = vlerp(w, roll, Math.min(1, dt * 20)); }
    if (b.kind === 'barrel') { const ax = Q.rot(b.q, [0, 1, 0]); w = vadd(w, vscale(vcross(ax, [0, -gLocal[1] > 0 ? 1 : 1, 0]), -ax[1] * 6 * dt * (f > 0 ? 1 : 0.3) * 10)); }
    if (b.kind === 'coin') {
      const nrm = Q.rot(b.q, [0, 1, 0]);
      if (b.contact) { const tgt = nrm[1] < 0 ? [0, -1, 0] : [0, 1, 0]; w = vadd(vscale(w, Math.exp(-dt * 12)), vscale(vcross(nrm, tgt), 18 * dt * 20)); }
      else if (f > 0) w = vscale(w, Math.exp(-dt * 1.5));
    }
    w = vscale(w, Math.exp(-dt * (f > 0 ? 1.5 : 0.2)));
    b.w = w; b.q = Q.integ(b.q, w, dt);
    if (b.kind === 'coin' && b.contact) b.v = vscale(b.v, Math.exp(-dt * 6));
  }
  function collideBodies() {
    const live = bodies.filter(b => b.alive && !b.held);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], d = vsub(b.p, a.p), L = vlen(d), m = a.r + b.r;
      if (L < m && L > 1e-5) {
        const n = vscale(d, 1 / L), ma = a.r ** 3 * a.dens, mb = b.r ** 3 * b.dens, k = (m - L) / (ma + mb);
        a.p = vmad(a.p, n, -k * mb); b.p = vmad(b.p, n, k * ma);
        const vn = vdot(vsub(b.v, a.v), n);
        if (vn < 0) { const J = -(1.3) * vn / (1 / ma + 1 / mb); a.v = vmad(a.v, n, -J / ma); b.v = vmad(b.v, n, J / mb); }
      }
    }
  }
  function simStep(dt) {
    G_BODY = CFG().sim.bodies.gravity;
    // block tilt springs → sloshing via local gravity
    const tk = 40, tc = 7;
    for (let k = 0; k < 2; k++) {
      const tgt = S.tiltTarget ? S.tiltTarget[k] : 0;
      const acc = (tgt - S.tilt[k]) * tk - S.tiltV[k] * tc;
      S.tiltV[k] += acc * dt; S.tilt[k] += S.tiltV[k] * dt;
      S.shearV[k === 0 ? 1 : 0] += (k === 0 ? 1 : -1) * acc * dt * 0.06 * (REDUCED ? 0.4 : 1);
    }
    computeBlock();
    // jelly wobble (shear + squash) springs
    const J = CFG().sim.jelly, K = lerp(J.wobbleSoft, J.wobbleFirm, S.firm), C = lerp(1.6, 6, S.firm);
    for (let k = 0; k < 2; k++) { S.shearV[k] += (-K * S.shear[k] - C * S.shearV[k]) * dt; S.shear[k] += S.shearV[k] * dt; }
    S.squashV += (-K * 1.4 * S.squash - C * S.squashV) * dt; S.squash += S.squashV * dt;
    S.shear = S.shear.map(v => clamp(v, -J.maxShear, J.maxShear)); S.squash = clamp(S.squash, -0.06, 0.06);
    // wind
    const Wd = CFG().sim.wind, Wv = CFG().sim.waves;
    const wa = Wd.swing * Math.sin(S.time * 0.07) + Wd.swing * 0.43 * Math.sin(S.time * 0.23 + 1);
    const wm = Wd.strength + Wd.gust * Math.sin(S.time * 0.13);
    S.wind = [Math.sin(wa) * wm, Math.cos(wa) * wm];
    // forces into the water
    if (ptrWater) water.pressure(ptrWater[0], ptrWater[1], 0.11, 0.09);
    if (!REDUCED && Math.random() < dt * Wv.ambientSwell) water.pressure(water.ox + rnd() * water.N * water.dx, water.oz + rnd() * water.N * water.dx, 0.2, rr(0.01, 0.025));
    water.time = S.time;
    const V = CFG().voyage;
    ship.anchored = !VOY();
    ship.control = VOY() ? { thrust: (keys.up ? 1 : 0) - (keys.down ? 1 : 0), turn: (keys.left ? 1 : 0) - (keys.right ? 1 : 0), power: V.thrust, reverse: V.reverse, rudder: V.turn } : null;
    ship.rocks = [[info.skull.p[0], info.skull.p[2], 0.62 * info.skull.s], ...chunkRocks()];
    ship.step(dt, water, gLocal, S.wind, info.anchorRing);
    water.follow(ship.pos[0], ship.pos[2]);
    if (INFINITE) {   // the block travels with the ship
      const nx = Math.round(ship.pos[0] / TDX) * TDX, nz = Math.round(ship.pos[2] / TDX) * TDX;
      if (nx !== BC[0] || nz !== BC[1]) { BC[0] = nx; BC[1] = nz; terrain.follow(); }
      if (Math.hypot(BC[0], BC[1]) > 512) rebase();
    }
    for (const b of bodies) stepBody(b, dt);
    collideBodies();
    const tension = lerp(Wv.tensionSoft, Wv.tensionFirm, S.firm);
    water.g = Wv.gravity;
    water.step(dt, gLocal[0] / G_BODY * water.g, gLocal[2] / G_BODY * water.g, lerp(Wv.dampingMin, Wv.dampingMax, S.damp), tension);
    // palms spring back
    for (const p of palms) {
      const tgt = p.target || [0, 0, 0];
      for (let k = 0; k < 3; k++) { p.bv[k] += ((tgt[k] - p.bend[k]) * 60 - p.bv[k] * 4) * dt; p.bend[k] += p.bv[k] * dt; }
    }
    // chest lid
    const la = (chest.target - chest.ang) * 90 - chest.vel * 5;
    chest.vel += la * dt; chest.ang += chest.vel * dt;
    if (chest.ang < 0) { chest.ang = 0; chest.vel = -chest.vel * 0.45; }
    if (chest.ang > 2.1) { chest.ang = 2.1; chest.vel = -chest.vel * 0.4; }
  }

  // ── per-frame effects ──
  function frameFX(dt, D) {
    const red = REDUCED ? 0.4 : 1;
    S.roar = Math.max(0, S.roar - dt * 0.45);
    S.fireFlick = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(S.time * 13.1) * Math.sin(S.time * 7.3 + 1)) + (REDUCED ? 0 : 0.1 * Math.sin(S.time * 23));
    const fp = info.fire, boost = 1 + S.roar * 2;
    const rate = (n) => { let k = n * dt * red; let c = Math.floor(k); if (Math.random() < k - c) c++; return c; };
    const FR = CFG().sim.fire;
    for (let i = rate(FR.flames * boost); i--;) parts.emit({ p: vadd(fp, [rr(-.05, .05), rr(-.04, 0), rr(-.05, .05)]), v: [rr(-.06, .06), rr(0.3, 0.55) * (1 + S.roar), rr(-.06, .06)], life: rr(0.35, 0.7), s0: rr(0.05, 0.08) * (1 + S.roar * 0.6), s1: 0.01, c0: [2.2, 1.1, 0.3, 0.9], c1: [1.4, 0.25, 0.05, 0.5], kind: 1, add: 1, drag: 0.8, grav: -0.3 });
    for (let i = rate(FR.embers * boost); i--;) parts.emit({ p: vadd(fp, [rr(-.04, .04), 0.05, rr(-.04, .04)]), v: [rr(-.15, .15), rr(0.4, 0.9), rr(-.15, .15)], life: rr(1.2, 2.6), s0: rr(0.006, 0.012), s1: 0.003, c0: [3, 1.5, 0.4, 1], c1: [2, 0.4, 0.05, 0.6], kind: 1, add: 1, drag: 0.6, grav: -0.05 });
    for (let i = rate(FR.smoke); i--;) parts.emit({ p: vadd(fp, [rr(-.04, .04), 0.18, rr(-.04, .04)]), v: [rr(-.03, .03), rr(0.18, 0.3), rr(-.03, .03)], life: rr(3, 5), s0: rr(0.04, 0.06), s1: rr(0.22, 0.34), c0: [0.42, 0.4, 0.38, 0.32], c1: [0.6, 0.6, 0.6, 0], kind: 0, drag: 0.25, grav: -0.03, lit: 1, rotv: rr(-.5, .5) });
    // chest glitter
    if (chest.ang > 0.6) for (let i = rate(10); i--;) {
      const c = info.chest.p; parts.emit({ p: vadd(c, [rr(-.1, .1), rr(0.14, 0.2), rr(-.08, .08)]), v: [0, rr(0.05, 0.15), 0], life: rr(0.5, 1.1), s0: rr(0.025, 0.045), s1: 0.0, c0: [2.5, 1.9, 0.8, 1], kind: 2, add: 1, drag: 1, rot: rr(0, 1) });
    }
    // fireflies at night
    if (D.night > 0.4 && info.bushes.length) for (let i = rate(5 * D.night); i--;) {
      const bp = info.bushes[Math.floor(Math.random() * info.bushes.length)];
      parts.emit({ p: vadd(bp, [rr(-.2, .2), rr(0, .2), rr(-.2, .2)]), v: [rr(-.08, .08), rr(-.02, .05), rr(-.08, .08)], life: rr(1.5, 3.5), s0: 0.03, s1: 0.03, c0: [1.2, 2.2, 0.4, 0.0], c1: [1.2, 2.2, 0.4, 1.0], kind: 1, add: 1, drag: 0.1 });
    }
    // light glows (one-frame sprites)
    const glow = (p, s, c) => parts.emit({ p, s0: s, life: 1e-4, c0: c, kind: 1, add: 1, nf: 1 });
    glow(vadd(fp, [0, 0.05, 0]), 0.36 * (0.8 + 0.2 * S.fireFlick) * (1 + S.roar * 0.5), [1.0, 0.42, 0.1, 0.2 + 0.35 * D.night]);
    if (D.night > 0.05) {
      for (const g of SHIP_INFO.glows) { const c = g.c; glow(ship.toWorld(g.p), g.s, [c[0], c[1], c[2], 0.5 * D.night]); }
      for (const e of info.skullEyes) glow(e, 0.13, [1, 0.5, 0.15, 0.18 * D.night * S.fireFlick]);
    }
  }

  // ── streamed chunks (infinite worlds) ──
  const chunks = new Map(), freeNodes = [];
  for (let i = NODE.NCHUNK; i--;) freeNodes.push(NODE.CHUNK + i);
  const chunkRocks = () => { const out = []; for (const c of chunks.values()) for (const r of c.rocks) out.push([r[0] - ORIGIN[0], r[1] - ORIGIN[1], r[2]]); return out; };
  function dropChunk(key) { const c = chunks.get(key); c.vb.destroy(); c.ib.destroy(); freeNodes.push(c.node); nodeF.fill(0, c.node * 20, c.node * 20 + 20); chunks.delete(key); }
  function dropAllChunks() { for (const k of [...chunks.keys()]) dropChunk(k); }
  function streamChunks(budgetMs) {
    if (!INFINITE) { if (chunks.size) dropAllChunks(); return; }
    const gx = BC[0] + ORIGIN[0], gz = BC[1] + ORIGIN[1], R = HALF + 1;
    const ci0 = Math.floor((gx - R) / CHUNK), ci1 = Math.floor((gx + R) / CHUNK), cj0 = Math.floor((gz - R) / CHUNK), cj1 = Math.floor((gz + R) / CHUNK);
    const want = [];
    for (let i = ci0; i <= ci1; i++) for (let j = cj0; j <= cj1; j++) want.push([i, j, Math.hypot((i + 0.5) * CHUNK - gx, (j + 0.5) * CHUNK - gz)]);
    const keep = new Set(want.map(([i, j]) => i * 100003 + j));
    for (const k of [...chunks.keys()]) if (!keep.has(k)) dropChunk(k);
    want.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    for (const [i, j] of want) {
      const key = i * 100003 + j; if (chunks.has(key) || !freeNodes.length) continue;
      const d = chunkDesc(i, j), node = freeNodes.pop(), g = buildChunk(d, node);
      chunks.set(key, { node, x0: d.x0, z0: d.z0, count: g.I.length, vb: buf(g.V.length ? g.V : new Float32Array(12), GPUBufferUsage.VERTEX), ib: buf(g.I.length ? g.I : new Uint32Array(3), GPUBufferUsage.INDEX), rocks: g.rocks });
      if (performance.now() - t0 > budgetMs) break;
    }
  }
  function drawChunks(p) { for (const c of chunks.values()) if (c.count) { p.setVertexBuffer(0, c.vb); p.setIndexBuffer(c.ib, 'uint32'); p.drawIndexed(c.count); } }
  // floating origin: keep simulation coordinates small however far she sails
  function rebase() {
    const q = TDX * 64, dx = Math.round(BC[0] / q) * q, dz = Math.round(BC[1] / q) * q;
    ORIGIN[0] += dx; ORIGIN[1] += dz;
    const sh = p => { if (p) { p[0] -= dx; p[2] -= dz; } };
    sh(ship.pos); for (const b of bodies) if (b.alive) sh(b.p);
    for (let i = 0; i < parts.n; i++) { parts.a.x[i] -= dx; parts.a.z[i] -= dz; }
    BC[0] -= dx; BC[1] -= dz; terrain.ox -= dx; terrain.oz -= dz; water.ox -= dx; water.oz -= dz;
    new Set([info.fire, info.chest.p, info.anchorRing, info.skull.p, ...info.skullEyes, ...info.bushes, ...statics.map(s => s.c)]).forEach(sh);
    for (const p of palms) sh(p.base);
    if (ptrWater) { ptrWater[0] -= dx; ptrWater[1] -= dz; }
  }

  // ── uniforms & node matrices ──
  function updateNodes() {
    const put = (i, m, p = [0, 0, 0, 0]) => { nodeF.set(m, i * 20); nodeF.set(p, i * 20 + 16); };
    const zero = new Float32Array(16);
    put(0, M4.T(-ORIGIN[0], 0, -ORIGIN[1]));
    for (const ch of chunks.values()) put(ch.node, M4.T(ch.x0 - ORIGIN[0], 0, ch.z0 - ORIGIN[1]));
    put(NODE.SHIP, Q.mat(ship.q, ship.pos));
    const c = info.chest;
    put(NODE.LID, M4.mul(M4.mul(M4.mul(M4.T(c.p[0], c.p[1], c.p[2]), M4.RY(c.yaw)), M4.T(0, c.h, -c.d / 2)), M4.RX(-chest.ang)));
    for (let i = 0; i < NODE.NPALM; i++) put(NODE.PALM + i, zero);
    palms.forEach((p, i) => put(NODE.PALM + i, M4.T(...p.base), [p.bend[0], p.bend[1], p.bend[2], p.phase]));
    const links = chainLinks(ship.toWorld(SHIP_INFO.anchorHawse), info.anchorRing, (x, z) => water.ground(x, z), NODE.NCHAIN);
    links.forEach((m, i) => put(NODE.CHAIN + i, ship.anchored ? m : zero));
    for (const b of bodies) put(b.node, b.alive ? Q.mat(b.q, b.p) : zero);
    device.queue.writeBuffer(nodeBuf, 0, nodeF);
  }
  function updateUniforms(D) {
    const fl = flavourAt(S.flavour);
    UF.set(viewProj, 0);
    // key light: sun by day, moon by night
    const el = D.sunEl * PI / 180, az = D.sunAz * PI / 180;
    let key = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)], keyI = D.sunI, keyC = D.sunC;
    const moonDir = vnorm([-0.55, 0.75, -0.4]);
    if (D.sunEl < 1) { const k = smooth(1, -8, D.sunEl); key = vnorm(vlerp(key, moonDir, k)); key[1] = Math.max(key[1], 0.15); keyI = lerp(D.sunI, 0.12 * D.moon, k); keyC = vlerp(D.sunC, [0.55, 0.65, 1], k); }
    key = vnorm(key);
    const c = VOY() ? S.cam.target : [0, 1.2, 0.2], lv = M4.lookAt(vmad(c, key, 14), c, Math.abs(key[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]);
    UF.set(M4.mul(M4.ortho(-5.2, 5.2, -5.2, 5.2, 1, 30), lv), 16);
    UF.set(blockM, 32); UF.set(invBlockM, 48); UF.set(invVP, 64);
    let o = 80; const v4 = (a, b, cc, d) => { UF[o++] = a; UF[o++] = b; UF[o++] = cc; UF[o++] = d; };
    v4(camPos[0], camPos[1], camPos[2], S.time);
    v4(key[0], key[1], key[2], keyI);
    v4(keyC[0], keyC[1], keyC[2], lerp(1, 0.55, D.night));
    v4(...D.top, 0); v4(...D.bg, 0); v4(...D.amb, 0);
    const fw = worldP(vadd(info.fire, [0, 0.06, 0])), fi = D.fire * S.fireFlick * (1 + S.roar * 1.5);
    v4(fw[0], fw[1], fw[2], fi);
    v4(1.0, 0.5, 0.18, S.fireFlick - 0.75);
    v4(fl.abs[0], fl.abs[1], fl.abs[2], WL);
    v4(fl.col[0], fl.col[1], fl.col[2], 0.9);
    v4(S.shear[0], S.shear[1], S.squash, WL + 0.3);
    v4(D.night, D.stars, LAYOUT.xmark[0] - ORIGIN[0], LAYOUT.xmark[1] - ORIGIN[1]);
    v4(W, H, S.wind[0] * 3, S.wind[1] * 3 * (REDUCED ? 0.4 : 1));
    v4(GN, GDX, water.ox, water.oz);
    v4(moonDir[0], moonDir[1], moonDir[2], D.moon);
    v4(...D.bg, 0);
    v4(...camR, 0); v4(...camU, 0);
    const lw = worldP(ship.toWorld(vadd(SHIP_INFO.glows[0].p, [0, 0, 0])));
    v4(lw[0], lw[1], lw[2], D.night * 0.5);
    v4(D.glow, 0, 0, 0);
    v4(HALF, TN, BLOCK, TDX);
    v4(SWELL.amp, SWELL.length, SWELL.speed, SWELL.fade);
    v4(BC[0], BC[1], 0, 0);
    device.queue.writeBuffer(uniBuf, 0, UF);
  }

  // ── picking ──
  function rayAt(px, py) {
    const r = canvas.getBoundingClientRect(), nx = (px - r.left) / r.width * 2 - 1, ny = 1 - (py - r.top) / r.height * 2;
    const a = M4.xp4(invVP, [nx, ny, 0]), b = M4.xp4(invVP, [nx, ny, 1]);
    const ro = local(a), rd = vnorm(vsub(local(b), ro));
    return { ro, rd, wro: a, wrd: vnorm(vsub(b, a)) };
  }
  const raySphere = (ro, rd, c, r) => { const oc = vsub(ro, c), b = vdot(oc, rd), q = vdot(oc, oc) - r * r, h = b * b - q; if (h < 0) return Infinity; const t = -b - Math.sqrt(h); return t > 0 ? t : Infinity; };
  const rayBox = (ro, rd, mn, mx) => {
    let t0 = -Infinity, t1 = Infinity, face = -1;
    for (let k = 0; k < 3; k++) { const inv = 1 / rd[k]; let a = (mn[k] - ro[k]) * inv, b = (mx[k] - ro[k]) * inv; if (a > b) [a, b] = [b, a]; if (a > t0) { t0 = a; face = k; } t1 = Math.min(t1, b); }
    return t1 >= t0 && t0 > 0 ? { t: t0, face } : null;
  };
  function pick(px, py) {
    const { ro, rd } = rayAt(px, py);
    let best = { t: Infinity, kind: 'orbit' };
    const cand = (t, kind, extra) => { if (t < best.t) best = { t, kind, ...extra }; };
    // terrain blocker (ray march)
    let tTerr = Infinity;
    { const bx = rayBox(ro, rd, [BC[0] - HALF, 0, BC[1] - HALF], [BC[0] + HALF, 3, BC[1] + HALF]); let t = bx ? bx.t : 0;
      for (let i = 0; i < 700 && t < 40; i++) { const p = vmad(ro, rd, t); if (!inBlock(p[0], p[2], -0.01)) { if (i > 3) break; } else if (p[1] < water.ground(p[0], p[2])) { tTerr = t; break; } t += 0.02; } }
    for (const b of bodies) if (b.alive) cand(raySphere(ro, rd, b.p, b.r * 1.8 + 0.02), 'body', { body: b });
    { const lr = Q.rot(Q.conj(ship.q), rd), lo = ship.toLocal(ro);
      const h1 = rayBox(lo, lr, [-0.27, -0.2, -0.82], [0.27, 0.4, 0.85]), h2 = rayBox(lo, lr, [-0.38, 0.4, -0.6], [0.38, 1.7, 0.6]);
      if (h1) cand(h1.t, 'ship', { hp: vmad(ro, rd, h1.t) }); if (h2) cand(h2.t + 0.01, 'ship', { hp: vmad(ro, rd, h2.t) }); }
    cand(raySphere(ro, rd, vadd(info.chest.p, [0, 0.08, 0]), 0.19), 'chest');
    cand(raySphere(ro, rd, vadd(info.fire, [0, 0.02, 0]), 0.22), 'fire');
    { const [x, z] = LAYOUT.xmark; cand(raySphere(ro, rd, [x, water.ground(x, z), z], 0.14), 'x'); }
    palms.forEach((p, i) => {
      for (let k = 0; k <= 5; k++) cand(raySphere(ro, rd, vadd(p.base, vadd(palmPath(p, k / 5), vscale(p.bend, (k / 5) ** 2))), k === 5 ? 0.24 : 0.07), 'palm', { palm: p });
    });
    // water surface / block sides
    const top = rayBox(ro, rd, [BC[0] - HALF, 0, BC[1] - HALF], [BC[0] + HALF, WL, BC[1] + HALF]);
    if (top) {
      if (top.face === 1) { const p = vmad(ro, rd, top.t); if (water.ground(p[0], p[2]) < WL) cand(top.t, 'water', { hp: p }); }
      else if (!VOY()) cand(top.t, 'tilt', { hp: vmad(ro, rd, top.t) });
    }
    if (tTerr < best.t - 0.05) best = { t: tTerr, kind: 'orbit' };
    return best;
  }
  const planeHit = (ro, rd, p0, n) => { const d = vdot(rd, n); if (Math.abs(d) < 1e-5) return null; const t = vdot(vsub(p0, ro), n) / d; return t > 0 ? vmad(ro, rd, t) : null; };

  // ── helm & follow camera ──
  const keys = { up: false, down: false, left: false, right: false };
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  addEventListener('keydown', e => { const k = KEYMAP[e.code]; if (k && VOY() && !typing(e)) { keys[k] = true; e.preventDefault(); } });
  addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  const zoomRange = () => VOY() ? [1.6, 14] : [5, 24];
  function orbit(dx, dy) {
    if (VOY()) { S.camOff -= dx * 0.006; S.camHold = 2.5; } else S.cam.az -= dx * 0.006;
    S.cam.el = clamp(S.cam.el + dy * 0.005, 0.1, 1.3);
  }
  function followCamera(dt) {
    const f = Q.rot(ship.q, [0, 0, 1]), heading = Math.atan2(-f[0], -f[2]);
    const lag = 1 - Math.exp(-dt * CFG().voyage.camera.lag);
    let d = heading - S.followAz; d = Math.atan2(Math.sin(d), Math.cos(d));
    S.followAz += d * lag;
    S.camHold = Math.max(0, (S.camHold || 0) - dt);
    if (!S.camHold && vlen(ship.vel) > 0.15) S.camOff *= Math.exp(-dt * 0.6);
    S.cam.az = S.followAz + S.camOff;
    const tgt = worldP(vadd(ship.pos, [0, 0.45, 0]));
    S.cam.target = S.cam.target ? vlerp(S.cam.target, tgt, 1 - Math.exp(-dt * 6)) : tgt;
  }
  // on-screen helm for touch screens
  if (VOY()) {
    const pad = document.createElement('div'); pad.id = 'dpad'; pad.className = 'ui';
    pad.innerHTML = '<button data-k="up" aria-label="前进">▲</button><button data-k="left" aria-label="左转">◀</button><button data-k="down" aria-label="后退">▼</button><button data-k="right" aria-label="右转">▶</button>';
    document.body.appendChild(pad);
    pad.querySelectorAll('button').forEach(b => {
      const set = v => e => { e.preventDefault(); keys[b.dataset.k] = v; b.classList.toggle('on', v); };
      b.addEventListener('pointerdown', set(true)); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, set(false));
    });
  }

  // ── input ──
  const pointers = new Map();
  let act = null, pinch = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      if (act) endAct(true);
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;
    const pk = e.button === 2 ? { kind: 'orbit' } : pick(e.clientX, e.clientY);
    act = { ...pk, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false };
    if (act.kind === 'body') { act.body.held = true; act.plane = act.body.p; act.last = [...act.body.p]; act.vel = [0, 0, 0]; }
    if (act.kind === 'ship') { const { ro, rd } = rayAt(e.clientX, e.clientY), wp = planeHit(ro, rd, [0, WL, 0], [0, 1, 0]) || ship.pos; act.local = ship.toLocal([wp[0], ship.pos[1], wp[2]]); act.local[1] = 0; }
    if (act.kind === 'water') ptrWater = [act.hp[0], act.hp[2]];
    if (act.kind === 'tilt') { act.tilt0 = [...S.tilt]; S.tiltTarget = [...S.tilt]; }
    if (act.kind === 'palm') act.palm.target = [...act.palm.bend];
    canvas.classList.add('grabbing');
  });
  canvas.addEventListener('pointermove', e => {
    const pp = pointers.get(e.pointerId);
    if (pp) { pp.x = e.clientX; pp.y = e.clientY; }
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      S.cam.dist = clamp(S.cam.dist * pinch.d / Math.max(d, 1), ...zoomRange());
      orbit(mx - pinch.mx, my - pinch.my);
      pinch = { d, mx, my }; return;
    }
    if (!act || act.id !== e.pointerId) { if (!pointers.size && e.pointerType === 'mouse') hover(e); return; }
    const dx = e.clientX - act.x, dy = e.clientY - act.y;
    act.x = e.clientX; act.y = e.clientY;
    if (Math.hypot(e.clientX - act.x0, e.clientY - act.y0) > 5) act.moved = true;
    const { ro, rd } = rayAt(e.clientX, e.clientY);
    switch (act.kind) {
      case 'orbit': orbit(dx, dy); break;
      case 'body': {
        const n = vnorm(M4.xv(invBlockM, camF)), hp = planeHit(ro, rd, act.plane, n);
        if (hp) { hp[0] = clamp(hp[0], BC[0] - HALF + 0.1, BC[0] + HALF - 0.1); hp[2] = clamp(hp[2], BC[1] - HALF + 0.1, BC[1] + HALF - 0.1); hp[1] = Math.max(hp[1], water.ground(hp[0], hp[2]) + act.body.r); act.body.p = hp; }
        break;
      }
      case 'ship': { const hp = planeHit(ro, rd, [0, WL, 0], [0, 1, 0]); if (hp && act.moved) ship.drag = { local: act.local, target: hp }; break; }
      case 'water': { const hp = planeHit(ro, rd, [0, WL, 0], [0, 1, 0]); ptrWater = hp && inBlock(hp[0], hp[2]) ? [hp[0], hp[2]] : null; break; }
      case 'tilt': {
        const tx = act.x - act.x0, ty = act.y - act.y0;
        const rx = [camR[0], camR[2]], fz = vnorm([camF[0], 0, camF[2]]);
        const wx = rx[0] * tx - fz[0] * ty, wz = rx[1] * tx - fz[2] * ty;
        S.tiltTarget = [clamp(act.tilt0[0] + wz * 0.0018, -0.22, 0.22), clamp(act.tilt0[1] - wx * 0.0018, -0.22, 0.22)];
        break;
      }
      case 'palm': {
        const p = act.palm, top = vadd(p.base, palmPath(p, 1)), n = vnorm(M4.xv(invBlockM, camF)), hp = planeHit(ro, rd, top, n);
        if (hp) { let d = vsub(hp, top); d[1] *= 0.3; const L = vlen(d); if (L > 0.55) d = vscale(d, 0.55 / L); p.target = d; }
        break;
      }
      default: if (act.moved) orbit(dx, dy);
    }
  });
  function endAct(cancel) {
    if (!act) return;
    const quick = !act.moved && performance.now() - act.t0 < 450 && !cancel;
    switch (act.kind) {
      case 'body': { const b = act.body; b.held = false; const v = act.vel; const L = vlen(v); b.v = L > 7 ? vscale(v, 7 / L) : v; break; }
      case 'ship': ship.drag = null; if (quick) fireCannon(); break;
      case 'water': ptrWater = null; break;
      case 'tilt': S.tiltTarget = null; break;
      case 'palm': act.palm.target = null; break;
      case 'chest': if (quick) { chest.open = !chest.open; chest.target = chest.open ? 1.95 : 0; chest.vel += chest.open ? 4 : -2; } break;
      case 'fire': if (quick) roar(); break;
      case 'x': if (quick) popX(); break;
    }
    act = null; canvas.classList.remove('grabbing');
  }
  const up = e => {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) { pinch = null; return; }
    if (act && act.id === e.pointerId) endAct(false);
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch = null; endAct(true); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.cam.dist = clamp(S.cam.dist * Math.exp(e.deltaY * 0.0012), ...zoomRange()); }, { passive: false });
  let hoverT = 0;
  function hover(e) {
    const now = performance.now(); if (now - hoverT < 60) return; hoverT = now;
    const k = pick(e.clientX, e.clientY).kind;
    canvas.classList.toggle('pointer', k !== 'orbit');
  }
  addEventListener('keydown', e => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); fireCannon(); }
  });

  // ── UI (panel is generated by the shell from config.panel) ──
  Object.assign(actions, {
    fire: () => fireCannon(),
    coins: () => dropCoins(Math.max(1, Math.round(CFG().sim.bodies.coinsPerDrop))),
    barrel: () => dropBarrel(),
    reset: () => resetAll(),
    view: () => camHome(),
    pause: () => {
      S.paused = !S.paused; Shell.buttonLabel('pause', S.paused ? '继续' : '暂停');
      Shell.status(S.paused ? 'paused' : 'live', S.paused ? 'WebGPU · 已暂停' : 'WebGPU · 实时');
    },
  });
  hooks = {
    onState(k, v) {
      if (k === 'flavour') S.flavour = v; else if (k === 'firmness') S.firm = v / 100;
      else if (k === 'damping') S.damp = v / 100; else if (k === 'day') S.day = v / 1000;
    },
    onRebuild(c) {
      setWorld(c.world); applySceneConfig(c.scene);
      ORIGIN[0] = ORIGIN[1] = 0; BC[0] = BC[1] = 0; dropAllChunks();
      makeWorld();
      terrain = new Terrain(); water = new Water(terrain);
      for (const b of [nodeVB, nodeIB, gridVB, gridIB, hfTex, terrTex]) b.destroy();
      nodeVB = buf(world.V, GPUBufferUsage.VERTEX); nodeIB = buf(world.I, GPUBufferUsage.INDEX);
      grid = buildGridMesh(TN); gridVB = buf(grid.V, GPUBufferUsage.VERTEX); gridIB = buf(grid.I, GPUBufferUsage.INDEX);
      hfTex = texOf(GN, 'rgba32float'); terrTex = texOf(TN, 'r32float'); bg0 = makeBg0();
      ship.reset(); for (const b of bodies) b.alive = false; parts.n = 0; camHome();
      chest.ang = chest.vel = chest.target = 0; chest.open = false;
      Object.assign(pj, { info, palms, water, terrain });
    },
    onConfig(path) { if (path === '*' || path.startsWith('camera') || path.startsWith('voyage')) camHome(); },
  };

  // small console handle for tinkering
  const project = lp => { const c = M4.xp4(viewProj, worldP(lp)), r = canvas.getBoundingClientRect(); return [r.left + (c[0] * 0.5 + 0.5) * r.width, r.top + (0.5 - c[1] * 0.5) * r.height]; };
  const pj = window.pirateJelly = { state: S, ship, water, bodies, info, palms, fire: fireCannon, coins: dropCoins, barrel: dropBarrel, roar, popX, chest, project };
  // ── frame loop ──
  let last = performance.now(), acc = 0, frame = 0, dark = null, vigSm = 0;
  Shell.status('live', 'WebGPU · 实时');
  if (QS.has('t')) Shell.setState('day', Math.round(+QS.get('t') * 1000));
  function render() {
    resize();
    const now = performance.now();
    let dt = Math.min((now - last) / 1000, 1 / 20); last = now;
    if (TEST) dt = 1 / 60;
    const D = dayAt(S.day);
    if (!S.paused) {
      S.time += dt; acc += dt;
      let steps = 0;
      while (acc >= DT && steps < 4) { simStep(DT); acc -= DT; steps++; }
      if (steps === 4) acc = 0;
      frameFX(dt, D);
      parts.step(dt, S.wind, water);
      if (act && act.kind === 'body') { const b = act.body; act.vel = vlerp(act.vel, vscale(vsub(b.p, act.last), 1 / dt), 0.5); act.last = [...b.p]; }
    } else { parts.step(0, S.wind, water); }
    const E = water.finishFrame(dt);
    streamChunks(TEST ? 50 : 5);
    computeBlock(); if (VOY()) followCamera(dt); computeCamera();
    updateUniforms(D); updateNodes();
    device.queue.writeTexture({ texture: hfTex }, water.tex, { bytesPerRow: GN * 16 }, [GN, GN]);
    if (terrain.dirty) { device.queue.writeTexture({ texture: terrTex }, terrain.h, { bytesPerRow: TN * 4 }, [TN, TN]); terrain.dirty = false; }
    const counts = parts.pack({ p: info.fire, i: D.fire * (1 + S.roar) * 1.4, amb: vadd(D.amb, vscale(D.sunC, D.sunI * 0.12)) });
    const total = counts[0] + counts[1] + counts[2];
    if (total) device.queue.writeBuffer(partBuf, 0, parts.out, 0, total * PF);

    const enc = device.createCommandEncoder();
    { const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setBindGroup(0, bg0);
      p.setPipeline(pNodeSh); p.setVertexBuffer(0, nodeVB); p.setIndexBuffer(nodeIB, 'uint32'); p.drawIndexed(world.I.length);
      drawChunks(p);
      p.setPipeline(pTerrSh); p.setVertexBuffer(0, gridVB); p.setIndexBuffer(gridIB, 'uint32'); p.drawIndexed(grid.I.length);
      p.end(); }
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: sceneTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1e4 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setBindGroup(0, bg0); p.setBindGroup(1, bgShadow);
      p.setPipeline(pBg); p.draw(3);
      p.setPipeline(pFloor); p.draw(6);
      p.setPipeline(pTerr); p.setVertexBuffer(0, gridVB); p.setIndexBuffer(gridIB, 'uint32'); p.drawIndexed(grid.I.length);
      p.setPipeline(pNodes); p.setVertexBuffer(0, nodeVB); p.setIndexBuffer(nodeIB, 'uint32'); p.drawIndexed(world.I.length);
      drawChunks(p);
      if (counts[0]) { p.setPipeline(pPartA); p.setVertexBuffer(0, partBuf); p.draw(4, counts[0], 0, 0); }
      p.end(); }
    enc.copyTextureToTexture({ texture: sceneTex }, { texture: hdr2 }, [W, H]);
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: hdr2.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: depthTex.createView(), depthLoadOp: 'load', depthStoreOp: 'store' } });
      p.setBindGroup(0, bg0); p.setBindGroup(1, bgScene);
      p.setPipeline(pJelly); p.setVertexBuffer(0, gridVB); p.setIndexBuffer(gridIB, 'uint32'); p.drawIndexed(grid.I.length);
      if (counts[1]) { p.setPipeline(pPartA); p.setVertexBuffer(0, partBuf); p.draw(4, counts[1], 0, counts[0]); }
      if (counts[2]) { p.setPipeline(pPartAdd); p.setVertexBuffer(0, partBuf); p.draw(4, counts[2], 0, counts[0] + counts[1]); }
      p.end(); }
    postF[0] = S.time % 100; postF[1] = format.endsWith('-srgb') ? 0 : 1; postF[2] = 0.22 + 0.15 * D.night; postF[3] = 0.012;
    device.queue.writeBuffer(postBuf, 0, postF);
    { const p = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      p.setPipeline(pPost); p.setBindGroup(0, bgPost); p.draw(3); p.end(); }
    device.queue.submit([enc.finish()]);

    // UI readouts
    if (++frame % 8 === 0) {
      let kin = 0, afloat = 0, sunk = 0;
      for (const b of bodies) if (b.alive) {
        kin += vdot(b.v, b.v);
        const h = water.height(b.p[0], b.p[2]);
        if (b.sub > 0.05 && b.sub < 0.98 && b.p[1] > h - b.r * 1.5) afloat++;
        else if (b.p[1] + b.r < h - 0.02 && vlen(b.v) < 0.4) sunk++;
      }
      const vig = clamp(Math.sqrt(E / (GN * GN)) * 6 * (VOY() ? 0.5 : 1) + Math.sqrt(kin) * 0.06 + vlen(ship.vel) * 0.8 + Math.hypot(...S.shear) * 4, 0, 1);
      vigSm = lerp(vigSm, vig, 0.35);
      Shell.meter('vigour', vigSm, vigSm < 0.12 ? '平静' : vigSm < 0.35 ? '活跃' : vigSm < 0.65 ? '起伏' : '风暴');
      Shell.count('shots', S.shots); Shell.count('afloat', afloat); Shell.count('sunk', sunk);
      { const sp = vlen([ship.vel[0], 0, ship.vel[2]]); Shell.meter('speed', sp / 1.3, (sp * 8).toFixed(1) + ' 节'); }
      if (INFINITE) Shell.count('distance', Math.round(Math.hypot(ship.pos[0] + ORIGIN[0] - LAYOUT.ship[0], ship.pos[2] + ORIGIN[1] - LAYOUT.ship[1]) * 10));
      const isDark = D.night > CFG().theme.darkAt;
      if (isDark !== dark) { dark = isDark; Shell.setDark(isDark); }
    }
    if (TEST && frame === (+QS.get('frames') || 90)) { document.title = 'READY'; console.log('[pirate-jelly] test frames done; verts', world.V.length / VSTRIDE, 'tris', world.I.length / 3, 'build', info.buildMs.toFixed(0) + 'ms'); }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
main().catch(e => { console.error(e); fail('果冻凝固时出了点问题：' + e.message); });
