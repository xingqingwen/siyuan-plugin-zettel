import { NOTEBOOK as NB, TOKEN } from "./_env.mjs";
/** 诊断2：普通块引用 ((id "anchor")) 是否在索引时注册 refs */
import { execFileSync } from "child_process";

const api = (ep, p) =>
    JSON.parse(
        execFileSync("curl", ["-s", "-m", "15", "http://127.0.0.1:6806" + ep, "-H", `Authorization: Token ${TOKEN}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(p ?? {})], { encoding: "utf8" }),
    );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = api("/api/filetree/createDocWithMd", { notebook: NB, path: `/卡片/DIA2源A ${Date.now() % 100000}`, markdown: "源A的内容。" });
await sleep(3500);
// 同一篇里：普通块引用一行 + embed 一行，对照
const b = api("/api/filetree/createDocWithMd", {
    notebook: NB,
    path: `/卡片/DIA2文章 ${Date.now() % 100000}`,
    markdown: `引言。\n\n{{embed ((${a.data} "DIA2源A"))}}\n\n🔗 合成来源：((${a.data} "DIA2源A"))\n`,
});
const ms = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
        const r = api("/api/query/sql", { stmt: `SELECT block_id, def_block_id, type FROM refs WHERE def_block_id='${a.data}' LIMIT 5` });
        if (r.data?.length) return { ms: Date.now() - t0, rows: r.data };
        await sleep(500);
    }
    return { ms: -1, rows: [] };
})();
console.log("refs(def=源A) 耗时:", ms.ms, JSON.stringify(ms.rows));

for (const id of [a.data, b.data]) {
    const p = api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${id}' AND type='d' LIMIT 1` });
    if (p.data?.[0]?.path) {
        api("/api/filetree/removeDoc", { notebook: NB, path: p.data[0].path });
    }
}
console.log("已清理");
