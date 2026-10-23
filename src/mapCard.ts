/**
 * 地图卡 · 世界地图
 *
 * 读书时会遇到「和地理位置绑定」的知识：海峡、岛链、贸易航线。
 * 这类卡除了进卡片网络（链路），还应该能钉在世界地图上看位置。
 *
 * 实现约束：
 * - 地图数据（Natural Earth 110m TopoJSON，约 105KB）打包进插件，完全离线，不加载任何瓦片服务。
 * - 等距圆柱投影（equirectangular）：经纬度到像素是线性映射，反算点击坐标只要一行，
 *   换Mercator省的那点视觉变形，代价是投影代码和反算复杂度，不值得。
 */
import { Dialog, showMessage } from "siyuan";
import { esc } from "./cards";
import { getBlockAttrs, openDocTab, sqlStrict } from "./siyuanApi";
import { CARD_MAP_ATTR } from "./cards";
import worldRaw from "./world-110m.json?raw";

export const MAP_W = 820;
export const MAP_H = 410;

export interface MapPoint {
    name?: string;
    lat: number;
    lng: number;
}
export interface MapRegion {
    name?: string;
    /** north / east / south / west 边界 */
    n: number;
    e: number;
    s: number;
    w: number;
}
export interface CardMap {
    points?: MapPoint[];
    regions?: MapRegion[];
}

export function projX(lng: number): number {
    return ((lng + 180) / 360) * MAP_W;
}
export function projY(lat: number): number {
    return ((90 - lat) / 180) * MAP_H;
}
export function invX(px: number): number {
    return (px / MAP_W) * 360 - 180;
}
export function invY(py: number): number {
    return 90 - (py / MAP_H) * 180;
}

/** 26.6°N, 56.2°E 这类人话坐标 */
export function fmtLatLng(lat: number, lng: number): string {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lng).toFixed(1)}°${ew}`;
}

let cachedPathD: string | null = null;

/** TopoJSON → SVG path（等距圆柱投影）。arcs 是差分编码，先累加还原再投影 */
function worldPathD(): string {
    if (cachedPathD) {
        return cachedPathD;
    }
    const topo = JSON.parse(worldRaw as string);
    const tr = topo.transform;
    const sx = tr.scale[0];
    const sy = tr.scale[1];
    const tx = tr.translate[0];
    const ty = tr.translate[1];
    const arcs: number[][][] = topo.arcs.map((arc: number[][]) => {
        let x = 0;
        let y = 0;
        return arc.map(([dx, dy]: number[]) => {
            x += dx;
            y += dy;
            return [x * sx + tx, y * sy + ty];
        });
    });
    const ringD = (ring: number[]): string => {
        const pts: number[][] = [];
        for (const idx of ring) {
            const seg = idx >= 0 ? arcs[idx] : [...arcs[~idx]].reverse();
            if (pts.length === 0) {
                pts.push(...seg);
            } else {
                pts.push(...seg.slice(1));
            }
        }
        return (
            pts
                .map(
                    (p, i) =>
                        `${i ? "L" : "M"}${projX(p[0]).toFixed(1)},${projY(p[1]).toFixed(1)}`,
                )
                .join("") + "Z"
        );
    };
    let d = "";
    for (const g of topo.objects.countries.geometries as any[]) {
        const polys =
            g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
        for (const poly of polys) {
            for (const ring of poly) {
                d += ringD(ring);
            }
        }
    }
    cachedPathD = d;
    return d;
}

export function worldMapSVG(cls = ""): string {
    return `<svg class="${cls}" viewBox="0 0 ${MAP_W} ${MAP_H}" width="${MAP_W}" height="${MAP_H}">
  <path class="zt-map-land" d="${worldPathD()}" fill-rule="evenodd"></path>
