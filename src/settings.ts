/**
 * 设置对话框 v0.3：完全自绘（思源 3.8.8 的 Setting 面板对复杂自定义元素兼容差）
 */
import { Dialog, showMessage } from "siyuan";
import { listNotebooks } from "./siyuanApi";
import { SyncConfig } from "./sync";
import { DEFAULT_TEMPLATES, Templates } from "./templates";
import { ensureStyles } from "./ui";

function textField(value: string, placeholder = "", width = "200px"): HTMLInputElement {
    const el = document.createElement("input");
    el.type = "text";
    el.className = "b3-text-field";
    el.style.width = width;
    el.value = value || "";
    el.placeholder = placeholder;
    return el;
}

function selectEl(options: { value: string; label: string }[], current: string): HTMLSelectElement {
    const el = document.createElement("select");
    el.className = "b3-select";
    for (const o of options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === current) {
            opt.selected = true;
        }
        el.appendChild(opt);
    }
    return el;
}

function switchEl(checked: boolean): HTMLInputElement {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.className = "b3-switch";
    el.checked = checked;
    return el;
}

function numField(value: number, placeholder = "0"): HTMLInputElement {
    const el = textField(String(value ?? ""), placeholder);
    el.type = "number";
    el.min = "0";
    return el;
}

export function openSettingsDialog(plugin: any, config: SyncConfig, onConfirm: (cfg: SyncConfig) => void) {
    ensureStyles();
    const dialog = new Dialog({
        title: plugin.i18n.settingTitle || "卡片盒设置",
        content: `<div class="wr-set">
  <div class="wr-set-body"></div>
  <div class="wr-set-foot">
    <span class="wr-foot-info"></span>
    <button class="b3-button b3-button--cancel wr-cancel">取消</button>
    <button class="b3-button wr-save">保存</button>
  </div>
</div>`,
        width: "720px",
        height: "80vh",
        destroyCallback: () => {
            // noop
        },
    });

    const body = dialog.element.querySelector(".wr-set-body") as HTMLElement;
    const footInfo = dialog.element.querySelector(".wr-foot-info") as HTMLElement;
    dialog.element.querySelector(".wr-cancel")!.addEventListener("click", () => dialog.destroy());

    const section = (label: string) => {
        const el = document.createElement("div");
        el.className = "wr-set-section";
        el.textContent = label;
        body.appendChild(el);
    };

    const row = (title: string, desc: string, ctrl: HTMLElement) => {
        const el = document.createElement("div");
        el.className = "wr-row";
        const label = document.createElement("div");
        label.className = "wr-row-label";
        label.innerHTML = `<div class="wr-row-title">${title}</div>${desc ? `<div class="wr-row-desc">${desc}</div>` : ""}`;
        const ctrlWrap = document.createElement("div");
        ctrlWrap.className = "wr-row-ctrl";
        ctrlWrap.appendChild(ctrl);
        el.appendChild(label);
        el.appendChild(ctrlWrap);
        body.appendChild(el);
        return el;
    };

    // ===== 基础 =====
    section("素材源 · 微信读书授权与存放位置");

    const apiKeyInput = textField(config.apiKey, "wrk-xxxxxxxx", "240px");
    apiKeyInput.style.fontFamily = "monospace";

    const validateBtn = document.createElement("button");
    validateBtn.className = "b3-button b3-button--small";
    validateBtn.textContent = "校验";
    validateBtn.addEventListener("click", async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showMessage("请先填写 API Key", 3000, "error");
            return;
        }
        validateBtn.textContent = "…";
        try {
            const { WereadClient } = await import("./weread");
            const client = new WereadClient(key);
            const data = await client.call<any>("/user/notebooks", { count: 1 });
            const total = data?.totalBookCount ?? 0;
            showMessage(`✅ Key 有效，共有笔记的书 ${total} 本`, 4000);
        } catch (e: any) {
            showMessage(`❌ Key 无效: ${e?.message || e}`, 6000, "error");
        } finally {
            validateBtn.textContent = "校验";
        }
    });

    const apiKeyWrap = document.createElement("div");
    apiKeyWrap.style.cssText = "display:flex;gap:6px;align-items:center;";
    apiKeyWrap.appendChild(apiKeyInput);
    apiKeyWrap.appendChild(validateBtn);
    row("API Key", "在 weread.qq.com/r/weread-skills 用微信扫码生成（wrk- 开头），Key 只保存在本地", apiKeyWrap);

    const notebookSelect = document.createElement("select");
    notebookSelect.className = "b3-select";
    row("同步到笔记本", "同步出来的书籍文档写入哪个笔记本", notebookSelect);

    const rootInput = textField(config.rootPath, "微信读书");
    row("文档根路径", "同步生成的文档放在该路径下，如：微信读书", rootInput);

    // ===== 同步内容 =====
    section("同步内容");
    const thoughtSwitch = switchEl(config.includeThoughts !== false);
    row("同步想法/点评", "除划线外，同时同步划线想法、章节点评与书评", thoughtSwitch);

    const popularSwitch = switchEl(config.syncPopular === true);
    row("同步热门划线", "每本书最多 20 条社区热门划线（每本多 1 次请求）", popularSwitch);

    const popularModeSelect = selectEl(
        [
            { value: "merge", label: "融入章节（按位置）" },
            { value: "separate", label: "独立区块（文末）" },
        ],
        config.popularMode || "merge",
    );
    row("热门划线展示方式", "融入章节按位置排列，或文末独立区块", popularModeSelect);

    // ===== 范围过滤 =====
    section("范围过滤");
    const minHlInput = numField(config.minHighlights || 0, "0 = 不过滤");
    row("最小划线数", "划线数少于此值的书不同步（0 = 不过滤）", minHlInput);

    const statusSelect = selectEl(
        [
            { value: "all", label: "全部" },
            { value: "reading", label: "仅在读" },
            { value: "finished", label: "仅读完" },
        ],
        config.onlyStatus || "all",
    );
    row("同步范围", "按阅读状态过滤书籍", statusSelect);

    const nameAuthorSwitch = switchEl(config.nameWithAuthor === true);
    row("文档名带作者", "《书名 · 作者》，可避免书名重复冲突", nameAuthorSwitch);

    const richMetaSwitch = switchEl(config.richMeta === true);
    row("丰富元数据", "获取封面、出版社等信息（每本多 1-2 次请求）", richMetaSwitch);

    // ===== 自动化 =====
    section("自动化");
    const autoSyncInput = numField(config.autoSyncMinutes || 0, "0 = 关闭");
    row("定时自动同步", "间隔分钟数，0 = 关闭。需要思源保持运行", autoSyncInput);

    const diarySelect = document.createElement("select");
    diarySelect.className = "b3-select";
    row("日记集成笔记本", "把当天新增划线追加到该笔记本的今日日记（思源日记机制）", diarySelect);

    // ===== 卡片 =====
    section("卡片 · 主功能");
    const cardPathInput = textField(config.cardPath || "卡片", "卡片", "180px");
    row("卡片存放路径", "卡片文档放在该路径下（相对笔记本根目录）", cardPathInput);

    const cardNbSelect = document.createElement("select");
    cardNbSelect.className = "b3-select";
    row("卡片存放到笔记本", "留空 = 跟随上面的同步笔记本；建议单独放到知识库笔记本", cardNbSelect);

    // ===== 模板 =====
    section("模板");
    const tplWrap = document.createElement("div");
    tplWrap.className = "wr-tpl-block";
    const tplInputs: Record<keyof Templates, HTMLTextAreaElement> = {} as any;
    const tplFields: { key: keyof Templates; label: string; hint: string }[] = [
        { key: "meta", label: "文档头", hint: "{{title}} {{author}} {{hlCount}} {{thCount}} {{popCount}} {{progress}} {{link}} {{syncTime}}" },
        { key: "chapter", label: "章节标题", hint: "{{chapterTitle}}" },
        { key: "highlight", label: "划线", hint: "{{markText}} {{createTime}} {{chapterTitle}} {{link}}" },
        { key: "thought", label: "想法", hint: "{{content}} {{createTime}}" },
        { key: "popular", label: "热门划线", hint: "{{markText}} {{totalUsers}}" },
    ];
    for (const f of tplFields) {
        const label = document.createElement("div");
        label.className = "wr-tpl-label";
        label.textContent = `${f.label} — 可用变量: ${f.hint}`;
        const ta = document.createElement("textarea");
        ta.className = "b3-text-field";
        ta.rows = 2;
        ta.value = (config.templates as any)?.[f.key] ?? (DEFAULT_TEMPLATES as any)[f.key];
        tplInputs[f.key] = ta;
        tplWrap.appendChild(label);
        tplWrap.appendChild(ta);
    }
    const tplReset = document.createElement("button");
    tplReset.className = "b3-button b3-button--small";
    tplReset.style.marginTop = "8px";
    tplReset.textContent = "恢复默认模板";
    tplReset.addEventListener("click", () => {
        for (const f of tplFields) {
            tplInputs[f.key].value = (DEFAULT_TEMPLATES as any)[f.key];
        }
    });
    tplWrap.appendChild(tplReset);
    const tplRow = row("块模板", "块类型固定：划线=引用块、想法=底色段落、热门=底色引用块", document.createElement("div"));
    tplRow.style.flexDirection = "column";
    tplRow.style.alignItems = "stretch";
    tplRow.querySelector(".wr-row-ctrl")!.replaceWith(tplWrap);

    // ===== 动态填充笔记本下拉 =====
    (async () => {
        try {
            const nbs = await listNotebooks();
            for (const sel of [notebookSelect, cardNbSelect, diarySelect]) {
                sel.innerHTML = "";
                if (sel === diarySelect || sel === cardNbSelect) {
                    const none = document.createElement("option");
                    none.value = "";
                    none.textContent = sel === diarySelect ? "（关闭日记集成）" : "（跟随同步笔记本）";
                    sel.appendChild(none);
                }
                for (const nb of nbs) {
                    const opt = document.createElement("option");
                    opt.value = nb.id;
                    opt.textContent = nb.name;
                    sel.appendChild(opt);
                }
                const current =
                    sel === notebookSelect
                        ? config.notebookId
                        : sel === cardNbSelect
                          ? config.cardNotebook || ""
                          : config.diaryNotebook;
                if (current) {
                    (sel as HTMLSelectElement).value = current;
                }
            }
        } catch {
            // 思源未就绪时忽略
        }
    })();

    // ===== 保存 =====
    dialog.element.querySelector(".wr-save")!.addEventListener("click", () => {
        onConfirm({
            apiKey: apiKeyInput.value.trim(),
            notebookId: (notebookSelect.value as string) || config.notebookId,
            rootPath: rootInput.value.trim() || "微信读书",
            includeThoughts: thoughtSwitch.checked,
            syncPopular: popularSwitch.checked,
            popularMode: (popularModeSelect.value as "merge" | "separate") || "merge",
            minHighlights: Math.max(0, parseInt(minHlInput.value || "0", 10) || 0),
            onlyStatus: (statusSelect.value as any) || "all",
            nameWithAuthor: nameAuthorSwitch.checked,
            richMeta: richMetaSwitch.checked,
            autoSyncMinutes: Math.max(0, parseInt(autoSyncInput.value || "0", 10) || 0),
            diaryNotebook: (diarySelect.value as string) || "",
            cardPath: cardPathInput.value.trim() || "卡片",
            cardNotebook: (cardNbSelect.value as string) || "",
            templates: {
                meta: tplInputs.meta.value,
                chapter: tplInputs.chapter.value,
                highlight: tplInputs.highlight.value,
                thought: tplInputs.thought.value,
                popular: tplInputs.popular.value,
            },
        });
        dialog.destroy();
    });

    footInfo.textContent = "修改模板/过滤后，下一次同步会自动全量重渲染";
}
