import { NOTEBOOK as NB, TOKEN } from "./_env.mjs";
// 真实内核验证 createCardDoc 全链路：建卡 → 属性 → 引用 → 删除
import { execSync } from "child_process";
execSync(`"node_modules/.bin/esbuild.cmd" src/cards.ts --bundle --platform=node --format=esm --alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.cards-bundle.mjs`, { stdio: "pipe" });
const m = await import("./.cards-bundle.mjs");

const plugin = { config: { notebookId: NB, cardPath: "_卡片自检" }, app: {}, loadData: async () => ({}) };

const made = await m.createCardDoc(plugin, {
    title: "_自检卡片_断电前的判断",
    body: "这是我的判断，用自己的话写的。",
    quote: "习惯是被重复了足够多次的行为。",
    quoteMeta: "《自检书》第一章 · 2026-10-23",
});
console.log("1. 建卡:", made.docId, "标题:", made.title);

const attrs = await (await fetch("http://127.0.0.1:6806/api/attr/getBlockAttrs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
    body: JSON.stringify({ id: made.docId }),
})).json();
console.log("2. 属性:", JSON.stringify(attrs.data));

const kd = await (await fetch("http://127.0.0.1:6806/api/block/getBlockKramdown", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
    body: JSON.stringify({ id: made.docId }),
})).json();
console.log("3. 正文:", JSON.stringify(kd.data?.kramdown));

// 关联建议：造一张卡再试
const made2 = await m.createCardDoc(plugin, { title: "环境设计比自律更可靠" });
const cards = [
    { id: made.docId, title: made.title, book: "", source: "", created: "2026-10-23", refs: 0, status: "待打磨" },
    { id: made2.docId, title: made2.title, book: "", source: "", created: "2026-10-23", refs: 0, status: "待打磨" },
];
console.log("4. 关联建议:", m.findRelated(cards, cards[0], 5).map(h => h.card.title + " / " + h.shared.join(",")));

const n = await m.appendLinks(made2.docId, [{ id: made.docId, title: made.title }]);
console.log("5. 写入连接:", n, "条");

await new Promise(r => setTimeout(r, 1500));
const q = await (await fetch("http://127.0.0.1:6806/api/query/sql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
    body: JSON.stringify({ stmt: `SELECT count(*) c FROM refs WHERE def_block_id='${made.docId}'` }),
})).json();
console.log("6. 目标卡被引用次数:", q.data?.[0]?.c);

for (const id of [made.docId, made2.docId]) {
    await fetch("http://127.0.0.1:6806/api/filetree/removeDocByID", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify({ id }),
    });
}
console.log("7. 测试卡已删除");
