import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** 读取样式或组件源码，保证中性交互约束可由发布门禁稳定复核。 */
async function source(relativeUrl: string): Promise<string> {
  return readFile(new URL(relativeUrl, import.meta.url), "utf8");
}

test("共享交互令牌使用黑白反色与中性焦点", async () => {
  const [tokens, ui, base] = await Promise.all([
    source("../../styles/tokens.css"),
    source("../../styles/ui.css"),
    source("../../styles/base.css"),
  ]);

  assert.match(tokens, /--interactive-primary-bg:\s*var\(--foreground\)/);
  assert.match(tokens, /--interactive-primary-fg:\s*var\(--surface\)/);
  assert.match(tokens, /--focus-ring:\s*color-mix\(in srgb, var\(--foreground\)/);
  assert.match(ui, /\.ui-button-primary[\s\S]*?background:\s*var\(--interactive-primary-bg\)/);
  assert.match(ui, /\.ui-button:focus-visible[\s\S]*?outline:\s*2px solid var\(--focus-ring\)/);
  assert.doesNotMatch(ui, /\.ui-button-primary[\s\S]{0,300}var\(--blue\)/);
  assert.doesNotMatch(base, /:focus(?:-visible)?[\s\S]{0,180}var\(--blue\)/);
});

test("关键选择态与插件搜索框不再依赖蓝色交互色", async () => {
  const [conversation, settings, plugins, automation, appearance] = await Promise.all([
    source("../../styles/conversation.css"),
    source("../settings/settings-compact.module.css"),
    source("../settings/plugins/settings-plugins-view.module.css"),
    source("../automation/automation-workspace.module.css"),
    source("../settings/appearance-settings-view.tsx"),
  ]);

  for (const value of [conversation, settings, plugins, automation]) {
    assert.doesNotMatch(value, /(?:focus|selected|active|drop-target)[\s\S]{0,180}(?:var\(--(?:color-)?blue\)|#2563eb)/i);
  }
  assert.match(plugins, /\.toolbar label:focus-within[\s\S]*?background:\s*color-mix/);
  assert.match(plugins, /\.toolbar label:focus-within[\s\S]*?outline:\s*0/);
  assert.match(plugins, /\.toolbar label:focus-within[\s\S]*?box-shadow:\s*none/);
  assert.match(appearance, /interactive-primary-bg/);
  assert.doesNotMatch(appearance, /checked \? "bg-blue"/);
});
