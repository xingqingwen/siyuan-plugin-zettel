import { TOKEN } from "./_env.mjs";
import { execFileSync } from "child_process";
const api = (ep, p) => {
    for (let i = 0; i < 3; i++) {
        try {
            const out = execFileSync("curl", ["-s", "-m", "15", "http://127.0.0.1:6806" + ep, "-H", `Authorization: Token ${TOKEN}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(p ?? {})], { encoding: "utf8" });
            if (out) return JSON.parse(out);
        } catch { /* retry */ }
    }
    return null;
};

// 1. 看 5 个锚定想法的 custom-weread-on 值
const rows = api("/api/query/sql", { stmt: `SELECT id, ial FROM blocks WHERE ial LIKE '%custom-weread-type="thought"%' AND ial LIKE '%custom-weread-on=%' LIMIT 5` }).data || [];
console.log("--- 锚定想法的 on 值 ---");
for (const r of rows) {
    const m = /custom-weread-on="([^"]*)"/.exec(r.ial);
    console.log(r.id, "on =", JSON.stringify(m?.[1]));
}

// 2. 看几个划线块（highlight）的 name 长什么样
const hls = api("/api/query/sql", { stmt: `SELECT id, name FROM blocks WHERE ial LIKE '%custom-weread-type="highlight"%' LIMIT 5` }).data || [];
console.log("\n--- 划线块的 name ---");
for (const h of hls) console.log(h.id, "name =", JSON.stringify(h.name));
