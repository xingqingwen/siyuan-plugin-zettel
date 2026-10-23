import { NOTEBOOK as NB, TOKEN } from "./_env.mjs";
/** 诊断：embed 块在内核索引里长什么样、refs 何时建立 */
import { execFileSync } from "child_process";

const api = (ep, p) =>
    JSON.parse(
        execFileSync("curl", ["-s", "-m", "15", "http://127.0.0.1:6806" + ep, "-H", `Authorization: Token ${TOKEN}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(p ?? {})], { encoding: "utf8" }),
    );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = api("/api/filetree/createDocWithMd", { notebook: NB, path: `/卡片/DIA源A ${Date.now() % 100000}`, markdown: "源A的内容。" });
await sleep(3500);
const embedMd = `{{embed ((${a.data} "DIA源A"))}}`;
console.log("embed markdown:", embedMd);
const b = api("/api/filetree/createDocWithMd", { notebook: NB, path: `/卡片/DIA文章 ${Date.now() % 100000}`, markdown: `引言。\n\n${embedMd}\n` });
await sleep(5000);
const blocks = api("/api/query/sql", { stmt: `SELECT id, type, subtype, markdown FROM blocks WHERE root_id='${b.data}' LIMIT 20` });
console.log("文章下的块:", JSON.stringify(blocks.data, null, 1).slice(0, 900));
const refs1 = api("/api/query/sql", { stmt: `SELECT block_id, def_block_id, type FROM refs WHERE root_id='${b.data}' LIMIT 20` });
console.log("refs(root_id=文章):", JSON.stringify(refs1.data));
const refs2 = api("/api/query/sql", { stmt: `SELECT block_id, def_block_id FROM refs WHERE def_block_id='${a.data}' LIMIT 20` });
console.log("refs(def=源A):", JSON.stringify(refs2.data));
// 也可能引用挂在文档块自己身上
const refs3 = api("/api/query/sql", { stmt: `SELECT block_id, def_block_id FROM refs WHERE block_id='${b.data}' LIMIT 20` });
console.log("refs(block_id=文章doc):", JSON.stringify(refs3.data));

for (const id of [a.data, b.data]) {
    const p = api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${id}' AND type='d' LIMIT 1` });
    if (p.data?.[0]?.path) {
        api("/api/filetree/removeDoc", { notebook: NB, path: p.data[0].path });
    }
}
console.log("已清理");
