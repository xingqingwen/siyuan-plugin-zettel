/**
 * Dock 面板：卡片盒的常驻视图
 * 与对话框共用同一套工作台，只是空间更窄。
 */
import { renderWorkbench } from "./home";

export const DOCK_TYPE = "zettel-dock";

export function renderDock(custom: any, plugin: any): void {
    const el = custom.element as HTMLElement;
    el.style.height = "100%";
    el.style.overflow = "hidden";
    renderWorkbench(el, plugin);
}
