/**
 * 块选择器：把任意思源文档里的内容块批量整理成文献卡。
 *
 * 「思源文档」tab 的核心需求是整理：点文档名回思源原生界面读原文，
 * 点「✍ 整理成卡」回面板勾块。这里只做一件事——选块 → 批量成卡。
 * 锚定走块 id（createCardDoc 的 sourceBlockId），卡片和原文永远互相找得到。
 */
import { Dialog, showMessage } from "siyuan";
import { CardDoc, createCardDoc, esc, listCards, notifyCardsChanged, titleFromText } from "./cards";
import { sqlStrict } from "./siyuanApi";

const STYLE_ID = "zt-bp-style";
const CSS = `
.zt-bp { display: flex; flex-direction: column; gap: 10px; min-width: 560px; }
.zt-bp-tip { font-size: 12px; color: var(--b3-theme-secondary); line-height: 1.7; }
.zt-bp-list { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.zt-bp-row { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border: 1px solid var(--b3-border-color); border-radius: 7px; cursor: pointer; }
.zt-bp-row:hover { background: var(--b3-list-hover); }
.zt-bp-row.carded { opacity: .5; }
.zt-bp-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid var(--b3-border-color); background: var(--b3-theme-surface); flex-shrink: 0; margin-top: 1px; }
.zt-bp-text { flex: 1; font-size: 12.5px; line-height: 1.55; min-width: 0; word-break: break-word; }
.zt-bp-foot { display: flex; gap: 8px; align-items: center; }
.zt-bp-count { font-size: 12px; color: var(--b3-theme-secondary); flex: 1; }
.zt-bp-rel { display: flex; flex-direction: column; gap: 4px; }
.zt-bp-rel-list { max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
`;

const TYPE_LABEL: Record<string, string> = { p: "段落", h: "标题", b: "引用", t: "表格" };

interface DocBlock {
    id: string;
    type: string;
    content: string;
    carded: boolean;
}

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

