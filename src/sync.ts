/**
 * 同步引擎 v0.2
 *
 * 文档结构（每本书一篇文档）:
 *   /<根路径>/<书名[ · 作者]>
 *     封面图片块（richMeta 开启时）                     key=cover
 *     > 📖 元信息块                                     key=meta
 *     ## 章节标题                                       key=c:<chapterUid>
 *     > 划线原文（引用块）                               key=h:<bookmarkId>
 *     🔥 热门划线（带底色引用块）                         key=p:<bookmarkId>
 *     ✏️ 想法（带底色段落，样式与划线明显区分）            key=r:<reviewId>
 *
 * 增量与性能:
 * - 根块 custom-weread-index 保存 {key -> blockId}，updateBlock 原地更新（块 ID 不变）
 * - book.sort（最近笔记时间）<= 上次同步时间 → 整本跳过（不发请求）
 * - 配置指纹变化（模板/热门划线/过滤设置）→ 本轮全量重拉重渲染
 * - 并发 2 本，进度回调
 */
import {
    NotebookBook,
    WereadClient,
    Highlight,
    ChapterInfo,
    PopularHighlight,
    bookDeepLink,
} from "./weread";
import {
    appendBlock,
    createDocWithMd,
    deleteBlock,
    findDocByPath,
    getBlockAttrs,
    insertBefore,
    removeDoc,
    setBlockAttrs,
    sql,
    sqlStrict,
    updateBlock,
} from "./siyuanApi";
import { renderTemplate, Templates } from "./templates";

const INDEX_ATTR = "custom-weread-index";
const BOOKID_ATTR = "custom-weread-book-id";
const SYNCED_ATTR = "custom-weread-synced";
/** 块级属性版本：老文档（无此标记）同步时会做一次属性回填 */
const ATTRS_VER = "custom-weread-attrs-ver";
const ATTRS_VERSION = "2";
/** 所有同步文档统一挂这个标签（不按书名打标签，否则标签树会被 300+ 个书名淹没） */
const DOC_TAG = "微信读书";

const STYLE_THOUGHT = "background-color: var(--b3-card-info-background);border-radius: 4px 4px 4px 4px;";
const STYLE_POPULAR = "background-color: var(--b3-card-warning-background);border-radius: 4px 4px 4px 4px;";

export interface SyncConfig {
    apiKey: string;
    notebookId: string;
    rootPath: string;
    includeThoughts: boolean;
    /** 热门划线 */
    syncPopular: boolean;
    popularMode: "merge" | "separate";
    /** 最小划线数过滤 */
    minHighlights: number;
    /** 同步范围：全部/在读/读完 */
    onlyStatus: "all" | "reading" | "finished";
    /** 文档名带作者（解决书名重复） */
    nameWithAuthor: boolean;
    /** 丰富元数据（每本多 1-2 次请求） */
    richMeta: boolean;
    /** 定时自动同步（分钟，0=关闭） */
    autoSyncMinutes: number;
    /** 日记集成的笔记本 ID */
    diaryNotebook: string;
    /** 卡片笔记存放的笔记本（留空=跟随同步笔记本） */
    cardNotebook?: string;
    /** 卡片笔记在笔记本里的路径 */
    cardPath?: string;
    templates: Templates;
}

type ItemKind = "meta" | "chapter" | "highlight" | "thought" | "popular" | "cover";

interface SyncItem {
    key: string;
    md: string;
    kind: ItemKind;
    /**
     * 块属性（name / style / custom-weread-*）。
     * 不走 setBlockAttrs，而是拼成 IAL 行随 markdown 一起写入——零额外请求。
     */
    attrs?: Record<string, string>;
}

export interface SyncResult {
    created: number;
    updated: number;
    deleted: number;
    skipped: boolean;
    bookTitle: string;
}

type State = Record<string, { docId: string; lastSync: number; lastSort: number }>;

