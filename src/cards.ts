/**
 * 卡片盒 · 数据层
 *
 * 定位变了：这个插件的主功能是「卡片笔记」，微信读书只是素材来源之一。
 * 所以这里不再只服务于「想法 → 卡」，而是卡片本身的读写：
 * 新建、列表、状态、关联、索引。
 *
 * 三条不肯让步的原则：
 * 1. 卡片标题是一句判断，不是名词。名词是分类，句子才是观点。
 * 2. 正文永远由人写。工具只搭骨架、锚来源、牵线。
 * 3. 孤岛要能被看见。卡片笔记失败的唯一标志是孤岛越攒越多，而肉眼看不出来。
 */
import { Dialog, showMessage } from "siyuan";
import { ensureStyles } from "./ui";
import { openMapPicker } from "./mapCard";
import {
    appendBlock,
    createDocWithMd,
    findDocByPath,
    getBlockAttrs,
    openDocTab,
    removeDoc,
    setBlockAttrs,
    sql,
    sqlStrict,
} from "./siyuanApi";

export const CARD_TYPE_ATTR = "custom-card-type";
export const CARD_SOURCE_ATTR = "custom-card-source";
export const CARD_BOOK_ATTR = "custom-card-book";
export const CARD_MAP_ATTR = "custom-card-map";

/**
 * 卡片四种类型（2026-10-23 产品重设计，用户确认）：
 * - 文献卡：别人的话 + 出处。从素材长出来，或手动写入原文。
 * - 想法卡：自己的判断。建卡时勾选它连接的卡——想法从来不是凭空来的。
 * - 永久卡：多张卡片合成的一篇文章（用户命名的用法：永久 = 沉淀成文）。
 * - 地图卡：绑定地理位置的知识（海峡/港口/航线），既进链路网络，也钉在世界地图上。
 * 旧版的「待打磨/成熟」状态已废除：卡片只有类型，没有流程状态。
 */
export const CARD_TYPE_LIT = "文献";
export const CARD_TYPE_IDEA = "想法";
export const CARD_TYPE_ARTICLE = "永久";
export const CARD_TYPE_MAP = "地图";

/** 兼容旧数据：老版本把「锚了来源的卡」也标成 永久，展示时归位为文献 */
export function normalizeCardType(rawType: string, source: string): string {
    if (!rawType) {
        return source ? CARD_TYPE_LIT : CARD_TYPE_IDEA;
    }
    if (rawType === CARD_TYPE_ARTICLE && source) {
        return CARD_TYPE_LIT;
    }
    return rawType;
}

export interface Thought {
    id: string;
    rootId: string;
    /** 评论内容（你自己的话） */
    text: string;
    /** 选区原文摘录：锚定想法取它批注的划线原文；未锚定取引用块里的摘录；章节点评为空 */
    abstract: string;
    book: string;
    chapter: string;
    time: string;
}

export interface CardDoc {
    id: string;
    title: string;
    book: string;
    source: string;
    created: string;
    refs: number;
    /** 文献 / 想法 / 地图（永久留给成文卡） */
    cardType: string;
}

/** 卡片变动后广播，界面收到就刷新。避免各面板互相 import 成环 */
export const cardEvents = new EventTarget();
export function notifyCardsChanged(): void {
    cardEvents.dispatchEvent(new Event("changed"));
}

