/**
 * 一次性：回填想法的原文摘录（abstract）。
 * 只重同步 reviewCount > 0 的书，避免全量 339 本。
 * 用法: node test/backfill-abstract.mjs
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const PETAL = process.env.SIYUAN_PETAL || "";

execSync(
    `"${root}/node_modules/.bin/esbuild.cmd" src/sync.ts --bundle --platform=node --format=esm ` +
    `--alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.sync-bundle.mjs`,
    { cwd: root, stdio: "pipe" },
);
execSync(
    `"${root}/node_modules/.bin/esbuild.cmd" src/weread.ts --bundle --platform=node --format=esm ` +
    `--alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.weread-bundle.mjs`,
    { cwd: root, stdio: "pipe" },
);

const { syncBooks } = await import("./.sync-bundle.mjs");
const { WereadClient } = await import("./.weread-bundle.mjs");
const { fetchSyncPost } = await import("./stub-siyuan.mjs");

const statePath = `${PETAL}/state.json`;
copyFileSync(statePath, `${PETAL}/state.json.bak-abs`);
console.log("已备份 state");

const cfg = JSON.parse(readFileSync(`${PETAL}/config.json`, "utf8"));
const fakePlugin = {
    async loadData(name) {
        const p = `${PETAL}/${name}`;
        if (!existsSync(p)) return undefined;
        const obj = JSON.parse(readFileSync(p, "utf8"));
        if (name === "state.json") obj.__revision = `force-${Date.now()}`;
        return obj;
    },
    async saveData(name, content) {
        writeFileSync(`${PETAL}/${name}`, JSON.stringify(content));
        return null;
    },
};

const client = new WereadClient(cfg.apiKey);
const books = await client.listNotebooks();
const withReviews = books.filter((b) => (b.reviewCount || 0) > 0);
const allIds = withReviews.map((b) => b.bookId);
console.log(`有想法的书 ${allIds.length} 本（共 ${withReviews.reduce((s, b) => s + b.reviewCount, 0)} 条想法）`);

const size = 10;
let total = { created: 0, updated: 0, deleted: 0, books: 0, skipped: 0, failed: [] };
for (let i = 0; i < allIds.length; i += size) {
    const batch = allIds.slice(i, i + size);
    process.stdout.write(`[批次 ${Math.floor(i / size) + 1}] ${i + 1}-${i + batch.length} …`);
    const r = await syncBooks(fakePlugin, client, cfg, new Set(batch));
    total.created += r.created;
    total.updated += r.updated;
    total.deleted += r.deleted;
    total.books += r.books;
    total.skipped += r.skipped;
    total.failed.push(...r.failed);
    console.log(` 完成 ${r.books} 本（失败 ${r.failed.length}）`);

    const v = await fetchSyncPost("/api/system/version", {}).catch(() => null);
    if (!v || v.code !== 0) {
        console.error("\n⚠️ 内核无响应，停止后续批次");
        break;
    }
    if (i + size < allIds.length) {
        await new Promise((res) => setTimeout(res, 4000));
    }
}

console.log(`\n汇总: ${JSON.stringify({ ...total, failed: total.failed.length })}`);
if (total.failed.length > 0) {
    console.log("失败书目:", total.failed.slice(0, 10).join(" / "));
}
