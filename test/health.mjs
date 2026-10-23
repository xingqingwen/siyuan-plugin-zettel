/** 数据体检：state 记录 vs 实际文档 vs 块属性覆盖 */
import { readFileSync } from "fs";
import { fetchSyncPost } from "./stub-siyuan.mjs";

const PETAL = process.env.SIYUAN_PETAL || "";
const state = JSON.parse(readFileSync(`${PETAL}/state.json`, "utf8"));
const recs = Object.entries(state).filter(([k]) => !k.startsWith("__"));

const docs = (await fetchSyncPost("/api/query/sql", {
    stmt: "SELECT id, name, hpath FROM blocks WHERE type='d'",
})).data || [];
const docSet = new Set(docs.map((d) => d.id));

const missing = recs.filter(([, v]) => !docSet.has(v.docId));
const wechatDocs = docs.filter((d) => (d.hpath || "").includes("微信读书"));

const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];
const total = await q("SELECT count(*) c FROM blocks WHERE ial LIKE '%custom-weread-type=%'");
const withTime = await q("SELECT count(*) c FROM blocks WHERE ial LIKE '%custom-weread-time=%'");
const hl = await q("SELECT count(*) c FROM blocks WHERE ial LIKE '%custom-weread-type=\"highlight\"%'");
const th = await q("SELECT count(*) c FROM blocks WHERE ial LIKE '%custom-weread-type=\"thought\"%'");

console.log(`state 记录: ${recs.length}`);
console.log(`state 中 docId 已不存在: ${missing.length}`);
console.log(`全部文档: ${docs.length}，其中路径含「微信读书」: ${wechatDocs.length}`);
console.log(`同步块总数: ${total[0]?.c}（划线 ${hl[0]?.c} / 想法 ${th[0]?.c}）`);
console.log(`带时间字段: ${withTime[0]?.c}`);

if (missing.length > 0) {
    console.log("\n前 10 条丢失记录:");
    for (const [bookId, v] of missing.slice(0, 10)) {
        console.log(`  ${bookId} → ${v.docId}`);
    }
}
const paths = [...new Set(wechatDocs.map((d) => (d.hpath || "").split("/").slice(0, 2).join("/")))];
console.log("\n路径前缀分布:", paths.slice(0, 5));
