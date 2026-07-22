import { createHash } from "node:crypto";
import { load } from "cheerio";

export const ACQUISITION_MAX_TEXT_CHARS = 64_000;
export const ACQUISITION_MAX_FEED_LINKS = 20;

export type ParsedAcquisitionDocument = {
  title: string;
  publisher?: string;
  publishedAt?: string;
  text: string;
  excerpt: string;
  contentHash: string;
  discoveredUrls: string[];
};

/** 统一空白并限制送入模型的正文长度。 */
function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().slice(0, ACQUISITION_MAX_TEXT_CHARS);
}

/** RSS/Atom 中的相对链接统一解析为绝对 HTTP(S) URL。 */
function normalizeDiscoveredUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim(), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** 服务端解析 HTML、RSS 与 Atom，只返回标准化文本和候选链接。 */
export function parseAcquisitionDocument(input: { body: string; contentType: string; url: string }): ParsedAcquisitionDocument {
  const isXml = /(?:xml|rss|atom)/i.test(input.contentType) || /^\s*<\?xml|^\s*<(?:rss|feed)\b/i.test(input.body);
  const $ = load(input.body, isXml ? { xmlMode: true } : undefined);

  if (isXml) {
    const feedTitle = normalizeText($("channel > title").first().text() || $("feed > title").first().text() || new URL(input.url).hostname);
    const entries = $("item, entry").toArray();
    const discoveredUrls = entries
      .map((entry) => {
        const node = $(entry);
        return normalizeDiscoveredUrl(node.find("link").first().attr("href") || node.find("link").first().text(), input.url);
      })
      .filter((url): url is string => Boolean(url))
      .filter((url, index, items) => items.indexOf(url) === index)
      .slice(0, ACQUISITION_MAX_FEED_LINKS);
    const text = normalizeText(entries.map((entry) => {
      const node = $(entry);
      return [node.find("title").first().text(), node.find("description, summary, content").first().text()].join(" ");
    }).join(" "));
    const publishedAt = normalizeText($("item > pubDate, entry > published, entry > updated").first().text()) || undefined;
    return {
      title: feedTitle,
      publisher: feedTitle,
      publishedAt,
      text,
      excerpt: text.slice(0, 600),
      contentHash: createHash("sha256").update(text).digest("hex"),
      discoveredUrls,
    };
  }

  $("script, style, noscript, template, svg, canvas, nav, footer, form").remove();
  const title = normalizeText($("meta[property='og:title']").attr("content") || $("title").first().text() || $("h1").first().text() || new URL(input.url).hostname);
  const publisher = normalizeText($("meta[property='og:site_name']").attr("content") || $("meta[name='application-name']").attr("content") || "") || undefined;
  const publishedAt = normalizeText(
    $("meta[property='article:published_time']").attr("content")
      || $("meta[name='date']").attr("content")
      || $("time[datetime]").first().attr("datetime")
      || "",
  ) || undefined;
  const contentRoot = $("article, main, [role='main']").first();
  const text = normalizeText((contentRoot.length ? contentRoot : $("body")).text());
  return {
    title,
    publisher,
    publishedAt,
    text,
    excerpt: text.slice(0, 600),
    contentHash: createHash("sha256").update(text).digest("hex"),
    discoveredUrls: [],
  };
}
