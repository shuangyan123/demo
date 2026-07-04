import { BOARD_OPTIONS, KNOWLEDGE_CATEGORIES, type Board, type KnowledgeCategory, type KnowledgeEntry, type Mistake } from "../types/review";

export type KnowledgeMatch = {
  entry: KnowledgeEntry;
  score: number;
  reasons: string[];
};

export type RelatedMistakeMatch = {
  mistake: Mistake;
  score: number;
  reasons: string[];
};

const boardKnowledgeMap = new Map<Board, KnowledgeCategory>([
  [BOARD_OPTIONS[0], KNOWLEDGE_CATEGORIES[0]],
  [BOARD_OPTIONS[1], KNOWLEDGE_CATEGORIES[1]],
]);

// 统一规范化推荐算法使用的关键词，避免大小写和空白差异影响命中。
function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

// 拼接错题可检索文本，用于本地候选召回和 AI 候选预筛。
function mistakeSearchText(mistake: Mistake): string {
  return [mistake.board, mistake.stem, mistake.answer, mistake.explanation, mistake.source, ...mistake.tags, ...mistake.reasons]
    .join(" ")
    .toLowerCase();
}

// 拼接知识资料可检索文本，用于本地候选召回和 AI 候选预筛。
function knowledgeSearchText(entry: KnowledgeEntry): string {
  return [entry.category, entry.title, entry.summary, entry.content, entry.source, ...entry.tags].join(" ").toLowerCase();
}

// 从错题标签、错因和正文中匹配相关知识库资料，返回带命中原因的推荐列表。
export function findRelatedKnowledgeEntries(mistake: Mistake | null, entries: KnowledgeEntry[], limit = 3): KnowledgeMatch[] {
  if (!mistake) return [];
  const mappedCategory = boardKnowledgeMap.get(mistake.board);
  const mistakeLabels = Array.from(new Set([...mistake.tags, ...mistake.reasons].map(normalizeKeyword).filter(Boolean)));
  const mistakeHaystack = mistakeSearchText(mistake);

  return entries
    .map<KnowledgeMatch>((entry) => {
      const reasons: string[] = [];
      let score = 0;
      const entryHaystack = knowledgeSearchText(entry);
      if (mappedCategory && entry.category === mappedCategory) {
        score += 6;
        reasons.push("同类知识库");
      }
      const labelHits = mistakeLabels.filter((label) => label.length >= 2 && entryHaystack.includes(label));
      if (labelHits.length) {
        score += labelHits.length * 4;
        reasons.push(`标签/错因命中：${labelHits.slice(0, 3).join("、")}`);
      }
      const entryTopics = Array.from(new Set([entry.title, ...entry.tags].map(normalizeKeyword).filter((label) => label.length >= 2)));
      const topicHits = entryTopics.filter((topic) => mistakeHaystack.includes(topic));
      if (topicHits.length) {
        score += topicHits.length * 3;
        reasons.push(`题干/解析命中：${topicHits.slice(0, 2).join("、")}`);
      }
      if (entry.favorite) {
        score += 1;
        reasons.push("已收藏");
      }
      return { entry, score, reasons };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
    .slice(0, limit);
}

// 从知识资料反向匹配错题，帮助用户看到这条资料正在服务哪些薄弱题目。
export function findRelatedMistakesForKnowledge(entry: KnowledgeEntry | null, mistakes: Mistake[], limit = 6): RelatedMistakeMatch[] {
  if (!entry) return [];
  const entryLabels = Array.from(new Set([entry.title, ...entry.tags].map(normalizeKeyword).filter((label) => label.length >= 2)));
  const entryHaystack = knowledgeSearchText(entry);

  return mistakes
    .map<RelatedMistakeMatch>((mistake) => {
      const reasons: string[] = [];
      let score = 0;
      const mappedCategory = boardKnowledgeMap.get(mistake.board);
      const mistakeHaystack = mistakeSearchText(mistake);
      if (mappedCategory === entry.category) {
        score += 6;
        reasons.push("同类板块");
      }
      const labelHits = entryLabels.filter((label) => mistakeHaystack.includes(label));
      if (labelHits.length) {
        score += labelHits.length * 4;
        reasons.push(`资料关键词命中：${labelHits.slice(0, 2).join("、")}`);
      }
      const mistakeLabels = [...mistake.tags, ...mistake.reasons].map(normalizeKeyword).filter((label) => label.length >= 2);
      const mistakeHits = mistakeLabels.filter((label) => entryHaystack.includes(label));
      if (mistakeHits.length) {
        score += mistakeHits.length * 3;
        reasons.push(`错因/标签命中：${mistakeHits.slice(0, 2).join("、")}`);
      }
      return { mistake, score, reasons };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.mistake.mastery - b.mistake.mastery)
    .slice(0, limit);
}