export function esc(s: string): string {
    return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function pick(ial: string, key: string): string {
    const m = new RegExp(`${key}="([^"]*)"`).exec(ial || "");
    return m ? m[1] : "";
}

/** 从 IAL 里取属性值（其它素材源模块也要用） */
export const pickAttr = pick;

export function plain(md: string): string {
    return (md || "")
        .replace(/^>\s?/gm, "")
        .replace(/^\s*✏️\s*/gm, "")
        .replace(/^\s*↩.*$/gm, "")
        .replace(/（\d+\s*人划线）/g, "")
        .replace(/[*`#>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** 标题净化：文件名不能带路径符号 */
export function safeTitle(s: string): string {
    return (s || "")
        .replace(/[\\/:*?"<>|]/g, " ")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[，,、；;：:。]+$/, "")
        .trim()
        .slice(0, 40);
}

/** 从一段原文里取第一句做标题。长句截断到 26 字 */
export function titleFromText(text: string): string {
    const t = plain(text);
    if (!t) {
        return "未命名卡片";
    }
    const first = t.split(/[。！？；\n]/)[0] || t;
    const s = first.length > 26 ? first.slice(0, 26) : first;
    return safeTitle(s) || "未命名卡片";
}

/** 全部想法（跨书） */
export async function listThoughts(): Promise<Thought[]> {
    const rows = await sqlStrict<{ id: string; root_id: string; markdown: string; ial: string }>(
        `SELECT id, root_id, markdown, ial FROM blocks ` +
            `WHERE ial LIKE '%custom-weread-type="thought"%' LIMIT 100000`,
    );
    const thoughts: Thought[] = [];
    /**
     * 锚定想法 → 它批注的划线块。注意 bookmarkId 不存在划线块的 IAL/name 里，
     * key(h:xxx)→块 id 的映射在同步文档根块的 custom-weread-index 属性里（同步器维护），
     * 必须走 getBlockAttrs 读（JSON 含引号，SQL 正则会截断）。
     */
    const byRoot = new Map<string, Map<string, Thought[]>>(); // rootId -> anchorKey -> thoughts
    for (const r of rows) {
        const anchor = pick(r.ial, "custom-weread-on");
        let abstract = "";
        let text = "";
        if (anchor) {
            // 锚定想法的块里只有评论，原文在划线块，先记下待查
            text = plain(r.markdown);
        } else {
            // 未锚定想法是一个引用块：原文摘录 + ✏️评论 合在一起，拆开
            const merged = (r.markdown || "").replace(/^>\s?/gm, "");
            const markAt = merged.indexOf("✏️");
            if (markAt >= 0) {
                abstract = merged.slice(0, markAt).trim();
                text = plain(merged.slice(markAt));
            } else {
                text = plain(r.markdown);
            }
        }
        const t: Thought = {
            id: r.id,
            rootId: r.root_id,
            text,
            abstract,
            book: pick(r.ial, "custom-weread-book-title"),
            chapter: pick(r.ial, "custom-weread-chapter"),
            time: pick(r.ial, "custom-weread-time"),
        };
        if (anchor) {
            let m = byRoot.get(t.rootId);
            if (!m) {
                m = new Map();
                byRoot.set(t.rootId, m);
            }
            const list = m.get(anchor) || [];
            list.push(t);
            m.set(anchor, list);
        }
        thoughts.push(t);
    }
    // 按同步文档批量把锚定划线的原文补进 abstract；单个文档解析失败不影响其它
    for (const [rootId, anchors] of byRoot) {
        try {
            const attrs = await getBlockAttrs(rootId);
            const idx = JSON.parse(attrs["custom-weread-index"] || "{}");
            /** 划线块 id → 等它原文的想法 */
            const want = new Map<string, Thought[]>();
            for (const [rawKey, ts] of anchors) {
                // custom-weread-on 存的是裸 bookmarkId，索引键带 h: 前缀
                const v = idx[`h:${rawKey}`];
                const hid = typeof v === "string" ? v : Array.isArray(v) ? v[0] : "";
                if (hid) {
                    const list = want.get(hid) || [];
                    list.push(...ts);
                    want.set(hid, list);
                }
            }
            const ids = Array.from(want.keys());
            for (let i = 0; i < ids.length; i += 40) {
                const cond = ids
                    .slice(i, i + 40)
                    .map((x) => `'${x}'`)
                    .join(",");
                const hls = await sqlStrict<{ id: string; markdown: string }>(
                    `SELECT id, markdown FROM blocks WHERE id IN (${cond}) LIMIT 200`,
                );
                for (const h of hls) {
                    for (const t of want.get(h.id) || []) {
                        t.abstract = plain(h.markdown);
                    }
                }
            }
        } catch {
            // 读不到索引就只有评论，不阻塞整个列表
        }
    }
    return thoughts.filter((t) => t.text.length > 3);
}

/**
 * 一张卡被引用了几次：文档自身被引 + 它的子块被引都算。
 * 查询失败返回 -1，界面显示「未知」——绝不把「查不到」当成「没人引用」。
 */
export async function refCount(docId: string): Promise<number> {
    try {
        const rows = await sqlStrict<{ c: number }>(
            `SELECT count(*) c FROM refs WHERE def_block_id='${docId}' OR def_block_parent_id='${docId}'`,
        );
        return Number(rows[0]?.c || 0);
    } catch {
        return -1;
    }
}

export async function listCards(): Promise<CardDoc[]> {
    const rows = await sqlStrict<{ id: string; content: string; ial: string; created: string }>(
        `SELECT id, content, ial, created FROM blocks ` +
            `WHERE type='d' AND ial LIKE '%${CARD_TYPE_ATTR}=%' LIMIT 100000`,
    );
    const out: CardDoc[] = [];
    for (const r of rows) {
        const source = pick(r.ial, CARD_SOURCE_ATTR);
        out.push({
            id: r.id,
            title: r.content || "未命名卡片",
            book: pick(r.ial, CARD_BOOK_ATTR),
            source,
            created: (r.created || "").slice(0, 10),
            refs: await refCount(r.id),
            cardType: normalizeCardType(pick(r.ial, CARD_TYPE_ATTR), source),
        });
    }
    out.sort((a, b) => (a.created < b.created ? 1 : -1));
    return out;
}

/**
 * 等文档进索引。
 * 实测教训：createDocWithMd 返回 id 的瞬间这个 id 还查不到，
 * 这时 setBlockAttrs 返回 200 但属性写不进去（静默失败）。
 */
async function waitIndexed(docId: string, ms = 4000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        try {
            const rows = await sql(`SELECT id FROM blocks WHERE id='${docId}'`);
            if (rows.length > 0) {
                return true;
            }
        } catch {
            // 索引抖动，继续等
        }
        await new Promise((r) => setTimeout(r, 120));
    }
    return false;
}

export function cardPaths(plugin: any): { notebook: string; root: string } {
    const cfg = plugin?.config || {};
    return {
        notebook: cfg.cardNotebook || cfg.notebookId || "",
        root: (cfg.cardPath || "卡片").replace(/^\/+|\/+$/g, ""),
    };
}

async function uniquePath(notebook: string, root: string, title: string): Promise<string> {
    let path = `/${root}/${title}`;
    if (await findDocByPath(notebook, path)) {
        const stamp = Date.now().toString().slice(-4);
        path = `/${root}/${title} (${stamp})`;
    }
    return path;
}

export interface NewCardInput {
    title: string;
    /** 正文（我的判断）。留空则写占位标题，等你自己填 */
    body?: string;
    /** 原文引用 */
    quote?: string;
    /** 原文出处，如《书名》第三章 · 2026-01-01 */
    quoteMeta?: string;
    /** 被引用的思源块（想法块或任意原文块） */
    sourceBlockId?: string;
    book?: string;
    /** 显式指定卡片类型；不填则由是否有来源自动判断（有来源=文献，无=想法） */
    cardType?: string;
    /** 建卡时就接上的关联卡（写进卡片末尾的块引用） */
    relatedCardIds?: string[];
    /** 地图卡的地理位置（存 custom-card-map，正文里也会写一行人话坐标） */
    map?: { points?: { name?: string; lat: number; lng: number }[]; regions?: { name?: string; n: number; e: number; s: number; w: number }[] };
}

/**
 * 建一张卡。
 * 刻意留空正文：如果我替你写「我的判断」，这张卡就又是一份复制品。
 */
export async function createCardDoc(plugin: any, input: NewCardInput): Promise<{ docId: string; title: string }> {
    const { notebook, root } = cardPaths(plugin);
    if (!notebook) {
        throw new Error("还没有选择笔记本，请先到设置里指定");
    }
    const title = safeTitle(input.title) || titleFromText(input.quote || input.body || "");
    const path = await uniquePath(notebook, root, title);

    const lines: string[] = [];
    // 有摘抄的卡（文献卡）：原文在上、判断在下——打开卡片第一眼先看到被评论的内容
    if (input.quote || input.sourceBlockId) {
        if (input.quote) {
            const q = input.quote.trim();
            // 保留换行结构：✏️ 前是原文摘录，✏️ 后是评论，各占一段，不再拍平成一堵字墙
            lines.push(...q.split(/\n/).map((l) => (l.trim() ? `> ${l.trim()}` : ">")));
            if (input.quoteMeta) {
                lines.push(`> ——${input.quoteMeta}`);
            }
        }
        if (input.sourceBlockId) {
            lines.push(`来源：((${input.sourceBlockId} "原文"))`);
        }
        lines.push("", "---", "");
    }
    if (input.body && input.body.trim()) {
        lines.push(input.body.trim(), "");
    } else {
        lines.push("**我的判断**", "");
    }
    if (input.map && (input.map.points?.length || input.map.regions?.length)) {
        lines.push("", "---", "");
        for (const p of input.map.points || []) {
            lines.push(`- 📍 ${p.name ? p.name + "：" : ""}${fmtLatLng(p.lat, p.lng)}`);
        }
        for (const r of input.map.regions || []) {
            lines.push(
                `- ▭ ${r.name ? r.name + "：" : ""}${r.n.toFixed(1)}°N~${r.s.toFixed(1)}°N, ${r.w.toFixed(1)}°E~${r.e.toFixed(1)}°E`,
            );
        }
    }

    const docId = await createDocWithMd(notebook, path, lines.join("\n"));
    const anchored = !!input.sourceBlockId || !!(input.quote && input.quote.trim());
    const cardType = input.cardType || (anchored ? CARD_TYPE_LIT : CARD_TYPE_IDEA);
    const attrs: Record<string, string> = {
        [CARD_TYPE_ATTR]: cardType,
    };
    if (input.sourceBlockId) {
        attrs[CARD_SOURCE_ATTR] = input.sourceBlockId;
    }
    if (input.book) {
        attrs[CARD_BOOK_ATTR] = input.book;
    }
    if (input.map && (input.map.points?.length || input.map.regions?.length)) {
        attrs[CARD_MAP_ATTR] = JSON.stringify(input.map);
    }

    await waitIndexed(docId);
    const wantType = attrs[CARD_TYPE_ATTR];
    for (let i = 0; i < 3; i++) {
        await setBlockAttrs(docId, attrs);
        const back = await getBlockAttrs(docId).catch(() => ({}) as Record<string, string>);
        if (back[CARD_TYPE_ATTR] === wantType) {
            break;
        }
        await new Promise((r) => setTimeout(r, 200));
    }

    // 建卡时就选好的关联：直接写进卡片末尾
    if (input.relatedCardIds && input.relatedCardIds.length > 0) {
        try {
            const all = await listCards();
            const targets = input.relatedCardIds
                .map((id) => all.find((c) => c.id === id))
                .filter((c): c is CardDoc => !!c);
            if (targets.length > 0) {
                await appendLinks(docId, targets);
            }
        } catch {
            // 关联失败不阻塞建卡，之后还能手动连
        }
    }
    notifyCardsChanged();
    return { docId, title };
}

/** 从一条微信读书想法建卡：原文摘录进引用，评论预填「我的判断」——评论就是你此刻的判断 */
export async function createCardFromThought(plugin: any, t: Thought): Promise<{ docId: string; title: string }> {
    const hasAbstract = !!t.abstract.trim();
    return createCardDoc(plugin, {
        title: titleFromText(t.text),
        // 有原文：引用=原文，判断=评论；没有原文（章节点评）：全文作为引用，判断留白
        quote: hasAbstract ? t.abstract : t.text,
        body: hasAbstract ? t.text : "",
        quoteMeta: `《${t.book || "未命名"}》${t.chapter || ""}${t.time ? ` · ${t.time}` : ""}`,
        sourceBlockId: t.id,
        book: t.book,
    });
}

/** 删除一张卡片文档。确认交互由调用方负责——删除不可恢复，必须让用户自己按 */
export async function deleteCard(docId: string): Promise<void> {
    const rows = await sqlStrict<{ box: string; path: string }>(
        `SELECT box, path FROM blocks WHERE id='${docId.replace(/'/g, "''")}' AND type='d' LIMIT 1`,
    );
    const r = rows[0];
    if (!r) {
        throw new Error("找不到这张卡的文档，可能已被删除");
    }
    await removeDoc(r.box, r.path);
    notifyCardsChanged();
}

