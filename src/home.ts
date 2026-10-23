/**
 * 卡片盒 · 工作台
 *
 * 这是插件的主界面。层级很明确：
 *   卡片（主）  ←  素材（微信读书的划线想法 + 思源自己的文档）
 * 素材只是原料，卡片才是产出。Dock 和对话框共用这一套渲染。
 */
import { Dialog, showMessage, confirm } from "siyuan";
import { NotebookBook, WereadClient } from "./weread";
import { SyncConfig, tsToDate } from "./sync";
import { coverEl, ensureStyles, statusBadge } from "./ui";
import { openSearch } from "./search";
import { polishBooks } from "./link";
import { listNotebooks, listDocsByPath, openDocTab, getBlockAttrs, setBlockAttrs, getDocContent } from "./siyuanApi";
import { listNoteDocs, usedSources } from "./importNote";
import { openBookNotes } from "./bookNotes";
import { openBlockPicker } from "./blockPicker";
import { openMapPicker, openMapOverview } from "./mapCard";
import {
    CARD_MAP_ATTR,
    CardDoc,
    Thought,
    afterCardCreated,
    cardEvents,
    createCardFromThought,
    esc,
    listCards,
    listThoughts,
    newCardDialog,
    deleteCard,
    openGraphDialog,
    openLinkDialog,
} from "./cards";

const STYLE_ID = "zt-wb-style";