export function openBlockPicker(
    plugin: any,
    doc: { id: string; title: string; nbName: string },
): void {
    ensureStyles();
    const dialog = new Dialog({
        title: `整理成卡 · ${doc.title}`,
        content: `<div class="zt-bp">
  <div class="zt-bp-tip">勾选要整理的块（可多选），每块生成一张<b>文献卡</b>：原文进卡、锚定回这个块，出处是《${esc(doc.title)}》。<br>灰色的是已经成过卡的块，默认不重复整理。</div>
  <div class="zt-search"><input class="b3-text-field zt-bp-search" type="text" placeholder="搜块内容"></div>
  <div class="zt-bp-list"><div class="zt-empty" style="padding:20px;">读取中…</div></div>
  <div class="zt-field">
    <div class="zt-label" style="font-weight:500;">可选：把这些卡都连到某张已有卡（想法卡建议连）</div>
    <div class="zt-bp-rel">
      <div class="zt-search"><input class="b3-text-field zt-bp-rel-search" type="text" placeholder="搜卡片标题，点选一张"></div>
      <div class="zt-bp-rel-list"></div>
    </div>
  </div>
  <div class="zt-bp-foot">
    <span class="zt-bp-count">还没选块</span>
    <span class="zt-bp-err" style="font-size:12px;color:var(--b3-theme-error);"></span>
    <button class="b3-button b3-button--cancel zt-bp-cancel">取消</button>
    <button class="b3-button b3-button--text zt-bp-ok" disabled>生成文献卡</button>
  </div>
</div>`,
        width: "680px",
        height: "auto",
    });

    const listEl = dialog.element.querySelector(".zt-bp-list") as HTMLElement;
    const searchEl = dialog.element.querySelector(".zt-bp-search") as HTMLInputElement;
    const relListEl = dialog.element.querySelector(".zt-bp-rel-list") as HTMLElement;
    const relSearchEl = dialog.element.querySelector(".zt-bp-rel-search") as HTMLInputElement;
    const countEl = dialog.element.querySelector(".zt-bp-count") as HTMLElement;
    const errEl = dialog.element.querySelector(".zt-bp-err") as HTMLElement;
    const okBtn = dialog.element.querySelector(".zt-bp-ok") as HTMLButtonElement;

    let blocks: DocBlock[] = [];
    let cards: CardDoc[] = [];
    const picked = new Set<string>();
    /** 可选：全部新卡连到这张已有卡 */
    let relCard: CardDoc | null = null;

    const paintCount = () => {
        countEl.textContent = picked.size > 0 ? `已选 ${picked.size} 块 → 生成 ${picked.size} 张文献卡${relCard ? `，全部连到「${relCard.title.slice(0, 14)}」` : ""}` : "还没选块";
        okBtn.disabled = picked.size === 0;
        okBtn.textContent = picked.size > 0 ? `生成 ${picked.size} 张文献卡` : "生成文献卡";
    };

    const paintList = () => {
        const kw = (searchEl.value || "").trim().toLowerCase();
        const shown = kw ? blocks.filter((b) => b.content.toLowerCase().includes(kw)) : blocks;
        listEl.innerHTML = shown.length
            ? shown
                  .map(
                      (b) =>
                          `<label class="zt-bp-row ${b.carded ? "carded" : ""}" data-id="${b.id}">
  <input type="checkbox" ${picked.has(b.id) ? "checked" : ""}>
  <span class="zt-bp-badge">${TYPE_LABEL[b.type] || b.type}</span>
  <span class="zt-bp-text">${esc(b.content.slice(0, 180))}${b.content.length > 180 ? "…" : ""}${b.carded ? ` <span class="zt-badge ok">已成卡</span>` : ""}</span>
</label>`,
                  )
                  .join("")
            : `<div class="zt-empty" style="padding:20px;">${blocks.length === 0 ? "这个文档没有可整理的内容块。" : "没有匹配的块。"}</div>`;
    };

    const paintRel = () => {
        const kw = (relSearchEl.value || "").trim().toLowerCase();
        const shown = (kw ? cards.filter((c) => c.title.toLowerCase().includes(kw)) : cards).slice(0, 12);
        relListEl.innerHTML = shown.length
            ? shown
                  .map(
                      (c) =>
                          `<div class="zt-bp-row ${relCard?.id === c.id ? "carded" : ""}" data-rel="${c.id}" style="padding:4px 9px;">
  <span class="zt-bp-text">${relCard?.id === c.id ? "✅ " : ""}${esc(c.title.slice(0, 40))} <span class="zt-badge">${esc(c.cardType)}</span></span>
</div>`,
                  )
                  .join("")
            : `<div class="zt-empty" style="padding:8px;font-size:11.5px;">${cards.length === 0 ? "盒子里还没有卡，第一张不用连。" : "没有匹配的卡片。"}</div>`;
    };

    void (async () => {
        try {
            const [rows, cardList] = await Promise.all([
                sqlStrict<{ id: string; type: string; content: string }>(
                    `SELECT id, type, content FROM blocks WHERE root_id='${doc.id}' AND type IN ('p','h','b','t') AND length(content) > 4 ORDER BY sort LIMIT 500`,
                ),
                listCards(),
            ]);
            cards = cardList;
            /** 已成卡的块：卡片上的 custom-card-source 指回来 */
            const carded = new Set(cards.map((c) => c.source).filter(Boolean));
            blocks = rows.map((r) => ({ ...r, carded: carded.has(r.id) }));
            paintList();
            paintRel();
        } catch (e: any) {
            listEl.innerHTML = `<div class="zt-empty" style="padding:20px;color:var(--b3-theme-error);">读取失败：${esc(String(e?.message || e))}</div>`;
        }
    })();

    searchEl.addEventListener("input", paintList);
    relSearchEl.addEventListener("input", paintRel);

    listEl.addEventListener("change", (e) => {
        const t = e.target as HTMLInputElement;
        if (t.type !== "checkbox") {
            return;
        }
        const row = t.closest(".zt-bp-row") as HTMLElement;
        if (!row) {
            return;
        }
        if (t.checked) {
            picked.add(row.dataset.id!);
        } else {
            picked.delete(row.dataset.id!);
        }
        paintCount();
    });

    relListEl.addEventListener("click", (e) => {
        const row = (e.target as HTMLElement).closest("[data-rel]") as HTMLElement | null;
        if (!row) {
            return;
        }
        const c = cards.find((x) => x.id === row.dataset.rel);
        relCard = relCard?.id === c?.id ? null : c || null;
        paintRel();
        paintCount();
    });

    dialog.element.querySelector(".zt-bp-cancel")!.addEventListener("click", () => dialog.destroy());
    okBtn.addEventListener("click", async () => {
        const ids = Array.from(picked);
        if (ids.length === 0) {
            return;
        }
        okBtn.disabled = true;
        errEl.textContent = "";
        let made = 0;
        let failed = 0;
        for (const b of blocks.filter((x) => picked.has(x.id))) {
            try {
                await createCardDoc(plugin, {
                    title: titleFromText(b.content),
                    quote: b.content,
                    quoteMeta: `《${doc.title}》${doc.nbName ? ` · ${doc.nbName}` : ""}`,
                    sourceBlockId: b.id,
                    book: doc.nbName || undefined,
                    relatedCardIds: relCard ? [relCard.id] : undefined,
                });
                made++;
            } catch (e: any) {
                failed++;
                console.error("块成卡失败", e);
            }
        }
        notifyCardsChanged();
        dialog.destroy();
        if (failed > 0) {
            showMessage(`${made} 张成卡成功，${failed} 张失败——失败的块还在，可以重试`, 6000, "error");
        } else {
            showMessage(`已生成 ${made} 张文献卡，都锚定回了原文`, 3500);
        }
    });
}