/** 26.6°N, 56.2°E 这类人话坐标（与 mapCard 保持一致，避免循环依赖） */
export function fmtLatLng(lat: number, lng: number): string {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lng).toFixed(1)}°${ew}`;
}

/* ================= 关联建议 ================= */

/** 字符二元组。中文不需要分词，2 字切片对短语匹配已经够用 */
function bigrams(s: string): string[] {
    const t = (s || "").replace(/[\s\p{P}\p{S}]/gu, "");
    const out: string[] = [];
    for (let i = 0; i < t.length - 1; i++) {
        out.push(t.slice(i, i + 2));
    }
    return out;
}

const STOP_BIGRAMS = new Set([
    "我们", "你们", "他们", "自己", "这个", "那个", "什么", "不是", "就是", "所以",
    "因为", "但是", "可以", "如果", "已经", "一个", "一种", "这样", "那样", "没有",
    "时候", "东西", "事情", "问题", "方法", "方式", "非常", "真的", "其实",
]);

export interface RelatedHit {
    card: CardDoc;
    score: number;
    shared: string[];
}

/**
 * 找相关卡。纯字符重合 + 同源书加权。
 * 为什么不上向量：这一步要的是「把人已经写下的话递到他面前」，
 * 二元组重合足够，而且完全可解释——你能看到是哪个词把它们连起来的。
 */
export function findRelated(cards: CardDoc[], target: CardDoc, limit = 5): RelatedHit[] {
    const tb = bigrams(target.title);
    const tset = new Set(tb);
    const hits: RelatedHit[] = [];
    for (const c of cards) {
        if (c.id === target.id) {
            continue;
        }
        const shared = Array.from(new Set(bigrams(c.title).filter((g) => tset.has(g) && !STOP_BIGRAMS.has(g))));
        let score = shared.length * 2;
        if (target.book && c.book && target.book === c.book) {
            score += 3;
        }
        if (score > 0) {
            hits.push({ card: c, score, shared });
        }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
}

/** 把连接写进卡片末尾。写一次，两边反链都会亮 */
export async function appendLinks(docId: string, targets: CardDoc[]): Promise<number> {
    if (targets.length === 0) {
        return 0;
    }
    const md = targets
        .map((t) => `- 关联：((${t.id} "${t.title.replace(/"/g, "")}"))`)
        .join("\n");
    await appendBlock(docId, md);
    // refs 索引通常 500ms 内跟上，但刚建完卡的文档可能更慢。
    // 不等一下，界面会立刻把这张卡又标成「孤岛」——用户会以为白连了。
    await new Promise((r) => setTimeout(r, 900));
    notifyCardsChanged();
    return targets.length;
}

/** 关联对话框：候选卡 + 全量搜索，勾选即连。
 *  推荐候选在上（可解释的连接理由），搜不到时手动输关键词翻全量——
 *  「系统没想到的连接」不该由系统垄断，人要能翻盒子。 */
