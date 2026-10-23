/**
 * 共享 UI 样式：卡片化书架界面
 * 全部使用思源 b3 CSS 变量，自动适配明暗主题
 */

const STYLE_ID = "wr-plugin-styles";

const CSS = `
/* ===== 自绘设置对话框 ===== */
.wr-set { display: flex; flex-direction: column; height: 100%; }
.wr-set-body { flex: 1; overflow: auto; padding: 4px 20px 12px; }
.wr-set-section {
    font-size: 12px; font-weight: 600; color: var(--b3-theme-primary);
    letter-spacing: .5px; margin: 14px 0 4px;
    padding-bottom: 6px; border-bottom: 1px dashed var(--b3-border-color);
}
.wr-set-section:first-child { margin-top: 4px; }
.wr-row {
    display: flex; align-items: center; gap: 16px;
    padding: 9px 0; border-bottom: 1px solid var(--b3-theme-background-light, rgba(0,0,0,.03));
}
.wr-row-label { flex: 1; min-width: 0; }
.wr-row-title { font-size: 13px; color: var(--b3-theme-on-background); }
.wr-row-desc { font-size: 11px; color: var(--b3-theme-secondary); margin-top: 2px; line-height: 1.5; }
.wr-row-ctrl { flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.wr-row-ctrl .b3-select, .wr-row-ctrl .b3-text-field { width: 200px; }
.wr-set-foot {
    display: flex; gap: 8px; justify-content: flex-end; align-items: center;
    padding: 12px 20px; border-top: 1px solid var(--b3-border-color);
}
.wr-set-foot .wr-foot-info { flex: 1; font-size: 12px; color: var(--b3-theme-secondary); }
.wr-tpl-block { width: 100%; padding: 4px 0; }
.wr-tpl-label { font-size: 11px; color: var(--b3-theme-secondary); margin: 6px 0 3px; }
.wr-tpl-block .b3-text-field { width: 100%; font-family: monospace; font-size: 12px; }

/* ===== 书籍卡片（选择对话框） ===== */
.wr-picker { display: flex; flex-direction: column; height: 100%; }
.wr-toolbar {
    display: flex; gap: 8px; align-items: center;
    padding: 10px 16px; border-bottom: 1px solid var(--b3-border-color);
}
.wr-toolbar .wr-count { font-size: 12px; color: var(--b3-theme-secondary); white-space: nowrap; }
.wr-grid {
    flex: 1; overflow: auto; padding: 12px 16px;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;
    align-content: start;
}
.wr-card {
    display: flex; gap: 10px; padding: 10px;
    border: 1px solid var(--b3-border-color); border-radius: 8px;
    cursor: pointer; position: relative; transition: box-shadow .15s, border-color .15s, transform .15s;
    background: var(--b3-theme-background);
}
.wr-card:hover { border-color: var(--b3-theme-primary); box-shadow: 0 2px 8px rgba(0,0,0,.08); transform: translateY(-1px); }
.wr-card.wr-checked { border-color: var(--b3-theme-primary); background: var(--b3-list-hover); }
.wr-cover {
    width: 46px; height: 64px; flex-shrink: 0; border-radius: 4px; overflow: hidden;
    background: var(--b3-theme-surface); box-shadow: 0 1px 4px rgba(0,0,0,.15);
    display: flex; align-items: center; justify-content: center;
}
.wr-cover img { width: 100%; height: 100%; object-fit: cover; }
.wr-cover.wr-noimg { font-size: 20px; color: var(--b3-theme-secondary); }
.wr-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wr-card-title {
    font-size: 13px; font-weight: 500; color: var(--b3-theme-on-background);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 20px;
}
.wr-card-author { font-size: 11px; color: var(--b3-theme-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wr-card-meta { display: flex; gap: 4px; flex-wrap: wrap; margin-top: auto; }
.wr-badge {
    font-size: 10px; padding: 1px 6px; border-radius: 10px;
    background: var(--b3-theme-surface); color: var(--b3-theme-secondary);
    border: 1px solid var(--b3-border-color); white-space: nowrap;
}
.wr-badge--hl { color: var(--b3-theme-primary); border-color: var(--b3-theme-primary-lighter, var(--b3-theme-primary)); opacity: .85; }
.wr-badge--done { background: var(--b3-card-success-background, rgba(46,194,126,.15)); color: var(--b3-card-success-color, #2ec27e); border-color: transparent; }
.wr-badge--reading { background: var(--b3-card-info-background, rgba(53,125,227,.12)); color: var(--b3-card-info-color, var(--b3-theme-primary)); border-color: transparent; }
.wr-card-sync { font-size: 10px; color: var(--b3-theme-tertiary); }
.wr-card-check {
    position: absolute; top: 8px; right: 8px; width: 15px; height: 15px; margin: 0; cursor: pointer;
    accent-color: var(--b3-theme-primary);
}
.wr-foot {
    display: flex; gap: 8px; justify-content: flex-end; align-items: center;
    padding: 12px 16px; border-top: 1px solid var(--b3-border-color);
}
.wr-foot .wr-foot-info { flex: 1; font-size: 12px; color: var(--b3-theme-secondary); }

/* ===== Dock 书架面板 ===== */
.wr-dock { display: flex; flex-direction: column; height: 100%; }
.wr-dock-head { display: flex; gap: 4px; padding: 8px; align-items: center; border-bottom: 1px solid var(--b3-border-color); }
.wr-dock-head .b3-text-field { font-size: 12px; padding: 4px 8px; }
.wr-dock-sort { padding: 0 8px 6px; display: flex; gap: 4px; }
.wr-dock-tools { padding: 0 8px 8px; display: flex; gap: 6px; border-bottom: 1px solid var(--b3-border-color); }
.wr-dock-tools .b3-button { flex: 1; font-size: 12px; justify-content: center; }
.wr-sort-btn {
    font-size: 11px; padding: 2px 8px; border-radius: 10px; cursor: pointer;
    color: var(--b3-theme-secondary); background: transparent; border: 1px solid transparent;
}
.wr-sort-btn:hover { background: var(--b3-list-hover); }
.wr-sort-btn.wr-active { color: var(--b3-theme-primary); border-color: var(--b3-theme-primary); }
.wr-dock-list { flex: 1; overflow: auto; padding: 0 8px 8px; }
.wr-dock-item {
    display: flex; gap: 8px; padding: 6px; cursor: pointer; border-radius: 6px;
    align-items: center; margin-bottom: 2px; transition: background .1s;
}
.wr-dock-item:hover { background: var(--b3-list-hover); }
.wr-dock-cover {
    width: 30px; height: 42px; flex-shrink: 0; border-radius: 3px; overflow: hidden;
    background: var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0,0,0,.12);
    display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--b3-theme-secondary);
}
.wr-dock-cover img { width: 100%; height: 100%; object-fit: cover; }
.wr-dock-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wr-dock-title {
    font-size: 12.5px; color: var(--b3-theme-on-background);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wr-dock-sub { font-size: 11px; color: var(--b3-theme-secondary); display: flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap; }
.wr-dock-progress {
    height: 3px; border-radius: 2px; background: var(--b3-border-color); overflow: hidden; flex-shrink: 0;
}
.wr-dock-progress > div { height: 100%; background: var(--b3-theme-primary); border-radius: 2px; }
.wr-dock-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.wr-dock-empty { padding: 16px 12px; color: var(--b3-theme-secondary); font-size: 12px; text-align: center; line-height: 1.8; }

/* ===== 设置面板分组头 ===== */
.wr-section-head {
    width: 100%; padding: 10px 0 2px; font-size: 12px; font-weight: 600;
    color: var(--b3-theme-primary); letter-spacing: .5px;
    border-bottom: 1px dashed var(--b3-border-color); margin-bottom: 4px;
}
`;

export function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

/** 封面元素（带兜底占位） */
export function coverEl(src: string | undefined, cls: string): HTMLElement {
    const el = document.createElement("div");
    el.className = cls + (src ? "" : " wr-noimg");
    if (src) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = src;
        img.onerror = () => {
            el.classList.add("wr-noimg");
            el.textContent = "📖";
            img.remove();
        };
        el.appendChild(img);
    } else {
        el.textContent = "📖";
    }
    return el;
}

/** 状态徽章（markedStatus 实测语义：2=在读、4=读完、1/3=想读/搁置） */
export function statusBadge(markedStatus: number | undefined): { cls: string; text: string } {
    if (markedStatus === 4) {
        return { cls: "wr-badge--done", text: "读完" };
    }
    if (markedStatus === 2) {
        return { cls: "wr-badge--reading", text: "在读" };
    }
    if (markedStatus === 1) {
        return { cls: "", text: "想读" };
    }
    return { cls: "", text: "搁置" };
}
