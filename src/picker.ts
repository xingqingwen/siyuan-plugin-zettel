/**
 * 书架选择对话框 v0.3：封面卡片网格
 */
import { Dialog, showMessage } from "siyuan";
import { WereadClient, NotebookBook } from "./weread";
import { syncBooks, SyncConfig, tsToDate } from "./sync";
import { openWorkbench } from "./home";
import { ensureStyles, coverEl, statusBadge } from "./ui";

export function openPicker(plugin: any, config: SyncConfig, state: Record<string, { lastSync: number }>) {
    ensureStyles();
    const dialog = new Dialog({
        title: plugin.i18n.pickerTitle,
        content: `<div class="wr-picker">
  <div class="wr-toolbar">
    <input class="b3-text-field fn__flex-1 wr-search" type="text" placeholder="搜索书名 / 作者">
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--b3-theme-secondary);cursor:pointer;">
      <input type="checkbox" class="wr-check-all" style="accent-color:var(--b3-theme-primary);">全选
    </label>
    <span class="wr-count"></span>
  </div>
  <div class="wr-grid">${plugin.i18n.loading}</div>
  <div class="wr-foot">
    <span class="wr-foot-info"></span>
    <button class="b3-button b3-button--outline wr-cards">🗂 卡片盒</button>
    <button class="b3-button b3-button--cancel wr-close">关闭</button>
    <button class="b3-button wr-sync-selected">${plugin.i18n.syncSelected}</button>
    <button class="b3-button b3-button--text wr-sync-all">${plugin.i18n.syncAll}</button>
  </div>
</div>`,
        width: "760px",
        height: "74vh",
        destroyCallback: () => {
            // noop
        },
    });

    const gridEl = dialog.element.querySelector(".wr-grid") as HTMLElement;
    const searchEl = dialog.element.querySelector(".wr-search") as HTMLInputElement;
    const checkAllEl = dialog.element.querySelector(".wr-check-all") as HTMLInputElement;
    const countEl = dialog.element.querySelector(".wr-count") as HTMLElement;
    const footInfoEl = dialog.element.querySelector(".wr-foot-info") as HTMLElement;
    const btnSelected = dialog.element.querySelector(".wr-sync-selected") as HTMLButtonElement;
    const btnAll = dialog.element.querySelector(".wr-sync-all") as HTMLButtonElement;
    dialog.element.querySelector(".wr-close")!.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector(".wr-cards")!.addEventListener("click", () => {
        dialog.destroy();
        void openWorkbench(plugin);
    });

    let books: NotebookBook[] = [];

    const setBusy = (busy: boolean) => {
        btnAll.disabled = busy;
        btnSelected.disabled = busy;
    };

    const updateCount = () => {
        const checked = dialog.element.querySelectorAll<HTMLInputElement>(".wr-book-check:checked").length;
        countEl.textContent = books.length ? `共 ${books.length} 本 · 已选 ${checked} 本` : "";
        footInfoEl.textContent = checked > 0 ? `已选 ${checked} 本，将只同步勾选的书` : "不勾选时用「全部同步」同步所有书";
    };

    const renderGrid = () => {
        const kw = (searchEl.value || "").trim().toLowerCase();
        const shown = kw
            ? books.filter((b) =>
                  (b.book?.title || "").toLowerCase().includes(kw) || (b.book?.author || "").toLowerCase().includes(kw))
            : books;
        gridEl.innerHTML = "";
        if (shown.length === 0) {
            gridEl.innerHTML = `<div class="wr-dock-empty">${kw ? "无匹配书籍" : plugin.i18n.noNotebooks}</div>`;
            updateCount();
            return;
        }
        for (const b of shown) {
            const hl = b.noteCount || 0;
            const th = b.reviewCount || 0;
            const last = state[b.bookId]?.lastSync;
            const st = statusBadge(b.markedStatus);
            const card = document.createElement("div");
            card.className = "wr-card";
            const check = document.createElement("input");
            check.type = "checkbox";
            check.className = "wr-book-check";
            check.dataset.bookId = b.bookId;
            check.style.position = "absolute";
            check.style.top = "8px";
            check.style.right = "8px";
            card.appendChild(coverEl(b.book?.cover, "wr-cover"));
            const body = document.createElement("div");
            body.className = "wr-card-body";
            body.innerHTML = `
    <div class="wr-card-title" style="padding-right:22px;">${escapeHtml(b.book?.title || "")}</div>
    <div class="wr-card-author">${escapeHtml(b.book?.author || "")}</div>
    <div class="wr-card-meta">
      <span class="wr-badge wr-badge--hl">划线 ${hl}</span>
      ${th > 0 ? `<span class="wr-badge">想法 ${th}</span>` : ""}
      <span class="wr-badge ${st.cls}">${st.text}</span>
      ${last ? `<span class="wr-card-sync">${tsToDate(last / 1000)} 已同步</span>` : ""}
    </div>`;
            card.appendChild(body);
            card.appendChild(check);
            card.addEventListener("click", (ev) => {
                if (ev.target !== check) {
                    check.checked = !check.checked;
                }
                card.classList.toggle("wr-checked", check.checked);
                updateCount();
            });
            if (check.checked) {
                card.classList.add("wr-checked");
            }
            gridEl.appendChild(card);
        }
        updateCount();
    };

    checkAllEl.addEventListener("change", () => {
        dialog.element.querySelectorAll<HTMLInputElement>(".wr-book-check").forEach((c) => {
            c.checked = checkAllEl.checked;
            c.closest(".wr-card")?.classList.toggle("wr-checked", c.checked);
        });
        updateCount();
    });
    searchEl.addEventListener("input", renderGrid);

    const doSync = async (ids?: Set<string>) => {
        setBusy(true);
        try {
            const client = new WereadClient(config.apiKey);
            gridEl.innerHTML = `<div class="wr-dock-empty">⏳ 准备同步…</div>`;
            const r = await syncBooks(plugin, client, config, ids, (msg, done, total) => {
                gridEl.innerHTML = `<div class="wr-dock-empty">⏳ ${escapeHtml(msg)}（${done}/${total}）</div>`;
            });
            const base =
                plugin.i18n.syncDone + `: ${r.books} 本书，新增 ${r.created} / 更新 ${r.updated} / 删除 ${r.deleted}`;
            if (r.failed.length > 0) {
                const names = r.failed.slice(0, 3).join("、") + (r.failed.length > 3 ? " 等" : "");
                showMessage(`${base}；失败 ${r.failed.length} 本（${names}）`, 7000, "error");
            } else {
                showMessage(base, 4000);
            }
            dialog.destroy();
        } catch (e: any) {
            showMessage(`${plugin.i18n.syncFail}: ${e?.message || e}`, 6000, "error");
            setBusy(false);
            renderGrid();
        }
    };

    btnAll.addEventListener("click", () => doSync());
    btnSelected.addEventListener("click", () => {
        const ids = new Set<string>();
        dialog.element.querySelectorAll<HTMLInputElement>(".wr-book-check:checked").forEach((c) => ids.add(c.dataset.bookId!));
        if (ids.size === 0) {
            showMessage(plugin.i18n.selectBooks, 3000, "error");
            return;
        }
        doSync(ids);
    });

    // 加载书架
    (async () => {
        try {
            const client = new WereadClient(config.apiKey);
            books = await client.listNotebooks();
            renderGrid();
            if (books.length === 0) {
                setBusy(true);
            }
        } catch (e: any) {
            gridEl.innerHTML = `<div class="wr-dock-empty">${plugin.i18n.loadFail}: ${escapeHtml(e?.message || String(e))}</div>`;
        }
    })();
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
