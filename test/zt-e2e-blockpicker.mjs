import { TOKEN, NOTEBOOK as NB } from "./_env.mjs";
/**
 * 块选择器数据层 E2E（v0.9.4）：
 * 1. 块查询 SQL（root_id + type IN p/h/b/t + ORDER BY sort）能拉到内容块
 * 2. 批量成卡：每块一张文献卡，锚定块 id，custom-card-source 回指成立
 * 3. 已成卡检测：第二次查询时块被标为 carded
 * 4. 清理
 */
import { execFileSync } from "child_process";

const KERNEL = "http://127.0.0.1:6806";
const CARD_ROOT = "卡片"; // 用户配置的卡片根目录（与插件一致时才可写，测试用临时目录名兜底）

function api(endpoint, payload, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            const out = execFileSync(
                "curl",
                ["-s", "-m", "15", `${KERNEL}${endpoint}`, "-H", `Authorization: Token ${TOKEN}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(payload ?? {})],
                { encoding: "utf8" },
            );
            if (out) return JSON.parse(out);
        } catch { /* retry */ }
    }
    throw new Error(`内核无响应: ${endpoint}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log(`${cond ? "✅" : "❌"} ${msg}`); };

// 建一个测试文档，塞 5 个块（段落/引用/标题）
const docMd = ["# BP测试文档", "", "第一个段落，讲的是整理方法。", "", "> 这是一句引用原文，用来测试引用块。", "", "第二个段落，长度足够被选择器捞到。", ""].join("\n");
const doc = api("/api/filetree/createDocWithMd", { notebook: NB, path: `/卡片/BP测试 ${Date.now().toString().slice(-5)}`, markdown: docMd });
ok(!!doc.data, "测试文档创建");
await sleep(3500);

// 1. 块查询（复刻 blockPicker SQL）
const rows = api("/api/query/sql", { stmt: `SELECT id, type, content FROM blocks WHERE root_id='${doc.data}' AND type IN ('p','h','b','t') AND length(content) > 4 ORDER BY sort LIMIT 500` }).data || [];
console.log(`块查询结果: ${rows.length} 块 → ${rows.map((r) => r.type).join(",")}`);
ok(rows.length >= 4, "能拉到内容块（段落+引用+标题）");
ok(rows.some((r) => r.type === "b"), "引用块在列");

// 2. 批量成卡（复刻 blockPicker 的 createCardDoc 行为）
const picks = rows.filter((r) => r.type !== "h").slice(0, 2);
const madeIds = [];
for (const b of picks) {
    const title = b.content.replace(/\s+/g, " ").split(/[。！？.!?]/)[0].slice(0, 26) || "未命名卡片";
    const md = ["**我的判断**", "", "", "", "---", "", `> ${b.content.trim()}`, "> 《BP测试》· 测试笔记本", "", `来源：((${b.id} "原文"))`].join("\n");
    const card = api("/api/filetree/createDocWithMd", { notebook: NB, path: `/卡片/BP卡 ${Date.now().toString().slice(-5)}${madeIds.length}`, markdown: md });
    if (card.data) {
        madeIds.push(card.data);
        api("/api/attr/setBlockAttrs", { id: card.data, attrs: { "custom-card-type": '"文献"', "custom-card-source": b.id, "custom-card-book": "测试笔记本" } });
    }
    await sleep(300);
}
ok(madeIds.length === picks.length, `批量成卡 ${madeIds.length}/${picks.length}`);
await sleep(3200); // 等 IAL 进索引

// 3. 锚定验证：卡片 IAL 的 custom-card-source 指回块
const back = api("/api/query/sql", { stmt: `SELECT id, ial FROM blocks WHERE type='d' AND id='${madeIds[0]}' LIMIT 1` });
const srcOk = back.data?.[0]?.ial?.includes(`custom-card-source="${picks[0].id}"`);
ok(!!srcOk, "卡片锚定回源块（custom-card-source）");

// 4. 已成卡检测（复刻 carded Set 逻辑）
const cards = api("/api/query/sql", { stmt: `SELECT id, ial FROM blocks WHERE type='d' AND ial LIKE '%custom-card-source=%' LIMIT 100000` }).data || [];
const cardedSet = new Set(cards.map((c) => (/custom-card-source="([^"]*)"/.exec(c.ial) || [])[1]).filter(Boolean));
ok(cardedSet.has(picks[0].id), "已成卡块能被检测到（carded 标记）");

// 5. 来源块引用成立（refs）
const refs = api("/api/query/sql", { stmt: `SELECT count(*) c FROM refs WHERE def_block_id='${picks[0].id}'` });
ok(Number(refs.data?.[0]?.c || 0) >= 1, "来源块被卡引用（refs，链路可连）");

// 清理
for (const id of [...madeIds, doc.data]) {
    const p = api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${id}' AND type='d' LIMIT 1` });
    if (p.data?.[0]?.path) api("/api/filetree/removeDoc", { notebook: NB, path: p.data[0].path });
}
console.log("🧹 测试文档与卡片已清理");
console.log(`\n结果: ${pass} 过, ${fail} 挂`);
process.exit(fail > 0 ? 1 : 0);
