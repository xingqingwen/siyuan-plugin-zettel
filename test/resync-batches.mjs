/**
 * 分批重同步：补齐 v2 属性（书名/作者/时间）+ 想法批注锚点。
 * 分批是为了避免一次性 3000+ 次 updateBlock 压垮内核（已真实崩过一次）。
 * 用法: node test/resync-batches.mjs [每批本数]
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
copyFileSync(statePath, `${PETAL}/state.json.bak-resync`);
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
const allIds = books.filter((b) => b.noteCount > 0 || b.reviewCount > 0).map((b) => b.bookId);
const size = Number(process.argv[2] || 50);
console.log(`共 ${allIds.length} 本，每批 ${size} 本`);

let total = { created: 0, updated: 0, deleted: 0, books: 0, skipped: 0, failed: [] };
for (let i = 0; i < allIds.length; i += size) {
    const batch = allIds.slice(i, i + size);
    process.stdout.write(`\n[批次 ${Math.floor(i / size) + 1}] ${i + 1}-${i + batch.length} …`);
    const r = await syncBooks(fakePlugin, client, cfg, new Set(batch));
    total.created += r.created;
    total.updated += r.updated;
    total.deleted += r.deleted;
    total.books += r.books;
    total.skipped += r.skipped;
    total.failed.push(...r.failed);
    console.log(` 完成 ${r.books} 本（失败 ${r.failed.length}）`);

    // 内核健康检查
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
