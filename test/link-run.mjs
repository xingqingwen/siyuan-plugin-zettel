/**
 * 关联工具实跑验证：node test/link-run.mjs [书名字关键词]
 */
import { execSync } from "child_process";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
execSync(
    `"${root}/node_modules/.bin/esbuild.cmd" src/link.ts --bundle --platform=node --format=esm ` +
    `--alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.link-bundle.mjs`,
    { cwd: root, stdio: "pipe" },
);

const { buildLexicon, linkBook, crossBook, tidyBook } = await import("./.link-bundle.mjs");
const { fetchSyncPost } = await import("./stub-siyuan.mjs");
const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];

const kw = process.argv[2];
let target;
if (kw) {
    const rows = await q(`SELECT id, name FROM blocks WHERE name LIKE '%${kw}%' AND type='d'`);
    target = rows[0];
} else {
    const rows = await q(
        `SELECT root_id as id, count(*) c FROM blocks WHERE ial LIKE '%custom-weread-type="highlight"%' GROUP BY root_id ORDER BY c DESC LIMIT 1`,
    );
    target = rows[0];
}
if (!target) {
    console.error("找不到目标文档");
    process.exit(1);
}
const doc = (await q(`SELECT name, hpath FROM blocks WHERE id='${target.id}'`))[0];
console.log(`目标: ${doc?.name || target.id}  路径: ${doc?.hpath}`);

console.log("\n--- 建词典 ---");
const t0 = Date.now();
const lex = await buildLexicon();
console.log(`词典 ${lex.size} 条，耗时 ${Date.now() - t0}ms`);
console.log("样例词条:", [...lex.keys()].slice(0, 8).join(" | "));

console.log("\n--- 本文提及 ---");
const t1 = Date.now();
const r1 = await linkBook(target.id, lex);
console.log(JSON.stringify(r1), `耗时 ${Date.now() - t1}ms`);

await new Promise((r) => setTimeout(r, 2000));
const after1 = await q(`SELECT markdown FROM blocks WHERE root_id='${target.id}' ORDER BY id DESC LIMIT 6`);
after1.reverse().forEach((b) => console.log("  " + (b.markdown || "").replace(/\n/g, " ⏎ ").slice(0, 100)));

console.log("\n--- 跨书共鸣 ---");
const t2 = Date.now();
const r2 = await crossBook(target.id);
console.log(JSON.stringify(r2), `耗时 ${Date.now() - t2}ms`);
await new Promise((r) => setTimeout(r, 2000));
const after2 = await q(`SELECT markdown FROM blocks WHERE root_id='${target.id}' ORDER BY id DESC LIMIT 6`);
after2.reverse().forEach((b) => console.log("  " + (b.markdown || "").replace(/\n/g, " ⏎ ").slice(0, 100)));

console.log("\n--- 整体统计 ---");
const stat = await q(
    `SELECT count(*) blocks, count(DISTINCT root_id) docs FROM blocks WHERE ial LIKE '%custom-weread-type%' AND markdown LIKE '%本文提及%'`,
);
console.log(JSON.stringify(stat));
