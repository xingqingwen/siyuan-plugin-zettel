import { NOTEBOOK_PREFIX } from "./_env.mjs";
/**
 * 端到端测试：真实数据跑同步引擎（不经过思源 UI）
 * 用法: node test/run-sync.mjs [bookTitleKeyword]
 */
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
// 用 esbuild 打包 sync.ts，siyuan 依赖替换为桩
execSync(
    `"${root}/node_modules/.bin/esbuild.cmd" src/sync.ts --bundle --platform=node --format=esm ` +
    `--alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.sync-bundle.mjs`,
    { cwd: root, stdio: "pipe" },
);

const { syncBooks, rebuildAll } = await import("./.sync-bundle.mjs");
const { fetchSyncPost } = await import("./stub-siyuan.mjs");

const KEY = process.env.WEREAD_TEST_KEY;
if (!KEY) {
    console.error("请设置 WEREAD_TEST_KEY");
    process.exit(1);
}
const NOTEBOOK = NOTEBOOK_PREFIX; // 知识库（前缀，下面自动补全）

// 补全笔记本 ID
const nbResp = await fetchSyncPost("/api/notebook/lsNotebooks", {});
const nb = nbResp.data.notebooks.find((n) => !n.closed && n.id.startsWith(NOTEBOOK) && n.name === "知识库");
if (!nb) {
    console.error("找不到知识库笔记本");
    process.exit(1);
}

const fakePlugin = {
    __store: {},
    app: {},
    async loadData(name) { return this.__store[name]; },
    async saveData(name, content) { this.__store[name] = content; },
};

const syncBundle = await import("./.sync-bundle.mjs");

const kw = process.argv[2] || "家有恶猫";
const cfg = {
    apiKey: KEY,
    notebookId: nb.id,
    rootPath: "微信读书同步测试",
    includeThoughts: true,
    syncPopular: true,
    popularMode: "merge",
    minHighlights: 0,
    onlyStatus: "all",
    nameWithAuthor: false,
    richMeta: true,
    autoSyncMinutes: 0,
    diaryNotebook: "",
    templates: {
        meta: "📖 {{title}} · {{author}}\n划线 {{hlCount}} 条 · 想法 {{thCount}} 条 · 热门 {{popCount}} 条 · 进度 {{progress}}%\n[打开微信读书]({{link}})",
        chapter: "{{chapterTitle}}",
        highlight: "{{markText}}",
        thought: "✏️ {{content}}",
        popular: "🔥 {{markText}}（{{totalUsers}} 人划线）",
    },
};

// 找到目标书
const { WereadClient } = await import("./.weread-bundle.mjs");
const realClient = new WereadClient(KEY);
const books = await realClient.listNotebooks();
const target = books.find((b) => (b.book?.title || "").includes(kw));
if (!target) {
    console.error(`找不到书: ${kw}，共有笔记的书 ${books.length} 本`);
    process.exit(1);
}
console.log(`目标书: ${target.book.title} | 划线${target.noteCount} 想法${target.reviewCount} sort=${target.sort}`);

console.log("--- 第一次同步（应创建文档）");
const t1 = Date.now();
const r1 = await syncBundle.syncBooks(fakePlugin, realClient, cfg, new Set([target.bookId]), (m, d, t) => {
    if (d % 1 === 0) console.log(`  ${d}/${t} ${m}`);
});
console.log(`结果: ${JSON.stringify(r1)}, 耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);

const state = fakePlugin.__store["state.json"];
const docId = state[target.bookId]?.docId;
console.log("docId:", docId);

// 思源块索引是异步更新的，等一拍再查
await new Promise((r) => setTimeout(r, 4000));

// 检查文档内容
const doc = await fetchSyncPost("/api/filetree/getDoc", { id: docId });
const blocks = (await fetchSyncPost("/api/query/sql", { stmt: `SELECT id, type, subtype, markdown, ial FROM blocks WHERE root_id='${docId}'` })).data || [];
console.log(`\n文档块数: ${blocks.length}`);
for (const b of blocks.slice(0, 12)) {
    console.log(`  [${b.type}/${b.subtype || ""}] ${(b.markdown || "").replace(/\n/g, "⏎").slice(0, 80)}`);
}
const thoughtStyled = blocks.filter((b) => b.markdown?.startsWith("✏️") || b.markdown?.includes("✏️"));
console.log(`\n想法块数量: ${thoughtStyled.length}, 其中带底色样式: ${thoughtStyled.filter((b) => b.ial?.includes("b3-card-info")).length}`);
const popularBlocks = blocks.filter((b) => b.markdown?.includes("🔥"));
console.log(`热门划线块数量: ${popularBlocks.length}, 带底色: ${popularBlocks.filter((b) => b.ial?.includes("b3-card-warning")).length}`);

// 新增：块级检索属性（让同步进来的内容能被反链 / SQL 用起来）
const attrBlocks = blocks.filter((b) => (b.ial || "").includes("custom-weread-book="));
const hlAttr = attrBlocks.filter((b) => (b.ial || "").includes('custom-weread-type="highlight"'));
const thAttr = attrBlocks.filter((b) => (b.ial || "").includes('custom-weread-type="thought"'));
const named = attrBlocks.filter((b) => (b.ial || "").includes("name="));
console.log(`\n带检索属性的块: ${attrBlocks.length}/${blocks.length}（划线 ${hlAttr.length} / 想法 ${thAttr.length}），含块命名 ${named.length}`);
if (hlAttr[0]) console.log("  划线块 ial:", hlAttr[0].ial.slice(0, 180));
if (thAttr[0]) console.log("  想法块 ial:", thAttr[0].ial.slice(0, 180));
const docRow = (await fetchSyncPost("/api/query/sql", { stmt: `SELECT tag, name FROM blocks WHERE id='${docId}'` })).data;
console.log(`文档标签: ${docRow[0]?.tag} | 文档命名: ${docRow[0]?.name}`);

console.log("\n--- 第二次同步（应整本跳过）");
const t2 = Date.now();
const r2 = await syncBundle.syncBooks(fakePlugin, realClient, cfg, new Set([target.bookId]));
console.log(`结果: ${JSON.stringify(r2)}, 耗时 ${((Date.now() - t2) / 1000).toFixed(2)}s（<2s 即跳过生效）`);

console.log("\n--- 块 ID 保留验证");
await new Promise((r) => setTimeout(r, 4000));
const doc2 = (await fetchSyncPost("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE root_id='${docId}' ORDER BY id` })).data || [];
const ids1 = blocks.map((b) => b.id).sort().join(",");
const ids2 = doc2.map((b) => b.id).sort().join(",");
console.log(ids1 === ids2 ? "✅ 第二次同步后块 ID 完全一致" : "❌ 块 ID 发生变化！");

console.log("\n✅ E2E 测试完成");
