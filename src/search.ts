/**
 * 划线检索台
 *
 * 这是插件里最"日常"的工具：1626 条划线散在 200 本书里，写作时想找"我到底在哪本书里划过这句"，
 * 靠翻文档是不可能的。这里一次性把全部划线拉到内存，输入关键词即时过滤。
 *
 * 结果可：跳转到原文块 / 复制块引用（粘到任意笔记里就是双链）。
 */
import { Dialog, showMessage } from "siyuan";
import { ensureStyles } from "./ui";
import { openDocTab, sqlStrict } from "./siyuanApi";

interface Hit {
    id: string;
    rootId: string;
    type: string;
    text: string;
    book: string;
    chapter: string;
    time: string;
}

const STYLE_ID = "wr-search-style";
const CSS = `
.wr-search { display: flex; flex-direction: column; height: 100%; gap: 10px; }
.wr-search-bar { display: flex; gap: 8px; align-items: center; }
.wr-search-bar input.b3-text-field { flex: 1; }
.wr-search-filters { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px; }
.wr-search-filters .b3-chip { cursor: pointer; user-select: none; }
.wr-search-filters .b3-chip.on { background: var(--b3-theme-primary); color: #fff; border-color: transparent; }
.wr-search-count { font-size: 12px; color: var(--b3-theme-secondary); margin-left: auto; }
.wr-search-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
.wr-hit { border: 1px solid var(--b3-border-color); border-radius: 8px; padding: 10px 12px; background: var(--b3-theme-surface); }
.wr-hit:hover { border-color: var(--b3-theme-primary); }
.wr-hit-head { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--b3-theme-secondary); margin-bottom: 6px; }
.wr-hit-book { color: var(--b3-theme-primary); font-weight: 600; cursor: pointer; }
.wr-hit-book:hover { text-decoration: underline; }
.wr-hit-type { border: 1px solid var(--b3-border-color); border-radius: 4px; padding: 0 4px; font-size: 11px; }
.wr-hit-type.t-thought { color: var(--b3-card-info-color, #357de3); }
.wr-hit-type.t-popular { color: var(--b3-card-warning-color, #d97706); }
.wr-hit-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.wr-hit-body mark { background: var(--b3-theme-primary-lightest, rgba(53,125,227,.2)); color: inherit; padding: 0 1px; border-radius: 2px; }
.wr-hit-ops { display: flex; gap: 6px; margin-top: 8px; opacity: 0; transition: opacity .12s; }
.wr-hit:hover .wr-hit-ops { opacity: 1; }
.wr-hit-ops button { font-size: 11px; padding: 1px 8px; }
.wr-empty { text-align: center; color: var(--b3-theme-tertiary); padding: 40px 0; font-size: 13px; }
`;

