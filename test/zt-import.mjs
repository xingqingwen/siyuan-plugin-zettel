import { NOTEBOOK as NB } from "./_env.mjs";
// 真实内核验证：listNoteDocs 排除规则 + docExcerpts 摘要
import { execSync } from "child_process";
execSync(`"node_modules/.bin/esbuild.cmd" src/importNote.ts --bundle --platform=node --format=esm --alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.import-bundle.mjs`, { stdio: "pipe" });
const m = await import("./.import-bundle.mjs");

const docs = await m.listNoteDocs({
    notebook: NB,
    excludePrefixes: ["/卡片", "/微信读书"],
    limit: 300,
});
console.log("候选文档数:", docs.length);
console.log("前 5 篇:");
for (const d of docs.slice(0, 5)) {
    console.log(" -", d.hpath, "| 更新:", d.updated, "| 已成卡:", d.carded);
}
const leaked = docs.filter((d) => d.hpath.startsWith("/卡片") || d.hpath.startsWith("/微信读书"));
console.log("排除区泄漏:", leaked.length, leaked.length ? "(FAIL)" : "(OK)");

const ex = await m.docExcerpts(docs.slice(0, 20).map((d) => d.id));
console.log("拿到摘要:", ex.size, "/ 20");
for (const [id, s] of [...ex].slice(0, 3)) {
    const d = docs.find((x) => x.id === id);
    console.log(" 摘要[", d.hpath, "]:", s.slice(0, 60));
}

// 关键词搜索走 SQL
const kwDocs = await m.listNoteDocs({ notebook: NB, excludePrefixes: ["/卡片", "/微信读书"], kw: "习惯", limit: 20 });
console.log("搜「习惯」:", kwDocs.length, "篇");
