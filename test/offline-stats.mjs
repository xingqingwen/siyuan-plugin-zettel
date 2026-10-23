import { ROOT } from "./_env.mjs";
/**
 * 离线统计：直接解析 .sy 文件，不依赖思源内核。
 * 目的：在动手做"分析"功能前，先确认现有字段能算出什么、算不出的缺什么。
 */
import fs from "node:fs";
import path from "node:path";


const books = [];
let totalHl = 0, totalTh = 0, totalCh = 0, totalMeta = 0;

function textOf(node) {
    if (node.Type === "NodeText" && typeof node.Data === "string") return node.Data;
    let r = "";
    for (const c of node.Children || []) r += textOf(c);
    return r;
}

function walk(node, ctx, out) {
    const p = node.Properties || {};
    const t = p["custom-weread-type"];
    if (t === "highlight") {
        const body = textOf(node).replace(/^>\s*/, "");
        out.hl.push({
            time: p["custom-weread-time"] || "",
            chapter: p["custom-weread-chapter"] || "",
            len: (body || p.name || "").length,
            text: body || p.name || "",
            book: ctx.book,
            author: ctx.author,
        });
    } else if (t === "thought") {
        const tb = textOf(node);
        out.th.push({ time: p["custom-weread-time"] || "", text: tb || p.name || "", book: ctx.book });
    } else if (t === "chapter") {
        out.ch.push(p.name || "");
    } else if (t === "meta") {
        out.meta++;
    }
    for (const c of node.Children || []) {
        walk(c, ctx, out);
    }
}

for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".sy"))) {
    let doc;
    try {
        doc = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    } catch {
        continue;
    }
    const p = doc.Properties || {};
    if (p.type !== "doc") continue;
    const out = { hl: [], th: [], ch: [], meta: 0 };
    const ctx = { book: p["custom-weread-book-title"] || p.name || "?", author: p["custom-weread-author"] || "" };
    for (const c of doc.Children || []) {
        walk(c, ctx, out);
    }
    // 作者从 meta 块里补（文档属性没有作者）
    let author = "";
    for (const c of doc.Children || []) {
        if (c.Properties?.["custom-weread-type"] === "meta") {
            author = c.Properties["custom-weread-author"] || "";
            break;
        }
    }
    books.push({ title: ctx.book, author: author || ctx.author, hl: out.hl, th: out.th, ch: out.ch, meta: out.meta, file: f });
    totalHl += out.hl.length;
    totalTh += out.th.length;
    totalCh += out.ch.length;
    totalMeta += out.meta;
}

console.log("=== 总量 ===");
console.log(`书 ${books.length} 本 / 划线 ${totalHl} / 想法 ${totalTh} / 章节标题 ${totalCh} / meta块 ${totalMeta}`);

const noTime = books.reduce((s, b) => s + b.hl.filter((h) => !h.time).length, 0);
console.log(`划线缺时间字段：${noTime}`);

// 1. 翻过没读（划线 <= 2）
const light = books.filter((b) => b.hl.length <= 2).sort((a, b) => a.hl.length - b.hl.length);
console.log(`\n=== 轻量阅读（划线<=2）：${light.length} 本 ===`);
console.log(light.slice(0, 15).map((b) => `${b.hl.length}  ${b.title}`).join("\n"));

// 2. 想法最多 / 想法率最高
const withTh = books.filter((b) => b.th.length > 0).sort((a, b) => b.th.length - a.th.length);
console.log(`\n=== 有想法的书：${withTh.length} 本 ===`);
console.log(withTh.slice(0, 12).map((b) => `${b.th.length}想法/${b.hl.length}划线  ${b.title}`).join("\n"));

// 3. 作者排行
const byAuthor = new Map();
for (const b of books) {
    if (!b.author) continue;
    const k = b.author.split(/[、,，\s]/)[0];
    if (k.length < 2) continue;
    const e = byAuthor.get(k) || { books: 0, hl: 0 };
    e.books++;
    e.hl += b.hl.length;
    byAuthor.set(k, e);
}
const topAuthor = [...byAuthor.entries()].sort((a, b) => b[1].hl - a[1].hl);
console.log(`\n=== 作者 Top15（共 ${byAuthor.size} 位）===`);
console.log(topAuthor.slice(0, 15).map(([k, v]) => `${v.hl}划线/${v.books}本  ${k}`).join("\n"));

// 4. 年月分布
const byYM = new Map();
for (const b of books) for (const h of b.hl) {
    const m = (h.time || "").match(/^(\d{4})-(\d{2})/);
    if (m) byYM.set(`${m[1]}-${m[2]}`, (byYM.get(`${m[1]}-${m[2]}`) || 0) + 1);
}
const years = new Map();
for (const [k, v] of byYM) {
    const y = k.slice(0, 4);
    years.set(y, (years.get(y) || 0) + v);
}
console.log(`\n=== 按年 ===`);
console.log([...years.entries()].sort().map(([k, v]) => `${k}: ${v}`).join("  |  "));

// 5. 章节密度：哪本书的干货集中
const dense = books.map((b) => {
    const m = new Map();
    for (const h of b.hl) {
        const c = h.chapter || "(未分章)";
        m.set(c, (m.get(c) || 0) + 1);
    }
    const arr = [...m.entries()].filter(([c]) => c !== "(未分章)").sort((a, b2) => b2[1] - a[1]);
    return { title: b.title, total: b.hl.length, top: arr[0], chapters: arr.length };
}).filter((x) => x.total >= 10 && x.top).sort((a, b) => b.top[1] / b.total - a.top[1] / a.total);

console.log(`\n=== 章节集中度最高（干货在哪一章）===`);
console.log(dense.slice(0, 10).map((x) => `${x.title}: 「${x.top[0]}」${x.top[1]}/${x.total} 条（占比 ${Math.round((x.top[1] / x.total) * 100)}%，共 ${x.chapters} 章）`).join("\n"));

// 6. 划线长度分布
const lens = books.flatMap((b) => b.hl.map((h) => h.len)).sort((a, b) => a - b);
const pct = (p) => lens[Math.floor(lens.length * p)] || 0;
console.log(`\n=== 划线长度（字）===`);
console.log(`最短 ${lens[0]} / 25% ${pct(0.25)} / 中位 ${pct(0.5)} / 75% ${pct(0.75)} / 最长 ${lens[lens.length - 1]}`);

// 7. 空章节
const emptyCh = books.reduce((s, b) => s + Math.max(0, b.ch.length - new Set(b.hl.map((h) => h.chapter)).size), 0);
console.log(`\n空章节总数（有标题无划线）：${emptyCh}`);

fs.writeFileSync("test/.stats.json", JSON.stringify({ books: books.map((b) => ({ t: b.title, a: b.author, h: b.hl.length, th: b.th.length, c: b.ch.length })) }, null, 0));
