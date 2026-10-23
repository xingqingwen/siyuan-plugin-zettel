/**
 * 本书笔记 · 勾选成卡
 *
 * 点书架上的书，不再把人踢去微信读书——就地展开这本书的划线与想法，
 * 勾选几条，一次生成文献卡。这是「素材 → 卡」闭环里最短的一条路：
 * 不经过同步文档翻找，也不用一条一条点。
 *
 * 数据直接走微信读书接口（实时），能对上已同步块的（name = h:/r: 键）
 * 就锚定来源；查不到锚点的照样建卡，只是引用原文、不带块引用。
 */
import { Dialog, showMessage } from "siyuan";
import { NotebookBook, WereadClient, ReviewItem } from "./weread";
import { afterCardCreated, createCardDoc, esc, notifyCardsChanged, plain, titleFromText } from "./cards";
import { getBlockAttrs, openDocTab, sqlStrict } from "./siyuanApi";
import { tsToDate } from "./sync";

const INDEX_ATTR = "custom-weread-index";

const STYLE_ID = "zt-bn-style";
const CSS = `
.zt-bn { display: flex; flex-direction: column; gap: 10px; min-width: 520px; }
.zt-bn-head { display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--b3-theme-secondary); }
.zt-bn-head .zt-flex { flex: 1; }
.zt-bn-list { max-height: 56vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.zt-bn-row {
  display: flex; gap: 9px; align-items: flex-start; padding: 8px 10px;
  border: 1px solid var(--b3-border-color); border-radius: 7px; cursor: pointer;
}
.zt-bn-row:hover { background: var(--b3-list-hover); }
.zt-bn-row.is-carded { opacity: .55; }
.zt-bn-row input[type=checkbox] { margin-top: 3px; flex-shrink: 0; }
.zt-bn-main { flex: 1; min-width: 0; }
.zt-bn-text { font-size: 12.5px; line-height: 1.6; color: var(--b3-theme-on-background); word-break: break-word; }
.zt-bn-meta { font-size: 11px; color: var(--b3-theme-secondary); margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.zt-badge { font-size: 10px; padding: 0 6px; border-radius: 8px; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); }
.zt-badge.ok { color: var(--b3-card-success-color, #2ec27e); border-color: transparent; background: var(--b3-card-success-background, rgba(46,194,126,.12)); }
.zt-empty { text-align: center; color: var(--b3-theme-tertiary); padding: 40px 16px; font-size: 12.5px; line-height: 2; }
.zt-bn-foot { display: flex; gap: 8px; align-items: center; }
.zt-bn-foot .zt-flex { flex: 1; }
.zt-bn-foot .b3-button { font-size: 12px; padding: 4px 12px; }
.zt-bn-make { background: var(--b3-theme-primary); color: #fff; border-color: transparent; font-weight: 600; }
.zt-bn-make:disabled { opacity: .4; cursor: not-allowed; }
`;

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
}

interface BookItem {
    /** h:<bookmarkId> / r:<reviewId>，与同步块 name 一致 */
    key: string;
    kind: "划线" | "想法";
    /** 想法 = 评论内容；划线 = 原文 */
    text: string;
    /** 想法带原文摘录时，引用=摘录、判断=评论（body） */
    quote: string;
    /** 预填「我的判断」：想法的评论内容；划线为空 */
    body: string;
    chapter: string;
    time: number;
    /** 已同步到思源的块 id，能锚就用 */
    anchorId: string;
    carded: boolean;
}

/** 已被任何卡片锚定为来源的块 ID 集合 */
async function usedSources(): Promise<Set<string>> {
    try {
        const rows = await sqlStrict<{ ial: string }>(
            `SELECT ial FROM blocks WHERE ial LIKE '%custom-card-source=%' LIMIT 100000`,
        );
        const out = new Set<string>();
        for (const r of rows) {
            const m = /custom-card-source="([^"]*)"/.exec(r.ial || "");
            if (m?.[1]) {
                out.add(m[1]);
            }
        }
        return out;
    } catch {
        return new Set();
    }
}

/**
 * 解析这本书的 key(h:/r:) → 思源块 id。
 * 映射存在同步文档根块的 custom-weread-index 属性里（同步器维护的索引），
 * 不在 blocks.name——别走弯路去查块名。
 */