const CSS = `
.zt-wb { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 13px; }
.zt-host { height: 72vh; display: flex; flex-direction: column; min-height: 0; }
.zt-tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--b3-border-color); flex-shrink: 0; }
.zt-tab {
  padding: 5px 12px; cursor: pointer; border-radius: 6px 6px 0 0; user-select: none;
  color: var(--b3-theme-secondary); font-size: 12.5px; border: 1px solid transparent; border-bottom: none;
}
.zt-tab:hover { background: var(--b3-list-hover); }
.zt-tab.on { color: var(--b3-theme-primary); background: var(--b3-theme-background); border-color: var(--b3-border-color); font-weight: 600; }
.zt-actions { display: flex; gap: 6px; padding: 8px; align-items: center; flex-shrink: 0; }
.zt-actions .b3-button { font-size: 12px; padding: 4px 10px; }
.zt-actions .zt-new { background: var(--b3-theme-primary); color: #fff; border-color: transparent; font-weight: 600; }
.zt-actions .zt-new:hover { opacity: .9; }
.zt-actions .b3-text-field { flex: 0 1 170px; min-width: 100px; font-size: 12px; padding: 4px 8px; }
.zt-actions .b3-select { font-size: 12px; max-width: 190px; }
.zt-flex { flex: 1; }
.zt-chips { display: flex; gap: 4px; padding: 0 8px 8px; flex-wrap: wrap; flex-shrink: 0; align-items: center; }
.zt-chip {
  font-size: 11px; padding: 2px 9px; border-radius: 10px; cursor: pointer; user-select: none;
  color: var(--b3-theme-secondary); border: 1px solid var(--b3-border-color); background: transparent;
}
.zt-chip:hover { background: var(--b3-list-hover); }
.zt-chip.on { color: var(--b3-theme-primary); border-color: var(--b3-theme-primary); font-weight: 600; }
.zt-chip.src { color: var(--b3-theme-on-background); }
.zt-chip.src.on { background: var(--b3-theme-primary); color: #fff; border-color: var(--b3-theme-primary); }
.zt-list { flex: 1; overflow-y: auto; padding: 0 8px 10px; min-height: 0; }
.zt-row {
  display: flex; gap: 8px; padding: 8px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; border-left: 3px solid transparent; margin-bottom: 2px;
  align-items: center;
}
.zt-row:hover { background: var(--b3-list-hover); }
.zt-row.is-orphan { border-left-color: var(--b3-card-warning-color, #d97706); }
.zt-main { flex: 1; min-width: 0; }
.zt-title { font-size: 13px; color: var(--b3-theme-on-background); line-height: 1.45; word-break: break-word; }
.zt-meta { font-size: 11px; color: var(--b3-theme-secondary); margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.zt-badge { font-size: 10px; padding: 0 6px; border-radius: 8px; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); }
.zt-badge.warn { color: var(--b3-card-warning-color, #d97706); border-color: transparent; background: var(--b3-card-warning-background, rgba(217,119,6,.12)); }
.zt-badge.ok { color: var(--b3-card-success-color, #2ec27e); border-color: transparent; background: var(--b3-card-success-background, rgba(46,194,126,.12)); }
.zt-ops { display: flex; gap: 4px; flex-shrink: 0; opacity: 0; transition: opacity .12s; }
.zt-row:hover .zt-ops { opacity: 1; }
.zt-ops .b3-button { font-size: 11px; padding: 1px 7px; }
.zt-body { font-size: 12.5px; line-height: 1.65; color: var(--b3-theme-on-background); word-break: break-word; }
.zt-empty { text-align: center; color: var(--b3-theme-tertiary); padding: 40px 16px; font-size: 12.5px; line-height: 2; }
.zt-empty b { color: var(--b3-theme-secondary); }
.zt-search { margin: 0 0 6px; }
.zt-search .b3-text-field { width: 100%; font-size: 12px; padding: 4px 8px; box-sizing: border-box; }
.zt-inbox-tip {
  font-size: 11.5px; color: var(--b3-theme-secondary); line-height: 1.6;
  padding: 8px 10px; margin-bottom: 4px; border-radius: 6px;
  background: var(--b3-theme-surface); border: 1px dashed var(--b3-border-color);
}
.zt-inbox-tip b { color: var(--b3-theme-primary); }
.zt-dir {
  font-size: 11px; color: var(--b3-theme-secondary); padding: 10px 2px 4px;
  display: flex; align-items: center; gap: 5px; user-select: none;
}
.zt-dir:first-child { padding-top: 2px; }
.zt-dir::after { content: ""; flex: 1; height: 1px; background: var(--b3-border-color); opacity: .6; }
.zt-book { display: flex; gap: 8px; padding: 6px; border-radius: 6px; cursor: pointer; align-items: center; }
.zt-book:hover { background: var(--b3-list-hover); }
.zt-book-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.zt-book-title { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zt-book-sub { font-size: 11px; color: var(--b3-theme-secondary); display: flex; align-items: center; gap: 4px; }
.zt-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.zt-progress { height: 3px; width: 40px; border-radius: 2px; background: var(--b3-border-color); overflow: hidden; flex-shrink: 0; }
.zt-progress > div { height: 100%; background: var(--b3-theme-primary); }
.zt-note-excerpt { font-size: 11.5px; color: var(--b3-theme-secondary); line-height: 1.5; margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.zt-tree { display: flex; flex-direction: column; }
.zt-tnode {
  display: flex; gap: 6px; align-items: center; padding: 5px 8px; border-radius: 6px;
  cursor: pointer; font-size: 12.5px; user-select: none; min-width: 0;
}
.zt-tnode:hover { background: var(--b3-list-hover); }
.zt-tnode.dir { font-weight: 500; color: var(--b3-theme-on-background); }
.zt-tnode.dir[data-path="/"] { font-weight: 600; }
.zt-tnode.doc { padding-left: 24px; }
.zt-tarrow { width: 12px; flex-shrink: 0; color: var(--b3-theme-secondary); font-size: 10px; text-align: center; }
.zt-tnode.doc .zt-tarrow { width: 0; }
.zt-tname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zt-tkids { }
.zt-tnode .zt-tkids .zt-tnode.doc { padding-left: 40px; }
.zt-tkids .zt-tkids { margin-left: 16px; }
.zt-tleaf-empty { font-size: 11px; color: var(--b3-theme-tertiary); padding: 3px 8px 3px 40px; }
.zt-tnode .zt-badge { flex-shrink: 0; }
.zt-tnode .zt-ops { margin-left: 4px; }
/* 删除按钮：红色醒目，悬停加深 */
.zt-del { color: var(--b3-theme-error); border-color: color-mix(in srgb, var(--b3-theme-error) 45%, transparent); }
.zt-del:hover { background: color-mix(in srgb, var(--b3-theme-error) 12%, transparent); border-color: var(--b3-theme-error); }
.zt-docview { display: flex; flex-direction: column; gap: 8px; }
.zt-docview-bar { display: flex; gap: 8px; align-items: center; padding: 2px 2px 0; }
.zt-docview-bar .b3-button { padding: 2px 8px; font-size: 12px; flex-shrink: 0; }
.zt-docview-title { font-weight: 600; font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zt-docview-body {
  overflow-y: auto; max-height: 66vh; padding: 12px 16px; font-size: 13px; line-height: 1.75;
  border: 1px solid var(--b3-border-color); border-radius: 8px; background: var(--b3-theme-background);
}
/* 阅读排版：摘抄引用块、分隔线、段落节奏 */
.zt-docview-body p { margin: 6px 0; }
.zt-docview-body blockquote {
  margin: 8px 0; padding: 8px 12px; border-left: 3px solid var(--b3-theme-primary);
  background: var(--b3-theme-surface); border-radius: 0 6px 6px 0; color: var(--b3-theme-on-surface);
}
.zt-docview-body blockquote p { margin: 4px 0; }
.zt-docview-body blockquote p:last-child { color: var(--b3-theme-secondary); font-size: 12px; }
.zt-docview-body hr { border: none; border-top: 1px dashed var(--b3-border-color); margin: 14px 0; }
.zt-docview-body h1, .zt-docview-body h2, .zt-docview-body h3 { margin: 12px 0 6px; line-height: 1.4; }
.zt-docview-body img { max-width: 100%; border-radius: 6px; }
.zt-docview-body code { font-size: 12px; padding: 1px 5px; border-radius: 4px; }
.zt-docview-body pre { padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.zt-docview-body table { border-collapse: collapse; margin: 8px 0; }
.zt-docview-body table td, .zt-docview-body table th { border: 1px solid var(--b3-border-color); padding: 4px 10px; }
.zt-docview-body blockquote { border-left: 3px solid var(--b3-border-color); margin: 6px 0; padding: 2px 10px; color: var(--b3-theme-secondary); }
.zt-docview-body table { border-collapse: collapse; }
.zt-docview-body th, .zt-docview-body td { border: 1px solid var(--b3-border-color); padding: 3px 8px; }
.zt-docview-body code { background: var(--b3-theme-surface); padding: 1px 4px; border-radius: 4px; }
.zt-new { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; }
.zt-field { display: flex; flex-direction: column; gap: 5px; }
.zt-label { font-size: 12px; font-weight: 600; color: var(--b3-theme-primary); }
.zt-hint { font-size: 11px; color: var(--b3-theme-secondary); line-height: 1.5; }
.zt-new .b3-text-field { width: 100%; box-sizing: border-box; }
.zt-new-title { font-size: 14px; padding: 7px 10px; }
.zt-new-foot { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.zt-new-err { flex: 1; font-size: 12px; color: var(--b3-theme-error); }
.zt-link { display: flex; flex-direction: column; gap: 10px; }
.zt-link-tip { font-size: 12px; color: var(--b3-theme-secondary); line-height: 1.7; }
.zt-link-list { max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.zt-link-row { display: flex; gap: 9px; align-items: center; padding: 7px 9px; border-radius: 6px; cursor: pointer; border: 1px solid var(--b3-border-color); }
.zt-link-row:hover { background: var(--b3-list-hover); }
.zt-link-title { flex: 1; font-size: 12.5px; min-width: 0; }
.zt-link-why { font-size: 11px; color: var(--b3-theme-secondary); white-space: nowrap; }
.zt-link-foot { display: flex; gap: 8px; justify-content: flex-end; }
`;

function ensureWorkbenchStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
}

type CardFilter = "all" | "文献" | "想法" | "地图" | "orphan";
type SortKey = "recent" | "notes" | "title";
type SourceKind = "weread" | "notes";
type WereadView = "shelf" | "inbox";

const FILTER_LABEL: Record<CardFilter, string> = {
    all: "全部",
    文献: "文献",
    想法: "想法",
    地图: "地图",
    orphan: "孤岛",
};

export interface WorkbenchPreset {
    tab?: "cards" | "sources";
    source?: SourceKind;
}

