import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

test("AI Markdown 渲染粗体、段落、列表和代码，且跳过原始 HTML", () => {
  const content = "第一段 **重点**。\n\n- 条目\n\n`const marker = \"**\"`\n\n<script>alert('xss')</script>";
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    skipHtml: true,
  }, content));

  assert.match(html, /<strong>重点<\/strong>/);
  assert.doesNotMatch(html, /\*\*重点\*\*/);
  assert.match(html, /<ul>/);
  assert.match(html, /<code>const marker = &quot;\*\*&quot;<\/code>/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /alert\(&#x27;xss&#x27;\)/);
});
