// 生成集市 preview.png：按卡片盒面板真实结构绘制的原型图（SVG → PNG）
// 运行：node scripts/gen-preview.mjs（sharp 从 .workbuddy node workspace 读取）
import { createRequire } from "module";
const require = createRequire("C:/Users/邢庆文/.workbuddy/binaries/node/workspace/");
const sharp = require("sharp");

const W = 1024, H = 768;
const C = {
    bg: "#f5f6f7", panel: "#ffffff", border: "#e3e5e8",
    text: "#1f2329", sub: "#86909c", primary: "#3575f0",
    lit: "#3575f0", idea: "#ff8c1a", map: "#00b567", perm: "#8f5cf6",
    danger: "#f54a45", quoteBg: "#f7f8fa",
};

const badge = (x, y, label, color) =>
    `<rect x="${x}" y="${y}" width="${22 + label.length * 12}" height="18" rx="9" fill="${color}18" stroke="${color}55"/>
     <text x="${x + 11 + label.length * 6}" y="${y + 13}" font-size="11" fill="${color}" text-anchor="middle" font-weight="600">${label}</text>`;

const chip = (x, y, label, active) =>
    `<rect x="${x}" y="${y}" width="${20 + label.length * 12}" height="24" rx="12" fill="${active ? C.primary : "#fff"}" stroke="${active ? C.primary : C.border}"/>
     <text x="${x + 10 + label.length * 6}" y="${y + 16.5}" font-size="12" fill="${active ? "#fff" : C.sub}" text-anchor="middle" font-weight="${active ? 600 : 400}">${label}</text>`;

// 左侧卡片行
const rows = [
    { type: "文献", c: C.lit, title: "价格还在走，但成交量已经掉头", meta: "《美伊冲突》 · 🔗 3", ref: true },
    { type: "想法", c: C.idea, title: "背离的本质是预期先行，价格只是追随", meta: "🔗 2", ref: true },
    { type: "地图", c: C.map, title: "霍尔木兹海峡的咽喉是拉腊克岛", meta: "📍1 ▭1 · 🔗 2", ref: true },
    { type: "永久", c: C.perm, title: "为什么说航道即权力", meta: "4 张卡合成 · 🔗 4", ref: true },
    { type: "想法", c: C.idea, title: "运费和保险费比油本身更诚实", meta: "孤岛 · 没有任何卡引用它", ref: false },
];
const rowsSVG = rows
    .map((r, i) => {
        const y = 148 + i * 74;
        return `
  <rect x="24" y="${y}" width="468" height="64" rx="10" fill="${C.panel}" stroke="${C.border}"/>
  ${badge(40, y + 12, r.type, r.c)}
  <text x="40" y="${y + 46}" font-size="13.5" fill="${C.text}" font-weight="600">${r.title}</text>
  <text x="${r.ref ? 336 : 340}" y="${y + 46}" font-size="10.5" fill="${r.ref ? C.sub : C.danger}">${r.meta}</text>
  <text x="470" y="${y + 32}" font-size="11" fill="${C.sub}" text-anchor="end">🔗 ✍ 关联</text>`;
    })
    .join("");

// 右侧链路图：节点 + 贝塞尔边
const nodes = [
    { x: 810, y: 205, label: "航道即权力", c: C.perm },
    { x: 640, y: 300, label: "成交量掉头", c: C.lit },
    { x: 950, y: 300, label: "预期先行", c: C.idea },
    { x: 730, y: 440, label: "拉腊克岛", c: C.map },
    { x: 950, y: 470, label: "保险费更诚实", c: C.idea },
];
const edges = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 4],
];
const edgesSVG = edges
    .map(([a, b]) => {
        const A = nodes[a], B = nodes[b];
        const mx = (A.x + B.x) / 2;
        return `<path d="M ${A.x} ${A.y} C ${mx} ${A.y}, ${mx} ${B.y}, ${B.x} ${B.y}" stroke="${C.primary}44" stroke-width="1.6" fill="none"/>`;
    })
    .join("");
const nodesSVG = nodes
    .map((n) => `
  <rect x="${n.x - 62}" y="${n.y - 16}" width="124" height="32" rx="16" fill="#fff" stroke="${n.c}" stroke-width="1.6"/>
  <circle cx="${n.x - 46}" cy="${n.y}" r="5" fill="${n.c}"/>
  <text x="${n.x + 6}" y="${n.y + 4.5}" font-size="11.5" fill="${C.text}" text-anchor="middle" font-weight="600">${n.label}</text>`)
    .join("");

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <style>text { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }</style>

  <!-- 标题栏 -->
  <text x="24" y="46" font-size="21" fill="${C.text}" font-weight="700">卡片盒</text>
  <text x="92" y="46" font-size="13" fill="${C.sub}">卢曼式卡片笔记 · 微信读书素材 → 卡片</text>
  <rect x="790" y="26" width="76" height="28" rx="6" fill="${C.primary}"/>
  <text x="828" y="44.5" font-size="12.5" fill="#fff" text-anchor="middle" font-weight="600">＋ 新建</text>
  <rect x="874" y="26" width="58" height="28" rx="6" fill="#fff" stroke="${C.border}"/>
  <text x="903" y="44.5" font-size="12.5" fill="${C.text}" text-anchor="middle">🌏 地图</text>
  <rect x="940" y="26" width="60" height="28" rx="6" fill="#fff" stroke="${C.border}"/>
  <text x="970" y="44.5" font-size="12.5" fill="${C.text}" text-anchor="middle">🔍 ↻</text>

  <!-- 筛选 chips -->
  ${chip(24, 72, "全部 12", true)}
  ${chip(110, 72, "文献 5", false)}
  ${chip(196, 72, "想法 4", false)}
  ${chip(282, 72, "地图 2", false)}
  ${chip(368, 72, "孤岛 1", false)}
  <text x="1000" y="88" font-size="12" fill="${C.sub}" text-anchor="end">素材：微信读书 · 思源文档</text>

  <!-- 左：卡片列表 -->
  ${rowsSVG}

  <!-- 右：链路图 -->
  <rect x="512" y="148" width="488" height="384" rx="10" fill="${C.panel}" stroke="${C.border}"/>
  <text x="530" y="176" font-size="12.5" fill="${C.sub}" font-weight="600">🔗 链路图</text>
  ${edgesSVG}
  ${nodesSVG}

  <!-- 底部提示 -->
  <rect x="24" y="556" width="976" height="188" rx="10" fill="${C.panel}" stroke="${C.border}"/>
  <text x="44" y="588" font-size="13" fill="${C.text}" font-weight="700">一张卡 = 一句你自己的判断</text>
  <text x="44" y="618" font-size="12.5" fill="${C.sub}">📖 文献卡：原文摘抄在上，你的判断在下，锚定来源块</text>
  <text x="44" y="642" font-size="12.5" fill="${C.sub}">💡 想法卡：建卡即勾选它接在哪几张卡上，孤岛自动标红</text>
  <text x="44" y="666" font-size="12.5" fill="${C.sub}">🌏 地图卡：和地方绑定的知识，钉在离线世界地图上</text>
  <text x="44" y="690" font-size="12.5" fill="${C.sub}">📜 永久卡：多张卡按顺序合成文章，嵌入块联动更新</text>
  <text x="44" y="722" font-size="12" fill="${C.primary}" font-weight="600">微信读书划线与想法 → 勾选批量成卡 · 评论自动成为「我的判断」</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("preview.png");
console.log("preview.png 已生成");
