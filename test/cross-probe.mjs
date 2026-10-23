/** 探针：1626 条划线里，有多少是「跨书重复」的（不依赖词典） */
import { fetchSyncPost } from "./stub-siyuan.mjs";

const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];
const rows = await q(
    `SELECT root_id, markdown, ial FROM blocks WHERE ial LIKE '%custom-weread-type="highlight"%' LIMIT 100000`,
);
console.log("划线总数:", rows.length);

const titleOf = (ial) => {
    const m = /custom-weread-book-title="([^"]*)"/.exec(ial || "");
    return m ? m[1] : "(未知)";
};
const norm = (s) =>
    (s || "")
        .replace(/^>\s?/gm, "")
        .replace(/[\s\p{P}\p{S}]/gu, "")
        .toLowerCase();

const bucket = new Map();
for (const r of rows) {
    const n = norm(r.markdown);
    if (n.length < 8) continue;
    const key = n.slice(0, 36);
    const cur = bucket.get(key) || { n: 0, books: new Set(), sample: "" };
    cur.n++;
    cur.books.add(titleOf(r.ial));
    if (!cur.sample) cur.sample = (r.markdown || "").replace(/^>\s?/gm, "").slice(0, 40);
    bucket.set(key, cur);
}

const dup = [...bucket.values()].filter((v) => v.n >= 2);
const cross = [...bucket.values()].filter((v) => v.books.size >= 2);
console.log(`重复出现（>=2 次）的句子: ${dup.length}`);
console.log(`跨书重复（>=2 本书）: ${cross.length}`);

console.log("\n跨书样例:");
cross
    .sort((a, b) => b.books.size - a.books.size)
    .slice(0, 10)
    .forEach((v) => console.log(`  [${v.books.size} 本] ${v.sample}  ← ${[...v.books].join(" / ")}`));

// 顺带看看书名的长度分布，判断词典可用性
const titles = new Set(rows.map((r) => titleOf(r.ial)));
console.log(`\n涉及书籍: ${titles.size} 本`);
const short = [...titles].filter((t) => t.length < 3);
console.log(`书名 <3 字的: ${short.length} 个，样例: ${short.slice(0, 5).join(" / ")}`);
