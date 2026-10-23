/**
 * 卡片盒 —— 思源笔记插件入口
 *
 * 主功能是卡片笔记（卢曼卡片法落到思源），微信读书同步退为素材来源。
 */
import { Plugin, showMessage, confirm, Setting } from "siyuan";
import { WereadClient } from "./weread";
import { SyncConfig, syncBooks, rebuildAll } from "./sync";
import { openSettingsDialog } from "./settings";
import { openPicker } from "./picker";
import { DOCK_TYPE, renderDock } from "./dock";
import { syncDiary } from "./diary";
import { DEFAULT_TEMPLATES } from "./templates";
import { openDocTab } from "./siyuanApi";
import { openSearch } from "./search";
import { polishBooks } from "./link";
import { buildCardIndex, newCardDialog } from "./cards";
import { openWorkbench, WorkbenchPreset } from "./home";

const TOPBAR_ICON = `<svg class="icon" viewBox="0 0 1024 1024" width="14" height="14" xmlns="http://www.w3.org/2000/svg"><path d="M288 320h448a64 64 0 0 1 64 64v448a64 64 0 0 1-64 64H288a64 64 0 0 1-64-64V384a64 64 0 0 1 64-64z" fill="none" stroke="currentColor" stroke-width="60"/><path d="M352 208h416a96 96 0 0 1 96 96v400" fill="none" stroke="currentColor" stroke-width="60" stroke-linecap="round" opacity="0.5"/></svg>`;

const DEFAULT_CONFIG: SyncConfig = {
    apiKey: "",
    notebookId: "",
    rootPath: "微信读书",
    includeThoughts: true,
    syncPopular: false,
    popularMode: "merge",
    minHighlights: 0,
    onlyStatus: "all",
    nameWithAuthor: false,
    richMeta: false,
    autoSyncMinutes: 0,
    diaryNotebook: "",
    cardPath: "卡片",
    cardNotebook: "",
    templates: { ...DEFAULT_TEMPLATES },
};

export default class ZettelPlugin extends Plugin {
    config: SyncConfig = { ...DEFAULT_CONFIG };
    private autoSyncTimer: ReturnType<typeof setInterval> | null = null;

    async onload() {
        const saved = await this.loadData("config.json");
        this.config = {
            ...DEFAULT_CONFIG,
            ...(saved || {}),
            templates: { ...DEFAULT_TEMPLATES, ...(saved?.templates || {}) },
        };

        this.addTopBar({
            id: "zettel-topbar",
            icon: TOPBAR_ICON,
            title: String(this.i18n.topBarTitle || "卡片盒"),
            position: "right",
            callback: () => this.openWorkbench(),
        });

        // ---- 卡片（主） ----
        this.addCommand({
            langKey: "newCard",
            langText: "新建卡片（选中文字会自动作为原文）",
            hotkey: "",
            callback: () => this.newCard(),
        });
        this.addCommand({
            langKey: "openWorkbench",
            langText: "打开卡片盒",
            hotkey: "",
            callback: () => this.openWorkbench(),
        });
        this.addCommand({
            langKey: "cardIndex",
            langText: "生成卡片索引文档（全部 / 孤岛 / 待打磨）",
            hotkey: "",
            callback: () => this.makeCardIndex(),
        });
        this.addCommand({
            langKey: "importNotes",
            langText: "素材：从思源笔记导入（选文档写成卡）",
            hotkey: "",
            callback: () => this.openWorkbench({ tab: "sources", source: "notes" }),
        });

        // ---- 素材（微信读书） ----
        this.addCommand({
            langKey: "pickBooks",
            langText: "素材：选择要同步的书",
            hotkey: "",
            callback: () => this.openPicker(),
        });
        this.addCommand({
            langKey: "syncAll",
            langText: String(this.i18n.cmdSyncAll || "素材：同步全部微信读书笔记"),
            hotkey: "",
            callback: () => this.syncAll(),
        });
        this.addCommand({
            langKey: "searchHighlights",
            langText: "素材：检索划线与想法（跨书搜索）",
            hotkey: "",
            callback: () => openSearch(this),
        });
        this.addCommand({
            langKey: "polishDocs",
            langText: "素材：整理同步文档（去重 / 清空章节 / 锚定想法）",
            hotkey: "",
            callback: () => this.polishAll(),
        });
        this.addCommand({
            langKey: "syncDiary",
            langText: "素材：把今日划线写进日记",
            hotkey: "",
            callback: () => this.syncDiaryCommand(),
        });

        // 兜底 Setting：集市若直接打开 this.setting，给一个跳转按钮
        this.setting = new Setting({ width: "520px", height: "auto" });
        this.setting.addItem({
            title: String(this.i18n.pluginName || "卡片盒"),
            description: "点击下方按钮打开完整设置面板",
            direction: "column",
            createActionElement: () => {
                const btn = document.createElement("button");
                btn.className = "b3-button";
                btn.textContent = "打开设置面板";
                btn.addEventListener("click", () => {
                    try {
                        (this.setting as any).close?.();
                    } catch {
                        // ignore
                    }
                    this.openSetting();
                });
                return btn;
            },
        });

        this.addDock({
            config: {
                position: "RightBottom",
                size: { width: 320, height: 480 },
                icon: "iconBookmark",
                title: String(this.i18n.topBarTitle || "卡片盒"),
                hotkey: "",
            },
            data: {},
            type: DOCK_TYPE,
            init: (custom: any) => {
                renderDock(custom, this);
            },
            destroy() {
                // noop
            },
        });

        this.setupAutoSync();
    }

