/** 只读统计：整理能清掉多少（不删任何块） */
import { fetchSyncPost } from "./stub-siyuan.mjs";

const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];
const norm = (s) =>
    (s || "")
        .replace(/^>\s?/gm, "")
        .replace(/[\s\p{P}\p{S}]/gu, "")
        .toLowerCase();
const kindOf = (ial) => {
    const m = /custom-weread-type="([^"]*)"/.exec(ial || "");
    return m ? m[1] : "";
};

const docs = await q("SELECT root_id, count(*) c FROM blocks WHERE ial LIKE '%custom-weread-type=\"highlight\"%' GROUP BY root_id ORDER BY c DESC LIMIT 100000");
console.log(`有划线的文档: ${docs.length}`);

let dupTotal = 0;
let emptyTotal = 0;
const bookDup = [];

for (const d of docs) {
    const rows = await q(`SELECT id, markdown, ial FROM blocks WHERE root_id='${d.root_id}' LIMIT 100000`);
    const seen = new Set();
    let dup = 0;
    for (const r of rows) {
        if (kindOf(r.ial) !== "highlight") continue;
        const n = norm(r.markdown);
        if (n.length < 6) continue;
        if (seen.has(n)) dup++;
        else seen.add(n);
    }
    // 空章节
    const ordered = rows.filter((r) => kindOf(r.ial)).sort((a, b) => (a.id < b.id ? -1 : 1));
    let empty = 0;
    for (let i = 0; i < ordered.length; i++) {
        if (kindOf(ordered[i].ial) !== "chapter") continue;
        let has = false;
        for (let j = i + 1; j < ordered.length; j++) {
            const k = kindOf(ordered[j].ial);
            if (k === "chapter") break;
            if (k === "highlight" || k === "thought" || k === "popular") {
                has = true;
                break;
            }
        }
        if (!has) empty++;
    }
    dupTotal += dup;
    emptyTotal += empty;
    if (dup > 0) bookDup.push({ doc: d.root_id, dup, total: Number(d.c) });
}

console.log(`\n可去重的重复划线: ${dupTotal} 条`);
console.log(`可清理的空章节: ${emptyTotal} 个`);
console.log(`涉及重复的书: ${bookDup.length} 本，Top5:`);
bookDup.slice(0, 5).forEach((b) => console.log(`  ${b.doc} 重复 ${b.dup} / ${b.total} 条`));

// 想法锚点属性覆盖
const on = await q("SELECT count(*) c FROM blocks WHERE ial LIKE '%custom-weread-on=%'");
console.log(`\n已带批注锚点属性的想法块: ${on[0]?.c}（重同步一次后才会全部带上）`);
