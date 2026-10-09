
// ───────────────────────── Starter study · default configuration ─────────────────────────
// Copy this file and src/starter/50_main.js to begin a new study in the series.
const DEFAULT_CONFIG = {
  meta: { id: 'starter', title: '果冻样本 — 材料研究' },
  ui: {
    eyebrow: '材料研究 · 模板',
    title: ['果冻', '样本。'],
    lede: '系列模板的最小示例：一颗用光线步进绘制的果冻球。改配置即可得到新作品的骨架，再替换场景代码即可。',
    howto: '玩法——点击果冻戳一下，按 [空格] 也行。',
    howtoDetail: '右侧面板切换口味、调节硬度 · 左上角「✎ 配置」可实时编辑全部文案、配色与参数，并导出 JSON 或复制分享链接',
    fallbackTitle: '果冻凝固不了。',
    fallbackText: '本作品使用 WebGPU 渲染，但当前浏览器或显卡适配器不支持。',
  },
  theme: {
    fonts: {
      serif: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",serif',
      sans: 'ui-sans-serif,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif',
      mono: 'ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace',
    },
    light: { bg: '#ece6dc', ink: '#1d1a16', ink2: '#5d554b', ink3: '#8b8276', accent: '#c2562b', accent2: '#2a8c86', glass: '#faf7f1' },
    dark: { bg: '#0f1424', ink: '#efe7da', ink2: '#b9b0a3', ink3: '#857d72', accent: '#f0a050', accent2: '#5fd0c4', glass: '#141828' },
    darkAt: 0.5,
  },
  panel: [
    { title: '样本', tag: '行动', items: [
      { type: 'buttons', buttons: [{ action: 'poke', label: '戳一下', primary: true }] },
      { type: 'meter', id: 'wobble', label: '晃动' },
      { type: 'counts', counts: [{ id: 'pokes', label: '次数' }] },
    ] },
    { title: '风味', tag: '果冻', items: [
      { type: 'swatches', bind: 'flavour', source: 'flavours' },
      { type: 'slider', bind: 'firmness', label: '硬度', min: 0, max: 100 },
      { type: 'slider', bind: 'night', label: '夜色', min: 0, max: 100 },
    ] },
    { items: [{ type: 'buttons', buttons: [{ action: 'pause', label: '暂停' }] }] },
  ],
  state: { flavour: 0, firmness: 50, night: 0 },
  flavours: [
    { name: '青绿', swatch: '#3cb7ad', color: '#3cb7ad' },
    { name: '金酒', swatch: '#d9902e', color: '#d9902e' },
    { name: '克拉肯', swatch: '#7a4bb3', color: '#7a4bb3' },
  ],
  sim: { wobbleSoft: 6, wobbleFirm: 30, size: 1.0 },
};
