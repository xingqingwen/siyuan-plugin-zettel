/**
 * 工具：整理 + 锚定
 *
 * 说明（来自真实数据实测，别走回头路）：
 * - 「用你的文档名当词典自动关联划线」实测 0 命中：库里可复用的主题文档太少，
 *   就算全量跑也只是噪声。语义级关联必须上 AI，不在本工具范围内。
 * - 「跨书相同句子」实测 0 条：不同作者不会写出同样的话。已放弃。
 *
 * 现在保留的是两个确定性工具：
 * 1. anchorThoughts —— 把「我的想法」用块引用锚到它批注的那条划线上。
 *    思源的块引用自带反链，所以划线的反链面板里会显示"谁批注了我"，
 *    想法也能点回原文。这是唯一 100% 准确、不靠猜的自动关联。
 * 2. tidyBook —— 同文重复的划线去重、只有标题没内容的空章节清理。
 *
 * 生成物统一用 `x:` 前缀记在 custom-weread-index 里，同步时不会被删（见 sync.ts）。
 */
import {
    deleteBlock,
    getBlockAttrs,
    insertAfter,
    setBlockAttrs,
    sqlStrict,
} from "./siyuanApi";

const INDEX_ATTR = "custom-weread-index";

async function readIndex(docId: string): Promise<Record<string, string>> {
    const attrs = await getBlockAttrs(docId);
    try {
        return JSON.parse(attrs[INDEX_ATTR] || "{}");
    } catch {
        return {};
    }
}

async function writeIndex(docId: string, index: Record<string, string>): Promise<void> {
    await setBlockAttrs(docId, { [INDEX_ATTR]: JSON.stringify(index) });
}

async function clearGenerated(index: Record<string, string>, key: string): Promise<void> {
    const raw = index[key];
    if (!raw) {
        return;
    }
    let ids: string[] = [];
    try {
        const v = JSON.parse(raw);
        ids = Array.isArray(v) ? v : [raw];
    } catch {
        ids = [raw];
    }
    for (const id of ids) {
        await deleteBlock(id).catch(() => {});
    }
    delete index[key];
}

export interface AnchorResult {
    /** 成功锚定的想法数 */
    anchored: number;
    /** 找不到对应划线的想法数 */
    orphan: number;
}

/**
 * 批注锚定：每条想法下面插一行「↩ 引用它批注的那条划线」。
 * 依赖同步时写进想法块的 custom-weread-on（=划线 bookmarkId）
 * 和文档 index 里的 h:<bookmarkId> → 块 ID 映射。
 */
export async function anchorThoughts(docId: string): Promise<AnchorResult> {
    const rows = await sqlStrict<{ id: string; ial: string }>(
        `SELECT id, ial FROM blocks WHERE root_id='${docId}' AND ial LIKE '%custom-weread-type="thought"%' LIMIT 100000`,
    );
    const index = await readIndex(docId);

    // 清掉上一次生成的锚点，避免重复
    for (const key of Object.keys(index)) {
        if (key.startsWith("x:anchor:")) {
            await clearGenerated(index, key);
        }
    }

    let anchored = 0;
    let orphan = 0;
    for (const r of rows) {
        const m = /custom-weread-on="([^"]*)"/.exec(r.ial || "");
        const bm = m ? m[1] : "";
        const targetId = bm ? index[`h:${bm}`] : "";
        if (!targetId) {
            orphan++;
            continue;
        }
        const ids = await insertAfter(r.id, docId, `↩ ((${targetId} "原文"))`).catch(() => [] as string[]);
        if (ids.length > 0) {
            index[`x:anchor:${r.id}`] = JSON.stringify(ids);
            anchored++;
        } else {
            orphan++;
        }
    }
    await writeIndex(docId, index);
    return { anchored, orphan };
}

export interface TidyResult {
    /** 合并掉的重复划线数 */
    merged: number;
    /** 删掉的空章节数 */
    emptyChapters: number;
}

/** 归一化：去标点/空白，用于判断"是不是同一句话" */
function norm(s: string): string {
    return (s || "")
        .replace(/^>\s?/gm, "")
        .replace(/[\s\p{P}\p{S}]/gu, "")
        .toLowerCase();
}

/**
 * 整理单本：同文重复的划线只留第一条，清理「有标题、没内容」的空章节。
 * 只动带 custom-weread-type 的块，不碰用户手动加的内容。
 */
export async function tidyBook(docId: string): Promise<TidyResult> {
    const rows = await sqlStrict<{ id: string; markdown: string; ial: string }>(
        `SELECT id, markdown, ial FROM blocks WHERE root_id='${docId}' LIMIT 100000`,
    );
    const kindOf = (ial: string) => {
        const m = /custom-weread-type="([^"]*)"/.exec(ial || "");
        return m ? m[1] : "";
    };

    // 1. 同文去重（保留先出现的那条）
    const seen = new Map<string, string>();
    let merged = 0;
    for (const r of rows) {
        if (kindOf(r.ial) !== "highlight") continue;
        const n = norm(r.markdown);
        if (n.length < 6) continue;
        if (seen.has(n)) {
            await deleteBlock(r.id).catch(() => {});
            merged++;
        } else {
            seen.set(n, r.id);
        }
    }

    // 2. 空章节：标题之后到下一个标题之前，没有任何划线/想法/热门划线
    const ordered = rows.filter((r) => kindOf(r.ial)).sort((a, b) => (a.id < b.id ? -1 : 1));
    let emptyChapters = 0;
    for (let i = 0; i < ordered.length; i++) {
        if (kindOf(ordered[i].ial) !== "chapter") continue;
        let hasContent = false;
        for (let j = i + 1; j < ordered.length; j++) {
            const k = kindOf(ordered[j].ial);
            if (k === "chapter") break;
            if (k === "highlight" || k === "thought" || k === "popular") {
                hasContent = true;
                break;
            }
        }
        if (!hasContent) {
            await deleteBlock(ordered[i].id).catch(() => {});
            emptyChapters++;
        }
    }

    return { merged, emptyChapters };
}

/** 批量整理 + 锚定 */
export async function polishBooks(
    docIds: string[],
    onProgress?: (msg: string, done: number, total: number) => void,
): Promise<{ books: number; merged: number; emptyChapters: number; anchored: number }> {
    let merged = 0;
    let emptyChapters = 0;
    let anchored = 0;
    let done = 0;
    for (const id of docIds) {
        try {
            const a = await anchorThoughts(id);
            anchored += a.anchored;
            const t = await tidyBook(id);
            merged += t.merged;
            emptyChapters += t.emptyChapters;
        } catch (e) {
            console.error("weread-notes: 整理失败", id, e);
        } finally {
            done++;
            onProgress?.("整理中…", done, docIds.length);
        }
    }
    return { books: docIds.length, merged, emptyChapters, anchored };
}