</svg>`;
}

const MAP_CSS = `
.zt-map-wrap { position: relative; border: 1px solid var(--b3-border-color); border-radius: 8px; overflow: hidden; background: var(--b3-theme-background); user-select: none; }
.zt-map-wrap svg { display: block; width: 100%; height: auto; }
.zt-map-land { fill: var(--b3-theme-surface); stroke: var(--b3-border-color); stroke-width: .4; }
.zt-map-wrap.is-pick { cursor: crosshair; }
.zt-map-pin { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
  background: var(--b3-theme-primary, #357de3); border: 2px solid var(--b3-theme-background); box-shadow: 0 0 0 1px var(--b3-theme-primary, #357de3); pointer-events: none; }
.zt-map-rect { position: absolute; border: 1.5px dashed var(--b3-theme-primary, #357de3); background: rgba(53,125,227,.12); pointer-events: none; }
.zt-map-drag { position: absolute; border: 1.5px dashed var(--b3-theme-secondary); background: rgba(120,120,120,.15); pointer-events: none; }
.zt-map-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.zt-map-toolbar .zt-map-mode { font-size: 12px; padding: 4px 10px; }
.zt-map-toolbar .zt-map-mode.zt-on { border-color: var(--b3-theme-primary); color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest, rgba(53,125,227,.08)); }
.zt-map-coord { margin-left: auto; font-size: 11.5px; color: var(--b3-theme-secondary); font-variant-numeric: tabular-nums; }
.zt-map-pts { margin-top: 8px; max-height: 150px; overflow-y: auto; }
.zt-map-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 1px solid var(--b3-border-color); border-radius: 6px; margin-top: 6px; font-size: 12px; }
.zt-map-item .ico { flex-shrink: 0; }
.zt-map-item .b3-text-field { flex: 1; min-width: 0; font-size: 12px; padding: 2px 6px; height: 24px; box-sizing: border-box; }
.zt-map-item .coord { color: var(--b3-theme-secondary); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.zt-map-item .x { cursor: pointer; color: var(--b3-theme-error); font-weight: 600; padding: 0 4px; flex-shrink: 0; }
.zt-map-pin { transition: transform .1s; }
.zt-map-pin.hl { transform: scale(1.7); }
.zt-map-rect.hl { background: rgba(53,125,227,.28); border-style: solid; }
.zt-map-foot { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.zt-map-overview-pin { cursor: pointer; }
.zt-map-info { min-height: 44px; max-height: 120px; overflow-y: auto; margin-top: 8px; padding: 8px 10px;
  border: 1px solid var(--b3-border-color); border-radius: 6px; font-size: 12.5px; display: none; }
.zt-map-info .zt-row { cursor: pointer; }
`;

function ensureMapStyles(): void {
    if (document.getElementById("zt-map-style")) {
        return;
    }
    const st = document.createElement("style");
    st.id = "zt-map-style";
    st.textContent = MAP_CSS;
    document.head.appendChild(st);
}

/* ================= 地图选择器 ================= */

/**
 * 地图选点/框选对话框（2026-10-23 交互重设计）：
 * - 显式模式切换（📍 标记位置 / ▭ 框选区域），不再靠位移阈值猜用户想点还是想拖
 * - 先落点、后命名：点一下，列表里立刻出现一行，光标直接落在名称框里
 * - 悬停地图实时报经纬度，落点之前就知道自己在哪
 * - 列表项悬停高亮地图上对应的钉子/框，删改都有着落
 */
export function openMapPicker(
    initial: CardMap | undefined,
    onDone: (m: CardMap) => void,
): void {
    ensureMapStyles();
    const points: MapPoint[] = (initial?.points || []).map((p) => ({ ...p }));
    const regions: MapRegion[] = (initial?.regions || []).map((r) => ({ ...r }));
    let mode: "point" | "region" = "point";

    const dialog = new Dialog({
        title: "选择地图位置",
        content: `<div class="zt-map-pick" style="min-width:${MAP_W}px;">
  <div class="zt-map-toolbar">
    <button class="b3-button b3-button--outline zt-map-mode" data-mode="point">📍 标记位置</button>
    <button class="b3-button b3-button--outline zt-map-mode" data-mode="region">▭ 框选区域</button>
    <span class="zt-map-coord"></span>
  </div>
  <div class="zt-map-tip" style="font-size:12px;color:var(--b3-theme-secondary);margin-bottom:8px;"></div>
  <div class="zt-map-wrap is-pick">${worldMapSVG()}<div class="zt-map-layer"></div></div>
  <div class="zt-map-pts"></div>
  <div class="zt-map-foot">
    <span class="zt-flex"></span>
    <button class="b3-button b3-button--cancel zt-map-cancel">取消</button>
    <button class="b3-button b3-button--text zt-map-ok">确定</button>
  </div>
</div>`,
        width: `${MAP_W + 40}px`,
        height: "auto",
    });

    const wrap = dialog.element.querySelector(".zt-map-wrap") as HTMLElement;
    const layer = dialog.element.querySelector(".zt-map-layer") as HTMLElement;
    const listEl = dialog.element.querySelector(".zt-map-pts") as HTMLElement;
    const coordEl = dialog.element.querySelector(".zt-map-coord") as HTMLElement;
    const tipEl = dialog.element.querySelector(".zt-map-tip") as HTMLElement;

    const MODE_TIP: Record<string, string> = {
        point: "点击地图落一个点（一座岛、一座城、一个港口）。落下的点出现在下面列表里，直接打字命名。",
        region: "按住鼠标拖出一个框，松开即框选一片区域（一片海域、一条航线带）。",
    };

    const setMode = (m: "point" | "region") => {
        mode = m;
        for (const b of Array.from(dialog.element.querySelectorAll<HTMLElement>(".zt-map-mode"))) {
            b.classList.toggle("zt-on", b.dataset.mode === m);
        }
        tipEl.textContent = MODE_TIP[m];
    };
    for (const b of Array.from(dialog.element.querySelectorAll<HTMLElement>(".zt-map-mode"))) {
        b.addEventListener("click", () => setMode(b.dataset.mode === "region" ? "region" : "point"));
    }

    // 覆盖层用百分比定位：svg 是 width:100% + 等比高度，viewBox 坐标按比例换算即可
    const px = (vx: number) => `${((vx / MAP_W) * 100).toFixed(3)}%`;
    const py = (vy: number) => `${((vy / MAP_H) * 100).toFixed(3)}%`;

    const paintMap = () => {
        layer.innerHTML =
            points
                .map(
                    (p, i) =>
                        `<div class="zt-map-pin" data-k="p" data-i="${i}" title="${esc(p.name || "未命名")}" style="left:${px(projX(p.lng))};top:${py(projY(p.lat))};"></div>`,
                )
                .join("") +
            regions
                .map(
                    (r, i) =>
                        `<div class="zt-map-rect" data-k="r" data-i="${i}" style="left:${px(projX(r.w))};top:${py(projY(r.n))};width:${
                            ((Math.max(projX(r.e) - projX(r.w), 1)) / MAP_W) * 100
                        }%;height:${((Math.max(projY(r.s) - projY(r.n), 1)) / MAP_H) * 100}%;"></div>`,
                )
                .join("");
    };

    const paintList = () => {
        listEl.innerHTML =
            points
                .map(
                    (p, i) =>
                        `<div class="zt-map-item" data-k="p" data-i="${i}"><span class="ico">📍</span>` +
                        `<input class="b3-text-field zt-map-item-name" data-k="p" data-i="${i}" value="${esc(p.name || "")}" placeholder="名称（选填），如：拉腊克岛">` +
                        `<span class="coord">${fmtLatLng(p.lat, p.lng)}</span><span class="x" title="删除" data-k="p" data-i="${i}">×</span></div>`,
                )
                .join("") +
            regions
                .map(
                    (r, i) =>
                        `<div class="zt-map-item" data-k="r" data-i="${i}"><span class="ico">▭</span>` +
                        `<input class="b3-text-field zt-map-item-name" data-k="r" data-i="${i}" value="${esc(r.name || "")}" placeholder="名称（选填），如：阿拉伯海">` +
                        `<span class="coord">${r.n.toFixed(1)}°N~${r.s.toFixed(1)}°N, ${r.w.toFixed(1)}°E~${r.e.toFixed(1)}°E</span><span class="x" title="删除" data-k="r" data-i="${i}">×</span></div>`,
                )
                .join("");
        if (points.length + regions.length === 0) {
            listEl.innerHTML = `<div style="font-size:12px;color:var(--b3-theme-tertiary);padding:6px 2px;">还没选位置。选好后这里会列出每一处，可以直接改名。</div>`;
        }
    };

    const focusLastName = () => {
        const inputs = listEl.querySelectorAll<HTMLInputElement>(".zt-map-item-name");
        inputs[inputs.length - 1]?.focus();
    };

    const paintAll = () => {
        paintMap();
        paintList();
    };
    paintAll();
    setMode("point");

    // 列表：改名 / 删除 / 悬停高亮地图对应物
    listEl.addEventListener("input", (e) => {
        const t = e.target as HTMLInputElement;
        if (!t.classList.contains("zt-map-item-name")) {
            return;
        }
        const i = Number(t.dataset.i);
        if (t.dataset.k === "p") {
            points[i].name = t.value.trim();
        } else {
            regions[i].name = t.value.trim();
        }
        paintMap();
    });
    listEl.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (!t.classList.contains("x")) {
            return;
        }
        const i = Number(t.dataset.i);
        if (t.dataset.k === "p") {
            points.splice(i, 1);
        } else {
            regions.splice(i, 1);
        }
        paintAll();
    });
    listEl.addEventListener("mouseover", (e) => {
        const it = (e.target as HTMLElement).closest(".zt-map-item") as HTMLElement | null;
        if (!it) {
            return;
        }
        const sel = `.zt-map-pin[data-k="${it.dataset.k}"][data-i="${it.dataset.i}"], .zt-map-rect[data-k="${it.dataset.k}"][data-i="${it.dataset.i}"]`;
        dialog.element.querySelector(sel)?.classList.add("hl");
    });
    listEl.addEventListener("mouseout", (e) => {
        const it = (e.target as HTMLElement).closest(".zt-map-item") as HTMLElement | null;
        if (!it) {
            return;
        }
        const sel = `.zt-map-pin[data-k="${it.dataset.k}"][data-i="${it.dataset.i}"], .zt-map-rect[data-k="${it.dataset.k}"][data-i="${it.dataset.i}"]`;
        dialog.element.querySelector(sel)?.classList.remove("hl");
    });

    // 地图交互。坐标换算只在事件内现场取 wrap 尺寸——
    // （v0.9.0 的 bug：mouseup 引用了 mousedown 作用域里的 rect，点一下就抛错）
    let downPos: { x: number; y: number } | null = null;
    let dragEl: HTMLElement | null = null;

    const localPos = (e: MouseEvent) => {
        const rect = wrap.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    /** 显示坐标 → 经纬度 */
    const toLatLng = (x: number, y: number) => ({
        lat: +invY((y / wrap.clientHeight) * MAP_H).toFixed(2),
        lng: +invX((x / wrap.clientWidth) * MAP_W).toFixed(2),
    });

    wrap.addEventListener("mousedown", (e) => {
        if (mode !== "region") {
            return;
        }
        downPos = localPos(e);
    });
    wrap.addEventListener("mousemove", (e) => {
        const { x, y } = localPos(e);
        const inMap = x >= 0 && y >= 0 && x <= wrap.clientWidth && y <= wrap.clientHeight;
        coordEl.textContent = inMap
            ? fmtLatLng(invY((y / wrap.clientHeight) * MAP_H), invX((x / wrap.clientWidth) * MAP_W))
            : "";
        if (!downPos || mode !== "region") {
            return;
        }
        if (Math.abs(x - downPos.x) + Math.abs(y - downPos.y) < 4) {
            return;
        }
        if (!dragEl) {
            dragEl = document.createElement("div");
            dragEl.className = "zt-map-drag";
            wrap.appendChild(dragEl);
        }
        dragEl.style.left = `${Math.min(downPos.x, x)}px`;
        dragEl.style.top = `${Math.min(downPos.y, y)}px`;
        dragEl.style.width = `${Math.abs(x - downPos.x)}px`;
        dragEl.style.height = `${Math.abs(y - downPos.y)}px`;
    });
    wrap.addEventListener("mouseup", (e) => {
        const { x, y } = localPos(e);
        const inMap = x >= 0 && y >= 0 && x <= wrap.clientWidth && y <= wrap.clientHeight;

        if (mode === "point") {
            if (!inMap) {
                return;
            }
            const ll = toLatLng(x, y);
            points.push({ name: "", lat: ll.lat, lng: ll.lng });
            paintAll();
            focusLastName();
            return;
        }

        // region 模式
        if (!downPos) {
            return;
        }
        const moved = Math.abs(x - downPos.x) + Math.abs(y - downPos.y);
        const dvn = (downPos.x / wrap.clientWidth) * MAP_W;
        const dvy = (downPos.y / wrap.clientHeight) * MAP_H;
        downPos = null;
        if (dragEl) {
            dragEl.remove();
            dragEl = null;
        }
        if (!inMap) {
            return;
        }
        if (moved < 6) {
            showMessage("框选区域：请按住鼠标拖动", 1500);
            return;
        }
        const vx = (x / wrap.clientWidth) * MAP_W;
        const vy = (y / wrap.clientHeight) * MAP_H;
        regions.push({
            name: "",
            n: +invY(Math.min(dvy, vy)).toFixed(2),
            s: +invY(Math.max(dvy, vy)).toFixed(2),
            w: +invX(Math.min(dvn, vx)).toFixed(2),
            e: +invX(Math.max(dvn, vx)).toFixed(2),
        });
        paintAll();
        focusLastName();
    });
    wrap.addEventListener("mouseleave", () => {
        coordEl.textContent = "";
        if (downPos && dragEl) {
            dragEl.remove();
            dragEl = null;
        }
        downPos = null;
    });

    dialog.element.querySelector(".zt-map-cancel")!.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector(".zt-map-ok")!.addEventListener("click", () => {
        if (points.length === 0 && regions.length === 0) {
            showMessage("至少选一个位置或一片区域", 3000);
            return;
        }
        dialog.destroy();
        onDone({ points, regions });
    });
}

