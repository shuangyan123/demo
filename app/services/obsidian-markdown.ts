import type { KnowledgeCategory, KnowledgeEntry } from "../types/review";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const AI_SECTION_PATTERN = /<!-- review-workspace:ai-start -->[\s\S]*?<!-- review-workspace:ai-end -->/;
const VALID_CATEGORIES = new Set<KnowledgeCategory>(["政治理论", "常识判断", "申论"]);

export type ParsedObsidianNote = {
  reviewId?: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  sourceRefs: string[];
  wikilinks: string[];
};

function stringList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、\n]/) : [];
  return Array.from(new Set(source.map(String).map((item) => item.trim()).filter(Boolean)));
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inferCategory(value: unknown, relativePath: string): KnowledgeCategory {
  const explicit = textValue(value) as KnowledgeCategory;
  if (VALID_CATEGORIES.has(explicit)) return explicit;
  const folder = relativePath.replace(/\\/g, "/").split("/")[0] as KnowledgeCategory;
  return VALID_CATEGORIES.has(folder) ? folder : "常识判断";
}

function inferSummary(body: string): string {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((item) => item.replace(/^#+\s+/gm, "").replace(WIKILINK_PATTERN, "$1").trim())
    .find(Boolean) ?? "";
  return paragraph.replace(/\s+/g, " ").slice(0, 160);
}

/** 解析 Obsidian Properties、正文和 Wikilink；不执行笔记中的任何内容。 */
export async function parseObsidianMarkdown(markdown: string, relativePath: string): Promise<ParsedObsidianNote> {
  const match = markdown.match(FRONTMATTER_PATTERN);
  const yaml = match?.[1] ?? "";
  const body = markdown.slice(match?.[0].length ?? 0).trim();
  const content = body.replace(/\n*## 关联知识\n+[\s\S]*$/m, "").trim();
  const { load } = await import("js-yaml");
  const loaded = yaml ? load(yaml) : {};
  const properties = loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded as Record<string, unknown> : {};
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fileName = relativePath.replace(/\\/g, "/").split("/").at(-1)?.replace(/\.md$/i, "") ?? "未命名知识";
  const links = Array.from(body.matchAll(WIKILINK_PATTERN), (item) => item[1].trim()).filter(Boolean);
  return {
    reviewId: textValue(properties["review-id"]) || undefined,
    category: inferCategory(properties.category, relativePath),
    title: textValue(properties.title) || heading || fileName,
    summary: textValue(properties.summary) || inferSummary(content),
    content,
    tags: stringList(properties.tags),
    sourceRefs: stringList(properties["source-refs"]),
    wikilinks: Array.from(new Set(links)),
  };
}

/** 生成 Obsidian 可读的 YAML Properties，并保留正文里的标准 Wikilink。 */
export async function serializeObsidianEntry(entry: KnowledgeEntry, wikilinks: string[] = [], sourceRefs: string[] = []): Promise<string> {
  const { dump } = await import("js-yaml");
  const properties = dump({
    "review-id": entry.id,
    title: entry.title,
    aliases: [entry.title],
    category: entry.category,
    tags: entry.tags,
    summary: entry.summary,
    "source-refs": sourceRefs,
    "updated-by": "review-workspace",
  }, { lineWidth: 120, noRefs: true, sortKeys: false }).trim();
  const cleanLinks = Array.from(new Set(wikilinks.map((item) => item.trim()).filter(Boolean)));
  const linkSection = cleanLinks.length ? `\n\n## 关联知识\n\n${cleanLinks.map((title) => `- [[${title}]]`).join("\n")}` : "";
  const bodyWithoutGeneratedLinks = entry.content.replace(/\n*## 关联知识\n+[\s\S]*$/m, "").trim();
  return `---\n${properties}\n---\n\n${bodyWithoutGeneratedLinks || `# ${entry.title}`}\n${linkSection}\n`;
}

/** AI 只维护显式边界内的演进内容，避免覆盖用户在 Obsidian 中手写的正文。 */
export function applyAiEvolutionSection(content: string, addition: string): string {
  const section = `<!-- review-workspace:ai-start -->\n## AI 演进\n\n${addition.trim()}\n<!-- review-workspace:ai-end -->`;
  return AI_SECTION_PATTERN.test(content) ? content.replace(AI_SECTION_PATTERN, section) : `${content.trim()}\n\n${section}`.trim();
}

/** 文件名保留中文可读性，同时移除 Windows 与 Vault 路径中的非法字符。 */
export function sanitizeObsidianFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  return (normalized || "未命名知识").slice(0, 80);
}

export function buildObsidianNotePath(entry: Pick<KnowledgeEntry, "id" | "category" | "title">): string {
  return `${entry.category}/${sanitizeObsidianFileName(entry.title)}--${entry.id.slice(0, 8)}.md`;
}

export function buildObsidianUri(vaultName: string, managedRoot: string, relativePath: string): string {
  const file = [managedRoot, relativePath].filter(Boolean).join("/");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

/** 使用 Web Crypto 生成稳定哈希，供三方同步判断内容是否变化。 */
export async function hashObsidianState(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toKnowledgeSemanticState(entry: Pick<KnowledgeEntry, "category" | "title" | "summary" | "content" | "tags">, wikilinks: string[] = []) {
  return {
    category: entry.category,
    title: entry.title.trim(),
    summary: entry.summary.trim(),
    content: entry.content.trim(),
    tags: [...entry.tags].map((item) => item.trim()).filter(Boolean).sort(),
    wikilinks: [...wikilinks].map((item) => item.trim()).filter(Boolean).sort(),
  };
}
