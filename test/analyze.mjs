import { ROOT } from "./_env.mjs";
/**
 * 分析指标：想法率 / 长度分档 / 作者归一
 * 只回答一个问题：他的 339 本书里，哪些是真读过、哪些是囤的。
 */
import fs from "node:fs";
import path from "node:path";


function textOf(n) {
    if (n.Type === "NodeText" && typeof n.Data === "string") return n.Data;
    let r = "";
    for (const c of n.Children || []) r += textOf(c);
    return r;
}

const books = [];
function collect(node, acc) {
    const p = node.Properties || {};
    const t = p["custom-weread-type"];
    if (t === "highlight") acc.hl.push({ t: p["custom-weread-time"] || "", c: p["custom-weread-chapter"] || "", x: textOf(node) });
    else if (t === "thought") acc.th.push({ t: p["custom-weread-time"] || "", x: textOf(node) });
    for (const ch of node.Children || []) collect(ch, acc);
}

for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".sy"))) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch { continue; }
    const p = d.Properties || {};
    if (p.type !== "doc") continue;
    const acc = { hl: [], th: [] };
    for (const c of d.Children || []) collect(c, acc);
    let author = "";
    for (const c of d.Children || []) {
        if (c.Properties?.["custom-weread-type"] === "meta") { author = c.Properties["custom-weread-author"] || ""; break; }
    }
    books.push({ title: p["custom-weread-book-title"] || p.name || "?", author, hl: acc.hl, th: acc.th });
}

// ---- 想法率：真精读 ----
const engaged = books.filter((b) => b.hl.length + b.th.length > 0)
    .map((b) => ({ ...b, rate: b.th.length / Math.max(1, b.hl.length + b.th.length), total: b.hl.length + b.th.length }))
    .filter((b) => b.total >= 6)
    .sort((a, b) => b.rate - a.rate);
console.log("=== 想法率 Top15（读过且有反应）===");
console.log(engaged.slice(0, 15).map((b) => `${Math.round(b.rate * 100)}%  ${b.th.length}想法/${b.hl.length}划线  ${b.title}`).join("\n"));

// ---- 长度分档 ----
const all = books.flatMap((b) => b.hl.map((h) => h.x.length));
const buckets = { "≤20": 0, "21-50": 0, "51-100": 0, "101-200": 0, ">200": 0 };
for (const n of all) {
    if (n <= 20) buckets["≤20"]++;
    else if (n <= 50) buckets["21-50"]++;
    else if (n <= 100) buckets["51-100"]++;
    else if (n <= 200) buckets["101-200"]++;
    else buckets[">200"]++;
}
console.log("\n=== 划线长度分档（共 " + all.length + " 条）===");
for (const [k, v] of Object.entries(buckets)) console.log(`${k} 字: ${v} 条 (${Math.round((v / all.length) * 100)}%)`);

// ---- 可直接当素材的（长划线）----
const material = books.flatMap((b) => b.hl.filter((h) => h.x.length >= 80).map((h) => ({ ...h, book: b.title, author: b.author })));
console.log(`\n=== 长划线（>=80 字，可当引用素材）：${material.length} 条，来自 ${new Set(material.map((m) => m.book)).size} 本书`);

// ---- 作者归一 ----
const norm = (a) => (a || "").replace(/[·•・.]/g, "·").replace(/\s*(讲述|著|主编|编|译)\s*$/, "").split(/[、,，]/)[0].trim();
const byA = new Map();
for (const b of books) {
    const k = norm(b.author);
    if (!k || k.length < 2) continue;
    const e = byA.get(k) || { n: 0, hl: 0, th: 0 };
    e.n++; e.hl += b.hl.length; e.th += b.th.length;
    byA.set(k, e);
}
console.log(`\n=== 作者 Top12（归一后 ${byA.size} 位）===`);
console.log([...byA.entries()].sort((a, b) => b[1].hl - a[1].hl).slice(0, 12)
    .map(([k, v]) => `${v.hl}划线 / ${v.n}本  ${k}`).join("\n"));

// ---- 囤书：0 划线的技术书 ----
const zero = books.filter((b) => b.hl.length === 0 && b.th.length === 0);
console.log(`\n=== 完全没动过的书：${zero.length} 本 ===`);
console.log(zero.slice(0, 12).map((b) => b.title).join(" / "));

// ---- 年度想法率 ----
const byYear = new Map();
for (const b of books) for (const x of [...b.hl, ...b.th]) {
    const m = (x.t || "").match(/^(\d{4})/);
    if (!m) continue;
    const e = byYear.get(m[1]) || { hl: 0, th: 0 };
    if (b.hl.includes(x)) e.hl++; else e.th++;
    byYear.set(m[1], e);
}
console.log("\n=== 年度：划线 vs 想法 ===");
console.log([...byYear.entries()].sort().map(([k, v]) => `${k}: ${v.hl}/${v.th}`).join("  |  "));
