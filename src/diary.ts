/**
 * 日记集成：把今天新增的划线/想法追加到思源今日日记
 * 依托思源原生日记机制（getDocCreatedToday / createDailyNote，遵循笔记本日记模板）。
 * 幂等：日记根块 custom-weread-diary-index 记录已写入块，重复执行只增量。
 */
import { WereadClient, Highlight } from "./weread";
import { appendBlock, createDailyNote, deleteBlock, getBlockAttrs, getDocCreatedToday, setBlockAttrs } from "./siyuanApi";
import { SyncConfig, bookPassesFilter, sanitizeTitle } from "./sync";

const DIARY_INDEX_ATTR = "custom-weread-diary-index";
const DIARY_DATE_ATTR = "custom-weread-diary-date";

function todayStr(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function todayDateStr(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function ensureDiaryDoc(notebook: string): Promise<string> {
    const existing = await getDocCreatedToday(notebook, todayStr());
    const existingId = normalizeDocId(existing);
    if (existingId) {
        return existingId;
    }
    const created = normalizeDocId(await createDailyNote(notebook));
    if (!created) {
        throw new Error("创建今日日记失败：请确认所选笔记本已启用日记功能");
    }
    return created;
}

/** createDailyNote/getDocCreatedToday 可能返回字符串或 {id} 对象，统一取文档 ID */
function normalizeDocId(v: any): string | null {
    if (!v) {
        return null;
    }
    if (typeof v === "string") {
        return v;
    }
    return v.id || v.data?.id || null;
}

export async function syncDiary(
    plugin: any,
    client: WereadClient,
    cfg: SyncConfig,
): Promise<{ added: number; diaryDocId: string }> {
    if (!cfg.diaryNotebook) {
        throw new Error("未配置日记笔记本");
    }
    const docId = await ensureDiaryDoc(cfg.diaryNotebook);
    const attrs = await getBlockAttrs(docId);

    let index: Record<string, string> = {};
    try {
        index = JSON.parse(attrs[DIARY_INDEX_ATTR] || "{}");
    } catch {
        index = {};
    }
    const isNewDay = attrs[DIARY_DATE_ATTR] !== todayDateStr();

    // 新的一天：清掉昨天的块，重置索引（只清我们写入的）
    if (isNewDay) {
        for (const key of Object.keys(index)) {
            if (key.startsWith("h:") || key.startsWith("r:") || key === "header") {
                await deleteBlock(index[key]).catch(() => {});
            }
        }
        index = {};
    }

    // 拉今天的划线：只查最近有笔记的书（sort 为最近笔记时间，旧书直接跳过）
    const notebooks = await client.listNotebooks();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = Math.floor(todayStart.getTime() / 1000);

    const candidates = notebooks
        .filter((b) => (b.sort || 0) >= since && bookPassesFilter(b, cfg))
        .sort((a, b) => (b.sort || 0) - (a.sort || 0))
        .slice(0, 100);

    type Entry = { key: string; text: string };
    const entries: Entry[] = [];
    for (const book of candidates) {
        const hl = await client.getHighlights(book.bookId);
        const fresh: Highlight[] = (hl.updated || []).filter((h) => h.createTime >= since);
        const title = book.book?.title || "未命名";
        for (const h of fresh) {
            const key = `h:${h.bookmarkId}`;
            if (index[key]) {
                continue;
            }
            entries.push({ key, text: `> 📖《${sanitizeTitle(title)}》\n> ${h.markText || ""}` });
        }
    }

    let added = 0;
    if (entries.length > 0 || isNewDay) {
        if (!index["header"]) {
            const ids = await appendBlock(docId, `## 📖 微信读书 · ${todayDateStr()}`);
            if (ids.length > 0) {
                index["header"] = ids[0];
            }
        }
        for (const e of entries) {
            const ids = await appendBlock(docId, e.text);
            if (ids.length > 0) {
                index[e.key] = ids[0];
                added++;
            }
        }
        await setBlockAttrs(docId, {
            [DIARY_INDEX_ATTR]: JSON.stringify(index),
            [DIARY_DATE_ATTR]: todayDateStr(),
        });
    }

    return { added, diaryDocId: docId };
}