/** 配置指纹：变化时本轮强制全量重渲染 */
function configRevision(cfg: SyncConfig): string {
    const relevant = {
        t: cfg.templates,
        pop: cfg.syncPopular,
        popMode: cfg.popularMode,
        min: cfg.minHighlights,
        status: cfg.onlyStatus,
        name: cfg.nameWithAuthor,
        rich: cfg.richMeta,
        thoughts: cfg.includeThoughts,
    };
    let h = 0;
    const s = JSON.stringify(relevant);
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return String(h);
}

function sanitizeTitle(title: string): string {
    return title.replace(/[\\/:*?"<>|#^\[\]]/g, " ").trim() || "未命名书籍";
}

function tsToDate(ts: number): string {
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
}

/** 书籍过滤。markedStatus 实测语义：1=想读 2=在读 3=搁置 4=读完（官方文档写的 1=读完 是错的） */
export function bookPassesFilter(book: NotebookBook, cfg: SyncConfig): boolean {
    if (cfg.minHighlights > 0 && (book.noteCount || 0) < cfg.minHighlights) {
        return false;
    }
    if (cfg.onlyStatus === "reading" && book.markedStatus !== 2) {
        return false;
    }
    if (cfg.onlyStatus === "finished" && book.markedStatus !== 4) {
        return false;
    }
    return true;
}

const quote = (s: string) =>
    s
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

/** 单块化：消灭空行（内核会把含空行的 markdown 拆成多个块） */
const singleBlock = (s: string) => s.replace(/\n\s*\n/g, "\n").trim();

/**
 * 生成思源 IAL 属性行（紧跟块之后，与该块一起解析）。
 * 实测：insertBlock / updateBlock 都会应用 IAL，且 updateBlock 会用新 IAL
 * 覆盖旧的自定义属性 —— 所以每次更新都必须传全量属性，不能只传增量。
 */
function ial(attrs?: Record<string, string>): string {
    if (!attrs) {
        return "";
    }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(attrs)) {
        if (!v) {
            continue;
        }
        // 引号/反斜杠/换行会破坏 IAL 语法，统一净化
        const safe = String(v)
            .replace(/["\\]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!safe) {
            continue;
        }
        parts.push(`${k}="${safe}"`);
    }
    return parts.length > 0 ? `\n{: ${parts.join(" ")} }` : "";
}

/** 块命名：反链/引用处显示的是这个名字，所以取划线正文而非标记 */
function blockName(text: string, max = 24): string {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) {
        return "";
    }
    return t.length > max ? t.slice(0, max) + "…" : t;
}

/** 属性值净化：IAL 用双引号包裹，值里不能出现引号/花括号/换行 */
function attrVal(text: string, max = 40): string {
    const t = (text || "")
        .replace(/["'{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return t.length > max ? t.slice(0, max) : t;
}

/** 行级引用规范化：已是 "> " 开头的行不再加前缀，避免双层引用 */
const asQuote = (s: string) =>
    s
        .split("\n")
        .map((line) => (line.trim().startsWith(">") ? line : `> ${line}`))
        .join("\n");

/** 组装一本书的全部同步块（有序） */
export function buildItems(
    book: NotebookBook,
    highlights: Highlight[],
    chapters: ChapterInfo[],
    reviews: { reviewId: string; content: string; abstract?: string; range?: string; createTime: number }[],
    popular: PopularHighlight[],
    cfg: SyncConfig,
    bookInfo: any,
): SyncItem[] {
    const items: SyncItem[] = [];
    const tpl = cfg.templates;
    const title = book.book?.title || "未命名书籍";
    const author = book.book?.author || "";
    const bookId = book.bookId;
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const syncTime = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`;

    /**
     * 统一构造：自动挂「书 ID / 书名 / 作者 / 类型 / 块命名 / 章节 / 时间 / 样式」。
     * 目的是让同步进来的内容在思源里可被反链、可被 SQL 查询，而不只是"躺在那里"。
     * 书名/作者/时间这三个字段是「整理与分析」的地基：没有它们，SQL 只能按书查，
     * 没法按主题、按年月、按作者做跨书统计。
     */
    const mk = (
        key: string,
        kind: ItemKind,
        md: string,
        opt: {
            name?: string;
            style?: string;
            chapter?: string;
            readers?: number;
            time?: number;
            /** 这条想法批注的是哪条划线（bookmarkId），供「批注锚定」建立块引用 */
            anchor?: string;
        } = {},
    ): SyncItem => {
        const attrs: Record<string, string> = {
            "custom-weread-book": bookId,
            "custom-weread-type": kind,
        };
        const bt = attrVal(title);
        if (bt) {
            attrs["custom-weread-book-title"] = bt;
        }
        const au = attrVal(author, 20);
        if (au) {
            attrs["custom-weread-author"] = au;
        }
        const nm = opt.name ? blockName(opt.name) : "";
        if (nm) {
            attrs.name = nm;
        }
        if (opt.chapter) {
            attrs["custom-weread-chapter"] = attrVal(opt.chapter, 30) || opt.chapter;
        }
        if (opt.readers !== undefined) {
            attrs["custom-weread-readers"] = String(opt.readers);
        }
        if (opt.time) {
            attrs["custom-weread-time"] = tsToDate(opt.time);
        }
        if (opt.anchor) {
            attrs["custom-weread-on"] = opt.anchor;
        }
        if (opt.style) {
            attrs.style = opt.style;
        }
        return { key, md, kind, attrs };
    };

    // 封面（丰富元数据时）
    const cover = bookInfo?.cover || book.book?.cover || "";
    if (cfg.richMeta && cover) {
        items.push(mk("cover", "cover", `![](${cover})`));
    }

    items.push(
        mk(
            "meta",
            "meta",
            asQuote(
                singleBlock(
                    renderTemplate(tpl.meta, {
                        title,
                        author,
                        hlCount: book.noteCount || 0,
                        thCount: book.reviewCount || 0,
                        popCount: popular.length,
                        progress: Math.round(book.readingProgress || 0),
                        link: bookDeepLink(book.bookId),
                        syncTime,
                        publisher: bookInfo?.publisher || "",
                        isbn: bookInfo?.isbn || "",
                        intro: (bookInfo?.intro || "").replace(/\n/g, " ").slice(0, 120),
                    }),
                ),
            ),
        ),
    );

    const chapterMap = new Map<number, ChapterInfo>();
    for (const ch of chapters) {
        chapterMap.set(ch.chapterUid, ch);
    }

    const byChapter = new Map<number, Highlight[]>();
    for (const h of highlights) {
        const list = byChapter.get(h.chapterUid) || [];
        list.push(h);
        byChapter.set(h.chapterUid, list);
    }
    for (const list of byChapter.values()) {
        list.sort((a, b) => {
            const ra = a.range?.split("-").map(Number) || [0, 0];
            const rb = b.range?.split("-").map(Number) || [0, 0];
            return ra[0] - rb[0] || a.createTime - b.createTime;
        });
    }

    const chapterUids = [...byChapter.keys()].sort((a, b) => {
        const ca = chapterMap.get(a);
        const cb = chapterMap.get(b);
        return (ca?.chapterIdx ?? a) - (cb?.chapterIdx ?? b);
    });

    // 想法按 range 挂到对应划线，否则文档末尾
    const reviewAfterHighlight = new Map<string, typeof reviews>();
    const unmatched: typeof reviews = [];
    const rangeToBookmark = new Map<string, string>();
    for (const h of highlights) {
        if (h.range) {
            rangeToBookmark.set(h.range, h.bookmarkId);
        }
    }
    for (const r of reviews) {
        const bid = r.range ? rangeToBookmark.get(r.range) : undefined;
        if (bid) {
            const list = reviewAfterHighlight.get(bid) || [];
            list.push(r);
            reviewAfterHighlight.set(bid, list);
        } else {
            unmatched.push(r);
        }
    }
    unmatched.sort((a, b) => a.createTime - b.createTime);

    // 热门划线按章节分组
    const popularByChapter = new Map<number, PopularHighlight[]>();
    for (const ph of popular) {
        const list = popularByChapter.get(ph.chapterUid) || [];
        list.push(ph);
        popularByChapter.set(ph.chapterUid, list);
    }
    for (const list of popularByChapter.values()) {
        list.sort((a, b) => {
            const ra = a.range?.split("-").map(Number) || [0, 0];
            const rb = b.range?.split("-").map(Number) || [0, 0];
            return ra[0] - rb[0];
        });
    }
    const userRangeSet = new Set(highlights.map((h) => h.range));

    const hlVars = (h: Highlight, chTitle: string) => ({
        markText: h.markText || "",
        createTime: tsToDate(h.createTime),
        chapterTitle: chTitle,
        link: `weread://bestbookmark?bookId=${h.bookId}&chapterUid=${h.chapterUid}&rangeStart=${(h.range || "0-0").split("-")[0]}&rangeEnd=${(h.range || "0-0").split("-")[1]}`,
    });

    const hlItem = (h: Highlight, chTitle: string) =>
        mk(
            `h:${h.bookmarkId}`,
            "highlight",
            quote(singleBlock(renderTemplate(tpl.highlight, hlVars(h, chTitle)))),
            { name: h.markText, chapter: chTitle, time: h.createTime },
        );

    const popItem = (ph: PopularHighlight, chTitle?: string) =>
        mk(
            `p:${ph.bookmarkId}`,
            "popular",
            quote(singleBlock(renderTemplate(tpl.popular, { markText: ph.markText, totalUsers: ph.totalCount }))),
            { name: ph.markText, chapter: chTitle, readers: ph.totalCount, style: STYLE_POPULAR },
        );

    const thoughtItem = (r: { reviewId: string; content: string; abstract?: string; createTime: number }, anchor?: string) => {
        const body = singleBlock(renderTemplate(tpl.thought, { content: r.content, createTime: tsToDate(r.createTime) }));
        const abs = (r.abstract || "").trim();
        // 没有锚定到划线时补原文摘录，避免"只有评论、不知道在评论什么"；
        // 已锚定的想法紧跟其划线块，原文就在上一块，不重复。
        const md = !anchor && abs ? quote([abs, "", body].join("\n")) : body;
        return mk(
            `r:${r.reviewId}`,
            "thought",
            md,
            { name: r.content, style: STYLE_THOUGHT, time: r.createTime, anchor },
        );
    };

    if (byChapter.size === 0) {
        // 只有想法、没有划线的书
        for (const r of reviews) {
            items.push(thoughtItem(r));
        }
        if (cfg.syncPopular && popular.length > 0) {
            items.push(mk("c:popular", "chapter", `## ${singleBlock(renderTemplate(tpl.chapter, { chapterTitle: "🔥 热门划线" }))}`));
            for (const ph of popular) {
                items.push(popItem(ph));
            }
        }
        return items;
    }

    for (const uid of chapterUids) {
        const ch = chapterMap.get(uid);
        const chTitle = (ch?.title || "未命名章节").replace(/\n/g, " ");
        items.push(
            mk(`c:${uid}`, "chapter", `## ${singleBlock(renderTemplate(tpl.chapter, { chapterTitle: chTitle }))}`, {
                chapter: chTitle,
            }),
        );

        if (cfg.syncPopular && cfg.popularMode === "merge") {
            // 热门划线按位置融入：与用户划线按 range 起点统一排序（与用户划线 range 相同的跳过）
            const merged: { start: number; item: SyncItem }[] = [];
            for (const h of byChapter.get(uid) || []) {
                merged.push({ start: Number((h.range || "0-0").split("-")[0]) || 0, item: hlItem(h, chTitle) });
            }
            for (const ph of popularByChapter.get(uid) || []) {
                if (userRangeSet.has(ph.range)) {
                    continue;
                }
                merged.push({ start: Number((ph.range || "0-0").split("-")[0]) || 0, item: popItem(ph, chTitle) });
            }
            merged.sort((a, b) => a.start - b.start);
            for (const m of merged) {
                items.push(m.item);
            }
        } else {
            for (const h of byChapter.get(uid) || []) {
                items.push(hlItem(h, chTitle));
                for (const r of reviewAfterHighlight.get(h.bookmarkId) || []) {
                    items.push(thoughtItem(r, h.bookmarkId));
                }
            }
        }
    }

    if (cfg.syncPopular && cfg.popularMode === "separate" && popular.length > 0) {
        items.push(mk("c:popular", "chapter", `## ${singleBlock(renderTemplate(tpl.chapter, { chapterTitle: "🔥 热门划线" }))}`));
        for (const ph of popular) {
            items.push(popItem(ph));
        }
    }

    for (const r of unmatched) {
        items.push(thoughtItem(r));
    }
    return items;
}

/**
 * 判断文档是否真的存在。
 * ⚠️ 这里踩过坑，顺序不能反：
 * 1. /api/attr/getBlockAttrs 最可靠——文档不存在时返回 code:0 + data:{}，不会抛错；
 * 2. SQL 有索引延迟，重启后可能长时间查不到，只能当兜底；
 * 3. 两次都拿不到 → 认为不存在；任何一次抛错 → 视为"无法确认"，抛出去跳过这本书。
 * 绝不能把"查不到"直接当成"不存在"，否则会给同一本书重复建文档（已真实发生过）。
 */
async function docExists(id: string): Promise<boolean> {
    let attrs: Record<string, string> | null = null;
    try {
        attrs = await getBlockAttrs(id);
    } catch {
        attrs = null;
    }
    if (attrs && Object.keys(attrs).length > 0) {
        return true;
    }
    if (attrs === null) {
        // 接口调用本身失败 → 无法确认，宁可这一本不同步
        throw new Error("无法确认文档是否存在（内核无响应），已跳过以免重复建档");
    }
    // attrs 是明确的空对象，再用 SQL 兜底（兼容早期无属性的文档）
    try {
        const rows = await sqlStrict(`SELECT id FROM blocks WHERE id='${id}' AND type='d' LIMIT 1`);
        return rows.length > 0;
    } catch (e) {
        throw new Error(`无法确认文档是否存在（SQL 失败）：${(e as Error)?.message || e}`);
    }
}

/** 确保书的文档存在（书名冲突时追加序号），返回 docId */
async function ensureBookDoc(
    state: State,
    book: NotebookBook,
    cfg: SyncConfig,
): Promise<string> {
    const cached = state[book.bookId]?.docId;
    if (cached) {
        if (await docExists(cached)) {
            return cached;
        }
        delete state[book.bookId];
    }
    const author = book.book?.author || "";
    let baseTitle = sanitizeTitle(book.book?.title || "未命名书籍");
    if (cfg.nameWithAuthor && author) {
        baseTitle = `${baseTitle} · ${sanitizeTitle(author)}`;
    }
    const rootPath = cfg.rootPath.replace(/^\/+|\/+$/g, "");
    // 书名冲突保护：查同路径文档是否属于别的书
    let finalTitle = baseTitle;
    for (let i = 2; i <= 20; i++) {
        const existing = await findDocByPath(cfg.notebookId, `/${rootPath}/${finalTitle}`);
        if (!existing) {
            break;
        }
        const attrs = await getBlockAttrs(existing);
        if (attrs[BOOKID_ATTR] === book.bookId) {
            return existing;
        }
        finalTitle = `${baseTitle} (${i})`;
    }
    const docId = await createDocWithMd(cfg.notebookId, `/${rootPath}/${finalTitle}`, " ");
    return docId;
}

/** 同步单本书 */
export async function syncBook(
    plugin: any,
    client: WereadClient,
    book: NotebookBook,
    cfg: SyncConfig,
    state: State,
    force: boolean,
    revision: string,
): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, deleted: 0, skipped: false, bookTitle: book.book?.title || "" };
    const rec = state[book.bookId];

    // 整本跳过：内容无变化且配置没变
    if (!force && rec && rec.lastSort >= (book.sort || 0) && rec.docId) {
        // 注意：查询失败会抛出，不会误判成"文档已删"而重建
        if (await docExists(rec.docId)) {
            result.skipped = true;
            return result;
        }
        delete state[book.bookId];
    }

    const [hl, rv, pop, bookInfo] = await Promise.all([
        client.getHighlights(book.bookId),
        cfg.includeThoughts ? client.listMyReviews(book.bookId) : Promise.resolve([]),
        cfg.syncPopular ? client.getPopularHighlights(book.bookId) : Promise.resolve({ items: [], chapters: [] }),
        cfg.richMeta ? client.getBookInfo(book.bookId).catch(() => null) : Promise.resolve(null),
    ]);

    const docId = await ensureBookDoc(state, book, cfg);
    const attrs = await getBlockAttrs(docId);

    let index: Record<string, string> = {};
    try {
        index = JSON.parse(attrs[INDEX_ATTR] || "{}");
    } catch {
        index = {};
    }

    const rows = await sql(`SELECT id FROM blocks WHERE root_id='${docId}' LIMIT 100000`);
    const existing = new Set(rows.map((r: any) => r.id));
    // SQL 索引刚重建时可能返回空，此时不能拿它做"块不存在"的清理，否则会误删索引记录
    if (existing.size > 0) {
        for (const key of Object.keys(index)) {
            if (key.startsWith("x:")) {
                // 生成物的值是块 ID 数组，只保留还活着的
                let ids: string[] = [];
                try {
                    const v = JSON.parse(index[key]);
                    ids = Array.isArray(v) ? v : [];
                } catch {
                    ids = [];
                }
                const alive = ids.filter((id) => existing.has(id));
                if (alive.length === 0) {
                    delete index[key];
                } else {
                    index[key] = JSON.stringify(alive);
                }
                continue;
            }
            if (!existing.has(index[key])) {
                delete index[key];
            }
        }
    }

    const items = buildItems(book, hl.updated, hl.chapters, rv.map((r) => r.review), pop.items, cfg, bookInfo);

    const desiredKeys = new Set(items.map((i) => i.key));
    for (const key of Object.keys(index)) {
        // x: 开头是「自动关联」等工具生成的内容，由 link.ts 自己维护，同步不碰
        if (key.startsWith("x:")) {
            continue;
        }
        if (!desiredKeys.has(key)) {
            await deleteBlock(index[key]);
            delete index[key];
            result.deleted++;
        }
    }

    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const oldId = index[it.key];
        // 属性随 markdown 一起写入（IAL），不额外发请求
        const md = it.md + ial(it.attrs);
        if (i > 0 && i % THROTTLE_EVERY === 0) {
            await sleep(THROTTLE_MS);
        }
        if (oldId) {
            await updateBlock(oldId, md);
            result.updated++;
        } else {
            let nextId: string | undefined;
            for (let j = i + 1; j < items.length; j++) {
                const nid = index[items[j].key];
                if (nid) {
                    nextId = nid;
                    break;
                }
            }
            let newIds: string[];
            if (nextId) {
                newIds = await insertBefore(nextId, docId, md);
            } else {
                newIds = await appendBlock(docId, md);
            }
            if (newIds.length > 0) {
                index[it.key] = newIds[0];
                result.created++;
            }
        }
    }

    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    // 老文档（v0.2 之前同步的）没有块命名与检索属性，本轮补一次
    const needBackfill = attrs[ATTRS_VER] !== ATTRS_VERSION;
    if (needBackfill) {
        await backfillAttrs(index, items);
    }
    await setBlockAttrs(docId, {
        [BOOKID_ATTR]: book.bookId,
        [INDEX_ATTR]: JSON.stringify(index),
        [SYNCED_ATTR]: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`,
        [ATTRS_VER]: ATTRS_VERSION,
        name: book.book?.title || "",
        memo: `微信读书《${book.book?.title || ""}》同步文档`,
        tags: DOC_TAG,
    });

    // 清理空白占位块（文档创建时留下的空段落；索引有延迟，本次查不到下次补删）
    try {
        const blanks = await sql(
            `SELECT id, markdown FROM blocks WHERE parent_id='${docId}' AND type='p'`,
        );
        for (const b of blanks) {
            if (!(b.markdown || "").trim()) {
                await deleteBlock(b.id).catch(() => {});
            }
        }
    } catch {
        // 忽略
    }

    state[book.bookId] = { docId, lastSync: Date.now(), lastSort: book.sort || 0 };
    return result;
}

/**
 * 一次性属性回填：给老版本同步出来的块补上「块命名 + 检索属性」。
 * 只走 setBlockAttrs（这些块已存在，无法再通过 IAL 写入），并发 6。
 */
async function backfillAttrs(index: Record<string, string>, items: SyncItem[]): Promise<void> {
    const byKey = new Map(items.map((it) => [it.key, it]));
    const targets: { id: string; attrs: Record<string, string> }[] = [];
    for (const [key, id] of Object.entries(index)) {
        const it = byKey.get(key);
        if (it?.attrs) {
            targets.push({ id, attrs: it.attrs });
        }
    }
    await runPool(targets, 6, async (t) => {
        try {
            await setBlockAttrs(t.id, t.attrs);
        } catch {
            // 单块失败不影响整本同步
        }
    });
}

/** 简单并发池 */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const idx = cursor++;
            await fn(items[idx]);
        }
    });
    await Promise.all(workers);
}

/**
 * 写入节流。
 * 实测教训：短时间内几千次 updateBlock 会把思源内核压垮（连续崩过两次），
 * 每写 25 块让出 35ms，内核就有机会把索引刷下去。
 */
const THROTTLE_EVERY = 25;
const THROTTLE_MS = 35;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 批量同步（bookIds 为空则按过滤条件全部同步）
 * 失败不中断：任何一本出错都只影响它自己，并在 failed 里留下书名。
 */
export async function syncBooks(
    plugin: any,
    client: WereadClient,
    cfg: SyncConfig,
    bookIds?: Set<string>,
    onProgress?: (msg: string, done: number, total: number) => void,
): Promise<{ created: number; updated: number; deleted: number; books: number; skipped: number; failed: string[] }> {
    const notebooks = await client.listNotebooks();
    const targets = notebooks.filter((b) => {
        if (bookIds && !bookIds.has(b.bookId)) {
            return false;
        }
        return bookPassesFilter(b, cfg);
    });
    if (targets.length === 0) {
        return { created: 0, updated: 0, deleted: 0, books: 0, skipped: 0, failed: [] };
    }
    const state = (await plugin.loadData("state.json")) || {};
    const revision = configRevision(cfg);
    const revChanged = state["__revision"] !== revision;
    state["__revision"] = revision;

    const total = { created: 0, updated: 0, deleted: 0, books: 0, skipped: 0, failed: [] as string[] };
    let done = 0;

    await runPool(targets, 2, async (book) => {
        // 快照：失败时回滚这条记录，避免"半途 state"被写回磁盘
        const snapshot = state[book.bookId] ? { ...state[book.bookId] } : undefined;
        try {
            const r = await syncBook(plugin, client, book, cfg, state, revChanged, revision);
            total.created += r.created;
            total.updated += r.updated;
            total.deleted += r.deleted;
            total.books++;
            if (r.skipped) {
                total.skipped++;
            }
        } catch (e: any) {
            if (snapshot) {
                state[book.bookId] = snapshot;
            } else {
                delete state[book.bookId];
            }
            total.failed.push(book.book?.title || book.bookId);
            console.error("weread-notes: 同步失败", book.book?.title, e);
        } finally {
            done++;
            onProgress?.(`同步《${book.book?.title || ""}》…`, done, targets.length);
        }
    });

    await plugin.saveData("state.json", state);
    return total;
}

/** 全量重建（删除所有同步文档并重新同步；块引用会失效，需用户确认） */
export async function rebuildAll(plugin: any, cfg: SyncConfig, client: WereadClient): Promise<void> {
    const state = (await plugin.loadData("state.json")) || {};
    for (const bookId of Object.keys(state)) {
        if (bookId.startsWith("__")) {
            continue;
        }
        const rec = state[bookId];
        if (rec?.docId) {
            const rows = await sql(`SELECT box, path FROM blocks WHERE id='${rec.docId}' AND type='d' LIMIT 1`);
            if (rows.length > 0) {
                try {
                    await removeDoc(rows[0].box, rows[0].path);
                } catch {
                    // 忽略单个文档删除失败
                }
            }
        }
        delete state[bookId];
    }
    await plugin.saveData("state.json", state);
    await syncBooks(plugin, client, cfg, undefined);
}

export { sanitizeTitle, tsToDate, fmtDuration };
