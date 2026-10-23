import { TOKEN, NOTEBOOK } from "./_env.mjs";
/**
 * v0.9.1 端到端验证：三条建卡路径对真实内核的写入是否全部可检索。
 * 模拟 cards.ts 的 createCardDoc / 永久卡成文的确切行为：
 *   1. 文献卡（quote 锚定）→ custom-card-type=文献
 *   2. 地图卡 → custom-card-type=地图 + custom-card-map JSON 可被总览 SQL 捞到
 *   3. 永久卡 → 嵌入块建立引用 + custom-card-type=永久
 * 全部走 curl（内核对非浏览器 UA 的 GET 有限制，-d POST 稳定）。
 * 跑完自清理。断言失败即退出码非 0。
 */
import { execFileSync } from "child_process";

const KERNEL = "http://127.0.0.1:6806";

let failures = 0;
const ok = (cond, label) => {
    console.log(`${cond ? "✅" : "❌"} ${label}`);
    if (!cond) failures++;
};

function api(endpoint, payload, attempt = 0) {
    let out = "";
    try {
        out = execFileSync(
            "curl",
            ["-s", "-m", "15", `${KERNEL}${endpoint}`, "-H", `Authorization: Token ${TOKEN}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(payload ?? {})],
            { encoding: "utf8" },
        );
    } catch {
        // curl 层失败按空响应处理，走重试
    }
    try {
        return JSON.parse(out);
    } catch {
        if (attempt < 3) {
            // 内核偶发空响应（历史已知），退避重试
            execFileSync(process.execPath, ["-e", "setTimeout(()=>{},450)"]);
            return api(endpoint, payload, attempt + 1);
        }
        throw new Error(`非 JSON 响应 ${endpoint}: ${out.slice(0, 120)}`);
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询直到 SQL 能看到，返回耗时 ms；超时返回 -1 */
async function pollSql(stmt, ms = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const r = api("/api/query/sql", { stmt });
        if (r.code === 0 && r.data?.length) return Date.now() - t0;
        await sleep(400);
    }
    return -1;
}

async function waitIndexed(docId, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const r = api("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE id='${docId}' LIMIT 1` });
        if (r.code === 0 && r.data?.length) return true;
        await sleep(300);
    }
    return false;
}

// ---------- 0. 内核健康 ----------
const health = api("/api/query/sql", { stmt: "SELECT count(*) AS n FROM blocks" });
ok(health.code === 0 && health.data?.[0]?.n > 0, `内核健康（blocks=${health.data?.[0]?.n}）`);