async function resolveAnchors(syncedDocId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!syncedDocId) {
        return out;
    }
    try {
        const attrs = await getBlockAttrs(syncedDocId);
        const raw = JSON.parse(attrs[INDEX_ATTR] || "{}");
        for (const [key, val] of Object.entries(raw)) {
            // 值可能是单个 id，也可能是 id 数组（一对多，如热门+自划同键）
            const ids = typeof val === "string" ? [val] : Array.isArray(val) ? (val as string[]) : [];
            if (ids[0]) {
                out.set(key, ids[0]);
            }
        }
    } catch {
        // 读不到索引就空着建卡，不阻塞
    }
    return out;
}

/**
 * 打开「本书笔记」对话框。
 * 同步文档 tab 打开（旧入口保留为次级操作），主操作是就地勾选成卡。
 */
export async function openBookNotes(
    plugin: any,
    b: NotebookBook,
    opts: { apiKey: string; syncedDocId?: string },
): Promise<void> {
    if (!opts.apiKey) {
        throw new Error("没有配置微信读书 API Key");
    }
    ensureStyles();
    const bookTitle = b.book?.title || "未命名";
    const dialog = new Dialog({
        title: `《${esc(bookTitle)}》的笔记`,
        content: `<div class="zt-bn"><div class="zt-empty">正在从微信读书读取这本书的划线与想法…</div></div>`,
        width: "700px",
        height: "auto",
    });
    const host = dialog.element.querySelector(".zt-bn") as HTMLElement;
    let items: BookItem[] = [];

    try {
        const client = new WereadClient(opts.apiKey);
        const [hl, reviews] = await Promise.all([
            client.getHighlights(b.bookId).catch(() => null),
            client.listMyReviews(b.bookId).catch(() => [] as ReviewItem[]),
        ]);
        if (!dialog.element.isConnected) {
            return; // 用户已经关了
        }
        const chTitle = new Map<number, string>();
        for (const c of hl?.chapters || []) {
            chTitle.set(c.chapterUid, c.title);
        }
        items = [];
        for (const h of hl?.updated || []) {
            const text = plain(h.markText || "");
            if (text.length < 4) {
                continue;
            }
            items.push({
                key: `h:${h.bookmarkId}`,
                kind: "划线",
                text,
                quote: text,
                body: "",
                chapter: chTitle.get(h.chapterUid) || "",
                time: h.createTime,
                anchorId: "",
                carded: false,
            });
        }
        for (const r of reviews) {
            const rv = r.review || ({} as any);
            const content = plain(rv.content || "");
            if (content.length < 4) {
                continue;
            }
            const abs = plain(rv.abstract || "");
            items.push({
                key: `r:${rv.reviewId}`,
                kind: "想法",
                text: content,
                // 有摘录：引用=摘录、判断=评论；没摘录（章节点评）：全文作为引用，判断留白
                quote: abs || content,
                body: abs ? content : "",
                chapter: rv.chapterName || "",
                time: rv.createTime,
                anchorId: "",
                carded: false,
            });
        }
        items.sort((a, b2) => a.chapter.localeCompare(b2.chapter, "zh-Hans-CN") || b2.time - a.time);

        const [anchors, used] = await Promise.all([resolveAnchors(opts.syncedDocId || ""), usedSources()]);
        for (const it of items) {
            it.anchorId = anchors.get(it.key) || "";
            it.carded = !!it.anchorId && used.has(it.anchorId);
        }
    } catch (e: any) {
        host.innerHTML = `<div class="zt-empty" style="color:var(--b3-theme-error);">读取失败：${esc(
            String(e?.message || e),
        )}</div>`;
        return;
    }

    if (items.length === 0) {
        host.innerHTML = `<div class="zt-empty">这本书还没有划线和想法。<br>去微信读书里画几笔，回来点 ↻。</div>`;
        return;
    }

    const paint = () => {
        const carded = items.filter((i) => i.carded).length;
        host.innerHTML = `
  <div class="zt-bn-head">
    <span>共 ${items.length} 条（划线与想法）${carded ? ` · 已成卡 ${carded} 条` : ""}</span>
    <span class="zt-flex"></span>
    ${opts.syncedDocId ? `<button class="b3-button b3-button--outline zt-bn-doc" title="在编辑器里打开这本书的同步笔记">同步文档</button>` : ""}
  </div>
  <div class="zt-bn-list">${items
      .map(
          (it, idx) => `<label class="zt-bn-row ${it.carded ? "is-carded" : ""}" data-idx="${idx}">
  <input type="checkbox" ${it.carded ? "disabled" : ""}>
  <div class="zt-bn-main">
    <div class="zt-bn-text">${esc(it.text.slice(0, 260))}${it.text.length > 260 ? "…" : ""}</div>
    <div class="zt-meta">
      <span class="zt-badge">${esc(it.kind)}</span>
      ${it.chapter ? `<span>${esc(it.chapter.slice(0, 24))}</span>` : ""}
      <span>${esc(tsToDate(it.time))}</span>
      ${it.carded ? `<span class="zt-badge ok">已成卡</span>` : ""}
    </div>
  </div>
</label>`,
      )
      .join("")}</div>
  <div class="zt-bn-foot">
    <button class="b3-button b3-button--outline zt-bn-all">全选</button>
    <span class="zt-flex"></span>
    <button class="b3-button zt-bn-make" disabled>生成卡片</button>
  </div>`;

        const makeBtn = host.querySelector(".zt-bn-make") as HTMLButtonElement;
        const syncCount = () => {
            const checked = host.querySelectorAll<HTMLInputElement>(".zt-bn-row input:checked").length;
            makeBtn.textContent = checked > 0 ? `生成卡片（${checked}）` : "生成卡片";
            makeBtn.disabled = checked === 0;
        };

        for (const row of Array.from(host.querySelectorAll<HTMLElement>(".zt-bn-row"))) {
            row.addEventListener("click", (e) => {
                const cb = row.querySelector<HTMLInputElement>("input[type=checkbox]");
                if (!cb || cb.disabled) {
                    return;
                }
                if ((e.target as HTMLElement) !== cb) {
                    cb.checked = !cb.checked;
                }
                syncCount();
            });
        }
        host.querySelector(".zt-bn-all")!.addEventListener("click", () => {
            const boxes = host.querySelectorAll<HTMLInputElement>(".zt-bn-row input[type=checkbox]:not(:disabled)");
            const allOn = Array.from(boxes).every((c) => c.checked);
            boxes.forEach((c) => (c.checked = !allOn));
            syncCount();
        });
        const docBtn = host.querySelector(".zt-bn-doc") as HTMLElement | null;
        docBtn?.addEventListener("click", async () => {
            await openDocTab(plugin.app, opts.syncedDocId!).catch(() => {});
        });

        makeBtn.addEventListener("click", async () => {
            const checkedIdx = Array.from(host.querySelectorAll<HTMLInputElement>(".zt-bn-row input:checked"))
                .map((c) => Number(c.closest<HTMLElement>(".zt-bn-row")!.dataset.idx))
                .filter((n) => !Number.isNaN(n));
            if (checkedIdx.length === 0) {
                return;
            }
            makeBtn.disabled = true;
            makeBtn.textContent = "生成中…";
            let made = 0;
            let lastId = "";
            try {
                for (const idx of checkedIdx) {
                    const it = items[idx];
                    if (!it || it.carded) {
                        continue;
                    }
                    const r = await createCardDoc(plugin, {
                        title: titleFromText(it.text),
                        quote: it.quote,
                        body: it.body,
                        quoteMeta: `《${bookTitle}》${it.chapter || ""}`,
                        sourceBlockId: it.anchorId || undefined,
                        book: bookTitle,
                    });
                    it.carded = true;
                    made++;
                    lastId = r.docId;
                    // 写入节流：别把内核压挂（有前科）
                    await new Promise((res) => setTimeout(res, 200));
                }
                notifyCardsChanged();
                showMessage(`已生成 ${made} 张文献卡，标题取自原文首句——去卡片盒里打磨成你自己的判断`, 5000);
                if (lastId) {
                    // 批量建卡不逐张打断，只对最后一张递上关联建议
                    await afterCardCreated(plugin, lastId);
                }
                if (dialog.element.isConnected) {
                    paint(); // 重绘，勾过的行变成「已成卡」
                }
            } catch (e: any) {
                showMessage(`生成失败（已完成 ${made} 张）：${e?.message || e}`, 6000, "error");
                if (dialog.element.isConnected) {
                    paint();
                }
            }
        });
    };

    paint();
}