    /** 设置入口：自绘对话框（思源 3.8.8 Setting 面板兼容性差） */
    openSetting() {
        openSettingsDialog(this, this.config, async (cfg) => {
            this.config = cfg;
            await this.saveData("config.json", cfg);
            this.setupAutoSync();
            showMessage("设置已保存", 3000);
        });
    }

    private setupAutoSync() {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
        const minutes = this.config.autoSyncMinutes || 0;
        if (minutes > 0 && this.config.apiKey) {
            this.autoSyncTimer = setInterval(() => {
                this.syncAll(true);
                if (this.config.diaryNotebook) {
                    this.syncDiaryCommand(true).catch(() => {});
                }
            }, minutes * 60 * 1000);
        }
    }

    private checkConfig(): boolean {
        if (!this.config.apiKey) {
            showMessage(String(this.i18n.missingApiKey || "请先配置 API Key"), 5000, "error");
            this.openSetting();
            return false;
        }
        return true;
    }

    private async getState(): Promise<Record<string, { docId: string; lastSync: number; lastSort: number }>> {
        try {
            return (await this.loadData("state.json")) || {};
        } catch {
            return {};
        }
    }

    private async openPicker() {
        if (!this.checkConfig()) {
            return;
        }
        openPicker(this, this.config, await this.getState());
    }

    /** 新建卡片：光标/选中的文字自动作为原文 */
    newCard() {
        let quote = "";
        try {
            const sel = window.getSelection();
            quote = (sel?.toString() || "").trim();
            if (quote.length > 1500) {
                quote = quote.slice(0, 1500) + "…";
            }
        } catch {
            // ignore
        }
        newCardDialog(this, { quote });
    }

    openWorkbench(preset: WorkbenchPreset = {}) {
        try {
            openWorkbench(this, preset);
        } catch (e: any) {
            showMessage(`打开失败：${e?.message || e}`, 6000, "error");
        }
    }

    /** 生成/刷新卡片索引文档 */
    async makeCardIndex() {
        if (!this.config.notebookId && !this.config.cardNotebook) {
            showMessage("请先在设置里选择卡片存放的笔记本", 4000, "error");
            return;
        }
        try {
            const id = await buildCardIndex(this);
            await openDocTab(this.app, id);
            showMessage("卡片索引已就绪：查询会随卡片变化自动更新", 4000);
        } catch (e: any) {
            showMessage(`生成失败：${e?.message || e}`, 6000, "error");
        }
    }