// ---------- 1. 文献卡 ----------
const litMd = [
    "**我的判断**",
    "",
    "端到端测试：文献卡正文占位。",
    "",
    "---",
    "",
    "> 端到端测试引用原文，用来验证 quote 锚定路径。",
    "> ——《测试之书》第一章",
    "",
].join("\n");
const lit = api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/卡片/E2E文献卡 ${Date.now().toString().slice(-5)}`, markdown: litMd });
ok(lit.code === 0 && !!lit.data, `文献卡建文档 docId=${lit.data}`);
ok(await waitIndexed(lit.data), "文献卡进入 SQL 索引");

let set = api("/api/attr/setBlockAttrs", { id: lit.data, attrs: { "custom-card-type": "文献", "custom-card-book": "测试之书" } });
ok(set.code === 0, "文献卡写 IAL 成功");
await sleep(400);
let back = api("/api/attr/getBlockAttrs", { id: lit.data });
ok(back.data?.["custom-card-type"] === "文献", "文献卡类型回读一致");
const litIalMs = await pollSql(`SELECT id FROM blocks WHERE type='d' AND ial LIKE '%custom-card-type=%' AND id='${lit.data}' LIMIT 1`);
ok(litIalMs >= 0, `listCards 全类型 SQL 能捞到文献卡（ial 索引延迟 ${litIalMs}ms）`);

// ---------- 2. 地图卡 ----------
const mapPayload = { points: [{ name: "测试角", lat: 26.6, lng: 56.2 }], regions: [{ name: "测试海", n: 10, e: 60, s: 5, w: 50 }] };
const mapMd = [
    "**我的判断**",
    "",
    "端到端测试：地图卡正文占位。",
    "",
    "---",
    "",
    "- 📍 测试角：26.6°N, 56.2°E",
    "- ▭ 测试海：10.0°N~5.0°N, 50.0°E~60.0°E",
    "",
].join("\n");
const map = api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/卡片/E2E地图卡 ${Date.now().toString().slice(-5)}`, markdown: mapMd });
ok(map.code === 0 && !!map.data, `地图卡建文档 docId=${map.data}`);
ok(await waitIndexed(map.data), "地图卡进入 SQL 索引");
set = api("/api/attr/setBlockAttrs", { id: map.data, attrs: { "custom-card-type": "地图", "custom-card-map": JSON.stringify(mapPayload) } });
ok(set.code === 0, "地图卡写 IAL（含 map JSON）成功");
const mapIalMs = await pollSql(`SELECT id, content FROM blocks WHERE type='d' AND ial LIKE '%custom-card-map=%' AND id='${map.data}' LIMIT 1`);
ok(mapIalMs >= 0, `地图总览 SQL 能捞到地图卡（ial 索引延迟 ${mapIalMs}ms）`);
const mapAttrBack = api("/api/attr/getBlockAttrs", { id: map.data });
const parsed = JSON.parse(mapAttrBack.data?.["custom-card-map"] || "{}");
ok(parsed.points?.[0]?.lat === 26.6 && parsed.regions?.[0]?.w === 50, "custom-card-map JSON 往返无损");

// ---------- 3. 永久卡（多卡成文） ----------
await sleep(400); // 让嵌入目标也稳定
const artLines = [`端到端测试引言。`, ""];
for (const id of [lit.data, map.data]) {
    artLines.push(`{{embed ((${id} "E2E卡"))}}`, "");
}
// 产线 v0.9.1 起：末尾补一行普通块引用（嵌入块的引用只在渲染时注册，索引时不进 refs）
artLines.push("---", "", `🔗 合成来源：((${lit.data} "E2E卡"))、((${map.data} "E2E卡"))`);
const art = api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/卡片/E2E永久卡 ${Date.now().toString().slice(-5)}`, markdown: artLines.join("\n") });
ok(art.code === 0 && !!art.data, `永久卡建文档 docId=${art.data}`);
ok(await waitIndexed(art.data), "永久卡进入 SQL 索引");
set = api("/api/attr/setBlockAttrs", { id: art.data, attrs: { "custom-card-type": "永久" } });
ok(set.code === 0, "永久卡写 IAL 成功");
const artIalMs = await pollSql(`SELECT id FROM blocks WHERE type='d' AND ial LIKE '%custom-card-type="永久"%' AND id='${art.data}' LIMIT 1`);
ok(artIalMs >= 0, `永久卡类型可检索（ial 索引延迟 ${artIalMs}ms）`);
const litRefMs = await pollSql(`SELECT rowid FROM refs WHERE def_block_id='${lit.data}' LIMIT 1`);
ok(litRefMs >= 0, `嵌入块给源卡建立了引用（refs 建立耗时 ${litRefMs}ms，链路图能连上）`);
const mapRefMs = await pollSql(`SELECT rowid FROM refs WHERE def_block_id='${map.data}' LIMIT 1`);
ok(mapRefMs >= 0, `地图卡同样被永久卡引用（refs 建立耗时 ${mapRefMs}ms）`);

// ---------- 清理 ----------
for (const id of [lit.data, map.data, art.data]) {
    const row = api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${id}' AND type='d' LIMIT 1` });
    const path = row.data?.[0]?.path;
    if (path) {
        const rm = api("/api/filetree/removeDoc", { notebook: NOTEBOOK, path });
        console.log(`${rm.code === 0 ? "🧹" : "⚠️"} 清理 ${path}（code=${rm.code}）`);
    } else {
        console.log(`⚠️ 清理失败：查不到 ${id} 的 path`);
    }
}
console.log(failures === 0 ? "\n全部通过 🎉" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
