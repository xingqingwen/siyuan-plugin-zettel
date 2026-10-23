import { TOKEN, NOTEBOOK as NB } from "./_env.mjs";
/**
 * 验证 listThoughts 的原文拆分逻辑（对真实内核数据）：
 * 1. 锚定想法：custom-weread-on 指向划线块，能查到原文
 * 2. 未锚定想法：引用块 markdown 里 ✏️ 前是原文摘录
 * 3. 建卡路径：quote = 原文 + ✏️评论，不截断
 */
import { execFileSync } from "child_process";

const KERNEL = "http://127.0.0.1:6806";

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

// ---- 复刻插件逻辑 ----
const pick = (ial, key) => { const m = new RegExp(`${key}="([^"]*)"`).exec(ial || ""); return m ? m[1] : ""; };
const plain = (md) => (md || "").replace(/^>\s?/gm, "").replace(/^\s*✏️\s*/gm, "").replace(/^\s*↩.*$/gm, "")
    .replace(/（\d+\s*人划线）/g, "").replace(/[*`#>]/g, "").replace(/\s+/g, " ").trim();

const rows = api("/api/query/sql", { stmt: `SELECT id, root_id, markdown, ial FROM blocks WHERE ial LIKE '%custom-weread-type="thought"%' LIMIT 100000` }).data || [];
console.log(`想法块总数: ${rows.length}`);
ok(rows.length > 0, "能查到想法块");

const needAnchors = new Map(); // rootId -> Map(anchorKey -> [rowId])
let parsed = { anchored: 0, unanchoredWithAbs: 0, unanchoredNoAbs: 0 };
for (const r of rows) {
    const anchor = /custom-weread-on="([^"]*)"/.exec(r.ial)?.[1] || "";
    let abstract = "", text = "";
    if (anchor) {
        text = plain(r.markdown);
        if (!needAnchors.has(r.root_id)) needAnchors.set(r.root_id, new Map());
        const m = needAnchors.get(r.root_id);
        (m.get(anchor) || m.set(anchor, []).get(anchor)).push(r.id);
        parsed.anchored++;
    } else {
        const merged = (r.markdown || "").replace(/^>\s?/gm, "");
        const markAt = merged.indexOf("✏️");
        if (markAt >= 0) { abstract = merged.slice(0, markAt).trim(); text = plain(merged.slice(markAt)); parsed.unanchoredWithAbs++; }
        else { text = plain(r.markdown); parsed.unanchoredNoAbs++; }
    }
    r._abstract = abstract; r._text = text;
}
console.log(`分布: 锚定=${parsed.anchored} 未锚定带原文=${parsed.unanchoredWithAbs} 未锚定无原文=${parsed.unanchoredNoAbs}`);

// 锚定想法补原文：rootId → custom-weread-index（getBlockAttrs）→ 划线块 id → markdown
let anchorHit = 0;
for (const [rootId, anchors] of needAnchors) {
    try {
        const attrs = api("/api/attr/getBlockAttrs", { id: rootId });
        const idx = JSON.parse(attrs.data?.["custom-weread-index"] || "{}");
        const want = new Map();
        for (const [key, rowIds] of anchors) {
            const v = idx[`h:${key}`];
            const hid = typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
            if (hid) for (const rid of rowIds) (want.get(hid) || want.set(hid, []).get(hid)).push(rid);
        }
        const ids = Array.from(want.keys());
        for (let i = 0; i < ids.length; i += 40) {
            const cond = ids.slice(i, i + 40).map((x) => `'${x}'`).join(",");
            const hls = api("/api/query/sql", { stmt: `SELECT id, markdown FROM blocks WHERE id IN (${cond}) LIMIT 200` }).data || [];
            for (const h of hls) for (const rid of want.get(h.id) || []) {
                const t = rows.find((r) => r.id === rid);
                if (t && plain(h.markdown)) { t._abstract = plain(h.markdown); anchorHit++; }
            }
        }
    } catch { /* 单文档失败不阻塞 */ }
}
console.log(`锚定原文补齐: 命中=${anchorHit} 未命中=${parsed.anchored - anchorHit}`);
ok(parsed.anchored === 0 || anchorHit > 0, "锚定想法能经索引查到划线原文");

// 抽样展示 3 条
console.log("\n--- 抽样 ---");
for (const r of rows.filter((r) => r._text.length > 3).slice(0, 3)) {
    console.log(`[书] ${pick(r.ial, "custom-weread-book-title")}`);
    console.log(`  原文: ${(r._abstract || "（无）").slice(0, 60)}`);
    console.log(`  评论: ${r._text.slice(0, 60)}`);
}

// 建卡路径验证：取一条真实想法，模拟 createCardFromThought 的 quote 组装，走真实建卡→检查→删除
const t = rows.find((r) => r._text.length > 10);
if (t) {
    const quote = t._abstract ? `${t._abstract}\n\n✏️ ${t._text}` : t._text;
    ok(!quote.includes("……") || t._text.includes("……"), "quote 不被插件截断（300 字上限已移除）");
    const made = api("/api/filetree/createDocWithMd", {
        notebook: NB,
        path: `/卡片/E2E想法卡 ${Date.now().toString().slice(-5)}`,
        markdown: `# E2E想法卡\n\n> ${quote.split("\n").join("\n> ")}\n\n《测试》`,
    });
    ok(!!made.data, "建卡文档成功");
    await sleep(3000);
    const back = api("/api/query/sql", { stmt: `SELECT markdown FROM blocks WHERE root_id='${made.data}' AND type='b' LIMIT 1` });
    const q = (back.data?.[0]?.markdown || "").replace(/^>\s?/gm, "");
    ok(q.includes("✏️"), "卡里能读到评论");
    if (t._abstract) ok(q.includes(t._abstract.slice(0, 20).replace(/[>]/g, "")), "卡里能读到原文摘录");
    else ok(true, "该想法无原文（章节点评），卡里只有评论属预期");
    const p = api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${made.data}' AND type='d' LIMIT 1` });
    if (p.data?.[0]?.path) { api("/api/filetree/removeDoc", { notebook: NB, path: p.data[0].path }); console.log("（测试文档已清理）"); }
}

console.log(`\n结果: ${pass} 过, ${fail} 挂`);
process.exit(fail > 0 ? 1 : 0);
