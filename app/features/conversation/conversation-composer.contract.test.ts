import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./conversation-navigation.contract.test.ts";

const composer = readFileSync(new URL("./conversation-composer.tsx", import.meta.url), "utf8");
const addMenu = readFileSync(new URL("./conversation-add-menu.tsx", import.meta.url), "utf8");
const draftInput = readFileSync(new URL("./conversation-draft-input.tsx", import.meta.url), "utf8");
const slashCommands = readFileSync(new URL("./conversation-slash-commands.tsx", import.meta.url), "utf8");
const reasoning = readFileSync(new URL("./conversation-reasoning-control.tsx", import.meta.url), "utf8");
const reasoningStyles = readFileSync(new URL("./conversation-reasoning-control.module.css", import.meta.url), "utf8");

test("Composer 一级显示添加、语音、通话、模型、推理和发送", () => {
  assert.match(composer, /aria-haspopup="menu"[\s\S]*aria-label="添加"/);
  assert.match(composer, /aria-label=\{recording \? "松开后转写" : "按住录音"\}/);
  assert.match(composer, /aria-label="实时语音通话"/);
  assert.match(composer, /ConversationModelSelector/);
  assert.match(composer, /ConversationReasoningControl/);
  assert.match(composer, /aria-label="发送"/);
  for (const label of ["文件和文件夹", "摄像头", "屏幕共享", "截图分析", "知识库检索", "MCP 工具", "Obsidian 提案", "历史辅导记录"]) {
    assert.match(addMenu, new RegExp(label));
  }
  assert.doesNotMatch(addMenu, /语音输入|实时语音通话|快捷指令/);
  assert.doesNotMatch(composer, /triggerVariant="menu"/);
});

test("斜杠菜单提供四个提示词和四个工具命令", () => {
  for (const label of ["/解释", "/出题", "/复盘", "/总结", "/模型", "/推理", "/知识", "/mcp"]) {
    assert.match(slashCommands, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(slashCommands, /findConversationSlashMatch/);
  assert.match(draftInput, /event\.key === "ArrowDown"/);
  assert.match(draftInput, /event\.key === "Enter" \|\| event\.key === "Tab"/);
  assert.doesNotMatch(composer, /onAppendShortcut/);
});

test("模型与推理可由命令直接打开且推理动画尊重减少动态效果", () => {
  assert.match(composer, /openModelSelector: \(\) => modelSelectorRef\.current\?\.open\(\)/);
  assert.match(reasoning, /ConversationReasoningControlHandle/);
  assert.match(reasoning, /useImperativeHandle/);
  assert.match(reasoningStyles, /reasoning-popover-enter 140ms/);
  assert.match(reasoningStyles, /prefers-reduced-motion: reduce/);
});

test("添加菜单保留 Escape、外部点击、焦点恢复与首条消息阻止", () => {
  assert.match(composer, /document\.addEventListener\("pointerdown", closeOnOutside\)/);
  assert.match(composer, /event\.key !== "Escape"/);
  assert.match(composer, /addTriggerRef\.current\?\.focus\(\)/);
  assert.match(addMenu, /请先发送首条消息，再调用 MCP 工具/);
  assert.match(addMenu, /请先发送首条消息，再生成 Obsidian 提案/);
});

test("Composer 使用共享上下文预算并提供显式压缩操作", () => {
  assert.match(composer, /contextBudget\.usedTokens/);
  assert.match(composer, /contextBudget\.remainingPercent/);
  assert.match(composer, /压缩上下文/);
  assert.match(composer, /onCompressContext/);
  assert.match(composer, /厂商用量校准 \+ 增量估算/);
});
