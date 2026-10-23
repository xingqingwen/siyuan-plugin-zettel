import { TOKEN, NOTEBOOK } from "./_env.mjs";
/**
 * 卡片功能自检：在真实内核上走一遍「建卡 → 写属性 → 查引用数 → 删掉」。
 * 不用打开思源界面就能验证 createDocWithMd / setBlockAttrs / refs 三条链路。
 */
const API = "http://127.0.0.1:6806";

async function post(url, payload) {
    const r = await fetch(API + url, {
        method: "POST",
        headers: { Authorization: "Token " + TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
    });
    const text = await r.text();
    if (!text) {
        return {};
    }
    return JSON.parse(text);
}

const sql = async (stmt) => (await post("/api/query/sql", { stmt })).data || [];

(async () => {
    const title = "_自检卡片_勿动";
    const path = `/卡片/${title}`;

    // 先清掉上次没删干净的
    const stale = await sql(`SELECT id FROM blocks WHERE type='d' AND content='${title}' LIMIT 10`);
    for (const r of stale) {
        await post("/api/filetree/removeDocByID", { id: r.id });
        console.log("0. 清理残留:", r.id);
    }

    const created = await post("/api/filetree/createDocWithMd", {
        notebook: NOTEBOOK,
        path,
        markdown: "**我的判断**\n\n\n\n---\n\n> 原想法：自检用\n\n来源：xxx",
    });
    const id = created.data;
    console.log("1. 建卡:", created.code === 0 ? "OK" : "FAIL", id);

    // 关键：建完立刻写属性会静默失败（块还没进索引），必须等它可被查到
    let indexed = false;
    for (let i = 0; i < 50; i++) {
        const rows = await sql(`SELECT id FROM blocks WHERE id='${id}'`);
        if (rows.length > 0) { indexed = true; break; }
        await new Promise((r) => setTimeout(r, 100));
    }
    console.log("1b. 等待索引:", indexed ? "OK" : `FAIL（${id} 5 秒内没进库）`);

    const set = await post("/api/attr/setBlockAttrs", {
        id,
        attrs: {
            "custom-card-type": "永久",
            "custom-card-source": "selftest",
            "custom-card-book": "自检",
            "custom-card-status": "待打磨",
        },
    });
    console.log("2. 写属性:", set.code === 0 ? "OK" : "FAIL " + JSON.stringify(set));

    await new Promise((r) => setTimeout(r, 400));
    const auth = await post("/api/attr/getBlockAttrs", { id });
    const a = auth.data || {};
    console.log("3a. getBlockAttrs:", a["custom-card-type"] === "永久" ? "OK" : "FAIL → " + JSON.stringify(a));

    const rows = await sql(`SELECT ial FROM blocks WHERE id='${id}'`);
    const ial = rows[0]?.ial || "";
    console.log("3b. SQL ial:", /custom-card-type/.test(ial) ? "OK" : "未刷新 → " + ial);

    const list = await sql(`SELECT count(*) c FROM blocks WHERE type='d' AND ial LIKE '%custom-card-type=%' LIMIT 100000`);
    console.log("4. 卡片可被 SQL 检出:", list[0]?.c, "张");

    const refs = await sql(`SELECT count(*) c FROM refs WHERE def_block_id='${id}' OR def_block_parent_id='${id}'`);
    console.log("5. 引用数查询:", refs[0]?.c === 0 ? "OK（0 次，会判为孤岛）" : "值=" + refs[0]?.c);

    await new Promise((r) => setTimeout(r, 300));
    const del = await post("/api/filetree/removeDocByID", { id });
    console.log("6. 清理测试卡:", del.code === 0 ? "OK" : "FAIL " + JSON.stringify(del));

    const after = await sql(`SELECT count(*) c FROM blocks WHERE id='${id}'`);
    console.log("7. 确认已删除:", (after[0]?.c || 0) === 0 ? "OK" : "仍在");
})().catch((e) => {
    console.error("自检失败:", e);
    process.exit(1);
});
