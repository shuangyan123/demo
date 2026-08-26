import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { conversationContextUsagePolicy } from "../../services/conversation-context-budget.ts";
import "./conversation-navigation.contract.test.ts";

const composer = readFileSync(new URL("./conversation-composer.tsx", import.meta.url), "utf8");
const addMenu = readFileSync(new URL("./conversation-add-menu.tsx", import.meta.url), "utf8");
const draftInput = readFileSync(new URL("./conversation-draft-input.tsx", import.meta.url), "utf8");
const slashCommands = readFileSync(new URL("./conversation-slash-commands.tsx", import.meta.url), "utf8");
const contextIndicator = readFileSync(new URL("./conversation-context-indicator.tsx", import.meta.url), "utf8");
const modelPicker = readFileSync(new URL("./conversation-model-picker.tsx", import.meta.url), "utf8");
const mainContentShell = readFileSync(new URL("../shared/main-content-shell.tsx", import.meta.url), "utf8");
const reviewShell = readFileSync(new URL("../review/review-workspace-shell.tsx", import.meta.url), "utf8");

test("Composer 一级保持紧凑且按输入状态切换语音与发送主操作", () => {
  assert.match(composer, /aria-haspopup="menu"[\s\S]*aria-label="添加"/);
  assert.match(composer, /aria-label=\{recording \? "松开后转写" : "按住录音"\}/);
  assert.match(composer, /ConversationModelSelector/);
  assert.match(composer, /draft\.trim\(\) \|\| attachments\.length/);
  assert.match(composer, /aria-label="开始语音聊天"/);
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

test("模型、推理、速度和高级设置收敛到同一个可键盘操作的菜单", () => {
  assert.match(composer, /openModelSelector: \(\) => modelSelectorRef\.current\?\.open\(\)/);
  assert.match(composer, /openRuntime\("reasoning"\)/);
  for (const label of ["模型", "推理强度", "速度", "高级"]) assert.match(modelPicker, new RegExp(`>${label}<`));
  assert.match(modelPicker, /手动模型 ID/);
  assert.match(modelPicker, /event\.key !== "ArrowDown" && event\.key !== "ArrowUp"/);
  assert.doesNotMatch(composer, /ConversationReasoningControl/);
});

test("添加菜单保留 Escape、外部点击、焦点恢复与首条消息阻止", () => {
  assert.match(composer, /document\.addEventListener\("pointerdown", closeOnOutside\)/);
  assert.match(composer, /event\.key !== "Escape"/);
  assert.match(composer, /addTriggerRef\.current\?\.focus\(\)/);
  assert.match(addMenu, /请先发送首条消息，再调用 MCP 工具/);
  assert.match(addMenu, /请先发送首条消息，再生成 Obsidian 提案/);
});

test("上下文环只展示结构化用量和截断摘要，并保留手动压缩边界", () => {
  assert.match(composer, /ConversationContextIndicator/);
  assert.match(contextIndicator, /budget\.usedTokens \/ budget\.contextWindow/);
  assert.match(contextIndicator, /slice\(0, 120\)/);
  assert.match(contextIndicator, /event\.key !== "Escape"/);
  assert.match(contextIndicator, /压缩上下文/);
  assert.match(composer, /onCompressContext/);
  assert.deepEqual(conversationContextUsagePolicy, { warningPercent: 72, autoCompactionPercent: 84, autoCompactionEnabled: false });
  assert.doesNotMatch(contextIndicator, /messages\.map|conversation\.messages/);
});

test("右侧内容统一使用居中宽度预设且对话保留宽屏工作区", () => {
  for (const width of ["max-w-3xl", "max-w-5xl", "max-w-7xl"]) assert.match(mainContentShell, new RegExp(width));
  assert.match(mainContentShell, /mx-auto min-h-full w-full/);
  assert.match(reviewShell, /<MainContentShell[\s\S]*width=\{contentWidth\(view\)\}/);
});
