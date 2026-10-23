/**
 * 实验：用「你自己的文档名」当词典，扫描 1626 条划线，看能自动连出多少关联。
 * 只读，不写任何数据。
 */
import { fetchSyncPost } from "./stub-siyuan.mjs";

const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];

// 1. 词典：你自己建的文档（排除插件同步出来的书）
const docs = await q(
    "SELECT id, name, alias, hpath FROM blocks WHERE type='d' AND (hpath NOT LIKE '%微信读书%' OR hpath IS NULL) LIMIT 100000",
);
// 2. 目标：同步进来的划线
const hls = await q(
    "SELECT id, markdown, ial FROM blocks WHERE ial LIKE '%custom-weread-type=\"highlight\"%' LIMIT 100000",
);

console.log(`你的文档: ${docs.length} 篇 | 划线: ${hls.length} 条`);

// 词典：文档名 + 别名，只保留 3~20 字的中文/英文词组，去掉太泛的词
const GENERIC = new Set([
    "笔记", "读书", "思考", "总结", "日记", "想法", "记录", "摘录", "复盘", "计划",
    "问题", "方法", "学习", "工作", "生活", "项目", "文档", "资料", "收藏", "待办",
]);
const dict = new Map(); // 词 → docId
for (const d of docs) {
    const names = [];
    if (d.name) names.push(d.name);
    if (d.alias) {
        try {
            const a = JSON.parse(d.alias);
            if (Array.isArray(a)) names.push(...a);
        } catch {}
    }
    for (const raw of names) {
        const w = String(raw).trim();
        if (w.length < 3 || w.length > 20) continue;
        if (GENERIC.has(w)) continue;
        if (!dict.has(w)) dict.set(w, d.id);
    }
}
console.log(`词典词条: ${dict.size}`);

// 按长度倒序匹配，长词优先（避免"习惯"命中"习惯的力量"里的短词）
const words = [...dict.keys()].sort((a, b) => b.length - a.length);

const hits = [];
const counter = new Map();
for (const h of hls) {
    const text = (h.markdown || "").replace(/^>\s?/gm, "");
    if (!text.trim()) continue;
    const matched = [];
    for (const w of words) {
        if (text.includes(w)) {
            matched.push(w);
            if (matched.length >= 3) break;
        }
    }
    if (matched.length > 0) {
        hits.push({ id: h.id, text: text.slice(0, 60), matched });
        for (const w of matched) counter.set(w, (counter.get(w) || 0) + 1);
    }
}

console.log(`\n能自动连出关联的划线: ${hits.length} / ${hls.length} (${((hits.length / hls.length) * 100).toFixed(1)}%)`);
console.log("\n被提及最多的文档名:");
[...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([w, c]) => console.log(`  ${c} 次  ${w}`));

console.log("\n样例:");
hits.slice(0, 8).forEach((h) => console.log(`  「${h.text}」→ ${h.matched.join(" / ")}`));
