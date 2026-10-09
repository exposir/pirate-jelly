
// ───────────────────────── Pirate Jelly · default configuration ─────────────────────────
// Everything the editor exposes lives here. Colours are sRGB hex; the scene converts to linear.
// Paths under `scene.*` rebuild the world when edited; everything else applies live.
const DEFAULT_CONFIG = {
  meta: { id: 'pirate-jelly', title: '海盗果冻 — 材料研究' },
  ui: {
    eyebrow: '材料研究 · 第 07 号',
    title: ['海盗', '果冻。'],
    lede: '一块摇晃的泻湖果冻，里面藏着一座荒岛——骷髅岩、埋着的宝箱，还有一艘下锚停泊的双桅船。浅水波浪、浮力与炮火，全部实时模拟。',
    howto: '玩法——点击船只开炮，按 [空格] 来一轮舷炮齐射。',
    howtoDetail: '拖动船只对抗锚绳 · 点击宝箱、营火或 X · 拖动水面制造波浪 · 拖动方块侧面使其倾斜 · 抓起并投掷炮弹、木桶、金币 · 拖动棕榈树使其弯曲 · 拖动空白处或右键拖动环绕 · 滚轮 / 双指缩放',
    fallbackTitle: '果冻凝固不了。',
    fallbackText: '本作品使用 WebGPU 渲染，但当前浏览器或显卡适配器不支持。请使用新版 Chrome、Edge 或 Safari 26+，或在浏览器实验功能中启用 WebGPU。',
  },
  theme: {
    fonts: {
      serif: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",serif',
      sans: 'ui-sans-serif,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif',
      mono: 'ui-monospace,"SF Mono",Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace',
    },
    light: { bg: '#ece6dc', ink: '#1d1a16', ink2: '#5d554b', ink3: '#8b8276', accent: '#c2562b', accent2: '#2a8c86', glass: '#faf7f1' },
    dark: { bg: '#0f1424', ink: '#efe7da', ink2: '#b9b0a3', ink3: '#857d72', accent: '#f0a050', accent2: '#5fd0c4', glass: '#141828' },
    darkAt: 0.5,                     // night level (0–1) where the page flips to the dark theme
  },
  panel: [
    { title: '小湾', tag: '行动', items: [
      { type: 'buttons', buttons: [{ action: 'fire', label: '发射一炮', primary: true }] },
      { type: 'buttons', buttons: [{ action: 'coins', label: '达布隆金币' }, { action: 'barrel', label: '木桶' }] },
      { type: 'meter', id: 'vigour', label: '活力' },
      { type: 'counts', counts: [{ id: 'shots', label: '射击' }, { id: 'afloat', label: '漂浮' }, { id: 'sunk', label: '沉底' }] },
    ] },
    { title: '风味', tag: '果冻', items: [
      { type: 'swatches', bind: 'flavour', source: 'flavours' },
      { type: 'slider', bind: 'firmness', label: '硬度', min: 0, max: 100 },
      { type: 'slider', bind: 'damping', label: '波浪阻尼', min: 0, max: 100 },
      { type: 'slider', bind: 'day', label: '一天时间', min: 0, max: 1000, format: 'dayName' },
    ] },
    { items: [{ type: 'buttons', buttons: [{ action: 'reset', label: '重置' }, { action: 'pause', label: '暂停' }, { action: 'view', label: '重置视角' }] }] },
  ],
  state: { flavour: 0, firmness: 62, damping: 30, day: 80 },   // initial control values
  flavours: [
    { name: '青绿', swatch: '#3cb7ad', tint: '#81ded3', glow: '#47acac', density: 1 },
    { name: '金酒', swatch: '#d9902e', tint: '#deb167', glow: '#c28f41', density: 1 },
    { name: '克拉肯', swatch: '#7a4bb3', tint: '#ad87d5', glow: '#9455b1', density: 1 },
  ],
  // time-of-day keyframes, evenly spaced along the slider
  day: [
    { name: '正午', sunElevation: 66, sunAzimuth: -150, sunIntensity: 1.6, sunColor: '#fffaf3', backdrop: '#e9e3d8', sky: '#d3dbe0', ambient: '#acb0b7', moon: 0, night: 0, stars: 0, fire: 0.18, glow: 0 },
    { name: '下午', sunElevation: 44, sunAzimuth: -135, sunIntensity: 1.52, sunColor: '#fff3e1', backdrop: '#e8dccb', sky: '#d8d6d0', ambient: '#aaa8a8', moon: 0, night: 0, stars: 0, fire: 0.18, glow: 0.1 },
    { name: '金色时段', sunElevation: 18, sunAzimuth: -118, sunIntensity: 1.4, sunColor: '#ffdcb0', backdrop: '#f0cfaa', sky: '#e9c19f', ambient: '#a89a94', moon: 0, night: 0, stars: 0, fire: 0.25, glow: 0.6 },
    { name: '日落', sunElevation: 4, sunAzimuth: -105, sunIntensity: 1.0, sunColor: '#ffb78f', backdrop: '#e9a689', sky: '#c98a8e', ambient: '#a08d91', moon: 0, night: 0.12, stars: 0, fire: 0.42, glow: 1 },
    { name: '黄昏', sunElevation: -10, sunAzimuth: -95, sunIntensity: 0, sunColor: '#cabaca', backdrop: '#5d5277', sky: '#343a66', ambient: '#807d9c', moon: 0.45, night: 0.5, stars: 0.3, fire: 1.0, glow: 0.5 },
    { name: '夜晚', sunElevation: -30, sunAzimuth: -85, sunIntensity: 0, sunColor: '#c2d2ff', backdrop: '#1a2038', sky: '#10182f', ambient: '#4c556f', moon: 0.9, night: 0.88, stars: 0.85, fire: 1.45, glow: 0 },
    { name: '午夜', sunElevation: -50, sunAzimuth: -75, sunIntensity: 0, sunColor: '#c2d2ff', backdrop: '#0c1122', sky: '#060a16', ambient: '#414a61', moon: 1, night: 1, stars: 1, fire: 1.6, glow: 0 },
  ],
  sim: {
    wind: { strength: 0.32, gust: 0.08, swing: 0.28 },
    waves: { gravity: 5.0, tensionSoft: 0.00003, tensionFirm: 0.00022, dampingMin: 0.05, dampingMax: 1.6, ambientSwell: 1.2 },
    jelly: { wobbleSoft: 30, wobbleFirm: 320, maxShear: 0.12 },
    bodies: { gravity: 6.5, cannonSpeed: 4.6, cannonElevation: 0.34, coinsPerDrop: 5 },
    fire: { flames: 45, embers: 6, smoke: 7 },
  },
  // jelly block dimensions and the water simulation window (rebuilds everything)
  world: { size: 5.2, terrainRes: 128, waterRes: 128, waterCell: 0, windowFade: 0, swell: { amp: 0, length: 1.6, speed: 1.2 }, islets: [] },
  voyage: { enabled: false, thrust: 1.9, reverse: 0.6, turn: 0.25, camera: { distance: 4.6, elevation: 0.36, lag: 2.2 } },
  camera: { azimuth: 0.78, elevation: 0.47, distance: 12.5, target: [0, 1.35, 0.1], fov: 0.56 },
  // world layout — editing anything below rebuilds the island
  scene: {
    island: { x: 0.1, z: -1.55, radiusX: 2.1, radiusZ: 1.1, hills: 1.0, cove: 0.13 },
    ship: [-1.0, 1.25], anchor: [-1.05, 0.15],
    skull: { x: -1.82, z: -0.95, yaw: 0.85, scale: 1.28 },
    camp: { fire: [0.3, -1.05], chest: [0.98, -1.18], xmark: [0.62, -0.8], shovel: [0.78, -0.74], rowboat: [-0.3, -0.58] },
    wreck: [1.35, 1.25],
    palms: [
      { x: 1.2, z: -1.48, height: 1.0, lean: [-0.5, 0.55] },
      { x: 0.02, z: -1.4, height: 0.82, lean: [-0.1, 0.18] },
      { x: -0.42, z: -1.18, height: 0.72, lean: [0.12, 0.22] },
      { x: 0.55, z: -1.62, height: 0.95, lean: [0.08, 0.1] },
      { x: 1.68, z: -1.3, height: 0.78, lean: [0.25, 0.12] },
      { x: -0.98, z: -1.35, height: 0.88, lean: [-0.2, 0.15] },
      { x: -0.15, z: -1.95, height: 1.05, lean: [0.05, -0.1] },
      { x: 0.95, z: -2.05, height: 0.9, lean: [0.1, 0.05] },
      { x: -1.42, z: -1.55, height: 0.75, lean: [-0.25, 0.1] },
    ],
    flora: { bushes: 22, ferns: 14, grassTufts: 20, shoreRocks: 16, kelpClumps: 8, trappedBubbles: 34, seabedCoins: 7, seed: 4242 },
  },
};
