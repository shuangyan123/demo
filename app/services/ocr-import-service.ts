import type { ApiSetting, ImportDraft } from "../types/review";
import { decryptSecret } from "./crypto-service";
import { callOpenAiCompatibleApi } from "./api-client";
import { boardInstruction, parseAiJson, parseCsv, parseJson, parsePlainText } from "./import-parser";

// 将图片文件读取成 data URL，供多模态模型识别。
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 读取文本类文件内容。
async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}

// 尝试从 PDF/Word 二进制文本中提取可读字符，无法保证完整解析。
function maybeBinaryTextToReadable(text: string) {
  return text.replace(/[^\u0009\u000a\u000d\u0020-\u007e\u4e00-\u9fa5，。！？；：、“”‘’（）《》【】]/g, " ").replace(/\s{2,}/g, " ").trim();
}

// 根据文件类型选择本地解析、文本提取或 AI 图片 OCR 流程。
export async function parseImportFile(file: File, setting?: ApiSetting): Promise<ImportDraft[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseJson(await readFileAsText(file));
  if (name.endsWith(".csv")) return parseCsv(await readFileAsText(file));
  if (name.endsWith(".txt") || file.type.startsWith("text/")) return parsePlainText(await readFileAsText(file));

  if (file.type.startsWith("image/")) {
    if (!setting) throw new Error("请先配置 API，再进行图片 OCR。");
    return parseImageWithAi(file, setting);
  }

  if (name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx")) {
    const buffer = await file.arrayBuffer();
    const text = maybeBinaryTextToReadable(new TextDecoder("utf-8", { fatal: false }).decode(buffer));
    if (text.length > 80) {
      return parsePlainText(text);
    }
    throw new Error("当前文件没有提取到可用文本，请将粉笔错题导出为截图或图片后上传。");
  }

  throw new Error("暂不支持该文件类型，请上传图片、txt、csv、json、PDF 或 Word。");
}

// 使用 AI 将粘贴文本结构化为可编辑草稿。
export async function parseTextWithAi(rawText: string, setting: ApiSetting): Promise<ImportDraft[]> {
  const apiKey = await decryptSecret(setting.encryptedKey, setting.iv);
  const result = await callOpenAiCompatibleApi({
    apiKey,
    baseUrl: setting.baseUrl,
    model: setting.model,
    messages: [
      {
        role: "system",
        content: `你是错题解析助手。请把用户提供的错题内容解析为 JSON。板块只能从以下六个中选择：${boardInstruction}。如果无法判断板块，用“常识判断”，并尽量补全错因和标签。只返回 JSON，不要解释。格式：{"items":[{"board":"","stem":"","answer":"","explanation":"","reasons":[],"tags":[],"source":"粉笔导入","confidence":0.8}]}`,
      },
      { role: "user", content: rawText },
    ],
  });
  return parseAiJson(result.content);
}

// 使用多模态 AI 识别图片内容并结构化为错题草稿。
export async function parseImageWithAi(file: File, setting: ApiSetting): Promise<ImportDraft[]> {
  const apiKey = await decryptSecret(setting.encryptedKey, setting.iv);
  const dataUrl = await fileToDataUrl(file);
  const result = await callOpenAiCompatibleApi({
    apiKey,
    baseUrl: setting.baseUrl,
    model: setting.model,
    messages: [
      {
        role: "system",
        content: `你是 OCR 和错题结构化助手。识别图片中的错题内容，并解析为 JSON。板块只能从以下六个中选择：${boardInstruction}。如果无法判断板块，用“常识判断”，并尽量补全错因和标签。只返回 JSON，不要解释。格式：{"items":[{"board":"","stem":"","answer":"","explanation":"","reasons":[],"tags":[],"source":"粉笔导入","confidence":0.8}]}`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "请识别并结构化这张错题图片。" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return parseAiJson(result.content);
}

// 使用当前 API 设置做一次轻量连接测试。
export async function testAiConnection(setting: ApiSetting): Promise<string> {
  const apiKey = await decryptSecret(setting.encryptedKey, setting.iv);
  const result = await callOpenAiCompatibleApi({
    apiKey,
    baseUrl: setting.baseUrl,
    model: setting.model,
    messages: [
      { role: "system", content: "只返回 JSON，格式为 {\"ok\":true,\"message\":\"ok\"}。" },
      { role: "user", content: "请做一次连接测试。" },
    ],
  });
  return result.content;
}
