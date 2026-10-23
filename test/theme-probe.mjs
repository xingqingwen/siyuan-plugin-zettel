import { ROOT } from "./_env.mjs";
/**
 * 主题探测：不给 AI，纯 n-gram 能不能从他自己的划线里聚出有意义的主题？
 * 这决定「主题聚合」该做成"自动发现"还是"用户指定"。
 */
import fs from "node:fs";
import path from "node:path";


function textOf(n) {
    if (n.Type === "NodeText" && typeof n.Data === "string") return n.Data;
    let r = "";
    for (const c of n.Children || []) r += textOf(c);
    return r;
}

const items = [];
function collect(node, book) {
    const p = node.Properties || {};
    if (p["custom-weread-type"] === "highlight") {
        const x = textOf(node).replace(/\s+/g, "");
        if (x.length >= 12) items.push({ x, book });
    }
    for (const c of node.Children || []) collect(c, book);
}

for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".sy"))) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch { continue; }
    if ((d.Properties || {}).type !== "doc") continue;
    const book = d.Properties["custom-weread-book-title"] || d.Properties.name || "?";
    for (const c of d.Children || []) collect(c, book);
}

// 停用词：中文虚词 + 通用高频片段
const STOP = new Set(`我们 你们 他们 自己 这个 那个 一个 一种 一些 什么 没有 就是 可以 不是 这些 那些 因为 所以 但是 如果 已经 还是 这样 那样 知道 觉得 时候 现在 问题 事情 东西 地方 方式 方法 过程 结果 情况 部分 方面 之间 之后 之前 通过 对于 关于 以及 并且 而且 或者 虽然 然而 因此 于是 只是 不过 其实 真的 非常 特别 重要 需要 应该 可能 一定 必须 不能 不会 不能 的是 了的 是一 这个 那就 那么 这么 怎么 为什么  어떻게`.split(/\s+/).filter(Boolean));

const count = (n) => {
    const m = new Map();
    for (const it of items) {
        const seen = new Set();
        for (let i = 0; i + n <= it.x.length; i++) {
            const g = it.x.slice(i, i + n);
            if (/[^\u4e00-\u9fa5]/.test(g)) continue; // 只留纯汉字
            if (STOP.has(g)) continue;
            if (seen.has(g)) continue;
            seen.add(g);
            const e = m.get(g) || { n: 0, books: new Set() };
            e.n++;
            e.books.add(it.book);
            m.set(g, e);
        }
    }
    return [...m.entries()].filter(([, v]) => v.n >= 8 && v.books.size >= 3).sort((a, b) => b[1].n - a[1].n);
};

for (const n of [2, 3, 4]) {
    const top = count(n).slice(0, 30);
    console.log(`\n=== ${n} 字片段（出现≥8次且跨≥3本书）Top30 ===`);
    console.log(top.map(([k, v]) => `${k}(${v.n}/${v.books.size}本)`).join("  "));
}
console.log(`\n参与统计的划线：${items.length} 条`);
