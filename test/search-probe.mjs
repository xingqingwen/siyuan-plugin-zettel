/** 验证检索台的数据与命中率 */
import { fetchSyncPost } from "./stub-siyuan.mjs";

const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];
const rows = await q(
    `SELECT id, root_id, markdown, ial FROM blocks ` +
        `WHERE ial LIKE '%custom-weread-type="highlight"%' ` +
        `OR ial LIKE '%custom-weread-type="thought"%' ` +
        `OR ial LIKE '%custom-weread-type="popular"%' LIMIT 100000`,
);
const pick = (ial, k) => {
    const m = new RegExp(`${k}="([^"]*)"`).exec(ial || "");
    return m ? m[1] : "";
};
const clean = (md) =>
    (md || "").replace(/^>\s?/gm, "").replace(/^\s*✏️\s*/gm, "").replace(/^\s*🔥\s*/gm, "").trim();

const all = rows
    .map((r) => ({
        id: r.id,
        text: clean(r.markdown),
        book: pick(r.ial, "custom-weread-book-title"),
        chapter: pick(r.ial, "custom-weread-chapter"),
        time: pick(r.ial, "custom-weread-time"),
        type: pick(r.ial, "custom-weread-type"),
    }))
    .filter((h) => h.text && h.text.length > 1);

console.log(`可检索条目: ${all.length}`);
console.log(`有书名的: ${all.filter((h) => h.book).length}`);
console.log(`有时间的: ${all.filter((h) => h.time).length}`);
console.log(`按类型: 划线 ${all.filter((h) => h.type === "highlight").length} / 想法 ${all.filter((h) => h.type === "thought").length}`);

for (const kw of ["习惯", "思考", "钱", "孩子", "系统"]) {
    const hits = all.filter((h) => (h.text + h.book + h.chapter).includes(kw));
    console.log(`\n搜「${kw}」→ ${hits.length} 条`);
    hits.slice(0, 3).forEach((h) => console.log(`  《${h.book}》${h.chapter} ${h.time}｜${h.text.slice(0, 50)}`));
}
