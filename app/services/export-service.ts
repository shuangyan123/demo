import type { ExportFormat, ExportScope, Mistake } from "../types/domains/review.ts";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";

export type ExportFile = {
  content: string;
  filename: string;
  mimeType: string;
};

// 生成适合文件名使用的时间戳，避免不同导出互相覆盖。
function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// 按 CSV 规则转义单元格，兼容中文、换行、英文逗号和双引号。
function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("、") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

// 把二维数组转换为 UTF-8 CSV 文本；前置 BOM 让 Excel 打开中文时更稳。
function toCsv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

// 把错题整理为 Markdown，适合直接进入复盘文档或笔记软件阅读。
function mistakesToMarkdown(items: Mistake[], title: string): string {
  const body = items.map((item, index) =>
    [
      `## ${index + 1}. ${item.board}`,
      "",
      `- 来源：${item.source}`,
      `- 错因：${item.reasons.join("、") || "待归因"}`,
      `- 标签：${item.tags.join("、") || "无"}`,
      `- 掌握度：${item.mastery}/5`,
      `- 下次复盘：${item.nextReviewAt}`,
      "",
      `**题干**`,
      "",
      item.stem,
      "",
      `**答案**：${item.answer}`,
      "",
      `**解析**`,
      "",
      item.explanation,
    ].join("\n"),
  );
  return [`# ${title}`, "", ...body].join("\n\n");
}

// 把知识资料整理为 Markdown，保留分类、标签、训练计划和正文。
function knowledgeToMarkdown(items: KnowledgeEntry[], title: string): string {
  const body = items.map((item, index) =>
    [
      `## ${index + 1}. ${item.title}`,
      "",
      `- 分类：${item.category}`,
      `- 来源：${item.source}`,
      `- 标签：${item.tags.join("、") || "无"}`,
      `- 收藏：${item.favorite ? "是" : "否"}`,
      `- 掌握度：${item.mastery}/5`,
      `- 下次训练：${item.nextReviewAt}`,
      "",
      item.summary ? `> ${item.summary}` : "",
      "",
      item.content,
    ].join("\n"),
  );
  return [`# ${title}`, "", ...body].join("\n\n");
}

// 根据格式导出错题；scope 只写入文件名，实际导出范围由调用方传入 items 控制。
export function exportMistakes(items: Mistake[], format: ExportFormat, scope: ExportScope): ExportFile {
  const base = `错题-${scope === "selected" ? "已选" : "筛选结果"}-${fileStamp()}`;
  if (format === "json") {
    return {
      filename: `${base}.json`,
      mimeType: "application/json;charset=utf-8",
      content: JSON.stringify({ exportedAt: new Date().toISOString(), type: "mistakes", count: items.length, items }, null, 2),
    };
  }
  if (format === "csv") {
    return {
      filename: `${base}.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: toCsv([
        ["板块", "题干", "答案", "解析", "来源", "错因", "标签", "掌握度", "下次复盘", "创建时间", "更新时间"],
        ...items.map((item) => [item.board, item.stem, item.answer, item.explanation, item.source, item.reasons, item.tags, item.mastery, item.nextReviewAt, item.createdAt, item.updatedAt]),
      ]),
    };
  }
  return {
    filename: `${base}.md`,
    mimeType: "text/markdown;charset=utf-8",
    content: mistakesToMarkdown(items, scope === "selected" ? "已选错题" : "错题筛选结果"),
  };
}

// 根据格式导出知识库资料；不包含 API Key、外观设置或导入任务。
export function exportKnowledgeEntries(items: KnowledgeEntry[], format: ExportFormat, scope: ExportScope): ExportFile {
  const base = `知识库-${scope === "selected" ? "已选" : "筛选结果"}-${fileStamp()}`;
  if (format === "json") {
    return {
      filename: `${base}.json`,
      mimeType: "application/json;charset=utf-8",
      content: JSON.stringify({ exportedAt: new Date().toISOString(), type: "knowledgeEntries", count: items.length, items }, null, 2),
    };
  }
  if (format === "csv") {
    return {
      filename: `${base}.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: toCsv([
        ["分类", "标题", "摘要", "正文", "来源", "标签", "收藏", "掌握度", "下次训练", "训练次数", "创建时间", "更新时间"],
        ...items.map((item) => [item.category, item.title, item.summary, item.content, item.source, item.tags, item.favorite ? "是" : "否", item.mastery, item.nextReviewAt, item.reviewCount, item.createdAt, item.updatedAt]),
      ]),
    };
  }
  return {
    filename: `${base}.md`,
    mimeType: "text/markdown;charset=utf-8",
    content: knowledgeToMarkdown(items, scope === "selected" ? "已选知识资料" : "知识库筛选结果"),
  };
}

// 生成完整工作台备份，方便用户在未来做手动归档或迁移。
export function exportWorkspaceBundle(input: { knowledgeEntries: KnowledgeEntry[]; mistakes: Mistake[] }): ExportFile {
  return {
    filename: `错题复盘-工作台备份-${fileStamp()}.json`,
    mimeType: "application/json;charset=utf-8",
    content: JSON.stringify({ exportedAt: new Date().toISOString(), type: "workspaceBundle", ...input }, null, 2),
  };
}

// 在浏览器中触发文件下载；调用方只传入已生成的文件内容，不需要接触 Blob 细节。
export function downloadExportFile(file: ExportFile): void {
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
