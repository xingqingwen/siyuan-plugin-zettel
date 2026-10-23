import { TOKEN, NOTEBOOK as NB } from "./_env.mjs";
// 验证 v0.9.8 卡片结构：摘抄在上 → 分隔线 → 我的判断（=想法的评论预填）
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
        } catch { /* retry */ }
    }
    return { code: -1, data: null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, l) => console.log(`${c ? "✅" : "❌"} ${l}`);

// 与 v0.9.8 createCardFromThought → createCardDoc 的拼装完全一致：
// 想法（有原文）：quote = 原文摘录，body = 评论（进「我的判断」）
const excerpt = "这是书里的原文摘录，讲一个重要概念，\n分了两行写。";
const comment = "这是我的评论，也就是这张卡的初始判断。";
const quoteMeta = "《测试书》第一章";
const qLines = excerpt.split(/\n/).map((l) => (l.trim() ? `> ${l.trim()}` : ">"));
const md = [...qLines, `> ——${quoteMeta}`, "", "---", "", comment, ""].join("\n");

const made = api("/api/filetree/createDocWithMd", { notebook: NB, path: `/卡片/E2E结构卡 ${Date.now().toString().slice(-5)}`, markdown: md });
ok(made.code === 0 && made.data, `建卡成功 ${made.data || ""}`);
await sleep(3500);

const blocks = api("/api/query/sql", { stmt: `SELECT id, type, subtype, markdown FROM blocks WHERE root_id='${made.data}' ORDER BY sort LIMIT 20` }).data || [];
const bq = blocks.find((b) => b.type === "b");
ok(!!bq, "存在引用块（只有原文摘录，不再混评论）");
if (bq) {
    const bqText = (bq.markdown || "");
    ok(bqText.includes("原文摘录") && !bqText.includes("评论"), "引用块只含原文，评论不混进摘抄");
    const j = api("/api/filetree/getDoc", { id: made.data, k: "", mode: 0, size: 20480 });
    const html = j?.data?.content || "";
    ok(html.indexOf("原文摘录") < html.indexOf("评论"), "渲染顺序：摘抄在上，判断（=评论）在下");
    ok(html.includes(comment), "评论完整出现在判断区");
}

// 清理
const p = api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${made.data}' AND type='d' LIMIT 1` });
if (p.data?.[0]?.path) {
    api("/api/filetree/removeDoc", { notebook: NB, path: p.data[0].path });
    console.log("🧹 已清理测试文档");
}
console.log("DONE");
