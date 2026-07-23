import type { ImportDraft, ImportProviderParseResult, ImportProviderPlugin } from "../types/domains/import.ts";

function diagnosticsForDrafts(drafts: ImportDraft[]): ImportProviderParseResult["diagnostics"] {
  const diagnostics: ImportProviderParseResult["diagnostics"] = [
    { tone: "info", message: `粉笔导入插件解析出 ${drafts.length} 条草稿。` },
  ];
  const needsReview = drafts.filter((draft) => draft.needsReview || draft.issues?.length).length;
  if (needsReview) diagnostics.push({ tone: "warning", message: `${needsReview} 条草稿需要人工复核板块、答案或置信度。` });
  if (!drafts.length) diagnostics.push({ tone: "warning", message: "没有识别到有效错题，请检查文本格式或截图清晰度。" });
  return diagnostics;
}

/** 粉笔导入插件只复用本地解析和默认 AI 连接，不保存上传原文到插件配置。 */
export const fenbiImportProviderPlugin: ImportProviderPlugin = {
  id: "fenbi",
  label: "粉笔导入",
  description: "解析粉笔错题文本、截图、PDF 和 docx，生成可确认的错题草稿。",
  category: "civil-service",
  privacyNote: "文本本地解析优先；AI 解析只使用默认文本/多模态连接，不把原文写入插件配置。",
  supportedInputs: ["text", "file", "image", "pdf", "docx"],
  requiredConnections: ["text", "vision"],
  diagnosticCapabilities: ["重复题提示", "低置信度提示", "缺答案提示", "板块不确定提示", "OCR/解析失败重试"],
  retryPolicy: "safe-reparse",
  draftSink: "import-drafts",
  aiCapabilities: ["text-parse", "vision-ocr"],
  async parseText({ rawText, mode, textConnection }) {
    if (mode === "ai" && !textConnection) throw new Error("请先在 AI 连接中配置默认文本连接，再使用粉笔 AI 文本解析。");
    const drafts = mode === "ai"
      ? await (await import("./fenbi-import-service.ts")).parseFenbiTextWithAi(rawText, textConnection!)
      : (await import("./fenbi-parser.ts")).parseFenbiTextByName(rawText, "paste.txt");
    return {
      providerId: "fenbi",
      sourceLabel: "粉笔导入",
      mode,
      drafts,
      diagnostics: diagnosticsForDrafts(drafts),
    };
  },
  async parseFile({ file, visionConnection }) {
    const drafts = await (await import("./fenbi-import-service.ts")).parseFenbiFile(file, visionConnection);
    return {
      providerId: "fenbi",
      sourceLabel: "粉笔导入",
      mode: "file",
      drafts,
      diagnostics: diagnosticsForDrafts(drafts),
    };
  },
};

export const importProviderPlugins: ImportProviderPlugin[] = [fenbiImportProviderPlugin];

export function getImportProviderPlugin(id: ImportProviderPlugin["id"]): ImportProviderPlugin {
  return importProviderPlugins.find((plugin) => plugin.id === id) ?? fenbiImportProviderPlugin;
}
