/**
 * 测试环境配置：公开仓库不带任何真实凭据。
 * 优先读环境变量（SIYUAN_TOKEN / SIYUAN_NOTEBOOK / SIYUAN_KERNEL），
 * 其次读本地未跟踪文件 test/.env.local.json。
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

let local = {};
try {
    local = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env.local.json"), "utf8"));
} catch {
    // 没有本地配置：非本机环境跑 E2E 时请设环境变量或补这个文件
}

export const KERNEL = process.env.SIYUAN_KERNEL || local.KERNEL || "http://127.0.0.1:6806";
export const TOKEN = process.env.SIYUAN_TOKEN || local.TOKEN || "";
export const NOTEBOOK = process.env.SIYUAN_NOTEBOOK || local.NOTEBOOK || "";
export const NOTEBOOK_PREFIX = process.env.SIYUAN_NOTEBOOK_PREFIX || local.NOTEBOOK_PREFIX || (NOTEBOOK.split("-")[0] ?? "");
export const ROOT = process.env.SIYUAN_ROOT || local.ROOT || "";
