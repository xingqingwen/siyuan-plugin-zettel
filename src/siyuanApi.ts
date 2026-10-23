/**
 * 思源内核 API 封装
 * 插件运行在思源前端内，同源请求无需 Token。
 */
import { fetchSyncPost, openTab } from "siyuan";

export async function siPost(url: string, payload: any = {}): Promise<any> {
    const resp = await fetchSyncPost(url, payload);
    return resp;
}

/** /api/query/sql 查询，返回行数组（静默失败，用于"查不到就算了"的场景） */
export async function sql<T = any>(stmt: string): Promise<T[]> {
    try {
        const r = await siPost("/api/query/sql", { stmt });
        return r?.data || [];
    } catch {
        return [];
    }
}

/** 严格版：失败直接抛错。用于"查不到"会被误读成"不存在"的判断场景 */
export async function sqlStrict<T = any>(stmt: string): Promise<T[]> {
    const r = await siPost("/api/query/sql", { stmt });
    if (r?.code !== 0) {
        throw new Error(`SQL 失败: ${r?.msg || "未知错误"}`);
    }
    return r?.data || [];
}

export async function getBlockAttrs(id: string): Promise<Record<string, string>> {
    const r = await siPost("/api/attr/getBlockAttrs", { id });
    return r?.data || {};
}

export async function setBlockAttrs(id: string, attrs: Record<string, string>): Promise<void> {
    await siPost("/api/attr/setBlockAttrs", { id, attrs });
}

export async function createDocWithMd(notebook: string, path: string, md: string): Promise<string> {
    // 3.8+ 内核要求 markdown 字段；同时带 md 兼容旧版本
    const r = await siPost("/api/filetree/createDocWithMd", { notebook, path, md, markdown: md });
    if (r?.code !== 0) {
        throw new Error(`创建文档失败: ${r?.msg || r?.code}`);
    }
    return r.data as string; // 文档块 ID
}

export async function appendBlock(parentID: string, markdown: string): Promise<string[]> {
    const r = await siPost("/api/block/appendBlock", { parentID, dataType: "markdown", data: markdown });
    return extractBlockIds(r);
}

export async function insertBefore(nextID: string, parentID: string, markdown: string): Promise<string[]> {
    const r = await siPost("/api/block/insertBlock", { parentID, nextID, dataType: "markdown", data: markdown });
    return extractBlockIds(r);
}

/** 在指定块之后插入（思源支持 previousID） */
export async function insertAfter(previousID: string, parentID: string, markdown: string): Promise<string[]> {
    const r = await siPost("/api/block/insertBlock", { parentID, previousID, dataType: "markdown", data: markdown });
    return extractBlockIds(r);
}

export async function updateBlock(id: string, markdown: string): Promise<void> {
    const r = await siPost("/api/block/updateBlock", { id, dataType: "markdown", data: markdown });
    if (r?.code !== 0) {
        throw new Error(`更新块失败 (${id}): ${r?.msg}`);
    }
}

export async function deleteBlock(id: string): Promise<void> {
    await siPost("/api/block/deleteBlock", { id });
}

/** 从 insert/append 响应中提取新块 ID 列表 */
function extractBlockIds(resp: any): string[] {
    const ops = resp?.data?.[0]?.doOperations || [];
    const ids = ops.map((op: any) => op.id).filter(Boolean);
    return ids;
}

/** 列出思源笔记本 */
export async function listNotebooks(): Promise<{ id: string; name: string; closed: boolean }[]> {
    const r = await siPost("/api/notebook/lsNotebooks", {});
    const all = r?.data?.notebooks || [];
    return all.filter((n: any) => !n.closed);
}

/** 列出某笔记本某路径下的直接子项（目录 + 文档）。path 传 "" 即根目录 */
export async function listDocsByPath(
    notebook: string,
    path: string,
): Promise<{ id: string; name: string; isDir: boolean; hPath: string }[]> {
    const r = await siPost("/api/filetree/listDocsByPath", { notebook, path: path || "/" });
    const files = r?.data?.files || [];
    return files.map((f: any) => ({ id: f.id, name: f.name, isDir: !!f.isDirectory, hPath: f.hPath || "" }));
}

/** 删除文档。path 为 blocks 表里的文件路径（如 /<docId>.sy），3.8+ 内核按此匹配 */
export async function removeDoc(notebook: string, path: string): Promise<void> {
    await siPost("/api/filetree/removeDoc", { notebook, path });
}

/** 按 hpath 查文档并删除（用于覆盖更新） */
export async function removeDocByHpath(notebook: string, hpath: string): Promise<void> {
    const rows = await sql(`SELECT box, path FROM blocks WHERE type='d' AND box='${notebook}' AND hpath='${hpath}' LIMIT 1`);
    if (rows.length > 0) {
        await removeDoc(rows[0].box, rows[0].path);
    }
}

/** 按笔记本与路径查文档 ID */
export async function findDocByPath(notebook: string, hpath: string): Promise<string | null> {
    const rows = await sql(`SELECT id FROM blocks WHERE type='d' AND box='${notebook}' AND hpath='${hpath}' LIMIT 1`);
    return rows.length > 0 ? rows[0].id : null;
}

/** 今日日记：存在返回文档 ID，不存在返回 null */
export async function getDocCreatedToday(notebook: string, date: string): Promise<string | null> {
    try {
        const r = await siPost("/api/filetree/getDocCreatedToday", { notebook, date });
        return r?.data || null;
    } catch {
        return null;
    }
}

/** 创建今日日记（遵循笔记本的日记模板与路径配置），返回文档 ID */
export async function createDailyNote(notebook: string): Promise<string | null> {
    const r = await siPost("/api/filetree/createDailyNote", { notebook, app: "" });
    return r?.data || null;
}

/** 获取笔记本配置（含 dailyNoteSavePath 等） */
export async function getNotebookConf(notebook: string): Promise<any> {
    const r = await siPost("/api/notebook/getNotebookConf", { notebook });
    return r?.data?.conf || r?.data || {};
}

/** 打开文档标签页。openTab 必须静态导入——动态 import("siyuan") 在运行时是裸模块名，浏览器解析不了 */
export async function openDocTab(app: any, docId: string): Promise<void> {
    await openTab({ app, doc: { id: docId } });
}

/** 读取文档渲染 HTML（编辑器 DOM 片段）。配合 protyle-wysiwyg / b3-typography 类直接显示 */
export async function getDocContent(docId: string): Promise<string> {
    const r = await siPost("/api/filetree/getDoc", { id: docId, k: "", mode: 0, size: 204800 });
    return r?.data?.content || "";
}
