/**
 * 属性回填 v2：为已同步的 339 本书补上「书名 / 作者 / 时间」三个字段。
 * 直接读写真实 petal 目录（等价于插件在思源里跑一次全量同步），不新建文档。
 * 用法: node test/backfill-v2.mjs
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

// 备份 state，防止中途失败写坏
const statePath = `${PETAL}/state.json`;
copyFileSync(statePath, `${PETAL}/state.json.bak-v2`);
console.log("已备份 state.json → state.json.bak-v2");

const cfg = JSON.parse(readFileSync(`${PETAL}/config.json`, "utf8"));

const fakePlugin = {
    async loadData(name) {
        const p = `${PETAL}/${name}`;
        if (!existsSync(p)) return undefined;
        const obj = JSON.parse(readFileSync(p, "utf8"));
        // 骗过 revChanged 判断 → 强制全量重跑（不改配置，只改内存里的 revision）
        if (name === "state.json") obj.__revision = "force-backfill-v2";
        return obj;
    },
    async saveData(name, content) {
        writeFileSync(`${PETAL}/${name}`, JSON.stringify(content));
        return null;
    },
};

const client = new WereadClient(cfg.apiKey);
const t0 = Date.now();
let lastLog = 0;
const r = await syncBooks(fakePlugin, client, cfg, undefined, (msg, done, total) => {
    const now = Date.now();
    if (now - lastLog > 3000 || done === total) {
        lastLog = now;
        console.log(`  ${done}/${total} ${msg}`);
    }
});
console.log(`\n同步完成: ${JSON.stringify(r)}  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// 验证：属性覆盖率
await new Promise((res) => setTimeout(res, 3000));
const q = async (stmt) => (await fetchSyncPost("/api/query/sql", { stmt })).data || [];
const total = await q(`SELECT count(*) c FROM blocks WHERE type='p' AND ial LIKE '%custom-weread-type=%'`);
const withTime = await q(`SELECT count(*) c FROM blocks WHERE type='p' AND ial LIKE '%custom-weread-time=%'`);
const withTitle = await q(`SELECT count(*) c FROM blocks WHERE type='p' AND ial LIKE '%custom-weread-book-title=%'`);
console.log(`划线/想法块总数: ${total[0]?.c}`);
console.log(`带时间字段: ${withTime[0]?.c}`);
console.log(`带书名字段: ${withTitle[0]?.c}`);
