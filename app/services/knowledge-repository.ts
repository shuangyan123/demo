import { reviewDb } from "../db/review-db";
import { relativeDate, toISODate } from "../lib/review-utils";
import type { KnowledgeAttempt, KnowledgeCategory, KnowledgeEntry, KnowledgeImportDraft, KnowledgeStarterTemplate, KnowledgeTrainingSnapshot } from "../types/domains/knowledge.ts";
import type { Mistake, ReviewResult } from "../types/domains/review.ts";
import { obsidianKnowledgeRepository } from "./obsidian-knowledge-repository.ts";

type KnowledgeInput = Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt" | "mastery" | "nextReviewAt" | "lastReviewedAt" | "reviewCount"> &
  Partial<Pick<KnowledgeEntry, "mastery" | "nextReviewAt" | "lastReviewedAt" | "reviewCount">>;

type LegacyKnowledgeEntry = Omit<KnowledgeEntry, "mastery" | "nextReviewAt" | "reviewCount"> &
  Partial<Pick<KnowledgeEntry, "mastery" | "nextReviewAt" | "reviewCount">>;

const boardToKnowledgeCategory: Partial<Record<Mistake["board"], KnowledgeCategory>> = {
  政治理论: "政治理论",
  常识判断: "常识判断",
};

const starterTemplates: KnowledgeStarterTemplate[] = [
  {
    category: "政治理论",
    title: "理论概念卡：核心概念、关键词、易混表述",
    summary: "用于整理一个理论概念的定义、关键词、常见设问和易混点。",
    content: "概念定义：\n关键词：\n常见设问：\n易混表述：\n对应题型：\n复盘提醒：遇到相近表述时先判断主体、目标、路径和落脚点。",
    tags: ["理论概念", "关键词", "易混点"],
    source: "知识库模板",
    mastery: 2,
  },
  {
    category: "政治理论",
    title: "时政材料卡：会议、文件、表述和对应考点",
    summary: "用于把时政材料拆成时间、主体、核心表述和可能命题角度。",
    content: "材料来源：\n时间 / 场景：\n核心表述：\n关键词：\n可能命题角度：\n容易误判的位置：",
    tags: ["时政", "会议文件", "材料整理"],
    source: "知识库模板",
    mastery: 2,
  },
  {
    category: "常识判断",
    title: "常识概念卡：定义、适用条件、例外",
    summary: "用于整理法律、科技、人文、地理等常识点的判断边界。",
    content: "知识点：\n定义：\n适用条件：\n常见例外：\n典型例子：\n易错选项特征：",
    tags: ["常识", "概念边界", "易错选项"],
    source: "知识库模板",
    mastery: 2,
  },
  {
    category: "常识判断",
    title: "高频专题卡：法律 / 科技 / 人文 / 地理归纳",
    summary: "用于按专题归纳多个小知识点，并保留错题关联入口。",
    content: "专题名称：\n核心知识点：\n相近概念对比：\n常见题干信号：\n关联错题：\n补充来源：",
    tags: ["专题归纳", "常识判断", "错题关联"],
    source: "知识库模板",
    mastery: 2,
  },
  {
    category: "申论",
    title: "申论主题卡：问题、原因、对策、表达",
    summary: "用于沉淀一个申论主题的材料语言、分析框架和可复用表达。",
    content: "主题：\n问题表现：\n原因分析：\n对策方向：\n规范表达：\n可迁移案例：\n适用题型：",
    tags: ["申论主题", "问题原因对策", "表达积累"],
    source: "知识库模板",
    mastery: 2,
  },
  {
    category: "申论",
    title: "申论素材卡：案例、金句、落点和使用限制",
    summary: "用于记录可迁移素材，避免只背句子不清楚适用边界。",
    content: "素材名称：\n背景：\n可用表达：\n适用主题：\n不适用场景：\n落点：\n改写方式：",
    tags: ["申论素材", "案例", "表达"],
    source: "知识库模板",
    mastery: 2,
  },
];

// 统一生成知识库条目时间戳，保持本地表记录和错题表使用同一种日期格式。
function todayStamp(today: Date): string {
  return toISODate(today);
}

// 从正文生成短摘要，避免知识库列表在没有用户手写摘要时显得空白。
function summaryFromContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 120);
}

// 清理编号、Markdown 标题符号和多余空白，用于把导入块的首行变成可读标题。
function cleanTitleLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(\d+[.、．)]\s*|第[一二三四五六七八九十\d]+[条点]\s*)/, "")
    .trim();
}