/* ================= 全盒地图总览 ================= */

export interface MapCardItem {
    id: string;
    title: string;
    map: CardMap;
}

/** 所有带地图数据的卡 */
export async function listMapCards(): Promise<MapCardItem[]> {
    const rows = await sqlStrict<{ id: string; content: string }>(
        `SELECT id, content FROM blocks WHERE type='d' AND ial LIKE '%${CARD_MAP_ATTR}=%' LIMIT 100000`,
    );
    const out: MapCardItem[] = [];
    for (const r of rows) {
        try {
            const attrs = await getBlockAttrs(r.id);
            const raw = attrs[CARD_MAP_ATTR];
            if (!raw) {
                continue;
            }
            const m = JSON.parse(raw) as CardMap;
            if ((m.points?.length || 0) + (m.regions?.length || 0) > 0) {
                out.push({ id: r.id, title: r.content || "未命名地图卡", map: m });
            }
        } catch {
            // 单张卡解析失败不影响其它
        }
    }
    return out;
}

/** 卡片盒的「地图」总览：所有地图卡钉在世界地图上，点钉子看卡 */
export async function openMapOverview(plugin: any): Promise<void> {
    ensureMapStyles();
    const dialog = new Dialog({
        title: "卡片地图",
        content: `<div class="zt-map-overview" style="min-width:${MAP_W}px;">
  <div class="zt-map-tip" style="font-size:12px;color:var(--b3-theme-secondary);margin-bottom:8px;">卡片盒里所有绑定了地理位置的卡。点钉子看这有什么卡，点卡名打开全文。</div>
  <div class="zt-map-wrap">${worldMapSVG()}<div class="zt-map-layer"></div></div>
  <div class="zt-map-info"></div>
</div>`,
        width: `${MAP_W + 40}px`,
        height: "auto",
    });
    const layer = dialog.element.querySelector(".zt-map-layer") as HTMLElement;
    const info = dialog.element.querySelector(".zt-map-info") as HTMLElement;
    layer.innerHTML = `<div class="zt-empty">定位卡片中…</div>`;

    let items: MapCardItem[] = [];
    try {
        items = await listMapCards();
    } catch (e: any) {
        layer.innerHTML = "";
        info.style.display = "block";
        info.innerHTML = `<span style="color:var(--b3-theme-error);">读取失败：${esc(String(e?.message || e))}</span>`;
        return;
    }
    if (items.length === 0) {
        layer.innerHTML = "";
        info.style.display = "block";
        info.innerHTML = `还没有地图卡。<br>新建卡片时选「地图卡」，在地图上点一个位置——<br>读书时遇到海峡、港口、航线这类知识，就钉在这里。`;
        return;
    }

    // 同一个位置的卡归成一组，点一下全部列出来
    const keyOf = (lat: number, lng: number) => `${Math.round(lat)}:${Math.round(lng)}`;
    const groups = new Map<string, { lat: number; lng: number; cards: MapCardItem[] }>();
    for (const it of items) {
        for (const p of it.map.points || []) {
            const k = keyOf(p.lat, p.lng);
            const g = groups.get(k) || { lat: p.lat, lng: p.lng, cards: [] };
            g.cards.push(it);
            groups.set(k, g);
        }
    }
    layer.innerHTML = "";
    const px = (vx: number) => `${((vx / MAP_W) * 100).toFixed(3)}%`;
    const py = (vy: number) => `${((vy / MAP_H) * 100).toFixed(3)}%`;
    for (const g of groups.values()) {
        const el = document.createElement("div");
        el.className = "zt-map-pin zt-map-overview-pin";
        el.style.pointerEvents = "auto";
        el.style.left = px(projX(g.lng));
        el.style.top = py(projY(g.lat));
        el.title = g.cards.map((c) => c.title).join("\n");
        el.addEventListener("click", () => {
            info.style.display = "block";
            info.innerHTML =
                `<div style="color:var(--b3-theme-secondary);font-size:11px;margin-bottom:4px;">${esc(fmtLatLng(g.lat, g.lng))} · ${g.cards.length} 张卡</div>` +
                g.cards
                    .map(
                        (c) =>
                            `<div class="zt-row" data-card="${c.id}" title="点击打开卡片全文"><div class="zt-main"><div class="zt-title" style="font-size:12.5px;">${esc(c.title)}</div></div></div>`,
                    )
                    .join("");
            for (const row of Array.from(info.querySelectorAll<HTMLElement>(".zt-row"))) {
                row.addEventListener("click", async () => {
                    try {
                        await openDocTab(plugin.app, row.dataset.card!);
                    } catch (err: any) {
                        showMessage(`打开失败：${err?.message || err}`, 5000, "error");
                    }
                });
            }
        });
        layer.appendChild(el);
    }
    // 区域画成虚线框
    for (const it of items) {
        for (const r of it.map.regions || []) {
            const el = document.createElement("div");
            el.className = "zt-map-rect";
            el.style.pointerEvents = "auto";
            el.style.cursor = "pointer";
            el.title = `${it.title}${r.name ? ` · ${r.name}` : ""}`;
            el.style.left = px(projX(r.w));
            el.style.top = py(projY(r.n));
            el.style.width = `${(Math.max(projX(r.e) - projX(r.w), 2) / MAP_W) * 100}%`;
            el.style.height = `${(Math.max(projY(r.s) - projY(r.n), 2) / MAP_H) * 100}%`;
            el.addEventListener("click", async () => {
                try {
                    await openDocTab(plugin.app, it.id);
                } catch {
                    // ignore
                }
            });
            layer.appendChild(el);
        }
    }
    info.style.display = "block";
    info.innerHTML = `<span style="color:var(--b3-theme-tertiary);font-size:11.5px;">共 ${items.length} 张地图卡、${groups.size} 个位置点。点钉子查看。</span>`;
}