export function openLinkDialog(plugin: any, target: CardDoc, cards: CardDoc[], openOnCancel = false): void {
    ensureGraphStyles();
    ensureStyles();
    const hits = findRelated(cards, target, 8);
    const hitIds = new Set(hits.map((h) => h.card.id));
    const dialog = new Dialog({
        title: "建立连接",
        content: `<div class="zt-link">
  <div class="zt-link-tip">「${esc(target.title)}」${target.cardType === CARD_TYPE_IDEA ? "是想法卡，<b>想法要接在已有的卡上才有意义</b>" : "可能连接到下面这些卡"}。勾上就会在卡片末尾写入块引用——<b>连接是写进去的，不是想出来的</b>。</div>
  <div class="zt-search"><input class="b3-text-field zt-link-search" type="text" placeholder="没找到想连的？搜全部卡片"></div>
  <div class="zt-link-list"></div>
  <div class="zt-link-foot">
    <button class="b3-button b3-button--cancel zt-link-cancel">先不连</button>
    <button class="b3-button b3-button--text zt-link-ok">连接所选</button>
  </div>
</div>`,
        width: "560px",
        height: "auto",
    });

    const listEl = dialog.element.querySelector(".zt-link-list") as HTMLElement;
    const rowHTML = (c: CardDoc, why: string) =>
        `<label class="zt-link-row">
  <input type="checkbox" value="${c.id}">
  <span class="zt-link-title">${esc(c.title)}</span>
  <span class="zt-link-why">${esc(why)}</span>
</label>`;

    const paint = (kw: string) => {
        const k = kw.trim().toLowerCase();
        let html = "";
        if (k) {
            const shown = cards
                .filter((c) => c.id !== target.id && (c.title || "").toLowerCase().includes(k))
                .slice(0, 30);
            html = shown.length
                ? shown.map((c) => rowHTML(c, c.cardType === CARD_TYPE_LIT ? "文献" : "")).join("")
                : `<div class="zt-empty">没有匹配的卡片。</div>`;
        } else {
            html = hits.length
                ? hits
                      .map((h) =>
                          rowHTML(
                              h.card,
                              h.shared.length ? `共同词：${h.shared.slice(0, 3).join("、")}` : "同一本书",
                          ),
                      )
                      .join("")
                : `<div class="zt-empty">暂无推荐候选。${cards.length > 1 ? "用上面的搜索翻全部卡片。" : "<b>第二张卡出现时，第一张才开始有意义</b>。"}</div>`;
        }
        listEl.innerHTML = html;
    };
    paint("");

    const searchEl = dialog.element.querySelector(".zt-link-search") as HTMLInputElement;
    searchEl.addEventListener("input", () => paint(searchEl.value || ""));

    dialog.element.querySelector(".zt-link-cancel")!.addEventListener("click", () => {
        dialog.destroy();
        if (openOnCancel) {
            // 从「建卡」流程进来的：取消连接也要落到卡片上，别让用户两手空空
            openDocTab(plugin.app, target.id).catch(() => {});
        }
    });
    dialog.element.querySelector(".zt-link-ok")!.addEventListener("click", async () => {
        const checked = Array.from(dialog.element.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked"));
        const picked = checked
            .map((c) => cards.find((x) => x.id === c.value))
            .filter((x): x is CardDoc => !!x);
        if (picked.length === 0) {
            dialog.destroy();
            if (openOnCancel) {
                openDocTab(plugin.app, target.id).catch(() => {});
            }
            return;
        }
        try {
            await appendLinks(target.id, picked);
            showMessage(`已连上 ${picked.length} 张卡，打开卡片就能看到`, 3500);
            dialog.destroy();
            await openDocTab(plugin.app, target.id);
        } catch (e: any) {
            showMessage(`连接失败：${e?.message || e}`, 5000, "error");
        }
    });
}

/* ================= 新建卡片 ================= */

/**
 * 建卡后的收尾。孤岛最好在出生时就被接住：
 * - 有可连的卡 → 递上关联建议。
 * - 想法卡 → 关联一步必经，哪怕暂时没有候选。想法不是凭空来的，
 *   写下的那一刻就该回答「它接着哪张卡」。可以点「先不连」，但不静默跳过。
 * - 其它（文献卡/地图卡没候选）→ 直接打开卡片。
 */
export async function afterCardCreated(plugin: any, docId: string): Promise<void> {
    try {
        const cards = await listCards();
        const me = cards.find((c) => c.id === docId);
        if (me) {
            const hits = findRelated(cards, me, 5);
            if (hits.length > 0 || me.cardType === CARD_TYPE_IDEA || me.cardType === CARD_TYPE_MAP) {
                openLinkDialog(plugin, me, cards, true);
                return;
            }
        }
    } catch {
        // 查询失败不阻塞，直接打开卡片
    }
    try {
        await openDocTab(plugin.app, docId);
    } catch {
        // ignore
    }
}

/**
 * 新建卡片（2026-10-23 交互重设计）：
 * 一个入口、四种「起点」。建卡的本质区别不是类型标签，是你手里攥着什么：
 * 📖 文献卡 —— 从一句原文开始（别人的话 + 出处）
 * 💡 想法卡 —— 从一个念头开始（自己的判断，顺手接在相关卡上）
 * 🌏 地图卡 —— 从一个地方开始（既进链路，也钉在世界地图上）
 * 📜 永久卡 —— 从几张卡片开始（选卡、排序、合成一篇文章）
 * quote/sourceBlockId 有值时（从素材进来）直接落在文献卡并锚定来源。
 */
export function newCardDialog(
    plugin: any,
    preset: {
        cardType?: string;
        quote?: string;
        title?: string;
        sourceBlockId?: string;
        book?: string;
        relatedCardIds?: string[];
    } = {},
): void {
    ensureStyles();
    ensureGraphStyles();
    const presetType =
        preset.cardType || (preset.sourceBlockId || preset.quote ? CARD_TYPE_LIT : CARD_TYPE_IDEA);

    const MODES = [
        { t: CARD_TYPE_LIT, ico: "📖", name: "文献卡", desc: "从一句原文开始", tip: "别人的话 + 出处。从素材进来会自动锚定原文。" },
        { t: CARD_TYPE_IDEA, ico: "💡", name: "想法卡", desc: "从一个念头开始", tip: "你自己的判断。建卡时顺手勾上它接在哪几张卡上。" },
        { t: CARD_TYPE_MAP, ico: "🌏", name: "地图卡", desc: "从一个地方开始", tip: "绑定地理位置的知识（海峡/港口/航线），既进链路，也钉在世界地图上。" },
        { t: CARD_TYPE_ARTICLE, ico: "📜", name: "永久卡", desc: "从几张卡片开始", tip: "选多张卡按顺序合成一篇文章，卡片以嵌入块组织进来。" },
    ];

    const MODE_HINT: Record<string, string> = {
        [CARD_TYPE_LIT]: "文献卡：记录<b>别人的话</b>和出处。想记自己的判断，切到「想法卡」。",
        [CARD_TYPE_IDEA]: "想法卡：<b>你自己的判断</b>。下面可以勾选它接在哪几张卡上。",
        [CARD_TYPE_MAP]: "地图卡：绑定<b>地理位置</b>的知识（海峡/港口/航线），既进链路，也钉在世界地图上。",
        [CARD_TYPE_ARTICLE]: "永久卡：选几张卡、排好顺序，<b>合成一篇文章</b>。至少选两张——一张卡成不了文章。",
    };

    const dialog = new Dialog({
        title: "新建",
        content: `<div class="zt-new">
  <div class="zt-modes">
    ${MODES.map(
        (m) =>
            `<button class="b3-button b3-button--outline zt-mode-btn" data-mode="${m.t}" title="${m.tip}"><span class="zt-mode-ico">${m.ico}</span><span class="zt-mode-name">${m.name}</span><span class="zt-mode-desc">${m.desc}</span></button>`,
    ).join("")}
  </div>
  <div class="zt-field">
    <div class="zt-label zt-title-label">标题 · 写成一句判断</div>
    <input class="b3-text-field fn__block zt-new-title" placeholder="例：霍尔木兹海峡的咽喉是拉腊克岛，不是霍尔木兹岛" value="${esc(preset.title || "")}">
    <div class="zt-hint zt-new-typehint"></div>
  </div>
  <div class="zt-field zt-only-note">
    <div class="zt-label">我的判断（正文 · 可以先空着）</div>
    <textarea class="b3-text-field fn__block zt-new-body" rows="5" placeholder="2-5 句，用你自己的话说。"></textarea>
  </div>
  <div class="zt-field zt-only-lit">
    <div class="zt-label">原文（文献卡必填）</div>
    <textarea class="b3-text-field fn__block zt-new-quote" rows="3" placeholder="要引用的原文">${esc(preset.quote || "")}</textarea>
  </div>
  <div class="zt-field zt-only-lit">
    <div class="zt-label">出处</div>
    <input class="b3-text-field fn__block zt-new-meta" placeholder="如：《书名》第三章" value="${esc(preset.book || "")}">
  </div>
  <div class="zt-field zt-only-map" style="display:none;">
    <div class="zt-label">地图位置（地图卡必选）</div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="b3-button b3-button--outline zt-new-map">🌏 在地图上选位置</button>
      <span class="zt-map-summary" style="font-size:12px;color:var(--b3-theme-secondary);">还没选</span>
    </div>
  </div>
  <div class="zt-field zt-only-rel">
    <div class="zt-label">关联卡片（可多选 · 建卡时接上，孤岛越少越好）</div>
    <div class="zt-search"><input class="b3-text-field zt-rel-search" type="text" placeholder="搜卡片标题"></div>
    <div class="zt-rel-list"></div>
  </div>
  <div class="zt-field zt-only-article" style="display:none;">
    <div class="zt-label">引言（可选 · 放在文章开头）</div>
    <textarea class="b3-text-field fn__block zt-new-intro" rows="2" placeholder="一两句，说明这篇文章在回答什么问题。"></textarea>
    <div class="zt-label" style="margin-top:8px;">选卡片（可搜，勾选顺序就是文章顺序）</div>
    <div class="zt-search"><input class="b3-text-field zt-art-search" type="text" placeholder="搜卡片标题"></div>
    <div class="zt-art-order" style="font-size:11.5px;color:var(--b3-theme-secondary);margin:4px 0 6px;line-height:1.7;"></div>
    <div class="zt-art-list"></div>
  </div>
  <div class="zt-new-foot">    <span class="zt-new-err"></span>
    <button class="b3-button b3-button--cancel zt-new-cancel">取消</button>
    <button class="b3-button b3-button--text zt-new-ok">建卡</button>
  </div>
</div>`,
        width: "640px",
        height: "auto",
    });

    const titleEl = dialog.element.querySelector(".zt-new-title") as HTMLInputElement;
    const bodyEl = dialog.element.querySelector(".zt-new-body") as HTMLTextAreaElement;
    const quoteEl = dialog.element.querySelector(".zt-new-quote") as HTMLTextAreaElement;
    const metaEl = dialog.element.querySelector(".zt-new-meta") as HTMLInputElement;
    const introEl = dialog.element.querySelector(".zt-new-intro") as HTMLTextAreaElement;
    const errEl = dialog.element.querySelector(".zt-new-err") as HTMLElement;
    const hintEl = dialog.element.querySelector(".zt-new-typehint") as HTMLElement;
    const titleLabelEl = dialog.element.querySelector(".zt-title-label") as HTMLElement;
    const relListEl = dialog.element.querySelector(".zt-rel-list") as HTMLElement;
    const relSearchEl = dialog.element.querySelector(".zt-rel-search") as HTMLInputElement;
    const mapSummaryEl = dialog.element.querySelector(".zt-map-summary") as HTMLElement;
    const okBtn = dialog.element.querySelector(".zt-new-ok") as HTMLButtonElement;

    let mode = MODES.some((m) => m.t === presetType) ? presetType : CARD_TYPE_IDEA;
    let mapData: { points?: any[]; regions?: any[] } | undefined;
    /** 切走文献卡时暂存原文，切回来恢复——误点一下类型不该毁掉已贴的原文 */
    let quoteStash = preset.quote || "";

    const showField = (cls: string, on: boolean) => {
        (dialog.element.querySelector(cls) as HTMLElement).style.display = on ? "" : "none";
    };

    const paint = () => {
        for (const b of Array.from(dialog.element.querySelectorAll<HTMLElement>(".zt-mode-btn"))) {
            b.classList.toggle("zt-on", b.dataset.mode === mode);
        }
        hintEl.innerHTML = MODE_HINT[mode] || "";
        showField(".zt-only-lit", mode === CARD_TYPE_LIT);
        showField(".zt-only-map", mode === CARD_TYPE_MAP);
        showField(".zt-only-rel", mode !== CARD_TYPE_ARTICLE);
        showField(".zt-only-note", mode !== CARD_TYPE_ARTICLE);
        showField(".zt-only-article", mode === CARD_TYPE_ARTICLE);
        titleLabelEl.textContent = mode === CARD_TYPE_ARTICLE ? "文章标题" : "标题 · 写成一句判断";
        titleEl.placeholder =
            mode === CARD_TYPE_ARTICLE ? "例：为什么说航道即权力" : "例：霍尔木兹海峡的咽喉是拉腊克岛，不是霍尔木兹岛";
        // 原文框：切走文献卡时暂存，切回来恢复
        if (mode === CARD_TYPE_LIT) {
            if (!quoteEl.value.trim() && quoteStash) {
                quoteEl.value = quoteStash;
            }
        } else {
            if (quoteEl.value.trim()) {
                quoteStash = quoteEl.value;
            }
            quoteEl.value = "";
        }
        paintOkLabel();
    };

    const paintOkLabel = () => {
        okBtn.textContent =
            mode === CARD_TYPE_ARTICLE
                ? artPicked.length >= 2
                    ? `生成文章（${artPicked.length} 张卡）`
                    : "生成文章"
                : "建卡";
    };

    /* ---- 关联卡片多选（文献 / 想法 / 地图共用） ---- */
    const relPicked = new Set<string>(preset.relatedCardIds || []);
    const paintRel = (kw: string) => {
        const k = kw.trim().toLowerCase();
        void (async () => {
            let all: CardDoc[] = [];
            try {
                all = await listCards();
            } catch {
                relListEl.innerHTML = `<div class="zt-empty" style="padding:10px;">卡片列表读取失败，可以先不选。</div>`;
                return;
            }
            const shown = k ? all.filter((c) => (c.title || "").toLowerCase().includes(k)).slice(0, 40) : all.slice(0, 40);
            relListEl.innerHTML = shown.length
                ? shown
                      .map(
                          (c) =>
                              `<label class="zt-link-row"><input type="checkbox" value="${c.id}" ${
                                  relPicked.has(c.id) ? "checked" : ""
                              }><span class="zt-link-title">${esc(c.title)}</span><span class="zt-link-why">${esc(c.cardType)}</span></label>`,
                      )
                      .join("")
                : `<div class="zt-empty" style="padding:10px;">${all.length === 0 ? "盒子里还没有别的卡——第一张不用连。" : "没有匹配的卡片。"}</div>`;
        })();
    };
    relListEl.addEventListener("change", (e) => {
        const t = e.target as HTMLInputElement;
        if (t.type === "checkbox") {
            if (t.checked) {
                relPicked.add(t.value);
            } else {
                relPicked.delete(t.value);
            }
        }
    });

    /* ---- 永久卡：选卡排序（勾选顺序即文章顺序） ---- */
    const artListEl = dialog.element.querySelector(".zt-art-list") as HTMLElement;
    const artSearchEl = dialog.element.querySelector(".zt-art-search") as HTMLInputElement;
    const artPicked: CardDoc[] = [];

    const paintArtOrder = () => {
        const orderEl = dialog.element.querySelector(".zt-art-order") as HTMLElement;
        orderEl.innerHTML = artPicked.length
            ? `文章顺序：${artPicked.map((c, i) => `${i + 1}.${esc(c.title.slice(0, 12))}`).join(" → ")}`
            : "还没选卡。勾选下面的卡片，勾选顺序就是文章顺序。";
        paintOkLabel();
    };
    const paintArtList = (kw: string) => {
        void (async () => {
            let all: CardDoc[] = [];
            try {
                all = await listCards();
            } catch (e: any) {
                artListEl.innerHTML = `<div class="zt-empty" style="padding:10px;">读取失败：${esc(String(e?.message || e))}</div>`;
                return;
            }
            const k = kw.trim().toLowerCase();
            const shown = (k ? all.filter((c) => (c.title || "").toLowerCase().includes(k)) : all).slice(0, 60);
            artListEl.innerHTML = shown.length
                ? shown
                      .map(
                          (c) =>
                              `<label class="zt-link-row"><input type="checkbox" value="${c.id}" ${artPicked.some((p) => p.id === c.id) ? "checked" : ""}><span class="zt-link-title">${esc(c.title)}</span><span class="zt-link-why">${esc(c.cardType)}</span></label>`,
                      )
                      .join("")
                : `<div class="zt-empty" style="padding:10px;">${all.length === 0 ? "盒子里还没有卡——永久卡要从已有的卡里选。" : "没有匹配的卡片。"}</div>`;
        })();
    };
    artSearchEl.addEventListener("input", () => paintArtList(artSearchEl.value || ""));
    artListEl.addEventListener("change", (e) => {
        const t = e.target as HTMLInputElement;
        if (t.type !== "checkbox") {
            return;
        }
        if (t.checked) {
            void (async () => {
                const all = await listCards();
                const c = all.find((x) => x.id === t.value);
                if (c && !artPicked.some((p) => p.id === c.id)) {
                    artPicked.push(c);
                }
                paintArtOrder();
            })();
        } else {
            const i = artPicked.findIndex((p) => p.id === t.value);
            if (i >= 0) {
                artPicked.splice(i, 1);
            }
            paintArtOrder();
        }
    });
    paintArtList("");
    paintArtOrder();

    /* ---- 地图选位 ---- */
    (dialog.element.querySelector(".zt-new-map") as HTMLElement)?.addEventListener("click", () => {
        openMapPicker(mapData, (m) => {
            mapData = m;
            const n = (m.points?.length || 0) + (m.regions?.length || 0);
            mapSummaryEl.textContent = n > 0 ? `已选 ${n} 处位置` : "还没选";
        });
    });

    /* ---- 模式切换 ---- */
    for (const b of Array.from(dialog.element.querySelectorAll<HTMLElement>(".zt-mode-btn"))) {
        b.addEventListener("click", () => {
            mode = b.dataset.mode || CARD_TYPE_IDEA;
            paint();
        });
    }
    relSearchEl.addEventListener("input", () => paintRel(relSearchEl.value || ""));
    paint();
    paintRel("");
    titleEl.focus();

    dialog.element.querySelector(".zt-new-cancel")!.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector(".zt-new-ok")!.addEventListener("click", async () => {
        const title = titleEl.value.trim();
        errEl.textContent = "";

        /* ---- 永久卡：多卡成文 ---- */
        if (mode === CARD_TYPE_ARTICLE) {
            if (title.length < 2) {
                errEl.textContent = "文章标题不能空着";
                titleEl.focus();
                return;
            }
            if (artPicked.length < 2) {
                errEl.textContent = "至少选两张卡——一张卡成不了文章，那只是它自己";
                return;
            }
            try {
                const { notebook, root } = cardPaths(plugin);
                if (!notebook) {
                    throw new Error("还没有选择笔记本，请先到设置里指定");
                }
                const path = await uniquePath(notebook, root, title);
                const lines: string[] = [];
                if (introEl.value.trim()) {
                    lines.push(introEl.value.trim(), "");
                }
                for (const c of artPicked) {
                    lines.push(`{{embed ((${c.id} "${c.title.replace(/"/g, "")}"))}}`, "");
                }
                // 嵌入块的引用要等文档被打开渲染才进 refs 表（实测索引时不注册），
                // 链路图会断——补一行普通块引用，索引时即注册，链路立刻通。
                lines.push("---", "", `🔗 合成来源：${artPicked.map((c) => `((${c.id} "${c.title.replace(/"/g, "")}"))`).join("、")}`);
                const docId = await createDocWithMd(notebook, path, lines.join("\n"));
                await waitIndexed(docId);
                await setBlockAttrs(docId, { [CARD_TYPE_ATTR]: CARD_TYPE_ARTICLE });
                notifyCardsChanged();
                dialog.destroy();
                showMessage(`永久卡已生成：${artPicked.length} 张卡按顺序嵌进去了`, 3500);
                await openDocTab(plugin.app, docId).catch(() => {});
            } catch (e: any) {
                errEl.textContent = `生成失败：${e?.message || e}`;
            }
            return;
        }

        /* ---- 文献 / 想法 / 地图 ---- */
        if (title.length < 2) {
            errEl.textContent = "标题不能空着——哪怕先写一句粗糙的";
            titleEl.focus();
            return;
        }
        if (mode === CARD_TYPE_LIT && !quoteEl.value.trim() && !preset.sourceBlockId) {
            errEl.textContent = "文献卡要有原文——手动写的原文填「原文」框；从素材来的请去素材里勾「写成卡」";
            return;
        }
        if (
            mode === CARD_TYPE_MAP &&
            (!mapData || (mapData.points?.length || 0) + (mapData.regions?.length || 0) === 0)
        ) {
            errEl.textContent = "地图卡至少钉一个位置——点「🌏 在地图上选位置」";
            return;
        }
        const relatedIds = Array.from(relPicked);
        try {
            const made = await createCardDoc(plugin, {
                title,
                body: bodyEl.value,
                quote: quoteEl.value,
                quoteMeta: metaEl.value.trim() || undefined,
                sourceBlockId: preset.sourceBlockId,
                book: preset.book || metaEl.value.trim() || undefined,
                cardType: mode,
                relatedCardIds: relatedIds,
                map: mapData as any,
            });
            dialog.destroy();
            showMessage("卡片已建好", 2500);
            if (relatedIds.length > 0) {
                // 关联是用户自己勾的，不用再打断
                await openDocTab(plugin.app, made.docId).catch(() => {});
            } else {
                await afterCardCreated(plugin, made.docId);
            }
        } catch (e: any) {
            errEl.textContent = `建卡失败：${e?.message || e}`;
        }
    });
}

/* ================= 永久卡（多卡成文） ================= */

/** 兼容入口：永久卡现在是「新建」对话框的第四种起点 */
export function openComposeDialog(plugin: any): void {
    newCardDialog(plugin, { cardType: CARD_TYPE_ARTICLE });
}

/* ================= 链路图 ================= */

const GRAPH_CSS = `
.zt-search { margin: 0 0 6px; }
.zt-search .b3-text-field { width: 100%; font-size: 12px; padding: 4px 8px; box-sizing: border-box; }
.zt-flex { flex: 1; }
.zt-empty { text-align: center; color: var(--b3-theme-tertiary); padding: 40px 16px; font-size: 12.5px; line-height: 2; }
.zt-empty b { color: var(--b3-theme-secondary); }
.zt-badge { font-size: 10px; padding: 0 6px; border-radius: 8px; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); flex-shrink: 0; }
.zt-badge.ok { color: var(--b3-card-success-color, #2ec27e); border-color: transparent; background: var(--b3-card-success-background, rgba(46,194,126,.12)); }
.zt-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.zt-mode-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 4px; border-radius: 8px; height: auto; }
.zt-mode-btn .zt-mode-ico { font-size: 20px; line-height: 1; }
.zt-mode-btn .zt-mode-name { font-size: 12.5px; font-weight: 600; }
.zt-mode-btn .zt-mode-desc { font-size: 10.5px; color: var(--b3-theme-tertiary); }
.zt-mode-btn.zt-on { border-color: var(--b3-theme-primary); color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest, rgba(53,125,227,.07)); }
.zt-mode-btn.zt-on .zt-mode-desc { color: var(--b3-theme-primary); opacity: .75; }
.zt-graph { display: flex; flex-direction: column; gap: 10px; }
.zt-graph-head { display: flex; align-items: center; gap: 6px; }
.zt-graph-head .b3-button { font-size: 12px; padding: 4px 10px; }
.zt-canvas {
  position: relative; border: 1px dashed var(--b3-border-color); border-radius: 8px;
  overflow: hidden; background: var(--b3-theme-background); min-height: 160px;
}
.zt-wires { position: absolute; inset: 0; pointer-events: none; }
.zt-node {
  position: absolute; height: 44px; padding: 4px 8px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface);
  display: flex; align-items: center; gap: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.05);
  box-sizing: border-box;
}
.zt-node:hover { border-color: var(--b3-theme-primary); }
.zt-node.is-center {
  border: 1.5px solid var(--b3-theme-primary); z-index: 2;
  background: var(--b3-theme-primary-lightest, rgba(53,125,227,.07));
}
.zt-node-title {
  flex: 1; min-width: 0; font-size: 12px; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.zt-node.is-center .zt-node-title { font-weight: 600; color: var(--b3-theme-primary); }
.zt-node .zt-g-open { font-size: 11px; padding: 1px 7px; opacity: 0; flex-shrink: 0; }
.zt-node:hover .zt-g-open { opacity: 1; }
.zt-gstub { font-size: 11.5px; color: var(--b3-theme-tertiary); padding: 2px 0; }
.zt-graph-tip { font-size: 11px; color: var(--b3-theme-tertiary); text-align: center; }
`;

function ensureGraphStyles(): void {
    if (document.getElementById("zt-graph-style")) {
        return;
    }
    const st = document.createElement("style");
    st.id = "zt-graph-style";
    st.textContent = GRAPH_CSS;
    document.head.appendChild(st);
}

export interface GraphNode {
    id: string;
    title: string;
    /** 是卡片 / 普通文档 / 微信读书素材 */
    kind: "card" | "doc" | "weread";
    cardType: string;
}

export interface CardGraph {
    center: GraphNode;
    /** 我引用了谁（从哪里长出来） */
    up: GraphNode[];
    /** 谁引用了我（长出了什么） */
    down: GraphNode[];
}

function escIn(s: string): string {
    return (s || "").replace(/'/g, "''");
}

/** 一堆块 id → 归并到所属文档，并识别类型（卡片/普通文档/微信读书素材） */
async function nodesFromBlockIds(blockIds: string[]): Promise<GraphNode[]> {
    if (blockIds.length === 0) {
        return [];
    }
    const inList = blockIds.map(escIn).map((i) => `'${i}'`).join(",");
    try {
        const roots = await sqlStrict<{ id: string; root_id: string }>(
            `SELECT DISTINCT id, root_id FROM blocks WHERE id IN (${inList}) LIMIT 10000`,
        );
        const rootIds = Array.from(new Set(roots.map((r) => r.root_id))).filter((x) => x);
        if (rootIds.length === 0) {
            return [];
        }
        const inRoots = rootIds.map(escIn).map((i) => `'${i}'`).join(",");
        const docs = await sqlStrict<{ id: string; content: string; ial: string }>(
            `SELECT id, content, ial FROM blocks WHERE type='d' AND id IN (${inRoots}) LIMIT 10000`,
        );
        return docs.map((d) => {
            const ct = pick(d.ial, CARD_TYPE_ATTR);
            return {
                id: d.id,
                title: d.content || "未命名",
                kind: ct ? "card" : d.ial.includes("custom-weread-type") ? ("weread" as const) : ("doc" as const),
                cardType: ct,
            };
        });
    } catch {
        return [];
    }
}

/**
 * 一张卡的链路：上游（我引用的块所在文档）+ 下游（引用了我的文档）。
 * 只用 refs 表，一次两条查询，不递归——展开一层就已经能看清位置，
 * 想看更远就以邻卡为中心再看一层。
 */
export async function cardGraph(docId: string): Promise<CardGraph> {
    const centerDocs = await sqlStrict<{ id: string; content: string; ial: string }>(
        `SELECT id, content, ial FROM blocks WHERE type='d' AND id='${escIn(docId)}' LIMIT 1`,
    ).catch(() => [] as { id: string; content: string; ial: string }[]);
    const cd = centerDocs[0];
    const center: GraphNode = {
        id: docId,
        title: cd?.content || "未命名",
        kind: pick(cd?.ial || "", CARD_TYPE_ATTR) ? "card" : "doc",
        cardType: pick(cd?.ial || "", CARD_TYPE_ATTR),
    };

    const upIds: string[] = await sqlStrict<{ def_block_id: string }>(
        `SELECT DISTINCT def_block_id FROM refs WHERE block_id IN ` +
            `(SELECT id FROM blocks WHERE root_id='${escIn(docId)}') LIMIT 5000`,
    )
        .then((rows) => rows.map((r) => r.def_block_id))
        .catch(() => []);
    const downIds: string[] = await sqlStrict<{ block_id: string }>(
        `SELECT DISTINCT block_id FROM refs ` +
            `WHERE def_block_id='${escIn(docId)}' OR def_block_parent_id='${escIn(docId)}' LIMIT 5000`,
    )
        .then((rows) => rows.map((r) => r.block_id))
        .catch(() => []);

    const [up, down] = await Promise.all([nodesFromBlockIds(upIds), nodesFromBlockIds(downIds)]);
    return {
        center,
        up: up.filter((n) => n.id !== docId),
        down: down.filter((n) => n.id !== docId),
    };
}

function graphNodeBadge(n: GraphNode): string {
    return n.kind === "card"
        ? `<span class="zt-badge ${n.cardType === CARD_TYPE_LIT ? "" : "ok"}">${esc(n.cardType || "卡")}</span>`
        : n.kind === "weread"
          ? `<span class="zt-badge">素材</span>`
          : `<span class="zt-badge">文档</span>`;
}

/**
 * 链路对话框：真正的图——上游节点在左、本卡居中、下游在右，连线用 SVG 画。
 * 点任何节点以它为中心重画（可以沿网络一直走）；「打开」直接跳文档；
 * 「返回」沿走来的路径回退。
 */
export async function openGraphDialog(plugin: any, docId: string): Promise<void> {
    ensureGraphStyles();
    ensureStyles();
    const dialog = new Dialog({
        title: "卡片链路",
        content: `<div class="zt-graph" style="min-width:780px;"><div class="zt-empty">绘制中…</div></div>`,
        width: "920px",
        height: "auto",
    });
    const host = dialog.element.querySelector(".zt-graph") as HTMLElement;

    /** 走过的中心点，供「返回」回退 */
    const stack: string[] = [];

    const paint = async (centerId: string) => {
        host.innerHTML = `<div class="zt-empty">绘制中…</div>`;
        let g: CardGraph;
        try {
            g = await cardGraph(centerId);
        } catch (e: any) {
            host.innerHTML = `<div class="zt-empty">读取失败：${esc(String(e?.message || e))}</div>`;
            return;
        }

        const NW = 260; // 节点宽
        const NH = 48; // 节点高
        const RH = 64; // 行距
        const PAD = 14;
        // 至少留三行高度：一两个节点时画布不至于挤成一坨
        const rows = Math.max(g.up.length, g.down.length, 3);
        const H = rows * RH + PAD * 2;

        host.innerHTML = `
  <div class="zt-graph-head">
    <button class="b3-button b3-button--outline zt-g-back" style="${stack.length ? "" : "visibility:hidden;"}">↩ 返回</button>
    <span class="zt-flex"></span>
    <button class="b3-button b3-button--outline zt-g-relate" title="为这张卡寻找/挑选关联">关联</button>
    <button class="b3-button b3-button--outline zt-g-spawn" title="由这张卡长出一张新想法卡，自动连回来">✍ 由此想</button>
    <button class="b3-button b3-button--outline zt-g-open-center" title="打开这张卡全文">打开本卡</button>
  </div>
  <div class="zt-canvas" style="height:${H}px"><svg class="zt-wires" width="100%" height="${H}"></svg></div>
  <div class="zt-graph-tip">${g.up.length ? `↑ ${g.up.length} 个来源` : "↑ 还没有引用来源"}　·　点节点往里走　·　${g.down.length ? `↓ ${g.down.length} 个延伸` : "↓ 还没有被别的卡引用"}</div>`;

        const canvas = host.querySelector(".zt-canvas") as HTMLElement;
        const svg = host.querySelector(".zt-wires") as SVGElement;
        const W = canvas.clientWidth || 620;
        const cx = Math.round((W - NW) / 2);
        const cy = Math.round(H / 2 - NH / 2);

        const addNode = (n: GraphNode, x: number, y: number, isCenter = false) => {
            const el = document.createElement("div");
            el.className = `zt-node ${isCenter ? "is-center" : ""}`;
            el.style.cssText = `left:${x}px;top:${y}px;width:${NW}px;height:${NH}px;`;
            el.dataset.id = n.id;
            el.innerHTML = `${graphNodeBadge(n)}<div class="zt-node-title" title="${esc(n.title)}">${esc(n.title)}</div><button class="b3-button b3-button--outline zt-g-open">打开</button>`;
            canvas.appendChild(el);
            return el;
        };

        const colY = (count: number, i: number) =>
            Math.round((H - count * RH + (RH - NH)) / 2 + i * RH);

        const upEls = g.up.map((n, i) => addNode(n, 0, colY(g.up.length, i)));
        const downEls = g.down.map((n, i) => addNode(n, W - NW, colY(g.down.length, i)));
        addNode(g.center, cx, cy, true);

        // 连线：上游右缘 → 本卡左缘；本卡右缘 → 下游左缘
        const NS = "http://www.w3.org/2000/svg";
        const wire = (x1: number, y1: number, x2: number, y2: number) => {
            const p = document.createElementNS(NS, "path");
            const mid = Math.round((x1 + x2) / 2);
            p.setAttribute("d", `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", "var(--b3-theme-primary, #357de3)");
            p.setAttribute("stroke-width", "1.4");
            p.setAttribute("opacity", "0.45");
            svg.appendChild(p);
        };
        for (let i = 0; i < g.up.length; i++) {
            const r = upEls[i].getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            wire(r.right - c.left, r.top - c.top + r.height / 2, cx, cy + NH / 2);
        }
        for (let i = 0; i < g.down.length; i++) {
            const r = downEls[i].getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            wire(cx + NW, cy + NH / 2, r.left - c.left, r.top - c.top + r.height / 2);
        }

        const bindNode = (el: HTMLElement) => {
            el.addEventListener("click", async (e) => {
                const t = e.target as HTMLElement;
                const id = el.dataset.id!;
                if (t.classList.contains("zt-g-open")) {
                    e.stopPropagation();
                    await openDocTab(plugin.app, id).catch(() => {});
                    return;
                }
                if (id === centerId) {
                    return;
                }
                stack.push(centerId);
                void paint(id);
            });
        };
        Array.from(canvas.querySelectorAll<HTMLElement>(".zt-node")).forEach(bindNode);

        (host.querySelector(".zt-g-back") as HTMLElement)?.addEventListener("click", () => {
            const prev = stack.pop();
            if (prev) {
                void paint(prev);
            }
        });
        (host.querySelector(".zt-g-open-center") as HTMLElement)?.addEventListener("click", async () => {
            await openDocTab(plugin.app, centerId).catch(() => {});
        });
        (host.querySelector(".zt-g-spawn") as HTMLElement)?.addEventListener("click", () => {
            // 由这张卡长出一张想法卡：预填关联（指向本卡），建完自动连回来
            newCardDialog(plugin, { cardType: CARD_TYPE_IDEA, relatedCardIds: [centerId] });
        });
        (host.querySelector(".zt-g-relate") as HTMLElement)?.addEventListener("click", async () => {
            try {
                const cards = await listCards();
                const me = cards.find((c) => c.id === centerId);
                if (me) {
                    openLinkDialog(plugin, me, cards, false);
                } else {
                    showMessage("这张还不在卡片盒里（可能是普通文档或素材块）", 3000);
                }
            } catch (e: any) {
                showMessage(`读取失败：${e?.message || e}`, 5000, "error");
            }
        });
    };

    await paint(docId);
}

/* ================= 索引文档 ================= */

/** 生成「卡片索引」：全是 SQL 查询块，随卡片变化自动更新 */
export async function buildCardIndex(plugin: any): Promise<string> {
    const { notebook, root } = cardPaths(plugin);
    if (!notebook) {
        throw new Error("还没有选择笔记本");
    }
    const path = `/${root}/卡片索引`;
    const exist = await findDocByPath(notebook, path);
    if (exist) {
        // 索引里是 SQL 查询块，本身就是活的。重写文档块等于清空重建，风险大于收益。
        return exist;
    }
    const q = (s: string) => `{{${s}}}`;
    const anyCard = `ial like '%${CARD_TYPE_ATTR}=%'`;
    const md = [
        "## 全部卡片",
        "",
        q(
            `select content as 标题, hpath as 路径, created as 创建 from blocks ` +
                `where type='d' and ${anyCard} order by created desc`,
        ),
        "",
        "## 孤岛卡（没有任何引用，说明还没接进网络）",
        "",
        q(
            `select content as 标题, hpath as 路径 from blocks ` +
                `where type='d' and ${anyCard} ` +
                `and id not in (select def_block_id from refs)`,
        ),
        "",
        "## 地图卡",
        "",
        q(
            `select content as 标题, hpath as 路径 from blocks ` +
                `where type='d' and ial like '%${CARD_MAP_ATTR}=%'`,
        ),
        "",
        "> 这几块是活的：新建卡片、连上引用之后，回来看就自动变了。",
    ].join("\n");
    return await createDocWithMd(notebook, path, md);
}