// 根据空行、编号行或标题行把资料文本切成多个待导入块，兼容常见笔记格式。
function splitKnowledgeBlocks(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const blankBlocks = normalized.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (blankBlocks.length > 1) return blankBlocks;

  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    const startsNewBlock = current.length > 0 && (/^#{1,6}\s+\S+/.test(trimmed) || /^(\d+[.、．)]\s+|第[一二三四五六七八九十\d]+[条点]\s*)/.test(trimmed));
    if (startsNewBlock) {
      blocks.push(current.join("\n").trim());
      current = [];
    }
    if (trimmed || current.length) current.push(line);
  }
  if (current.length) blocks.push(current.join("\n").trim());
  return blocks.filter(Boolean);
}

// 读取资料块里的中文字段标签，支持“标题：”“摘要：”“标签：”等轻量结构化输入。
function fieldsFromBlock(block: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of block.split(/\n/)) {
    const match = line.match(/^(标题|摘要|来源|标签|正文|内容)[:：]\s*(.*)$/);
    if (match) data[match[1]] = match[2].trim();
  }
  return data;
}

// 把逗号、顿号或换行分隔的标签文本整理成数组。
function listFromText(value: string): string[] {
  return value
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 把待导入草稿转换为正式知识库条目，确认入库时复用同一套默认训练字段。
function entryFromDraft(draft: KnowledgeImportDraft, today: Date): KnowledgeEntry {
  const now = todayStamp(today);
  return {
    category: draft.category,
    title: draft.title,
    summary: draft.summary || summaryFromContent(draft.content),
    content: draft.content,
    tags: draft.tags,
    source: draft.source || "资料导入",
    favorite: false,
    mastery: draft.mastery || 2,
    nextReviewAt: now,
    reviewCount: 0,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
}

// 把知识库搭建模板转换为导入草稿，确保模板先进入预览区而不是直接写入本地库。
function draftFromStarterTemplate(template: KnowledgeStarterTemplate): KnowledgeImportDraft {
  return {
    id: crypto.randomUUID(),
    selected: true,
    category: template.category,
    title: template.title,
    summary: template.summary,
    content: template.content,
    tags: template.tags,
    source: template.source,
    mastery: template.mastery,
  };
}

// 根据错题所属板块推断知识库分类；无法明确归类的技能题先进入常识判断，用户可在草稿区改成更合适分类。
function inferCategoryFromMistake(mistake: Mistake): KnowledgeCategory {
  return boardToKnowledgeCategory[mistake.board] ?? "常识判断";
}

// 把错题正文裁成可读标题，避免导入草稿列表出现过长题干。
function titleFromMistake(mistake: Mistake): string {
  return `${mistake.board}错题：${mistake.stem.replace(/\s+/g, " ").trim()}`.slice(0, 48);
}

// 从错题生成知识库草稿正文，保留题干、答案、解析和错因，便于后续整理成稳定知识点。
function contentFromMistake(mistake: Mistake): string {
  return [
    `板块：${mistake.board}`,
    `题干：${mistake.stem}`,
    `答案：${mistake.answer}`,
    `解析：${mistake.explanation}`,
    `错因：${mistake.reasons.join("、") || "待补充"}`,
    `标签：${mistake.tags.join("、") || "待补充"}`,
    `复盘提醒：把本题中可迁移的概念、公式、题干信号或表达框架整理到这里。`,
  ].join("\n");
}

// 根据训练结果计算知识资料的新掌握度和下次训练日期，保持和错题复盘相近的节奏。
function nextKnowledgeState(entry: KnowledgeEntry, result: ReviewResult, today: Date): Pick<KnowledgeEntry, "mastery" | "nextReviewAt" | "lastReviewedAt" | "reviewCount" | "updatedAt"> {
  const delta = result === "correct" ? 1 : result === "wrong" ? -1 : 0;
  const mastery = Math.max(1, Math.min(5, entry.mastery + delta));
  const interval = result === "correct" ? Math.max(2, mastery * 2) : result === "uncertain" ? 1 : 0;
  const reviewedAt = todayStamp(today);

  return {
    mastery,
    nextReviewAt: relativeDate(today, interval),
    lastReviewedAt: reviewedAt,
    reviewCount: entry.reviewCount + 1,
    updatedAt: reviewedAt,
  };
}

export const knowledgeRepository = {
  // 根据分类生成可编辑知识库模板草稿；不直接入库，避免产生用户未确认的默认资料。
  createStarterDrafts(category?: KnowledgeCategory): KnowledgeImportDraft[] {
    return starterTemplates
      .filter((template) => !category || template.category === category)
      .map((template) => draftFromStarterTemplate(template));
  },

  // 从单道错题生成知识库资料草稿；仅生成前端草稿，不直接写入 IndexedDB。
  createDraftFromMistake(mistake: Mistake): KnowledgeImportDraft {
    const tags = Array.from(new Set([mistake.board, ...mistake.tags, ...mistake.reasons, "错题沉淀"].filter(Boolean)));
    return {
      id: crypto.randomUUID(),
      selected: true,
      category: inferCategoryFromMistake(mistake),
      title: titleFromMistake(mistake),
      summary: `从${mistake.board}错题整理出的知识卡，重点处理：${mistake.reasons.join("、") || "待补充错因"}。`,
      content: contentFromMistake(mistake),
      tags,
      source: `错题沉淀 / ${mistake.source || "本地题库"}`,
      mastery: Math.max(1, Math.min(3, mistake.mastery)),
    };
  },

  // 补齐历史知识资料缺失的训练字段，避免旧 IndexedDB 数据进入训练页时报错。
  async ensureTrainingFields(today: Date): Promise<void> {
    const entries = (await reviewDb.knowledgeEntries.toArray()) as LegacyKnowledgeEntry[];
    const patches = entries
      .filter((entry) => typeof entry.mastery !== "number" || !entry.nextReviewAt || typeof entry.reviewCount !== "number")
      .map((entry) => ({
        ...entry,
        mastery: typeof entry.mastery === "number" ? entry.mastery : 2,
        nextReviewAt: entry.nextReviewAt || entry.createdAt || todayStamp(today),
        reviewCount: typeof entry.reviewCount === "number" ? entry.reviewCount : 0,
        updatedAt: entry.updatedAt || todayStamp(today),
      }));

    if (patches.length) {
      await reviewDb.knowledgeEntries.bulkPut(patches);
    }
  },

  // 读取全部知识库条目；页面侧负责搜索和筛选，便于保持交互即时响应。
  async list(today?: Date): Promise<KnowledgeEntry[]> {
    if (today) {
      await this.ensureTrainingFields(today);
    }
    return reviewDb.knowledgeEntries.orderBy("updatedAt").reverse().toArray();
  },

  // 读取知识训练所需的完整快照，包含今日队列、薄弱资料和历史训练记录。
  async loadTrainingSnapshot(today: Date): Promise<KnowledgeTrainingSnapshot> {
    await this.ensureTrainingFields(today);
    const [entries, attempts] = await Promise.all([
      reviewDb.knowledgeEntries.orderBy("updatedAt").reverse().toArray(),
      reviewDb.knowledgeAttempts.orderBy("reviewedAt").reverse().toArray(),
    ]);
    const todayText = todayStamp(today);
    const dueEntries = entries.filter((entry) => entry.nextReviewAt <= todayText).sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt));
    const lowEntries = entries.filter((entry) => entry.mastery <= 2);

    return { entries, attempts, dueEntries, lowEntries };
  },

  // 新增一条知识库资料，调用方负责传入合法分类和已拆分标签。
  async create(input: KnowledgeInput, today: Date): Promise<KnowledgeEntry> {
    const now = todayStamp(today);
    const entry: KnowledgeEntry = {
      ...input,
      id: crypto.randomUUID(),
      mastery: input.mastery ?? 2,
      nextReviewAt: input.nextReviewAt ?? now,
      lastReviewedAt: input.lastReviewedAt,
      reviewCount: input.reviewCount ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.knowledgeEntries.add(entry);
    return entry;
  },

  // 更新知识库条目正文、标签、来源或分类，并同步更新时间。
  async update(id: string, patch: Partial<KnowledgeInput>, today: Date): Promise<void> {
    await reviewDb.knowledgeEntries.update(id, {
      ...patch,
      updatedAt: todayStamp(today),
    });
    await obsidianKnowledgeRepository.markLocalChanged(id, today);
  },

  // 切换收藏状态；收藏用于筛选高频资料和常看知识点。
  async toggleFavorite(entry: KnowledgeEntry, today: Date): Promise<void> {
    await reviewDb.knowledgeEntries.update(entry.id, {
      favorite: !entry.favorite,
      updatedAt: todayStamp(today),
    });
  },

  // 记录一轮知识训练，原子更新资料掌握度、下次训练日期和训练历史。
  async recordReview(entry: KnowledgeEntry, result: ReviewResult, today: Date): Promise<void> {
    const nextState = nextKnowledgeState(entry, result, today);
    const attempt: KnowledgeAttempt = {
      id: crypto.randomUUID(),
      knowledgeId: entry.id,
      result,
      confidence: nextState.mastery,
      reviewedAt: todayStamp(today),
    };

    await reviewDb.transaction("rw", reviewDb.knowledgeEntries, reviewDb.knowledgeAttempts, async () => {
      await reviewDb.knowledgeEntries.update(entry.id, nextState);
      await reviewDb.knowledgeAttempts.add(attempt);
    });
  },

  // 删除单条知识库资料，并清理错题关联、面试关联和辅导关联；不会影响错题、复盘记录或导入任务。
  async remove(id: string): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.knowledgeEntries, reviewDb.knowledgeAttempts, reviewDb.knowledgeMistakeLinks, reviewDb.interviewLinks, reviewDb.tutoringLinks], async () => {
      await reviewDb.knowledgeEntries.delete(id);
      await reviewDb.knowledgeAttempts.where("knowledgeId").equals(id).delete();
      await reviewDb.knowledgeMistakeLinks.where("knowledgeId").equals(id).delete();
      await reviewDb.interviewLinks.where("[targetType+targetId]").equals(["knowledge", id]).delete();
      await reviewDb.tutoringLinks.where("[targetType+targetId]").equals(["knowledge", id]).delete();
    });
  },

  // 批量删除知识资料，并同步清理训练记录、错题关联、面试关联和辅导关联，保持知识库没有悬空链接。
  async removeMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await reviewDb.transaction("rw", [reviewDb.knowledgeEntries, reviewDb.knowledgeAttempts, reviewDb.knowledgeMistakeLinks, reviewDb.interviewLinks, reviewDb.tutoringLinks], async () => {
      await reviewDb.knowledgeEntries.bulkDelete(ids);
      await reviewDb.knowledgeAttempts.where("knowledgeId").anyOf(ids).delete();
      await reviewDb.knowledgeMistakeLinks.where("knowledgeId").anyOf(ids).delete();
      await reviewDb.interviewLinks.where("[targetType+targetId]").anyOf(ids.map((id) => ["knowledge", id] as const)).delete();
      await reviewDb.tutoringLinks.where("[targetType+targetId]").anyOf(ids.map((id) => ["knowledge", id] as const)).delete();
    });
  },

  // 把粘贴文本按空行切成多个知识条目，作为导入页的轻量本地整理入口。
  async importText(input: Omit<KnowledgeInput, "title" | "summary" | "content" | "favorite"> & { rawText: string }, today: Date): Promise<KnowledgeEntry[]> {
    const drafts = this.parseImportDrafts(input);
    const entries = drafts.map((draft) => entryFromDraft(draft, today));
    if (entries.length) {
      await reviewDb.knowledgeEntries.bulkAdd(entries);
    }
    return entries;
  },

  // 只把资料文本解析成可编辑草稿，不直接写入 IndexedDB，供导入页确认前预览。
  parseImportDrafts(input: Omit<KnowledgeInput, "title" | "summary" | "content" | "favorite"> & { rawText: string }): KnowledgeImportDraft[] {
    return splitKnowledgeBlocks(input.rawText).map((block) => {
      const fields = fieldsFromBlock(block);
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      const firstLine = cleanTitleLine(fields["标题"] || lines[0] || "未命名知识点");
      const content = fields["正文"] || fields["内容"] || block;
      const tags = Array.from(new Set([...input.tags, ...listFromText(fields["标签"] || "")]));
      return {
        id: crypto.randomUUID(),
        selected: true,
        category: input.category,
        title: firstLine.slice(0, 48),
        summary: fields["摘要"] || summaryFromContent(content),
        content,
        tags,
        source: fields["来源"] || input.source || "资料导入",
        mastery: input.mastery ?? 2,
      };
    });
  },

  // 把导入页勾选后的资料草稿批量写入知识库，不改变错题、复盘或 API 设置。
  async addDrafts(drafts: KnowledgeImportDraft[], today: Date): Promise<KnowledgeEntry[]> {
    const entries = drafts.map((draft) => entryFromDraft(draft, today));
    if (entries.length) {
      await reviewDb.knowledgeEntries.bulkAdd(entries);
    }
    return entries;
  },
};
