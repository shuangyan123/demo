import type { ApiConnectionProfile, ImportDraft } from "../types/review";
import { generateWithConnection } from "./ai-connection-client";
import { buildFenbiSystemPrompt, parseFenbiAiJson, parseFenbiTextByName } from "./fenbi-parser";

type PdfJsModule = {
  getDocument: (input: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        getViewport: (input: { scale: number }) => { width: number; height: number };
        render: (input: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
      }>;
    }>;
  };
};

// 将浏览器文件读成 data URL，供默认多模态连接识别图片。
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 使用默认多模态连接识别图片或 PDF 页截图，并要求模型返回粉笔错题 JSON。
async function parseImageUrlWithAi(imageUrl: string, connection: ApiConnectionProfile): Promise<ImportDraft[]> {
  const result = await generateWithConnection(connection, "vision", {
    temperature: 0.1,
    maxOutputTokens: 4000,
    messages: [
      { role: "system", content: buildFenbiSystemPrompt() },
      {
        role: "user",
        content: [
          { type: "text", text: "请识别并结构化这份粉笔错题截图。" },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return parseFenbiAiJson(result.content);
}

// 对粘贴文本或文件文本调用 AI 结构化解析，保留粉笔字段和置信度。
export async function parseFenbiTextWithAi(rawText: string, connection: ApiConnectionProfile): Promise<ImportDraft[]> {
  const result = await generateWithConnection(connection, "text", {
    temperature: 0.1,
    maxOutputTokens: 4000,
    messages: [
      { role: "system", content: buildFenbiSystemPrompt() },
      { role: "user", content: rawText },
    ],
  });
  return parseFenbiAiJson(result.content);
}

// 图片导入始终走默认多模态连接，没有对应默认值时由调用方展示可读提示。
export async function parseFenbiImageFile(file: File, connection: ApiConnectionProfile): Promise<ImportDraft[]> {
  return parseImageUrlWithAi(await fileToDataUrl(file), connection);
}

// 从 PDF 文本层提取内容；没有文本层时返回空字符串，交给截图 OCR 兜底。
async function extractPdfText(file: File): Promise<{ text: string; pdf?: Awaited<ReturnType<PdfJsModule["getDocument"]>["promise"]> }> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map((item) => item.str ?? "").join(" "));
  }
  return { text: pages.join("\n\n").replace(/\s{2,}/g, " ").trim(), pdf };
}

// 将无文本层 PDF 的前几页渲染为图片后交给 OCR，避免直接提示用户重新截图。
async function parsePdfPagesWithOcr(pdf: Awaited<ReturnType<PdfJsModule["getDocument"]>["promise"]>, connection: ApiConnectionProfile): Promise<ImportDraft[]> {
  const drafts: ImportDraft[] = [];
  const pageCount = Math.min(pdf.numPages, 6);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvasContext: context, viewport }).promise;
    drafts.push(...(await parseImageUrlWithAi(canvas.toDataURL("image/png"), connection)));
  }
  return drafts;
}

// 解析 PDF：先读文本层，失败或无文本时再按页渲染截图 OCR。
export async function parseFenbiPdfFile(file: File, visionConnection?: ApiConnectionProfile): Promise<ImportDraft[]> {
  const { text, pdf } = await extractPdfText(file);
  if (text.length > 80) return parseFenbiTextByName(text, file.name);
  if (!visionConnection || !pdf) throw new Error("PDF 没有可提取文本，请先配置默认多模态连接后使用 OCR，或上传带文本层的文件。");
  return parsePdfPagesWithOcr(pdf, visionConnection);
}

// 解析 docx 文档正文，旧 doc 二进制格式不在第一版自动解析范围内。
export async function parseFenbiDocxFile(file: File): Promise<ImportDraft[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  if (!result.value.trim()) throw new Error("Word 文档没有提取到可用文本，请转为截图或 PDF 后上传。");
  return parseFenbiTextByName(result.value, file.name);
}

// 根据文件类型选择粉笔导入流程；返回草稿仍需进入批次仓储持久化。
export async function parseFenbiFile(file: File, visionConnection?: ApiConnectionProfile): Promise<ImportDraft[]> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) {
    if (!visionConnection) throw new Error("请先配置默认多模态连接，再进行粉笔截图 OCR。");
    return parseFenbiImageFile(file, visionConnection);
  }
  if (name.endsWith(".pdf")) return parseFenbiPdfFile(file, visionConnection);
  if (name.endsWith(".docx")) return parseFenbiDocxFile(file);
  if (name.endsWith(".doc")) throw new Error("旧版 .doc 暂不支持自动解析，请转为截图、PDF 或 docx 后上传。");
  if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".json") || file.type.startsWith("text/")) {
    return parseFenbiTextByName(await file.text(), file.name);
  }
  throw new Error("暂不支持该文件类型，请上传图片、PDF、docx、txt、csv 或 json。");
}
