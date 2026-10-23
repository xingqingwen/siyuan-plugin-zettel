/**
 * 素材来源之二：思源笔记自己的文档。
 *
 * 为什么值得做：卡片盒的主张是「素材 → 卡」，素材本就不该锁死在微信读书。
 * 用户自己的读书笔记、网摘、会议记录，同样是「别人的话、或过去的自己」，
 * 同样该有一条低成本的路变成卡片。这里刻意做得很薄：
 * 列文档、给摘要、锚来源，判断与成卡仍走同一条 createCardDoc 流程。
 */
import { sqlStrict } from "./siyuanApi";
import { CARD_SOURCE_ATTR, pickAttr } from "./cards";

export interface NoteDoc {
    id: string;
    title: string;
    hpath: string;
    created: string;
    updated: string;
    excerpt: string;
    /** 已有卡片锚定过这篇文档 */
    carded: boolean;
}

function escSql(s: string): string {
    return (s || "").replace(/'/g, "''");
}

/** 已被任何卡片锚定为来源的块 ID 集合 */
export async function usedSources(): Promise<Set<string>> {
    try {
        const rows = await sqlStrict<{ ial: string }>(
            `SELECT ial FROM blocks WHERE ial LIKE '%${CARD_SOURCE_ATTR}=%' LIMIT 100000`,
        );
        const out = new Set<string>();
        for (const r of rows) {
            const src = pickAttr(r.ial || "", CARD_SOURCE_ATTR);
            if (src) {
                out.add(src);
            }
        }
        return out;
    } catch {
        // 查不出就不标「已成卡」，绝不误标
        return new Set();
    }
}

/**
 * 跨笔记本搜索候选文档（文件树模式的搜索兜底）。
 * ⚠️ 必须带 box 条件——blocks 表的 box 列就是笔记本 ID，
 * 之前漏了它，选哪个笔记本查出来的都是全工作空间，「筛选没效果」的真凶就是这行。
 * excludePrefixes 排除插件自己的区域（卡片目录、微信读书同步目录）。
 */
export async function listNoteDocs(opts: {
    notebooks: string[];
    excludePrefixes?: string[];
    kw?: string;
    limit?: number;
}): Promise<NoteDoc[]> {
    const nbs = (opts.notebooks || []).map(escSql).filter(Boolean);
    if (nbs.length === 0) {
        return [];
    }
    const conds: string[] = ["type='d'", `box IN (${nbs.map((n) => `'${n}'`).join(",")})`];
    for (const p of opts.excludePrefixes || []) {
        conds.push(`hpath NOT LIKE '${escSql(p)}%'`);
    }
    const kw = (opts.kw || "").trim();
    if (kw) {
        conds.push(`(content LIKE '%${escSql(kw)}%' OR hpath LIKE '%${escSql(kw)}%')`);
    }
    const rows = await sqlStrict<{
        id: string;
        content: string;
        hpath: string;
        created: string;
        updated: string;
    }>(
        `SELECT id, content, hpath, created, updated FROM blocks WHERE ${conds.join(" AND ")} ` +
            `ORDER BY updated DESC LIMIT ${opts.limit || 300}`,
    );
    const used = await usedSources();
    return rows.map((r) => ({
        id: r.id,
        title: r.content || r.hpath.split("/").pop() || "未命名",
        hpath: r.hpath,
        created: (r.created || "").slice(0, 10),
        updated: (r.updated || "").slice(0, 10),
        excerpt: "",
        carded: used.has(r.id),
    }));
}

/**
 * 批量取每个文档的第一段正文，帮人判断「这是不是值得成卡的那篇」。
 * 只取第一个非空块，失败静默——摘要是加分项，不是必需品。
 */
export async function docExcerpts(docIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (docIds.length === 0) {
        return out;
    }
    const inList = docIds.map((i) => `'${escSql(i)}'`).join(",");
    try {
        const rows = await sqlStrict<{ root_id: string; content: string }>(
            `SELECT root_id, content FROM blocks WHERE root_id IN (${inList}) ` +
                `AND type != 'd' AND content != '' ORDER BY sort LIMIT 50000`,
        );
        for (const r of rows) {
            if (!out.has(r.root_id)) {
                out.set(r.root_id, r.content.replace(/\s+/g, " ").trim().slice(0, 200));
            }
        }
    } catch {
        // ignore
    }
    return out;
}