    /** 整理全部已同步文档 */
    async polishAll() {
        const state = await this.getState();
        const ids = Object.values(state)
            .map((s) => s.docId)
            .filter(Boolean);
        if (ids.length === 0) {
            showMessage("还没有同步过任何书", 3000, "error");
            return;
        }
        confirm(
            "整理微信读书文档",
            `将对 ${ids.length} 本书执行：<br><br>· 同一本书里完全重复的划线只留第一条<br>· 删掉「只有标题、没有内容」的空章节<br>· 把每条想法用块引用锚到它批注的原文<br><br>只处理插件生成的块，不动你手写的内容。继续？`,
            async () => {
                try {
                    const r = await polishBooks(ids, (msg, done, total) => {
                        if (done % 20 === 0 || done === total) {
                            showMessage(`${msg} (${done}/${total})`, 1500);
                        }
                    });
                    showMessage(
                        `整理完成：去重 ${r.merged} 条，清理空章节 ${r.emptyChapters} 个，锚定想法 ${r.anchored} 条`,
                        7000,
                    );
                } catch (e: any) {
                    showMessage(`整理失败：${e?.message || e}`, 6000, "error");
                }
            },
        );
    }

    /** 同步全部 */
    async syncAll(silent = false) {
        if (!this.config.apiKey) {
            if (!silent) {
                this.checkConfig();
            }
            return;
        }
        try {
            if (!silent) {
                showMessage("开始同步微信读书笔记…", 3000);
            }
            const client = new WereadClient(this.config.apiKey);
            const r = await syncBooks(this, client, this.config, undefined, (msg, done, total) => {
                if (!silent && (done % 5 === 0 || done === total)) {
                    showMessage(`${msg} (${done}/${total})`, 2000);
                }
            });
            const msg =
                String(this.i18n.syncDone || "同步完成") +
                `: ${r.books} 本书（跳过 ${r.skipped}），新增 ${r.created} / 更新 ${r.updated} / 删除 ${r.deleted}`;
            if (r.failed.length > 0) {
                const names = r.failed.slice(0, 3).join("、") + (r.failed.length > 3 ? " 等" : "");
                showMessage(`${msg}；失败 ${r.failed.length} 本（${names}），可再同步一次重试`, 8000, "error");
            } else {
                showMessage(msg, 5000);
            }
        } catch (e: any) {
            showMessage(`${this.i18n.syncFail || "同步失败"}: ${e?.message || e}`, 8000, "error");
        }
    }

    /** 今日划线 → 日记 */
    async syncDiaryCommand(silent = false): Promise<void> {
        if (!this.config.apiKey || !this.config.diaryNotebook) {
            if (!silent) {
                showMessage("请先配置 API Key 与日记集成笔记本", 4000, "error");
                this.openSetting();
            }
            return;
        }
        try {
            const client = new WereadClient(this.config.apiKey);
            const r = await syncDiary(this, client, this.config);
            showMessage(`日记同步完成：今日新增 ${r.added} 条划线`, 4000);
        } catch (e: any) {
            showMessage(`日记同步失败: ${e?.message || e}`, 6000, "error");
        }
    }

    /** 全量重建（危险操作，块引用会失效） */
    async rebuildCommand() {
        confirm(
            "全量重建同步文档",
            "将删除所有由本插件生成的书籍文档并重新同步。<b>已有文档中的块引用会失效</b>，确定继续？",
            async () => {
                try {
                    const client = new WereadClient(this.config.apiKey);
                    await rebuildAll(this, this.config, client);
                    showMessage("重建完成", 4000);
                } catch (e: any) {
                    showMessage(`重建失败: ${e?.message || e}`, 6000, "error");
                }
            },
        );
    }

    onunload() {
        if (this.autoSyncTimer) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
    }
}
