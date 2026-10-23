import { TOKEN } from "./_env.mjs";
// 验证卡片阅读视图的数据层：getDoc 渲染普通卡 + 永久卡（嵌入块在面板渲染时长什么样）
import { execFileSync } from "child_process";

const KERNEL = "http://127.0.0.1:6806";

function api(endpoint, payload) {
    for (let i = 0; i < 3; i++) {
        const out = execFileSync(
            "curl",
            ["-s", "-m", "15", `${KERNEL}${endpoint}`, "-H", `Authorization: Token ${TOKEN}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(payload ?? {})],
            { encoding: "utf8" },
        );
        try {
            const j = JSON.parse(out);
            if (j && j.code !== undefined) return j;
        } catch { /* 空响应重试 */ }
    }
    return { code: -1, data: null };
}
const ok = (cond, label) => console.log(`${cond ? "✅" : "❌"} ${label}`);

// 1. 找一张普通卡和一张永久卡
const cards = api("/api/query/sql", { stmt: `SELECT id, ial FROM blocks WHERE type='d' AND ial LIKE '%custom-card-type=%' LIMIT 100000` }).data || [];
const typeOf = (ial) => (ial.match(/custom-card-type="([^"]+)"/) || [])[1] || "";
const lit = cards.find((c) => typeOf(c.ial) === "文献");
const perm = cards.find((c) => typeOf(c.ial) === "永久");
ok(!!lit, "找到文献卡样本");
ok(!!perm, "找到永久卡样本");

// 2. 文献卡渲染内容
if (lit) {
    const r = api("/api/filetree/getDoc", { id: lit.id, k: "", mode: 0, size: 204800 });
    const html = r?.data?.content || "";
    ok(html.length > 0, `文献卡 getDoc 有内容（${html.length} 字符）`);
    ok(html.includes("b3-typography") || html.includes("<p") || html.includes("data-node-id"), "内容是可直接挂载的 DOM 片段");
}

// 3. 永久卡渲染内容：嵌入块渲染成什么样
if (perm) {
    const r = api("/api/filetree/getDoc", { id: perm.id, k: "", mode: 0, size: 204800 });
    const html = r?.data?.content || "";
    ok(html.length > 0, `永久卡 getDoc 有内容（${html.length} 字符）`);
    const hasEmbed = html.includes("custom-embed") || html.includes("render-node") || html.includes("embed");
    console.log(`   嵌入块相关标记: custom-embed=${html.includes("custom-embed")} render-node=${html.includes("render-node")}`);
    // 嵌入目标是否已在 HTML 里带出正文
    const embedTargets = api("/api/query/sql", { stmt: `SELECT def_block_id FROM refs WHERE block_id IN (SELECT id FROM blocks WHERE root_id='${perm.id}' AND subtype='embed') LIMIT 10` }).data || [];
    console.log(`   永久卡嵌入块数: ${embedTargets.length}`);
    if (embedTargets.length > 0) {
        const target = embedTargets[0].def_block_id;
        const tgt = api("/api/filetree/getDoc", { id: target, k: "", mode: 0, size: 20480 });
        console.log(`   嵌入目标自身内容长度: ${(tgt?.data?.content || "").length}`);
    }
}
console.log("DONE");
