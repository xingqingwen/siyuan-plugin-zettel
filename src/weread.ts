/**
 * 微信读书 Agent Gateway 客户端
 *
 * 统一入口: POST https://i.weread.qq.com/api/agent/gateway
 * 鉴权: Authorization: Bearer wrk-xxxx（用户在 weread.qq.com/r/weread-skills 扫码生成）
 *
 * 规则（来自官方 Skill 文档）:
 * - 业务参数必须与 api_name / skill_version 平铺在同一层，禁止包在 params 里
 * - /user/notebooks 用 lastSort 游标分页（取上页最后一条的 sort）
 * - /review/list/mine 用 synckey 游标分页
 * - 回包出现 upgrade_info 必须提示升级
 */

export const GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
export const SKILL_VERSION = "1.0.5";

export interface WereadBookMeta {
    title: string;
    author?: string;
    cover?: string;
    [k: string]: unknown;
}

export interface NotebookBook {
    bookId: string;
    book: WereadBookMeta;
    /** 想法/点评数（含划线想法、书评想法、书摘等个人内容） */
    reviewCount: number;
    /** 划线/高亮原文条数 */
    noteCount: number;
    /** 书签数（不可导出内容，仅统计） */
    bookmarkCount: number;
    readingProgress?: number;
    markedStatus?: number;
    /** 游标排序值（最近笔记时间） */
    sort: number;
}

export interface Highlight {
    bookmarkId: string;
    bookId: string;
    chapterUid: number;
    markText: string;
    createTime: number;
    type: number;
    range: string;
    colorStyle?: number;
}

export interface ChapterInfo {
    bookId?: string;
    chapterUid: number;
    chapterIdx: number;
    title: string;
}

export interface PopularHighlight {
    bookmarkId: string;
    chapterUid: number;
    range: string;
    markText: string;
    totalCount: number;
}

export interface ReviewItem {
    review: {
        reviewId: string;
        content: string;
        abstract?: string;
        createTime: number;
        star?: number;
        chapterName?: string;
        chapterUid?: number;
        range?: string;
        isFinish?: number;
        [k: string]: unknown;
    };
}

export class WereadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WereadError";
    }
}

/** 经思源内核 /api/fetch 代理发送请求（规避浏览器 CORS 限制） */
async function proxyPost(url: string, headers: Record<string, string>, body: string): Promise<string> {
    const resp = await fetch("/api/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: "POST", headers, body }),
    });
    if (!resp.ok) {
        throw new WereadError(`内核代理请求失败: HTTP ${resp.status}`);
    }
    return await resp.text();
}

export class WereadClient {
    constructor(private apiKey: string) {}

    /** 网关调用：先直连，被 CORS 拦截时自动降级走内核代理 */
    async call<T = any>(apiName: string, params: Record<string, unknown> = {}): Promise<T> {
        const body = JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params });
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
        let text: string;
        try {
            const resp = await fetch(GATEWAY_URL, { method: "POST", headers, body });
            text = await resp.text();
        } catch (e) {
            // 直连失败（通常是 CORS），走思源内核代理
            text = await proxyPost(GATEWAY_URL, headers, body);
        }
        return this.parse<T>(apiName, text);
    }

    private parse<T>(apiName: string, text: string): T {
        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            throw new WereadError(`${apiName} 返回非 JSON: ${text.slice(0, 200)}`);
        }
        if (json.upgrade_info) {
            const msg = json.upgrade_info?.message || "微信读书 Skill 有版本更新";
            throw new WereadError(`需要升级: ${msg}`);
        }
        if (json.errcode && json.errcode !== 0) {
            throw new WereadError(`${apiName} 出错 (${json.errcode}): ${json.errmsg || json.errmsg_zh || "未知错误"}`);
        }
        return (json.data !== undefined ? json.data : json) as T;
    }

    /** 拉取所有有笔记的书（游标分页到 hasMore=0） */
    async listNotebooks(): Promise<NotebookBook[]> {
        const out: NotebookBook[] = [];
        let lastSort: number | undefined = undefined;
        for (let i = 0; i < 200; i++) {
            const params: Record<string, unknown> = { count: 50 };
            if (lastSort !== undefined) {
                params.lastSort = lastSort;
            }
            const data = await this.call<any>("/user/notebooks", params);
            const books: NotebookBook[] = data?.books || [];
            out.push(...books);
            if (data?.hasMore === 1 && books.length > 0) {
                lastSort = books[books.length - 1].sort;
            } else {
                break;
            }
        }
        return out;
    }

    /** 单本书的划线列表（已过滤书签） */
    async getHighlights(bookId: string): Promise<{ updated: Highlight[]; chapters: ChapterInfo[]; book?: WereadBookMeta }> {
        const data = await this.call<any>("/book/bookmarklist", { bookId });
        return {
            updated: data?.updated || [],
            chapters: data?.chapters || [],
            book: data?.book,
        };
    }

    /** 全书热门划线（最多 20 条，含人数） */
    async getPopularHighlights(bookId: string): Promise<{ items: PopularHighlight[]; chapters: ChapterInfo[] }> {
        const data = await this.call<any>("/book/bestbookmarks", { bookId, chapterUid: 0 });
        return {
            items: data?.items || [],
            chapters: data?.chapters || [],
        };
    }

    /** 书籍详细信息 */
    async getBookInfo(bookId: string): Promise<any> {
        return await this.call<any>("/book/info", { bookId });
    }

    /** 阅读统计（mode: weekly/monthly/annually/overall） */
    async getReadData(mode: string, baseTime = 0): Promise<any> {
        return await this.call<any>("/readdata/detail", { mode, baseTime });
    }

    /** 单本书的个人想法/点评（synckey 游标分页） */
    async listMyReviews(bookId: string): Promise<ReviewItem[]> {
        const out: ReviewItem[] = [];
        let synckey = 0;
        for (let i = 0; i < 200; i++) {
            const data = await this.call<any>("/review/list/mine", { bookid: bookId, synckey, count: 50 });
            const reviews: ReviewItem[] = data?.reviews || [];
            out.push(...reviews);
            if (data?.hasMore === 1 && data?.synckey && data.synckey !== synckey) {
                synckey = data.synckey;
            } else {
                break;
            }
        }
        return out;
    }
}

/** 微信读书深度链接：跳转到书的上次阅读位置 */
export function bookDeepLink(bookId: string): string {
    return `weread://reading?bId=${bookId}`;
}
