
// ───────────────────────── Pirate Voyage · overrides on top of the Pirate Jelly config ─────────────────────────
// A free-sailing sandbox on an endless jelly sea: the block travels with the ship like a sample slide,
// and islets, sea stacks, wrecks and kelp are generated chunk by chunk around her.
{
  const VOYAGE = {
    meta: { id: 'pirate-voyage', title: '果冻航海 — 材料研究' },
    ui: {
      eyebrow: '材料研究 · 第 07 号 · 航海版',
      title: ['果冻', '航海。'],
      lede: '把海盗船开出小湾，驶向没有尽头的果冻海：这块果冻样本跟着船走，切面随时显示脚下的地层；小岛、海蚀柱、沉船和海带一路随机生成。',
      howto: '玩法——[↑][↓] 前进后退，[←][→] 转舵，[空格] 左右舷轮流开炮。',
      howtoDetail: '也可以用 W A S D · 拖动空白处环顾四周，滚轮 / 双指缩放 · 拖动水面制造波浪 · 抓起并投掷木桶和金币 · 点击宝箱、营火或 X',
    },
    panel: [
      { title: '航行', tag: '船长', items: [
        { type: 'meter', id: 'speed', label: '航速' },
        { type: 'buttons', buttons: [{ action: 'fire', label: '开炮', primary: true }] },
        { type: 'buttons', buttons: [{ action: 'coins', label: '达布隆金币' }, { action: 'barrel', label: '木桶' }] },
        { type: 'counts', counts: [{ id: 'distance', label: '离家 · 米' }, { id: 'shots', label: '射击' }, { id: 'sunk', label: '沉底' }] },
      ] },
      { title: '风味', tag: '果冻', items: [
        { type: 'swatches', bind: 'flavour', source: 'flavours' },
        { type: 'slider', bind: 'firmness', label: '硬度', min: 0, max: 100 },
        { type: 'slider', bind: 'damping', label: '波浪阻尼', min: 0, max: 100 },
        { type: 'slider', bind: 'day', label: '一天时间', min: 0, max: 1000, format: 'dayName' },
      ] },
      { items: [{ type: 'buttons', buttons: [{ action: 'reset', label: '回到起点' }, { action: 'pause', label: '暂停' }, { action: 'view', label: '重置视角' }] }] },
    ],
    state: { flavour: 0, firmness: 62, damping: 22, day: 120 },
    world: {
      infinite: true, size: 18.4, terrainRes: 384, waterRes: 160, waterCell: 0.055, windowFade: 12,
      swell: { amp: 0.012, length: 1.8, speed: 1.4 },
      islets: [
        { x: 7.2, z: 4.6, r: 1.2, h: 0.5 }, { x: -7.8, z: 4.2, r: 1.0, h: 0.4 }, { x: 5.0, z: -7.6, r: 1.5, h: 0.6 },
        { x: -6.2, z: -7.0, r: 0.9, h: 0.35 }, { x: 9.0, z: -2.0, r: 0.8, h: 0.3 }, { x: -9.6, z: -1.0, r: 1.1, h: 0.45 },
        { x: 1.4, z: 8.8, r: 1.0, h: 0.4 },
      ],
    },
    voyage: { enabled: true, thrust: 1.9, reverse: 0.6, turn: 0.25, camera: { distance: 4.6, elevation: 0.36, lag: 2.2 } },
    sim: { waves: { ambientSwell: 3 } },
    scene: { flora: { kelpClumps: 40, trappedBubbles: 240, seabedCoins: 18 } },
  };
  const merged = Shell.util.merge(DEFAULT_CONFIG, VOYAGE);
  for (const k in merged) DEFAULT_CONFIG[k] = merged[k];
}
