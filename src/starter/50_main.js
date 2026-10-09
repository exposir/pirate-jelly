
// ───────────────────────── Starter study · scene ─────────────────────────
// The minimal contract with the shell: mount it, register actions, react to state, report readouts.
const WGSL = /* wgsl */`
struct U { res: vec4f, col: vec4f, p: vec4f };   // res.xy, time | jelly rgb | wobble, night, size, bg
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0; return vec4f(p, 0.0, 1.0);
}
fn sdf(p: vec3f) -> f32 {
  let t = u.res.z; let w = u.p.x;
  let q = p * vec3f(1.0 + 0.25 * w * sin(t * 9.0), 1.0 - 0.25 * w * sin(t * 9.0), 1.0 + 0.25 * w * sin(t * 9.0));
  return length(q) - u.p.z + 0.04 * sin(p.x * 5.0 + t) * sin(p.y * 5.0 - t * 1.3) * sin(p.z * 5.0);
}
fn nrm(p: vec3f) -> vec3f { let e = vec2f(0.002, 0.0);
  return normalize(vec3f(sdf(p + e.xyy) - sdf(p - e.xyy), sdf(p + e.yxy) - sdf(p - e.yxy), sdf(p + e.yyx) - sdf(p - e.yyx))); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = (fc.xy - 0.5 * u.res.xy) / u.res.y * vec2f(1.0, -1.0);
  let bgc = mix(vec3f(0.93, 0.9, 0.85), vec3f(0.05, 0.07, 0.13), u.p.y) * (1.0 - 0.3 * length(uv));
  let ro = vec3f(0.0, 0.3, 4.8); let rd = normalize(vec3f(uv - vec2f(0.0, 0.08), -1.5));
  var t = 0.0; var hit = false;
  for (var i = 0; i < 90; i++) { let d = sdf(ro + rd * t); if (d < 0.001) { hit = true; break; } t += d; if (t > 8.0) { break; } }
  var c = bgc;
  // contact shadow on the floor
  let fy = -u.p.z * 1.02; let ft = (fy - ro.y) / rd.y;
  if (ft > 0.0 && (!hit || ft < t)) { let fp = ro + rd * ft; c = mix(c, c * mix(vec3f(0.55), u.col.rgb, 0.5), exp(-length(fp.xz) * 1.6)); }
  if (hit) {
    let p = ro + rd * t; let n = nrm(p); let l = normalize(vec3f(-0.5, 0.8, 0.4));
    let fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    let thick = exp(-max(dot(-n, rd), 0.0) * 1.5);
    let body = u.col.rgb * (0.35 + 0.65 * max(dot(n, l), 0.0)) * mix(1.0, 0.35, u.p.y);
    c = mix(body, bgc * u.col.rgb * 1.6, thick * 0.45);
    c += vec3f(1.0) * pow(max(dot(reflect(rd, n), l), 0.0), 60.0) * 0.8 + fres * mix(vec3f(0.9), vec3f(0.4, 0.5, 0.9), u.p.y) * 0.5;
  }
  return vec4f(pow(c, vec3f(1.0 / 1.1)), 1.0);
}`;

async function main() {
  const actions = {};
  const st = { wob: 0, wv: 0, pokes: 0, paused: false, t: 0 };
  await Shell.mount({ defaults: DEFAULT_CONFIG, actions, panelDeps: ['flavours'], onState: () => { } });
  const cfg = () => Shell.cfg;
  const poke = () => { st.wv += 3; st.pokes++; Shell.count('pokes', st.pokes); };
  Object.assign(actions, {
    poke,
    pause: () => { st.paused = !st.paused; Shell.buttonLabel('pause', st.paused ? '继续' : '暂停'); Shell.status(st.paused ? 'paused' : 'live', st.paused ? 'WebGPU · 已暂停' : 'WebGPU · 实时'); },
  });
  if (!navigator.gpu) return Shell.fail();
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return Shell.fail('浏览器支持 WebGPU，但没有拿到可用的显卡适配器。');
  const device = await adapter.requestDevice();
  const canvas = document.getElementById('gl'), ctx = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const mod = device.createShaderModule({ code: WGSL });
  const pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] } });
  const ub = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
  canvas.addEventListener('pointerdown', poke);
  addEventListener('keydown', e => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); poke(); } });
  Shell.status('live', 'WebGPU · 实时');
  const lin = h => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 1.0));
  let last = performance.now(), dark = null;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const c = cfg(), s = Shell.state, k = c.sim.wobbleSoft + (c.sim.wobbleFirm - c.sim.wobbleSoft) * s.firmness / 100;
    if (!st.paused) { st.t += dt; st.wv += (-k * st.wob - 1.5 * st.wv) * dt; st.wob += st.wv * dt; }
    const night = s.night / 100, col = lin(c.flavours[Math.min(s.flavour, c.flavours.length - 1)].color);
    device.queue.writeBuffer(ub, 0, new Float32Array([w, h, st.t, 0, ...col, 1, Math.min(Math.abs(st.wob), 1), night, c.sim.size, 0]));
    const enc = device.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
    device.queue.submit([enc.finish()]);
    Shell.meter('wobble', Math.abs(st.wob) * 2, Math.abs(st.wob) < 0.05 ? '静止' : '晃动中');
    const isDark = night > c.theme.darkAt; if (isDark !== dark) { dark = isDark; Shell.setDark(isDark); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch(e => { console.error(e); Shell.fail('出了点问题：' + e.message); });
