/** 临时 SQL 查询工具: node test/q.mjs "SELECT ..." */
import { fetchSyncPost } from "./stub-siyuan.mjs";

const stmt = process.argv[2];
if (!stmt) {
    console.error("用法: node test/q.mjs \"SELECT ...\"");
    process.exit(1);
}
const r = await fetchSyncPost("/api/query/sql", { stmt });
if (r.code !== 0) {
    console.error("SQL 错误:", r.msg);
    process.exit(1);
}
const rows = r.data || [];
console.log(`共 ${rows.length} 行`);
for (const row of rows.slice(0, 60)) {
    console.log(JSON.stringify(row));
}
