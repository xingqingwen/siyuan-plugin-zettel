/**
 * 简易模板系统：占位符替换（不做完整模板引擎，够用且无依赖）
 * 模板只控制块文本内容；块类型由引擎按条目种类决定
 * （划线=引用块、想法=带底色的段落、章节=H2、热门划线=带底色引用块）。
 */

export interface Templates {
    /** 文档头元信息块 */
    meta: string;
    /** 章节标题 {{chapterTitle}} */
    chapter: string;
    /** 划线 {{markText}} {{createTime}} {{chapterTitle}} {{link}} */
    highlight: string;
    /** 想法 {{content}} {{createTime}} */
    thought: string;
    /** 热门划线 {{markText}} {{totalUsers}} */
    popular: string;
}

export const DEFAULT_TEMPLATES: Templates = {
    meta: "📖 {{title}} · {{author}}\n> 划线 {{hlCount}} 条 · 想法 {{thCount}} 条 · 热门划线 {{popCount}} 条 · 进度 {{progress}}%\n> [在微信读书中打开]({{link}}) · 最近同步 {{syncTime}}",
    chapter: "{{chapterTitle}}",
    highlight: "{{markText}}",
    thought: "✏️ {{content}}",
    popular: "🔥 {{markText}}（{{totalUsers}} 人划线）",
};

/** 占位符替换：{{key}} -> vars[key]；缺失的占位符替换为空串 */
export function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
    return tpl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key) => {
        const v = vars[key];
        return v === undefined || v === null ? "" : String(v);
    });
}

export function mergeTemplates(saved: any): Templates {
    return { ...DEFAULT_TEMPLATES, ...(saved || {}) };
}