function esc(s: string): string {
    return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function cleanMarkdown(md: string): string {
    return (md || "")
        .replace(/^>\s?/gm, "")
        .replace(/^\s*✏️\s*/gm, "")
        .replace(/^\s*🔥\s*/gm, "")
        .replace(/（\d+\s*人划线）/g, "")
        .replace(/\n{2,}/g, "\n")
        .trim();
}

function pick(ial: string, key: string): string {
    const m = new RegExp(`${key}="([^"]*)"`).exec(ial || "");
    return m ? m[1] : "";
}

/** 一次性把全部划线/想法/热门拉进内存 */
async function loadAll(): Promise<Hit[]> {
    const rows = await sqlStrict<{ id: string; root_id: string; markdown: string; ial: string }>(
        `SELECT id, root_id, markdown, ial FROM blocks ` +
            `WHERE ial LIKE '%custom-weread-type="highlight"%' ` +
            `OR ial LIKE '%custom-weread-type="thought"%' ` +
            `OR ial LIKE '%custom-weread-type="popular"%' LIMIT 100000`,
    );
    return rows
        .map((r) => ({
            id: r.id,
            rootId: r.root_id,
            type: pick(r.ial, "custom-weread-type"),
            text: cleanMarkdown(r.markdown),
            book: pick(r.ial, "custom-weread-book-title"),
            chapter: pick(r.ial, "custom-weread-chapter"),
            time: pick(r.ial, "custom-weread-time"),
        }))
        .filter((h) => h.text && h.text.length > 1);
}

export function openSearch(plugin: any): void {
    ensureStyles();
    if (!document.getElementById(STYLE_ID)) {
        const st = document.createElement("style");
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    const dialog = new Dialog({
        title: "划线检索",
        content: `<div class="wr-search">
  <div class="wr-search-bar">
    <input class="b3-text-field" placeholder="搜索你划过的句子、写过的想法…（支持多关键词，空格分隔）" />
  </div>
  <div class="wr-search-filters">
    <span class="b3-chip on" data-type="all">全部</span>
    <span class="b3-chip" data-type="highlight">划线</span>
    <span class="b3-chip" data-type="thought">想法</span>
    <span class="b3-chip" data-type="popular">热门</span>
    <span class="wr-search-count">加载中…</span>
  </div>
  <div class="wr-search-list"><div class="wr-empty">正在读取全部划线…</div></div>
</div>`,
        width: "860px",
        height: "76vh",
    });

    const root = dialog.element.querySelector(".wr-search") as HTMLElement;
    const input = root.querySelector("input") as HTMLInputElement;
    const listEl = root.querySelector(".wr-search-list") as HTMLElement;
    const countEl = root.querySelector(".wr-search-count") as HTMLElement;
    const chips = Array.from(root.querySelectorAll(".b3-chip")) as HTMLElement[];

    let all: Hit[] = [];
    let type = "all";
    let timer = 0;

    const render = () => {
        const kw = input.value.trim().toLowerCase();
        const words = kw ? kw.split(/\s+/).filter(Boolean) : [];
        let hits = all;
        if (type !== "all") {
            hits = hits.filter((h) => h.type === type);
        }
        if (words.length > 0) {
            hits = hits.filter((h) => {
                const t = (h.text + " " + h.book + " " + h.chapter).toLowerCase();
                return words.every((w) => t.includes(w));
            });
        }
        countEl.textContent = kw ? `${hits.length} 条命中 / 共 ${all.length} 条` : `共 ${all.length} 条`;

        if (hits.length === 0) {
            listEl.innerHTML = `<div class="wr-empty">${all.length === 0 ? "还没有同步过划线" : "没有匹配的划线，试试别的词"}</div>`;
            return;
        }
        // 有关键词时高亮
        const hi = (s: string) => {
            let out = esc(s);
            for (const w of words) {
                if (!w) continue;
                out = out.replace(new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
            }
            return out;
        };
        const typeLabel = (t: string) => (t === "thought" ? "想法" : t === "popular" ? "热门" : "划线");
        listEl.innerHTML = hits
            .slice(0, 300)
            .map(
                (h) => `<div class="wr-hit" data-id="${h.id}" data-root="${h.rootId}">
  <div class="wr-hit-head">
    <span class="wr-hit-book" data-root="${h.rootId}">《${esc(h.book || "未命名")}》</span>
    <span>${esc(h.chapter || "")}</span>
    <span>${esc(h.time || "")}</span>
    <span class="wr-hit-type t-${h.type}">${typeLabel(h.type)}</span>
  </div>
  <div class="wr-hit-body">${hi(h.text)}</div>
  <div class="wr-hit-ops">
    <button class="b3-button b3-button--outline wr-copy">复制块引用</button>
    <button class="b3-button b3-button--outline wr-open">打开所在文档</button>
  </div>
</div>`,
            )
            .join("");
        if (hits.length > 300) {
            listEl.insertAdjacentHTML("beforeend", `<div class="wr-empty">只显示前 300 条，再加关键词缩小范围</div>`);
        }
    };

    listEl.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;
        const card = target.closest(".wr-hit") as HTMLElement | null;
        if (!card) return;
        const id = card.dataset.id!;
        const rootId = card.dataset.root!;
        if (target.classList.contains("wr-copy")) {
            const hit = all.find((h) => h.id === id);
            const name = (hit?.text || "").replace(/\s+/g, " ").slice(0, 30);
            await navigator.clipboard.writeText(`((${id} "${name.replace(/"/g, "")}"))`);
            showMessage("已复制块引用，粘到任意笔记里即可建立双链", 2500);
        } else if (target.classList.contains("wr-open") || target.classList.contains("wr-hit-book")) {
            await openDocTab(plugin.app, rootId);
        }
    });

    input.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(render, 160);
    });

    chips.forEach((c) => {
        c.addEventListener("click", () => {
            chips.forEach((x) => x.classList.remove("on"));
            c.classList.add("on");
            type = c.dataset.type || "all";
            render();
        });
    });

    input.focus();
    loadAll()
        .then((rows) => {
            all = rows;
            render();
            input.focus();
        })
        .catch((err) => {
            listEl.innerHTML = `<div class="wr-empty">读取失败：${esc(String(err?.message || err))}</div>`;
        });

    setTimeout(() => input.focus(), 100);
}
