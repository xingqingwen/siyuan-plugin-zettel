import { TOKEN } from "./_env.mjs";
// siyuan 模块桩：在 Node 环境里模拟思源前端 SDK（内核请求走本机 6806 + Token）
const KERNEL = "http://127.0.0.1:6806";

export async function fetchSyncPost(url, data) {
    const resp = await fetch(KERNEL + url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(data || {}),
    });
    return await resp.json();
}

export class Plugin {
    constructor(options) {
        this.app = options?.app || {};
        this.name = options?.name || "test";
        this.i18n = options?.i18n || {};
        this.data = {};
    }
    addTopBar() {}
    addCommand() {}
    addDock() {}
    openSetting() {}
    async loadData(name) { return this.__data?.[name]; }
    async saveData(name, content) {
        this.__data = this.__data || {};
        this.__data[name] = content;
        return null;
    }
}

export async function openTab() {}
export function showMessage() {}
export function confirm() {}
export class Dialog {
    constructor(o) { this.element = { querySelector: () => null, querySelectorAll: () => [] }; }
    destroy() {}
}
export class Setting {
    addItem() {}
}
