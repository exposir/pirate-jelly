
// ───────────────────────── Material Studies · shell ─────────────────────────
// A config-driven page shell shared by every study: masthead, status pill, glass control
// panel, how-to footer, fallback card, light/dark theme and a live configuration editor.
// A study supplies DEFAULT_CONFIG plus actions / formatters / hooks via Shell.mount().
const Shell = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  function merge(base, over) {                     // deep merge; arrays are replaced wholesale
    if (over === undefined) return clone(base);
    if (!isObj(base) || !isObj(over)) return clone(over);
    const o = clone(base);
    for (const k in over) o[k] = k in base ? merge(base[k], over[k]) : clone(over[k]);
    return o;
  }
  function diff(base, cur) {                       // the minimal override that turns base into cur
    if (isObj(base) && isObj(cur)) {
      const o = {}; let any = false;
      for (const k in cur) { const d = diff(base[k], cur[k]); if (d !== undefined) { o[k] = d; any = true; } }
      return any ? o : undefined;
    }
    return JSON.stringify(base) === JSON.stringify(cur) ? undefined : clone(cur);
  }
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgba = (h, a) => `rgba(${rgb(h).join(',')},${a})`;
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

  const LABELS = {
    meta: '元信息', id: '标识', title: '标题', ui: '界面文字', eyebrow: '眉线', lede: '简介', howto: '玩法', howtoDetail: '玩法说明',
    fallbackTitle: '备用卡片标题', fallbackText: '备用卡片正文', theme: '主题', fonts: '字体', serif: '衬线体', sans: '无衬线体', mono: '等宽体',
    light: '浅色主题', dark: '深色主题', bg: '背景', ink: '主文字', ink2: '次文字', ink3: '弱文字', accent: '强调色', accent2: '强调色 2', glass: '玻璃底色',
    darkAt: '深色切换点', panel: '控制面板', tag: '角标', items: '控件', type: '类型', buttons: '按钮', action: '动作', label: '文字', primary: '主按钮',
    counts: '计数', bind: '绑定', source: '数据源', min: '最小值', max: '最大值', format: '格式', state: '初始状态', flavour: '风味', firmness: '硬度',
    damping: '波浪阻尼', day: '一天时间', flavours: '果冻风味', name: '名称', swatch: '色块', tint: '透射色', glow: '散射色', density: '浓度',
    sunElevation: '太阳高度 °', sunAzimuth: '太阳方位 °', sunIntensity: '太阳强度', sunColor: '阳光颜色', backdrop: '背景色', sky: '天空色',
    ambient: '环境光', moon: '月光', night: '夜晚程度', stars: '星星', fire: '营火', sim: '模拟', wind: '风', strength: '强度', gust: '阵风',
    swing: '风向摆动', waves: '波浪', gravity: '重力', tensionSoft: '表面张力（软）', tensionFirm: '表面张力（硬）', dampingMin: '阻尼下限',
    dampingMax: '阻尼上限', ambientSwell: '背景涌浪', jelly: '果冻', wobbleSoft: '摇晃刚度（软）', wobbleFirm: '摇晃刚度（硬）', maxShear: '最大剪切',
    bodies: '刚体', cannonSpeed: '炮弹初速', cannonElevation: '炮口仰角', coinsPerDrop: '每次金币数', flames: '火焰粒子 /秒', embers: '余烬 /秒',
    smoke: '烟 /秒', camera: '相机', azimuth: '方位角', elevation: '仰角', distance: '距离', target: '注视点', fov: '视场角', scene: '场景布局',
    island: '岛屿', x: 'x', z: 'z', radiusX: '半径 x', radiusZ: '半径 z', hills: '丘陵高度', cove: '小湾深度', ship: '船', anchor: '锚',
    skull: '骷髅岩', yaw: '朝向', scale: '缩放', camp: '营地', chest: '宝箱', xmark: 'X 标记', shovel: '铲子', rowboat: '划艇', wreck: '沉船',
    palms: '棕榈树', height: '高度', lean: '倾斜', flora: '植被', bushes: '灌木', ferns: '蕨类', grassTufts: '草丛', shoreRocks: '岸边岩石',
    kelpClumps: '海带丛', trappedBubbles: '果冻气泡', seabedCoins: '海底金币', seed: '随机种子', speed: '速度', hue: '色相', size: '大小',
  };
  const label = k => LABELS[k] ?? k;

  const S = { cfg: null, defaults: null, state: {}, opts: null, key: '', saveT: 0 };

  // ── theme ──
  function applyTheme() {
    const t = S.cfg.theme, f = t.fonts || {};
    const block = (sel, c, dark) => `${sel}{--bg:${c.bg};--ink:${c.ink};--ink2:${c.ink2};--ink3:${c.ink3};--accent:${c.accent};--accent2:${c.accent2};` +
      `--glass:${rgba(c.glass, dark ? 0.6 : 0.62)};--glass-b:${rgba(c.ink, dark ? 0.12 : 0.1)};--track:${rgba(c.ink, dark ? 0.18 : 0.14)};` +
      `--pill:${rgba(c.glass, dark ? 0.7 : 0.75)};--shadow:0 18px 50px -20px ${dark ? 'rgba(0,0,0,.7)' : rgba(c.ink, 0.35)};}`;
    let el = $('theme-live');
    if (!el) { el = document.createElement('style'); el.id = 'theme-live'; document.head.appendChild(el); }
    el.textContent = `:root{--serif:${f.serif};--sans:${f.sans};--mono:${f.mono}}` + block('html:root', t.light, false) + block('html body.dark', t.dark, true);
  }
  function setDark(on) { document.body.classList.toggle('dark', !!on); }

  // ── static chrome ──
  const rich = s => esc(s).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
  function renderMasthead() {
    const u = S.cfg.ui, [a, b] = u.title || [];
    const st = $('status');
    const keep = st ? { cls: st.className, txt: st.querySelector('span').textContent } : { cls: '', txt: 'WebGPU · 启动中' };
    $('masthead').innerHTML = `<div class="eyebrow"><i></i>${esc(u.eyebrow)}</div><h1><span>${esc(a)}</span><span><em>${esc(b)}</em></span></h1>
      <p class="lede">${esc(u.lede)}</p>
      <div class="tools"><div id="status" class="${keep.cls}"><b></b><span>${esc(keep.txt)}</span></div><button class="ui-btn" id="cfgBtn" aria-expanded="false">✎ 配置</button></div>`;
    $('cfgBtn').onclick = () => toggleEditor();
    document.title = S.cfg.meta?.title || a;
  }
  function renderHowto() {
    $('howto').innerHTML = `<div class="line">${rich(S.cfg.ui.howto)}</div><p>${esc(S.cfg.ui.howtoDetail)}</p>`;
  }
  function renderFallback(msg) {
    $('fallback').querySelector('.card').innerHTML = `<div class="eyebrow"><i></i>${esc(S.cfg.ui.eyebrow)}</div><h3>${esc(S.cfg.ui.fallbackTitle)}</h3>
      <p>${msg ? msg : esc(S.cfg.ui.fallbackText)}</p><p>Chrome / Edge：<code>chrome://flags/#enable-unsafe-webgpu</code></p>`;
  }

  // ── control panel (generated from cfg.panel) ──
  function fmt(item, v) { const f = item.format && S.opts.formatters?.[item.format]; return f ? f(v, S.cfg) : String(v); }
  function renderPanel() {
    const P = $('panel'), open = P.classList.contains('open');
    let h = `<button class="handle" id="handle" aria-expanded="${open}"><i></i><span>控制</span></button>`;
    for (const sec of S.cfg.panel) {
      h += '<section class="sec">';
      if (sec.title) h += `<h2>${esc(sec.title)} <small>${esc(sec.tag || '')}</small></h2>`;
      for (const it of sec.items || []) {
        if (it.type === 'buttons') h += `<div class="row" style="margin-top:6px">${(it.buttons || []).map(b => `<button data-action="${esc(b.action)}" class="${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`).join('')}</div>`;
        else if (it.type === 'meter') h += `<div class="meter"><div class="lbl"><span>${esc(it.label)}</span><span id="meterv-${esc(it.id)}">—</span></div><div class="bar"><i id="meter-${esc(it.id)}"></i></div></div>`;
        else if (it.type === 'counts') h += `<div class="counts">${(it.counts || []).map(c => `<div><b id="count-${esc(c.id)}">0</b>${esc(c.label)}</div>`).join('')}</div>`;
        else if (it.type === 'swatches') h += `<div class="flav" data-bind="${esc(it.bind)}">${(S.cfg[it.source] || []).map((o, i) =>
          `<button data-i="${i}" aria-pressed="${S.state[it.bind] === i}"><i style="background:${esc(o.swatch)}"></i>${esc(o.name)}</button>`).join('')}</div>`;
        else if (it.type === 'slider') h += `<div class="slider"><div class="lbl"><span>${esc(it.label)}</span><output data-out="${esc(it.bind)}">${esc(fmt(it, S.state[it.bind]))}</output></div>
          <input type="range" data-bind="${esc(it.bind)}" min="${it.min ?? 0}" max="${it.max ?? 100}" step="${it.step ?? 1}" value="${S.state[it.bind]}" aria-label="${esc(it.label)}"></div>`;
      }
      h += '</section>';
    }
    P.innerHTML = h;
    $('handle').onclick = () => { P.classList.toggle('open'); $('handle').setAttribute('aria-expanded', P.classList.contains('open')); };
    P.querySelectorAll('[data-action]').forEach(b => b.onclick = () => S.opts.actions?.[b.dataset.action]?.(b));
    P.querySelectorAll('.flav').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => setState(g.dataset.bind, +b.dataset.i)));
    P.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', () => setState(r.dataset.bind, +r.value)));
  }
  function findItem(bind) { for (const s of S.cfg.panel) for (const it of s.items || []) if (it.bind === bind) return it; return {}; }
  function setState(k, v, silent) {
    S.state[k] = v;
    const P = $('panel');
    P.querySelectorAll(`.flav[data-bind="${k}"] button`).forEach(b => b.setAttribute('aria-pressed', +b.dataset.i === v));
    const r = P.querySelector(`input[data-bind="${k}"]`); if (r && +r.value !== v) r.value = v;
    const o = P.querySelector(`output[data-out="${k}"]`); if (o) o.textContent = fmt(findItem(k), v);
    if (!silent) S.opts.onState?.(k, v, S.state);
  }
  const meter = (id, v01, text) => { const b = $('meter-' + id), t = $('meterv-' + id); if (b) b.style.width = (Math.max(0, Math.min(1, v01)) * 100).toFixed(1) + '%'; if (t && text != null) t.textContent = text; };
  const count = (id, n) => { const e = $('count-' + id); if (e && e.textContent !== String(n)) e.textContent = n; };
  const buttonLabel = (action, text) => { const b = $('panel').querySelector(`[data-action="${action}"]`); if (b) b.textContent = text; };
  function status(cls, text) { const s = $('status'); if (!s) return; s.className = cls; s.querySelector('span').textContent = text; }
  function fail(msg) { renderFallback(msg); document.body.classList.add('na'); status('na', 'WebGPU · 不可用'); console.error('[study] ' + (msg || 'no WebGPU')); }

  // ── config editor ──
  let tab = 'form';
  function toggleEditor(force) {
    const E = $('editor'), open = force ?? !E.classList.contains('open');
    if (open) renderEditor();
    E.classList.toggle('open', open);
    $('cfgBtn')?.setAttribute('aria-expanded', open);
  }
  function msg(t) { const m = $('editor').querySelector('.msg'); if (m) m.textContent = t; }
  function isRebuild(path) { return (S.opts.rebuild || []).some(p => path === p || path.startsWith(p + '.')); }
  function field(path, key, v) {
    const id = 'f-' + path.replace(/\./g, '-'), L = `<label for="${id}" title="${esc(path)}">${esc(label(key))}</label>`;
    if (isHex(v)) return `<div class="f">${L}<div class="col"><input type="color" data-p="${path}" data-k="hex" value="${v}"><input type="text" id="${id}" data-p="${path}" data-k="hex" value="${v}"></div></div>`;
    if (typeof v === 'number') return `<div class="f">${L}<input type="number" id="${id}" data-p="${path}" data-k="num" value="${v}" step="${Math.abs(v) >= 20 || Number.isInteger(v) && Math.abs(v) >= 2 ? 1 : Math.abs(v) < 0.01 && v !== 0 ? 0.00001 : 0.01}"></div>`;
    if (typeof v === 'boolean') return `<div class="f">${L}<input type="checkbox" id="${id}" data-p="${path}" data-k="bool" ${v ? 'checked' : ''}></div>`;
    if (typeof v === 'string') return v.length > 48 ? `<div class="f wide">${L}<textarea id="${id}" data-p="${path}" data-k="str" rows="${Math.min(6, Math.ceil(v.length / 44))}">${esc(v)}</textarea></div>`
      : `<div class="f">${L}<input type="text" id="${id}" data-p="${path}" data-k="str" value="${esc(v)}"></div>`;
    if (Array.isArray(v) && v.every(x => typeof x === 'number' || typeof x === 'string'))
      return `<div class="f">${L}<div class="vec">${v.map((x, i) => `<input type="${typeof x === 'number' ? 'number' : 'text'}" data-p="${path}.${i}" data-k="${typeof x === 'number' ? 'num' : 'str'}" value="${esc(x)}" step="0.01">`).join('')}</div></div>`;
    return group(path, key, v);
  }
  function group(path, key, v) {
    const rb = isRebuild(path) && !isRebuild(path.split('.').slice(0, -1).join('.')) ? ' <span class="rebuild">重建</span>' : '';
    if (Array.isArray(v)) {
      const items = v.map((x, i) => {
        const nm = isObj(x) ? (x.name || x.title || x.label || x.type || '') : '';
        return `<details><summary>#${i + 1} <small>${esc(nm)}</small><button class="rm" data-rm="${path}" data-i="${i}" title="删除">×</button></summary>${Object.keys(x).map(k => field(`${path}.${i}.${k}`, k, x[k])).join('')}</details>`;
      }).join('');
      return `<details><summary>${esc(label(key))} <small>${v.length}</small>${rb}</summary>${items}<button class="add" data-add="${path}">＋ 复制最后一项</button></details>`;
    }
    return `<details${path.split('.').length === 1 && ['ui', 'flavours'].includes(path) ? ' open' : ''}><summary>${esc(label(key))}${rb}</summary>${Object.keys(v).map(k => field(path ? `${path}.${k}` : k, k, v[k])).join('')}</details>`;
  }
  function renderEditor() {
    const E = $('editor'), body = E.querySelector('.body'), scroll = body ? body.scrollTop : 0;
    const openSet = new Set([...E.querySelectorAll('details[open]>summary')].map(s => s.parentElement.dataset.path).filter(Boolean));
    E.innerHTML = `<header><div class="eyebrow"><i></i>${esc(S.cfg.ui.eyebrow)}</div><h2>配置作品 <button class="ui-btn" id="edClose" style="margin:0">关闭 ✕</button></h2>
      <p>修改即时生效；标有「重建」的分组会重新生成场景。配置自动保存在本机浏览器。</p></header>
      <div class="edbar"><button id="edExport">导出 JSON</button><button id="edImport">导入 JSON</button><button id="edShare">复制分享链接</button><button id="edReset">恢复默认</button></div>
      <div class="tabs" role="tablist"><button role="tab" data-tab="form" aria-selected="${tab === 'form'}">表单</button><button role="tab" data-tab="json" aria-selected="${tab === 'json'}">JSON</button></div>
      <div class="body">${tab === 'form' ? Object.keys(S.cfg).filter(k => k !== 'meta').map(k => field(k, k, S.cfg[k])).join('')
        : `<div class="jsonbar"><button id="jsonApply" class="primary">应用 JSON</button><button id="jsonFmt">格式化</button></div><textarea id="json" spellcheck="false">${esc(JSON.stringify(S.cfg, null, 2))}</textarea>`}</div>
      <div class="msg"></div><input type="file" id="edFile" accept="application/json,.json" hidden>`;
    // remember which groups were open, keyed by path
    E.querySelectorAll('details').forEach(d => { const f = d.querySelector('[data-p],[data-add]'); const p = f ? (f.dataset.p || f.dataset.add) : ''; d.dataset.path = p.split('.').slice(0, 2).join('.') + '|' + d.querySelector('summary').textContent.trim().slice(0, 12); if (openSet.has(d.dataset.path)) d.open = true; });
    E.querySelector('.body').scrollTop = scroll;
    $('edClose').onclick = () => toggleEditor(false);
    E.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderEditor(); });
    $('edExport').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.cfg, null, 2)], { type: 'application/json' }));
      a.download = (S.cfg.meta?.id || 'study') + '.config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); msg('已导出配置文件。');
    };
    $('edImport').onclick = () => $('edFile').click();
    $('edFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { replaceConfig(JSON.parse(await f.text())); msg('已导入：' + f.name); } catch (err) { msg('导入失败：' + err.message); } };
    $('edShare').onclick = async () => {
      const d = diff(S.defaults, S.cfg), url = location.origin + location.pathname + location.search + (d ? '#cfg=' + b64e(JSON.stringify(d)) : '');
      history.replaceState(null, '', url);
      msg('地址栏已更新为分享链接（' + url.length + ' 字符）。');
      try { await navigator.clipboard.writeText(url); msg('分享链接已复制（' + url.length + ' 字符）。'); } catch { prompt('复制这个链接：', url); }
    };
    $('edReset').onclick = () => { if (confirm('恢复全部默认配置？当前修改会丢失。')) { replaceConfig(clone(S.defaults)); history.replaceState(null, '', location.pathname + location.search); msg('已恢复默认。'); } };
    if (tab === 'json') {
      $('jsonApply').onclick = () => { try { replaceConfig(JSON.parse($('json').value)); msg('JSON 已应用。'); } catch (err) { msg('JSON 有误：' + err.message); } };
      $('jsonFmt').onclick = () => { try { $('json').value = JSON.stringify(JSON.parse($('json').value), null, 2); } catch (err) { msg('JSON 有误：' + err.message); } };
      return;
    }
    E.querySelectorAll('[data-p]').forEach(inp => inp.addEventListener('input', () => {
      const p = inp.dataset.p, k = inp.dataset.k;
      const v = k === 'num' ? parseFloat(inp.value) : k === 'bool' ? inp.checked : inp.value;
      if (k === 'num' && !Number.isFinite(v)) return;
      if (k === 'hex') { if (!isHex(v)) return; inp.parentElement.querySelectorAll('input').forEach(o => { if (o !== inp) o.value = v; }); }
      setPath(S.cfg, p, v); changed(p);
    }));
    E.querySelectorAll('[data-rm]').forEach(b => b.onclick = e => {
      e.preventDefault(); const arr = getPath(S.cfg, b.dataset.rm); if (arr.length <= 1) return msg('至少保留一项。');
      arr.splice(+b.dataset.i, 1); changed(b.dataset.rm); renderEditor();
    });
    E.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const arr = getPath(S.cfg, b.dataset.add); arr.push(clone(arr[arr.length - 1])); changed(b.dataset.add); renderEditor(); });
  }

  // ── change propagation ──
  let rebuildT = 0;
  function changed(path) {
    const top = path.split('.')[0];
    if (top === 'ui' || top === 'meta') { renderMasthead(); renderHowto(); }
    if (top === 'theme') applyTheme();
    if (top === 'panel' || top === 'state' || (S.opts.panelDeps || []).includes(top)) {
      if (top === 'state') for (const k in S.cfg.state) setState(k, S.cfg.state[k], false);
      renderPanel();
    }
    if (isRebuild(path)) { clearTimeout(rebuildT); rebuildT = setTimeout(() => { msg('正在重建场景…'); S.opts.onRebuild?.(S.cfg); msg('场景已重建。'); }, 350); }
    S.opts.onConfig?.(path, S.cfg);
    clearTimeout(S.saveT); S.saveT = setTimeout(save, 400);
  }
  function save() { try { const d = diff(S.defaults, S.cfg); if (d) localStorage.setItem(S.key, JSON.stringify(d)); else localStorage.removeItem(S.key); } catch { } }
  function replaceConfig(next) {
    S.cfg = merge(S.defaults, next);
    for (const k in S.cfg.state) S.state[k] = S.cfg.state[k];
    applyTheme(); renderMasthead(); renderHowto(); renderPanel();
    S.opts.onRebuild?.(S.cfg); S.opts.onConfig?.('*', S.cfg);
    for (const k in S.state) S.opts.onState?.(k, S.state[k], S.state);
    save(); renderEditor();
  }

  async function mount(opts) {
    S.opts = opts; S.defaults = clone(opts.defaults); S.key = 'materialStudy:' + (S.defaults.meta?.id || 'study');
    let over;
    try {
      const h = location.hash.match(/cfg=([^&]+)/); if (h) over = JSON.parse(b64d(h[1]));
      const q = new URLSearchParams(location.search).get('config');
      if (!over && q) over = await (await fetch(q)).json();
      if (!over) { const ls = localStorage.getItem(S.key); if (ls) over = JSON.parse(ls); }
    } catch (e) { console.warn('[study] ignoring bad config override', e); }
    S.cfg = merge(S.defaults, over || {});
    for (const k in S.cfg.state) S.state[k] = S.cfg.state[k];
    applyTheme(); renderMasthead(); renderHowto(); renderPanel(); renderFallback();
    addEventListener('keydown', e => { if (e.key === 'Escape' && $('editor').classList.contains('open')) toggleEditor(false); });
    return S.cfg;
  }
  return {
    mount, status, fail, setDark, meter, count, buttonLabel, setState, toggleEditor,
    get cfg() { return S.cfg; }, get state() { return S.state; },
    util: { merge, diff, clone, getPath, setPath },
  };
})();