export function renderWorkbench(container: HTMLElement, plugin: any, preset: WorkbenchPreset = {}): void {
    ensureStyles();
    ensureWorkbenchStyles();

    const cfg: SyncConfig = plugin.config || ({} as SyncConfig);

    container.innerHTML = `<div class="zt-wb">
  <div class="zt-tabs">
    <div class="zt-tab on" data-tab="cards">卡片</div>
    <div class="zt-tab" data-tab="sources">素材</div>
  </div>
  <div class="zt-actions"></div>
  <div class="zt-chips"></div>
  <div class="zt-list"></div>
</div>`;

    const root = container.querySelector(".zt-wb") as HTMLElement;
    const listEl = root.querySelector(".zt-list") as HTMLElement;
    const chipsEl = root.querySelector(".zt-chips") as HTMLElement;
    const actionsEl = root.querySelector(".zt-actions") as HTMLElement;
    const tabs = Array.from(root.querySelectorAll<HTMLElement>(".zt-tab"));

    let tab: "cards" | "sources" = preset.tab === "sources" ? "sources" : "cards";
    let srcKind: SourceKind = preset.source === "notes" ? "notes" : "weread";
    let wrView: WereadView = "shelf";
    let filter: CardFilter = "all";
    let cardKw = "";
    let cards: CardDoc[] = [];
    let books: NotebookBook[] = [];
    let state: Record<string, { docId: string; lastSync: number }> = {};
    let sortKey: SortKey = "recent";
    let shelfLoaded = false;
    /** 书架重绘入口：数据到了不必重建整页，保住搜索框里的字 */
    let shelfPaint: (() => void) | null = null;
    /** 卡片阅读视图：激活时列表区改为面板内渲染卡片全文 */
    let cardView: { id: string; title: string; cardType: string } | null = null;

    /* ================= 卡片 ================= */

    /** 卡片阅读视图：面板内直接渲染卡片全文（不跳思源页签），与文档阅读视图同款交互 */
    const renderCardView = () => {
        if (!cardView) {
            return;
        }
        const v = cardView;
        listEl.innerHTML = `<div class="zt-docview">
  <div class="zt-docview-bar">
    <button class="b3-button b3-button--outline zt-cardview-back">← 返回列表</button>
    <span class="zt-badge">${esc(v.cardType || "卡片")}</span>
    <span class="zt-docview-title">${esc(v.title || "未命名卡片")}</span>
    <span class="zt-flex"></span>
    <button class="b3-button b3-button--outline zt-cardview-graph" title="查看这张卡的上下游链路">🔗 链路</button>
    <button class="b3-button b3-button--outline zt-cardview-open" title="去思源主界面编辑这张卡">在思源中打开</button>
  </div>
  <div class="zt-docview-body b3-typography protyle-wysiwyg"><div class="zt-empty" style="padding:20px;">渲染中…</div></div>
</div>`;
        const body = listEl.querySelector(".zt-docview-body") as HTMLElement;
        void (async () => {
            try {
                const html = await getDocContent(v.id);
                body.innerHTML = html || `<div class="zt-empty" style="padding:20px;">空卡片。</div>`;
            } catch (e: any) {
                body.innerHTML = `<div class="zt-empty" style="padding:20px;color:var(--b3-theme-error);">渲染失败：${esc(String(e?.message || e))}<br>可以点「在思源中打开」查看原文。</div>`;
            }
        })();
        listEl.querySelector(".zt-cardview-back")!.addEventListener("click", () => {
            cardView = null;
            paintCards();
        });
        listEl.querySelector(".zt-cardview-graph")!.addEventListener("click", () => {
            void openGraphDialog(plugin, v.id);
        });
        listEl.querySelector(".zt-cardview-open")!.addEventListener("click", () => {
            void openDocTab(plugin.app, v.id).catch((err: any) =>
                showMessage(`打开卡片失败：${err?.message || err}`, 5000, "error"),
            );
        });
    };

    /** 只重绘列表与计数。搜索框打字时走这里，避免重建输入框丢焦点 */
    const paintCards = () => {
        if (cardView) {
            renderCardView();
            return;
        }
        const counts: Record<CardFilter, number> = {
            all: cards.length,
            文献: cards.filter((c) => c.cardType === "文献").length,
            想法: cards.filter((c) => c.cardType === "想法").length,
            地图: cards.filter((c) => c.cardType === "地图").length,
            orphan: cards.filter((c) => c.refs === 0).length,
        };
        for (const chip of Array.from(chipsEl.querySelectorAll<HTMLElement>(".zt-chip[data-filter]"))) {
            const f = chip.dataset.filter as CardFilter;
            chip.textContent = `${FILTER_LABEL[f]} ${counts[f]}`;
            chip.classList.toggle("on", f === filter);
        }

        const hit = (s: string) => (s || "").toLowerCase().includes(cardKw);

        let shown = cards;
        if (filter === "orphan") {
            shown = cards.filter((c) => c.refs === 0);
        } else if (filter !== "all") {
            shown = cards.filter((c) => c.cardType === filter);
        }
        if (cardKw) {
            shown = shown.filter((c) => hit(c.title) || hit(c.book));
        }

        if (shown.length === 0) {
            const noNotebook = !cfg.notebookId && !cfg.cardNotebook;
            if (cards.length === 0 && noNotebook) {
                listEl.innerHTML = `<div class="zt-empty">还没有卡片。<br>先选一个放卡片的笔记本：<br><br><button class="b3-button zt-setup">打开设置</button></div>`;
                const btn = listEl.querySelector(".zt-setup") as HTMLElement;
                btn?.addEventListener("click", () => (plugin as any).openSetting?.());
                return;
            }
            const msg =
                cards.length === 0
                    ? "还没有卡片。卡有四种起点，点「＋ 新建」选一种：<br>· <b>别人的话</b> → 📖 文献卡（也可以去「素材」点开书或文档，勾「写成卡」）<br>· <b>你自己的判断</b> → 💡 想法卡，顺便勾上它接在哪几张卡上<br>· <b>一个地方</b> → 🌏 地图卡，钉在世界地图上<br>· <b>几张卡片</b> → 📜 永久卡，按顺序合成一篇文章<br><br><b>第一张永远是最难的</b>，写下来就算开始。"
                    : cardKw
                      ? "没有匹配的卡片。"
                      : filter === "orphan"
                        ? "没有孤岛卡，每张都接上了网络。"
                        : `没有${FILTER_LABEL[filter]}卡。`;
            listEl.innerHTML = `<div class="zt-empty">${msg}</div>`;
            return;
        }

        listEl.innerHTML = shown
            .map((c) => {
                const refs = c.refs < 0 ? "引用数未知" : c.refs === 0 ? "孤岛" : `被引 ${c.refs} 次`;
                const typeTip: Record<string, string> = {
                    文献: "别人的话 + 出处",
                    想法: "你自己的判断",
                    地图: "绑定地理位置的卡",
                    永久: "多张卡合成的文章",
                };
                return `<div class="zt-row ${c.refs === 0 ? "is-orphan" : ""}" data-card="${c.id}" title="点击在面板内阅读卡片全文">
  <div class="zt-main">
    <div class="zt-title">${esc(c.title)}</div>
    <div class="zt-meta">
      <span class="zt-badge ${c.cardType === "地图" ? "ok" : ""}" title="${typeTip[c.cardType] || ""}">${esc(c.cardType || "卡")}</span>
      ${c.book ? `<span>《${esc(c.book)}》</span>` : ""}
      <span>${esc(c.created)}</span>
      <span>${refs}</span>
    </div>
  </div>
  <div class="zt-ops">
    <button class="b3-button b3-button--outline zt-graph" title="看它从哪里长出来、又长出了什么">链路</button>
    <button class="b3-button b3-button--outline zt-spawn" title="由这张卡长出一张新想法卡，自动连回来">✍</button>
    <button class="b3-button b3-button--outline zt-connect" title="找出可能相关的卡并连上">关联</button>
    ${c.cardType === "地图" ? `<button class="b3-button b3-button--outline zt-maploc" title="重新选择地图位置">🌏</button>` : ""}
    <button class="b3-button b3-button--outline zt-del" title="删除这张卡（不可恢复）">🗑 删除</button>
  </div>
</div>`;
            })
            .join("");
    };

    const renderCards = () => {
        actionsEl.innerHTML = `<input class="b3-text-field zt-card-search" type="text" placeholder="搜索卡片">
  <button class="b3-button zt-new" title="新建：📖 文献 / 💡 想法 / 🌏 地图 / 📜 永久（多卡成文）">＋ 新建</button>
  <button class="b3-button zt-map" title="所有地图卡钉在世界地图上">🌏 地图</button>
  <button class="b3-button zt-search-hl" title="跨书搜索划线与想法">🔍</button>
  <button class="b3-button zt-refresh" title="刷新">↻</button>
  <span class="zt-flex"></span>`;
        chipsEl.innerHTML = (["all", "文献", "想法", "地图", "orphan"] as CardFilter[])
            .map(
                (f) =>
                    `<span class="zt-chip" data-filter="${f}" title="${{
                        all: "卡片盒里的全部卡片",
                        ["文献" as CardFilter]: "别人的话 + 出处",
                        ["想法" as CardFilter]: "你自己的判断",
                        ["地图" as CardFilter]: "绑定地理位置的卡",
                        orphan: "没有任何引用的卡",
                    }[f]}">${FILTER_LABEL[f]}</span>`,
            )
            .join("");

        const searchEl = actionsEl.querySelector(".zt-card-search") as HTMLInputElement;
        searchEl.value = cardKw;
        searchEl.addEventListener("input", () => {
            cardKw = (searchEl.value || "").trim().toLowerCase();
            paintCards();
        });

        actionsEl.querySelector(".zt-new")!.addEventListener("click", () => newCardDialog(plugin));
        actionsEl.querySelector(".zt-map")!.addEventListener("click", () => void openMapOverview(plugin));
        actionsEl.querySelector(".zt-search-hl")!.addEventListener("click", () => openSearch(plugin));
        actionsEl.querySelector(".zt-refresh")!.addEventListener("click", () => void reloadCards());
        for (const chip of Array.from(chipsEl.querySelectorAll<HTMLElement>(".zt-chip"))) {
            chip.addEventListener("click", () => {
                filter = (chip.dataset.filter as CardFilter) || "all";
                paintCards();
            });
        }
        paintCards();
    };

    const reloadCards = async () => {
        listEl.innerHTML = `<div class="zt-empty">读取中…</div>`;
        try {
            cards = await listCards();
            if (tab === "cards") {
                paintCards();
            }
        } catch (e: any) {
            listEl.innerHTML = `<div class="zt-empty">读取失败：${esc(String(e?.message || e))}<br><br>若刚启动思源，等几秒再点 ↻</div>`;
        }
    };

    /* ================= 素材 · 公共 ================= */

    /** 素材源切换 chip：微信读书 / 思源文档 */
    const sourceToggleHTML = () =>
        `<span class="zt-chip src ${srcKind === "weread" ? "on" : ""}" data-src="weread">微信读书</span>` +
        `<span class="zt-chip src ${srcKind === "notes" ? "on" : ""}" data-src="notes">思源文档</span>`;

    const bindSourceToggle = (repaint: () => void) => {
        for (const chip of Array.from(chipsEl.querySelectorAll<HTMLElement>(".zt-chip.src"))) {
            chip.addEventListener("click", () => {
                const next = (chip.dataset.src as SourceKind) || "weread";
                if (next === srcKind) {
                    return;
                }
                srcKind = next;
                repaint();
            });
        }
    };

    /* ================= 素材 · 微信读书 ================= */

    /** 点书：不再把人踢去微信读书，就地展开这本书的划线与想法、勾选成卡 */
    const openBook = async (b: NotebookBook) => {
        const syncedDocId = ((await plugin.loadData("state.json").catch(() => ({}))) || {})[b.bookId]?.docId;
        if (!cfg.apiKey) {
            if (syncedDocId) {
                await openDocTab(plugin.app, syncedDocId);
            } else {
                showMessage("没有配置微信读书 API Key，无法读取这本书的笔记", 4000, "error");
            }
            return;
        }
        await openBookNotes(plugin, b, { apiKey: cfg.apiKey, syncedDocId });
    };

    /** 未成卡想法：微信读书里写了想法、还没变成卡片的清单（从卡片 tab 挪过来的，它本来就是素材） */
    const renderInbox = () => {
        actionsEl.innerHTML = `<input class="b3-text-field zt-inbox-search" type="text" placeholder="搜索想法内容 / 书名">
  <button class="b3-button zt-inbox-refresh" title="刷新">↻</button>
  <span class="zt-flex"></span>`;
        chipsEl.innerHTML =
            sourceToggleHTML() +
            `<span class="zt-chip on" data-wrview="inbox">未成卡想法</span>`;
        bindSourceToggle(renderSources);

        listEl.innerHTML = `<div class="zt-inbox-tip">下面是你在<b>微信读书</b>里写的想法，还没变成卡片。点「写成卡」，用自己的话把它的观点重写一遍，它才算你的。<br>划线原文请在「书架」里点开对应的书，勾选成卡。</div>`;
        const listHost = document.createElement("div");
        listEl.appendChild(listHost);
        const searchEl = actionsEl.querySelector(".zt-inbox-search") as HTMLInputElement;

        let inbox: Thought[] = [];
        const paint = () => {
            const done = new Set(cards.map((c) => c.source).filter(Boolean));
            const todo = inbox.filter((t) => !done.has(t.id));
            const kw = (searchEl.value || "").trim().toLowerCase();
            const shown = kw ? todo.filter((t) => (t.text || "").toLowerCase().includes(kw) || (t.book || "").toLowerCase().includes(kw)) : todo;
            listHost.innerHTML = shown.length
                ? shown
                      .map(
                          (t) => `<div class="zt-row" data-thought="${t.id}">
  <div class="zt-main">
    ${t.abstract ? `<div class="zt-body" style="color:var(--b3-theme-secondary);font-size:12px;">「${esc(t.abstract.slice(0, 120))}${t.abstract.length > 120 ? "…" : ""}」</div>` : ""}
    <div class="zt-body">✏️ ${esc(t.text.slice(0, 220))}</div>
    <div class="zt-meta"><span>《${esc(t.book || "未命名")}》</span><span>${esc(t.chapter || "")}</span><span>${esc(t.time || "")}</span></div>
  </div>
  <div class="zt-ops"><button class="b3-button b3-button--outline zt-make">写成卡</button></div>
</div>`,
                      )
                      .join("")
                : `<div class="zt-empty">${
                      inbox.length === 0
                          ? "还没有想法数据。<br>先点 ↻ 读取，或先在「⟳ 同步」里同步一次。"
                          : kw
                            ? "没有匹配的想法。"
                            : "所有想法都成卡了。<br>回「卡片」看看孤岛——连进网络才算数。"
                  }</div>`;
        };

        const reload = async () => {
            listHost.innerHTML = `<div class="zt-empty">读取中…</div>`;
            try {
                const [t, c] = await Promise.all([listThoughts(), listCards()]);
                inbox = t;
                cards = c;
                paint();
            } catch (e: any) {
                listHost.innerHTML = `<div class="zt-empty" style="color:var(--b3-theme-error);">读取失败：${esc(
                    e?.message || String(e),
                )}</div>`;
            }
        };

        searchEl.addEventListener("input", paint);
        actionsEl.querySelector(".zt-inbox-refresh")!.addEventListener("click", () => void reload());
        if (!inbox.length) {
            void reload();
        } else {
            paint();
        }
    };

    const renderShelf = () => {
        actionsEl.innerHTML = `<button class="b3-button zt-sync" title="同步全部微信读书笔记">⟳ 同步</button>
  <button class="b3-button zt-pick" title="选择书籍同步">☰ 选书</button>
  <button class="b3-button zt-polish" title="去重、清理空章节、锚定想法">🧹</button>
  <span class="zt-flex"></span>`;
        chipsEl.innerHTML =
            sourceToggleHTML() +
            `<span class="zt-chip on" data-wrview="shelf">书架</span>` +
            (["recent", "notes", "title"] as SortKey[])
                .map(
                    (k) =>
                        `<span class="zt-chip ${sortKey === k ? "on" : ""}" data-sort="${k}">${
                            { recent: "最近", notes: "笔记多", title: "书名" }[k]
                        }</span>`,
                )
                .join("");
        bindSourceToggle(renderSources);
        for (const chip of Array.from(chipsEl.querySelectorAll<HTMLElement>(".zt-chip[data-wrview]"))) {
            chip.addEventListener("click", () => {
                wrView = (chip.dataset.wrview as WereadView) || "shelf";
                renderSources();
            });
        }

        listEl.innerHTML = `<div class="zt-search"><input class="b3-text-field zt-shelf-search" type="text" placeholder="搜索书名 / 作者"></div>
<div class="zt-books"></div>`;
        const booksEl = listEl.querySelector(".zt-books") as HTMLElement;
        const searchEl = listEl.querySelector(".zt-shelf-search") as HTMLInputElement;

        const paint = () => {
            const kw = (searchEl.value || "").trim().toLowerCase();
            const totalNotes = (b: NotebookBook) => (b.noteCount || 0) + (b.reviewCount || 0);
            let shown = kw
                ? books.filter(
                      (b) =>
                          (b.book?.title || "").toLowerCase().includes(kw) ||
                          (b.book?.author || "").toLowerCase().includes(kw),
                  )
                : [...books];
            if (sortKey === "notes") {
                shown.sort((a, b) => totalNotes(b) - totalNotes(a));
            } else if (sortKey === "title") {
                shown.sort((a, b) => (a.book?.title || "").localeCompare(b.book?.title || "", "zh-Hans-CN"));
            }
            if (shown.length === 0) {
                booksEl.innerHTML = `<div class="zt-empty">${kw ? "无匹配书籍" : "还没有数据，点「⟳ 同步」"}</div>`;
                return;
            }
            booksEl.innerHTML = "";
            for (const b of shown) {
                const last = state[b.bookId]?.lastSync;
                const st = statusBadge(b.markedStatus);
                const progress = Math.round((b.readingProgress || 0) * 10) / 10;
                const row = document.createElement("div");
                row.className = "zt-book";
                row.title = `${b.book?.title || ""} · ${totalNotes(b)} 条笔记 · 点击查看本书笔记`;
                row.innerHTML = `<div class="zt-book-info">
      <div class="zt-book-title">${esc(b.book?.title || "")}</div>
      <div class="zt-book-sub">
        <span class="zt-dot" style="background:${
            st.cls === "wr-badge--done"
                ? "var(--b3-card-success-color,#2ec27e)"
                : st.cls === "wr-badge--reading"
                  ? "var(--b3-theme-primary)"
                  : "var(--b3-border-color)"
        };"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${esc(b.book?.author || "")} · ${totalNotes(b)} 条</span>
        ${last ? `<span>${tsToDate(last / 1000)}</span>` : ""}
      </div>
    </div>`;
                const info = row.querySelector(".zt-book-info")!;
                info.insertBefore(coverEl(b.book?.cover, "wr-dock-cover"), info.firstChild);
                if (b.markedStatus === 2 && progress > 0) {
                    const bar = document.createElement("div");
                    bar.className = "zt-progress";
                    bar.innerHTML = `<div style="width:${Math.min(progress, 100)}%"></div>`;
                    row.appendChild(bar);
                }
                row.addEventListener("click", () => void openBook(b));
                booksEl.appendChild(row);
            }
        };
        shelfPaint = paint;

        searchEl.addEventListener("input", paint);
        for (const chip of Array.from(chipsEl.querySelectorAll<HTMLElement>(".zt-chip[data-sort]"))) {
            chip.addEventListener("click", () => {
                sortKey = (chip.dataset.sort as SortKey) || "recent";
                Array.from(chipsEl.querySelectorAll<HTMLElement>(".zt-chip[data-sort]")).forEach((c) =>
                    c.classList.toggle("on", c === chip),
                );
                paint();
            });
        }

        actionsEl.querySelector(".zt-sync")!.addEventListener("click", () => {
            (plugin as any).syncAll?.();
            setTimeout(() => void loadShelf(true), 3000);
        });
        actionsEl.querySelector(".zt-pick")!.addEventListener("click", () => (plugin as any).openPicker?.());
        actionsEl.querySelector(".zt-polish")!.addEventListener("click", async () => {
            const ids = Object.values(state)
                .map((s) => s.docId)
                .filter(Boolean);
            if (ids.length === 0) {
                showMessage("还没有同步过任何书", 3000, "error");
                return;
            }
            const ok = window.confirm(
                `将对 ${ids.length} 本书执行整理：\n\n· 同一本书里完全重复的划线只留第一条\n· 删掉「只有标题、没有内容」的空章节\n· 把每条想法用块引用锚到它批注的原文\n\n只处理插件生成的块，不动你手写的内容。继续？`,
            );
            if (!ok) {
                return;
            }
            try {
                const r = await polishBooks(ids, () => {});
                showMessage(
                    `整理完成：去重 ${r.merged} 条，清理空章节 ${r.emptyChapters} 个，锚定想法 ${r.anchored} 条`,
                    7000,
                );
            } catch (e: any) {
                showMessage(`整理失败：${e?.message || e}`, 6000, "error");
            }
        });

        if (shelfLoaded) {
            paint();
            return;
        }
        booksEl.innerHTML = `<div class="zt-empty">${
            cfg.apiKey ? "加载书架…" : "还没有配置微信读书 API Key。<br><br><b>素材是可选的</b>——卡片功能不需要它。"
        }</div>`;
        if (cfg.apiKey) {
            void loadShelf(false);
        }
    };

    const loadShelf = async (refresh: boolean) => {
        if (!cfg.apiKey) {
            return;
        }
        if (refresh) {
            shelfLoaded = false;
        }
        try {
            const client = new WereadClient(cfg.apiKey);
            books = await client.listNotebooks();
            state = (await plugin.loadData("state.json")) || {};
            shelfLoaded = true;
            if (tab === "sources" && srcKind === "weread" && shelfPaint) {
                shelfPaint();
            }
        } catch (e: any) {
            if (tab === "sources" && srcKind === "weread") {
                listEl.innerHTML = `<div class="zt-empty" style="color:var(--b3-theme-error);">加载失败：${esc(
                    e?.message || String(e),
                )}</div>`;
            }
        }
    };

    /* ================= 素材 · 思源文档（文件树） ================= */

    /** 插件的目录（卡片、微信读书同步区）不进树。注意只滤目录、不滤整本笔记本——
     *  插件目录常长在用户自己的笔记本里（比如知识库），整本隐藏会误伤真实内容 */
    const excludedPrefixes = (): string[] => {
        const cfg2 = plugin?.config || {};
        const out: string[] = [];
        const cardRoot = (cfg2.cardPath || "卡片").replace(/^\/+|\/+$/g, "");
        const wereadRoot = (cfg2.rootPath || "微信读书").replace(/^\/+|\/+$/g, "");
        if (cardRoot) {
            out.push(`/${cardRoot}`);
        }
        if (wereadRoot) {
            out.push(`/${wereadRoot}`);
        }
        return out;
    };

    const isExcludedPath = (hpath: string): boolean =>
        excludedPrefixes().some((p) => hpath === p || hpath.startsWith(`${p}/`));

    /** 树结构：笔记本是根，目录逐层懒加载（listDocsByPath，快且天然带层级） */
    let treeNotebooks: { id: string; name: string }[] = [];
    const treeExpanded = new Set<string>();
    const treeCache = new Map<string, { id: string; name: string; isDir: boolean; hPath: string }[]>();
    let treeUsed: Set<string> | null = null;

    const treeKey = (nb: string, path: string) => `${nb}\u0001${path}`;

    const docNodeHTML = (n: { id: string; name: string; nb: string; nbName: string; carded: boolean }): string =>
        `<div class="zt-tnode doc" data-kind="doc" data-id="${n.id}" data-nb="${n.nb}" data-title="${esc(n.name)}" data-nbname="${esc(n.nbName)}"
   title="点击在面板中阅读全文；「✍ 整理成卡」批量勾选块生成文献卡">
  <span class="zt-tname">${esc(n.name)}</span>
  ${n.carded ? `<span class="zt-badge ok">已成卡</span>` : ""}
  <span class="zt-ops"><button class="b3-button b3-button--outline zt-note-make">✍ 整理成卡</button></span>
</div>`;

    const dirNodeHTML = (n: { id: string; nb: string; path: string; name: string; arrow: string }): string =>
        `<div class="zt-tnode dir" data-kind="dir" data-nb="${n.nb}" data-path="${esc(n.path)}" title="${esc(n.path)}">
  <span class="zt-tarrow">${n.arrow}</span><span class="zt-tname">${esc(n.name)}</span>
</div>`;

    const renderNotes = () => {
        actionsEl.innerHTML = `<input class="b3-text-field zt-note-search" type="text" placeholder="跨笔记本搜索文档标题">
  <button class="b3-button zt-nb-refresh" title="重建文件树">↻</button>
  <span class="zt-flex"></span>`;
        chipsEl.innerHTML = sourceToggleHTML() + `<span class="zt-chip on" title="按笔记本 → 目录浏览你的文档">文件树</span>`;
        bindSourceToggle(renderSources);

        listEl.innerHTML = `<div class="zt-tree"><div class="zt-empty">读取笔记本…</div></div>`;
        const treeEl = listEl.querySelector(".zt-tree") as HTMLElement;
        const searchEl = actionsEl.querySelector(".zt-note-search") as HTMLInputElement;

        const ensureUsed = async () => {
            if (!treeUsed) {
                treeUsed = await usedSources().catch(() => new Set<string>());
            }
            return treeUsed;
        };

        /** 整树绘制：递归画出所有已展开的层级（深目录也在这棵里）。
         *  docView 激活时这片区域显示文档阅读视图。 */
        let docView: { id: string; title: string; nbName: string } | null = null;
        const paintFullTree = () => {
            if (docView) {
                renderDocView();
                return;
            }
            if (treeNotebooks.length === 0) {
                treeEl.innerHTML = `<div class="zt-empty">没有打开的笔记本。</div>`;
                return;
            }
            const used = treeUsed || new Set<string>();
            const paintKids = (nbId: string, path: string): string => {
                const key = treeKey(nbId, path);
                if (!treeExpanded.has(key)) {
                    return "";
                }
                const kids = (treeCache.get(key) || []).filter((c) => !isExcludedPath(c.hPath));
                const inner =
                    kids
                        .map((c) => {
                            if (c.isDir) {
                                return (
                                    dirNodeHTML({ id: c.id, nb: nbId, path: c.hPath, name: c.name, arrow: treeExpanded.has(treeKey(nbId, c.hPath)) ? "▾" : "▸" }) +
                                    paintKids(nbId, c.hPath)
                                );
                            }
                            return docNodeHTML({
                                id: c.id,
                                name: c.name,
                                nb: nbId,
                                nbName: treeNotebooks.find((n) => n.id === nbId)?.name || "",
                                carded: used.has(c.id),
                            });
                        })
                        .join("") || `<div class="zt-tleaf-empty">（空）</div>`;
                return `<div class="zt-tkids">${inner}</div>`;
            };
            treeEl.innerHTML = treeNotebooks
                .map((nb) => {
                    const open = treeExpanded.has(treeKey(nb.id, "/"));
                    return (
                        dirNodeHTML({ id: nb.id, nb: nb.id, path: "/", name: nb.name, arrow: open ? "▾" : "▸" }) +
                        paintKids(nb.id, "/")
                    );
                })
                .join("");
        };

        /** 文档阅读视图：面板内直接渲染全文（不跳思源页签），顺手整理 */
        const renderDocView = () => {
            if (!docView) {
                return;
            }
            treeEl.innerHTML = `<div class="zt-docview">
  <div class="zt-docview-bar">
    <button class="b3-button b3-button--outline zt-docview-back">← 文件树</button>
    <span class="zt-docview-title">${esc(docView.title)}</span>
    <span class="zt-flex"></span>
    <button class="b3-button b3-button--outline zt-docview-make">✍ 整理成卡</button>
    <button class="b3-button b3-button--outline zt-docview-open" title="去思源主界面编辑这篇文档">在思源中打开</button>
  </div>
  <div class="zt-docview-body b3-typography protyle-wysiwyg"><div class="zt-empty" style="padding:20px;">渲染中…</div></div>
</div>`;
            const body = treeEl.querySelector(".zt-docview-body") as HTMLElement;
            void (async () => {
                try {
                    const html = await getDocContent(docView!.id);
                    body.innerHTML = html || `<div class="zt-empty" style="padding:20px;">空文档。</div>`;
                } catch (e: any) {
                    body.innerHTML = `<div class="zt-empty" style="padding:20px;color:var(--b3-theme-error);">渲染失败：${esc(String(e?.message || e))}<br>可以点「在思源中打开」查看原文。</div>`;
                }
            })();
            treeEl.querySelector(".zt-docview-back")!.addEventListener("click", () => {
                docView = null;
                paintFullTree();
            });
            treeEl.querySelector(".zt-docview-make")!.addEventListener("click", () => {
                if (docView) {
                    openBlockPicker(plugin, docView);
                }
            });
            treeEl.querySelector(".zt-docview-open")!.addEventListener("click", () => {
                if (docView) {
                    void openDocTab(plugin.app, docView.id).catch((err: any) =>
                        showMessage(`打开文档失败：${err?.message || err}`, 5000, "error"),
                    );
                }
            });
        };

        const toggleDir = async (nb: string, path: string) => {
            const key = treeKey(nb, path);
            if (treeExpanded.has(key)) {
                treeExpanded.delete(key);
                paintFullTree();
                return;
            }
            if (!treeCache.has(key)) {
                treeExpanded.add(key);
                paintFullTree();
                try {
                    const files = await listDocsByPath(nb, path);
                    treeCache.set(
                        key,
                        files.sort((a, b) =>
                            a.isDir === b.isDir ? a.name.localeCompare(b.name, "zh-Hans-CN") : a.isDir ? -1 : 1,
                        ),
                    );
                } catch (e: any) {
                    showMessage(`读取目录失败：${e?.message || e}`, 5000, "error");
                    treeCache.set(key, []);
                }
            } else {
                treeExpanded.add(key);
            }
            await ensureUsed();
            paintFullTree();
        };

        treeEl.addEventListener("click", async (e) => {
            const t = e.target as HTMLElement;
            const node = t.closest(".zt-tnode") as HTMLElement | null;
            if (!node) {
                return;
            }
            const kind = node.dataset.kind;
            if (kind === "dir") {
                e.stopPropagation();
                await toggleDir(node.dataset.nb!, node.dataset.path!);
                return;
            }
            if (kind === "doc") {
                const id = node.dataset.id!;
                if (t.classList.contains("zt-note-make")) {
                    // 整理工作台：勾选文档里的块，批量生成文献卡
                    openBlockPicker(plugin, {
                        id,
                        title: node.dataset.title || "",
                        nbName: node.dataset.nbname || treeNotebooks.find((n) => n.id === node.dataset.nb)?.name || "",
                    });
                    return;
                }
                // 点击文档名：面板内直接渲染全文阅读，不跳思源页签
                docView = {
                    id,
                    title: node.dataset.title || "",
                    nbName: node.dataset.nbname || treeNotebooks.find((n) => n.id === node.dataset.nb)?.name || "",
                };
                paintFullTree();
            }
        });

        actionsEl.querySelector(".zt-nb-refresh")!.addEventListener("click", async () => {
            treeCache.clear();
            treeExpanded.clear();
            treeUsed = null;
            try {
                const nbs = await listNotebooks();
                treeNotebooks = nbs.map((n) => ({ id: n.id, name: n.name }));
                paintFullTree();
            } catch (e: any) {
                treeEl.innerHTML = `<div class="zt-empty" style="color:var(--b3-theme-error);">读取笔记本失败：${esc(
                    e?.message || String(e),
                )}</div>`;
            }
        });

        // 搜索：跨全部打开的笔记本（box 条件修正过的 SQL）
        let searchSeq = 0;
        const runSearch = async () => {
            const kw = (searchEl.value || "").trim();
            if (!kw) {
                paintFullTree();
                return;
            }
            const seq = ++searchSeq;
            treeEl.innerHTML = `<div class="zt-empty">搜索中…</div>`;
            try {
                const docs = await listNoteDocs({
                    notebooks: treeNotebooks.map((n) => n.id),
                    excludePrefixes: excludedPrefixes(),
                    kw,
                    limit: 100,
                });
                if (seq !== searchSeq) {
                    return;
                }
                const used = await ensureUsed();
                if (seq !== searchSeq) {
                    return;
                }
                treeEl.innerHTML =
                    docs.length === 0
                        ? `<div class="zt-empty">没有匹配的文档。</div>`
                        : docs
                              .map((d) =>
                                  docNodeHTML({
                                      id: d.id,
                                      name: d.title,
                                      nb: "",
                                      nbName: "",
                                      carded: used.has(d.id),
                                  }),
                              )
                              .join("");
            } catch (e: any) {
                if (seq === searchSeq) {
                    treeEl.innerHTML = `<div class="zt-empty" style="color:var(--b3-theme-error);">搜索失败：${esc(
                        e?.message || String(e),
                    )}</div>`;
                }
            }
        };
        searchEl.addEventListener("input", () => void runSearch());

        // 初始化
        void (async () => {
            try {
                const nbs = await listNotebooks();
                treeNotebooks = nbs.map((n) => ({ id: n.id, name: n.name }));
                // 默认展开第一个笔记本，给用户一个「有东西」的第一印象
                if (treeNotebooks.length > 0) {
                    void toggleDir(treeNotebooks[0].id, "/");
                } else {
                    paintFullTree();
                }
            } catch (e: any) {
                treeEl.innerHTML = `<div class="zt-empty" style="color:var(--b3-theme-error);">读取笔记本失败：${esc(
                    e?.message || String(e),
                )}</div>`;
            }
        })();
    };

    /* ================= 素材 · 分发 ================= */

    const renderSources = () => {
        if (srcKind === "notes") {
            renderNotes();
        } else if (wrView === "inbox") {
            renderInbox();
        } else {
            renderShelf();
        }
    };

    /* ================= 事件 ================= */

    listEl.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;
        const row = target.closest(".zt-row") as HTMLElement | null;
        if (!row) {
            return;
        }

        if (target.classList.contains("zt-make")) {
            const done = new Set(cards.map((c) => c.source).filter(Boolean));
            const all = await listThoughts().catch(() => [] as Thought[]);
            const t = all.filter((x) => !done.has(x.id)).find((x) => x.id === row.dataset.thought);
            if (!t) {
                return;
            }
            target.setAttribute("disabled", "true");
            target.textContent = "…";
            try {
                const made = await createCardFromThought(plugin, t);
                showMessage("卡片已建好，写你的判断吧", 3000);
                void reloadCards();
                await afterCardCreated(plugin, made.docId);
                // 成卡后从未成卡清单里消失
                row.remove();
            } catch (err: any) {
                showMessage(`生成失败：${err?.message || err}`, 6000, "error");
                target.removeAttribute("disabled");
                target.textContent = "写成卡";
            }
            return;
        }

        if (target.classList.contains("zt-note-make")) {
            // 文件树节点的「写成卡」在 .zt-tnode 上有自己的监听，不会走到这里
            return;
        }

        const cardId = row.dataset.card;
        if (!cardId) {
            return;
        }
        const card = cards.find((c) => c.id === cardId);

        if (target.classList.contains("zt-graph")) {
            e.stopPropagation();
            if (card) {
                void openGraphDialog(plugin, card.id);
            }
            return;
        }
        if (target.classList.contains("zt-connect")) {
            e.stopPropagation();
            if (card) {
                openLinkDialog(plugin, card, cards);
            }
            return;
        }
        if (target.classList.contains("zt-spawn")) {
            e.stopPropagation();
            if (card) {
                newCardDialog(plugin, { cardType: "想法", relatedCardIds: [card.id] });
            }
            return;
        }
        if (target.classList.contains("zt-maploc")) {
            e.stopPropagation();
            if (card) {
                void (async () => {
                    try {
                        const attrs = await getBlockAttrs(card.id);
                        let current: any;
                        try {
                            current = attrs[CARD_MAP_ATTR] ? JSON.parse(attrs[CARD_MAP_ATTR]) : undefined;
                        } catch {
                            current = undefined;
                        }
                        openMapPicker(current, async (m) => {
                            await setBlockAttrs(card.id, { [CARD_MAP_ATTR]: JSON.stringify(m) });
                            showMessage("地图位置已更新", 2500);
                            void reloadCards();
                        });
                    } catch (err: any) {
                        showMessage(`读取失败：${err?.message || err}`, 5000, "error");
                    }
                })();
            }
            return;
        }
        if (target.classList.contains("zt-del")) {
            e.stopPropagation();
            if (card) {
                confirm(
                    "删除卡片",
                    `确定删除「${esc((card.title || "").slice(0, 30))}」？<br><br>删除<b>不可恢复</b>；引用它的卡片、合成它的永久卡会出现死链。`,
                    () => {
                        void (async () => {
                            try {
                                await deleteCard(card.id);
                                showMessage("卡片已删除", 2500);
                                // 立即从本地缓存移除并重绘——SQL 索引要 2-3 秒才同步删除，直接 reload 会看到"阴魂不散"
                                cards = cards.filter((c) => c.id !== card.id);
                                if (cardView?.id === card.id) {
                                    cardView = null;
                                }
                                paintCards();
                                // 延迟对账一次，等索引追上来后取真实列表
                                setTimeout(() => {
                                    void reloadCards();
                                }, 3000);
                            } catch (err: any) {
                                showMessage(`删除失败：${err?.message || err}`, 5000, "error");
                            }
                        })();
                    },
                );
            }
            return;
        }
        // 点击卡片：面板内渲染全文阅读；要编辑时再用「在思源中打开」
        cardView = {
            id: cardId,
            title: card?.title || "",
            cardType: card?.cardType || "",
        };
        paintCards();
    });

    tabs.forEach((t) => {
        t.addEventListener("click", () => {
            const next = (t.dataset.tab as "cards" | "sources") || "cards";
            if (next === tab) {
                return;
            }
            tab = next;
            tabs.forEach((x) => x.classList.toggle("on", x === t));
            if (tab === "cards") {
                renderCards();
                void reloadCards();
            } else {
                cardView = null;
                renderSources();
            }
        });
    });

    const onChange = () => {
        // 面板已关闭就不要再查库：对话框每次打开都会挂一个监听
        if (!container.isConnected) {
            return;
        }
        if (tab === "cards") {
            void reloadCards();
        }
    };
    cardEvents.addEventListener("changed", onChange);

    if (tab === "cards") {
        renderCards();
        void reloadCards();
    } else {
        tabs.forEach((x) => x.classList.toggle("on", x.dataset.tab === "sources"));
        renderSources();
    }
}

/** 卡片盒对话框（主入口） */
export function openWorkbench(plugin: any, preset: WorkbenchPreset = {}): void {
    ensureStyles();
    ensureWorkbenchStyles();
    const dialog = new Dialog({
        title: "卡片盒",
        content: `<div class="zt-host"></div>`,
        width: "820px",
        height: "auto",
    });
    const host = dialog.element.querySelector(".zt-host") as HTMLElement;
    renderWorkbench(host, plugin, preset);
}
