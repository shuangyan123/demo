import { reviewDb } from "../db/review-db.ts";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { ObsidianGraphNode, ObsidianGraphSnapshot } from "../types/domains/obsidian.ts";
import {
  hashObsidianState,
  parseObsidianMarkdown,
  toKnowledgeSemanticState,
} from "./obsidian-markdown.ts";

export function nowStamp(today = new Date()): string {
  return today.toISOString();
}

/** 知识训练日期沿用知识库的 YYYY-MM-DD 契约。 */
export function dayStamp(today = new Date()): string {
  return today.toISOString().slice(0, 10);
}

export function normalizeKnowledgeDay(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : dayStamp(parsed);
}

export function withoutSelfLinks(links: string[], title: string): string[] {
  return links.filter((link) => link.trim() && link.trim() !== title.trim());
}

export function noteTitleFromPath(path: string): string {
  return path.split("/").at(-1)?.replace(/--[a-f0-9-]{8}\.md$/i, "").replace(/\.md$/i, "") ?? path;
}

export function entryFromNote(
  note: Awaited<ReturnType<typeof parseObsidianMarkdown>>,
  path: string,
  today: Date,
  existing?: KnowledgeEntry,
): KnowledgeEntry {
  const now = dayStamp(today);
  return {
    id: existing?.id ?? note.reviewId ?? crypto.randomUUID(),
    category: note.category,
    title: note.title,
    summary: note.summary,
    content: note.content,
    tags: note.tags,
    source: `Obsidian / ${path}`,
    favorite: existing?.favorite ?? false,
    mastery: existing?.mastery ?? 2,
    nextReviewAt: normalizeKnowledgeDay(existing?.nextReviewAt, now),
    lastReviewedAt: existing?.lastReviewedAt,
    reviewCount: existing?.reviewCount ?? 0,
    createdAt: normalizeKnowledgeDay(existing?.createdAt, now),
    updatedAt: now,
  };
}

export async function semanticHash(entry: KnowledgeEntry, wikilinks: string[]): Promise<string> {
  return hashObsidianState(toKnowledgeSemanticState(entry, wikilinks));
}

/** 图谱只从已同步 mapping 和序列化知识条目派生。 */
export async function loadObsidianGraphSnapshot(): Promise<ObsidianGraphSnapshot> {
  const [mappings, entries] = await Promise.all([
    reviewDb.obsidianNoteMappings.toArray(),
    reviewDb.knowledgeEntries.toArray(),
  ]);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const titleToNodeId = new Map<string, string>();
  const nodes: ObsidianGraphNode[] = mappings.map((mapping) => {
    const entry = entryById.get(mapping.knowledgeId);
    const title = entry?.title ?? noteTitleFromPath(mapping.path);
    const node = {
      id: mapping.knowledgeId,
      title,
      category: mapping.category,
      knowledgeId: mapping.knowledgeId,
      path: mapping.path,
      status: mapping.status === "synced" ? "synced" as const : "issue" as const,
    };
    titleToNodeId.set(title, node.id);
    return node;
  });
  const externalNodes = new Map<string, ObsidianGraphNode>();
  const edges = mappings.flatMap((mapping) => {
    const source = entryById.get(mapping.knowledgeId);
    const sourceTitle = source?.title ?? noteTitleFromPath(mapping.path);
    return withoutSelfLinks(mapping.wikilinks, sourceTitle).map((link) => {
      const targetId = titleToNodeId.get(link) ?? `external:${link}`;
      if (!titleToNodeId.has(link) && !externalNodes.has(targetId)) {
        externalNodes.set(targetId, { id: targetId, title: link, status: "external" as const });
      }
      return { id: `${mapping.knowledgeId}->${targetId}`, sourceId: mapping.knowledgeId, targetId, label: link };
    });
  });
  return {
    nodes: [...nodes, ...externalNodes.values()],
    edges,
    syncedCount: nodes.filter((node) => node.status === "synced").length,
    issueCount: nodes.filter((node) => node.status === "issue").length,
    externalCount: externalNodes.size,
  };
}
