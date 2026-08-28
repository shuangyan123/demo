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
const modelSelector = readFileSync(new URL("./conversation-model-selector.tsx", import.meta.url), "utf8");
const modelPicker = readFileSync(new URL("./conversation-model-picker.tsx", import.meta.url), "utf8");
const modelPickerStyles = readFileSync(new URL("./conversation-model-picker.module.css", import.meta.url), "utf8");
const overlayEvents = readFileSync(new URL("../shared/ui-overlay-events.ts", import.meta.url), "utf8");
const popover = readFileSync(new URL("../shared/ui-popover.tsx", import.meta.url), "utf8");
const hint = readFileSync(new URL("../shared/ui-tooltip.tsx", import.meta.url), "utf8");
const infoHoverCard = readFileSync(new URL("../shared/ui-info-hover-card.tsx", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../shared/ui-overlay-position.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../shared/workspace-shell.tsx", import.meta.url), "utf8");
const shellStyles = readFileSync(new URL("../../styles/shell.css", import.meta.url), "utf8");
const mainContentShell = readFileSync(new URL("../shared/main-content-shell.tsx", import.meta.url), "utf8");
const reviewShell = readFileSync(new URL("../review/review-workspace-shell.tsx", import.meta.url), "utf8");
const reviewSidebar = readFileSync(new URL("../review/review-workspace-app-sidebar.tsx", import.meta.url), "utf8");
const conversationTree = readFileSync(new URL("./conversation-folder-tree.tsx", import.meta.url), "utf8");
const conversationStyles = readFileSync(new URL("../../styles/conversation.css", import.meta.url), "utf8");
const mcpPermission = readFileSync(new URL("../../services/mcp-permission.ts", import.meta.url), "utf8");
const shellStylesForEdges = readFileSync(new URL("../../styles/shell.css", import.meta.url), "utf8");
const uiStylesForEdges = readFileSync(new URL("../../styles/ui.css", import.meta.url), "utf8");

test("Composer 一级保持紧凑、语义化分组并按输入状态切换语音与发送主操作", () => {
  assert.match(composer, /aria-haspopup="menu"[\s\S]*aria-label="添加文件等内容"/);
  assert.match(composer, /aria-label={`更改权限：\$\{permissionLabel\}`}[\s\S]*data-permission-state={permissionLabel}[\s\S]*>\{permissionLabel\}</);
  assert.doesNotMatch(composer, />工具权限</);
  assert.match(composer, /aria-label=\{recording \? "停止听写" : "点击开始听写"\}/);
  assert.match(composer, /ConversationModelSelector/);
  assert.match(composer, /<ConversationContextIndicator[\s\S]*<ConversationModelSelector/);
  assert.match(composer, /draft\.trim\(\) \|\| attachments\.length/);
  assert.match(composer, /aria-label="开启语音聊天"/);
  assert.match(composer, /aria-label="发送"/);
  for (const label of ["文件和文件夹", "摄像头", "屏幕共享", "截图分析", "知识库检索", "MCP 工具", "Obsidian 提案", "历史辅导记录"]) {
    assert.match(addMenu, new RegExp(label));
  }
  assert.doesNotMatch(addMenu, /语音输入|实时语音通话|快捷指令/);
  assert.doesNotMatch(composer, /triggerVariant="menu"/);
});

test("斜杠菜单提供四个提示词和五个工具命令", () => {
  for (const label of ["/解释", "/出题", "/复盘", "/总结", "/模型", "/推理", "/知识", "/mcp", "/压缩"]) {
    assert.match(slashCommands, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(slashCommands, /findConversationSlashMatch/);
  assert.match(draftInput, /event\.key === "ArrowDown"/);
  assert.match(draftInput, /event\.key === "Enter" \|\| event\.key === "Tab"/);
  assert.doesNotMatch(composer, /onAppendShortcut/);
});

test("模型、推理和速度收敛到同一个可键盘操作的目录菜单", () => {
  assert.match(composer, /openModelSelector: \(\) => modelSelectorRef\.current\?\.open\(\)/);
  assert.match(composer, /openRuntime\("reasoning"\)/);
  for (const label of ["模型", "推理强度", "速度"]) assert.match(modelPicker, new RegExp(`>${label}<`));
  assert.doesNotMatch(modelPicker, /手动模型 ID|高级模型配置|showAdvanced|manualModelId/);
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

test("上下文环使用只读信息卡，并把手动压缩收敛到 slash command", () => {
  assert.match(composer, /ConversationContextIndicator/);
  assert.match(contextIndicator, /budget\.usedTokens \/ budget\.contextWindow/);
  assert.match(contextIndicator, /背景信息窗口/);
  assert.match(contextIndicator, /背景信息窗口：/);
  assert.doesNotMatch(contextIndicator, /当前用量|接近上限/);
  assert.match(contextIndicator, /formatContextTokenCount\(budget\.usedTokens\)/);
  assert.doesNotMatch(contextIndicator, /压缩上下文|当前对话|上次压缩|conversation-context-summary/);
  assert.match(contextIndicator, /UiInfoHoverCard/);
  assert.doesNotMatch(contextIndicator, /UiPopover|aria-haspopup="dialog"/);
  assert.match(infoHoverCard, /createPortal/);
  assert.match(infoHoverCard, /CLOSE_GRACE_MS = 160/);
  assert.match(infoHoverCard, /event\.key !== "Escape"/);
  assert.match(infoHoverCard, /document\.addEventListener\("pointerdown", closeOnOutside\)/);
  assert.match(infoHoverCard, /lastPointerTypeRef\.current !== "touch"/);
  assert.match(infoHoverCard, /computeUiOverlayPosition/);
  assert.match(popover, /computeUiOverlayPosition/);
  assert.match(composer, /onCompressContext/);
  assert.match(draftInput, /command\.action === "compact"/);
  assert.match(draftInput, /disabledActions=\{contextCompressionAvailable && !contextCompressing \? \[\] : \["compact"\]\}/);
  assert.match(draftInput, /pendingActions=\{contextCompressing \? \["compact"\] : \[\]\}/);
  assert.match(slashCommands, /disabledActions\?: readonly ConversationSlashCommandAction\[\]/);
  assert.deepEqual(conversationContextUsagePolicy, { warningPercent: 72, autoCompactionPercent: 84, autoCompactionEnabled: false });
  assert.doesNotMatch(contextIndicator, /messages\.map|conversation\.messages|ConversationContextCompaction/);
});

test("WorkspaceFrame、Composer 和用户消息各自只保留一个权威外缘", () => {
  assert.match(shell, /data-workspace-frame="true"/);
  assert.match(shellStylesForEdges, /is-sidebar-expanded \.chrome-content-frame\[data-content-surface="raised-surface"\][\s\S]*border-top: 1px solid var\(--chrome-workspace-frame-edge\);[\s\S]*border-left: 1px solid var\(--chrome-workspace-frame-edge\);/);
  assert.match(shellStylesForEdges, /is-sidebar-expanded \.chrome-sidebar-boundary\s*\{\s*background: transparent;/);
  assert.match(shellStylesForEdges, /is-sidebar-collapsed \.chrome-content-frame\[data-content-surface="raised-surface"\][\s\S]*border: 0;/);
  assert.match(uiStylesForEdges, /\.conversation-composer:focus-within\s*\{[\s\S]*border-color: var\(--chrome-composer-focus-outline\);[\s\S]*box-shadow: var\(--chrome-composer-focus-shadow\);/);
  assert.doesNotMatch(uiStylesForEdges, /\.conversation-composer:focus-within\s*\{[\s\S]*outline:\s*2px[\s\S]*outline-offset/);
  assert.match(uiStylesForEdges, /\.conversation-message\.is-user \.conversation-message-bubble\s*\{[\s\S]*box-shadow: none;/);
  assert.match(mcpPermission, /export function summarizeMcpPermission/);
  assert.match(mcpPermission, /未发现工具|未配置/);
});

test("右侧内容统一使用居中宽度预设且对话保留宽屏工作区", () => {
  for (const width of ["content-width-narrow", "content-width-medium", "content-width-wide"]) assert.match(mainContentShell, new RegExp(width));
  assert.match(mainContentShell, /mx-auto min-h-full w-full/);
  assert.match(mainContentShell, /data-main-content-width/);
  assert.match(readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8"), /--conversation-content-max-width/);
  assert.match(reviewShell, /<MainContentShell[\s\S]*width=\{contentWidth\(view\)\}/);
  assert.match(reviewShell, /contentSurface="raised-surface"/);
  assert.match(reviewShell, /conversation-main-content flex !h-full !min-h-0/);
});

test("对话画布拥有唯一滚动容器并让正文与 Composer 共用坐标轴", () => {
  const workspace = readFileSync(new URL("./conversation-workspace.tsx", import.meta.url), "utf8");
  const navigationStyles = readFileSync(new URL("./conversation-navigation.module.css", import.meta.url), "utf8");
  const uiStyles = readFileSync(new URL("../../styles/ui.css", import.meta.url), "utf8");
  assert.match(workspace, /className="conversation-canvas-scroll" data-scroll-owner="conversation-canvas"/);
  assert.match(workspace, /scrollContainerRef: conversationScrollRef/);
  assert.match(navigationStyles, /conversation-canvas-scroll[\s\S]*overflow-y: auto/);
  assert.match(navigationStyles, /conversation-message-content[\s\S]*max-width: var\(--conversation-content-max-width\)/);
  assert.match(navigationStyles, /conversation-reading-column[\s\S]*linear-gradient\(90deg/);
  assert.match(navigationStyles, /conversation-composer-stack[\s\S]*var\(--conversation-content-max-width\)/);
  assert.match(navigationStyles, /conversation-composer-dock[\s\S]*safe-area-inset-bottom/);
  assert.match(uiStyles, /\.conversation-composer[\s\S]*var\(--conversation-content-max-width\)/);
  assert.match(workspace, /className="conversation-thread-header"/);
  assert.doesNotMatch(workspace, /workspace-topbar/);
  assert.match(workspace, /data-conversation-layer="thread-header"/);
  assert.match(workspace, /data-conversation-layer="conversation-canvas"/);
  assert.match(workspace, /data-conversation-layer="reading-column"/);
  assert.match(workspace, /conversation-composer-dock" data-conversation-layer="composer-dock"/);
  assert.match(workspace, /data-conversation-layer="jump-to-latest"/);
  assert.match(composer, /data-conversation-layer="composer-card"/);
  assert.match(reviewShell, /conversation-main-content[^"]*!max-w-none/);
  assert.match(navigationStyles, /conversation-message-content[\s\S]*margin: 0 auto/);
});

test("模型一级控制与厂商整行支持桌面悬停、焦点和显式键盘进入", () => {
  assert.match(modelPicker, /onMouseEnter=\{\(\) => openModelBrowser\(\)\}/);
  assert.match(modelPicker, /onFocus=\{\(\) => \{ if \(usesDesktopFlyout\(\)\) openModelBrowser\(\); \}\}/);
  assert.match(modelPicker, /openSelectedRuntime\("reasoning"\)/);
  assert.match(modelPicker, /openSelectedRuntime\("speed"\)/);
  assert.match(modelPicker, /event\.key !== "ArrowRight" && event\.key !== "Enter"/);
  assert.match(modelPicker, /onMouseEnter=\{\(\) => activateProvider\(provider\)\}/);
  assert.match(modelPicker, /onFocus=\{\(\) => activateProvider\(provider\)\}/);
  assert.match(modelPicker, /event\.key !== "ArrowLeft"/);
  assert.match(modelPicker, /styles\.controlFlyout/);
  assert.match(modelPicker, /styles\.controlPane/);
  assert.match(modelPicker, /styles\.detailPane/);
  assert.match(modelPicker, /styles\.flyout/);
  assert.match(modelPicker, /className=\{`\$\{styles\.layer\} \$\{styles\.providerPane\}`\}/);
  assert.match(modelPicker, /className=\{`\$\{styles\.layer\} \$\{styles\.modelPane\}`\}/);
  assert.match(modelPicker, /styles\.mobileDisclosure/);
  assert.match(modelPickerStyles, /data-model-picker-view="providers"[\s\S]*width: min\(41rem/);
  assert.match(modelPickerStyles, /data-model-picker-view="models"[\s\S]*height: min\(26rem/);
  assert.match(modelPickerStyles, /\.picker:not\(\[data-model-picker-view="controls"\]\) \.controlPane[\s\S]*display: none/);
  assert.match(modelPickerStyles, /\.flyoutBack\s*\{\s*display: none;/);
  assert.match(modelPickerStyles, /@media \(max-width: 640px\)[\s\S]*?\.flyoutBack\s*\{\s*display: grid;/);
  assert.match(modelPickerStyles, /\.mobileDisclosure\s*\{\s*display: inline-flex;/);
  assert.doesNotMatch(modelPicker, /<strong>模型<\/strong>/);
});

test("模型目录按 active provider key 原子切换且连接入口只存在于零连接状态", () => {
  const catalog = readFileSync(new URL("./use-connection-model-catalog.ts", import.meta.url), "utf8");
  assert.match(modelPicker, /const activeProviderId =/);
  assert.match(modelPicker, /eligible\.filter\(\(connection\) => connection\.provider === activeProviderId\)/);
  assert.match(modelPicker, /key=\{catalog\.key\}/);
  assert.match(catalog, /loaded\?\.key === catalogKey \? loaded\.models : fallbackModels/);
  assert.match(catalog, /let active = true/);
  assert.match(catalog, /if \(active\) setLoaded/);
  assert.doesNotMatch(modelPicker, /管理 AI 连接/);
  assert.match(modelPicker, /尚未配置 AI 连接/);
  assert.match(modelPicker, /配置 AI 服务后即可选择模型/);
  assert.match(modelPicker, /前往设置/);
  assert.match(modelPicker, /暂无可用模型/);
});

test("Sidebar 将项目选中、当前对话和键盘焦点表达为独立状态", () => {
  assert.match(reviewSidebar, /data-project-selected=\{projectActive \? "true"/);
  assert.match(reviewSidebar, /workspace-project-row/);
  assert.match(reviewSidebar, /is-selected/);
  assert.match(conversationTree, /data-conversation-active=\{active \? "true"/);
  assert.match(conversationTree, /aria-current=\{active \? "page"/);
  assert.match(conversationStyles, /workspace-project-row\.is-selected/);
  assert.match(conversationStyles, /conversation-tree-chat\.is-active/);
  assert.match(conversationStyles, /conversation-tree-chat-label:focus-visible/);
  assert.match(conversationStyles, /workspace-project-row:focus-visible/);
});

test("交互式菜单打开时关闭 Topic Preview、UiHint 和信息卡", () => {
  assert.match(composer, /announceInteractiveOverlayOpen\(\)/);
  assert.match(modelSelector, /openMenu/);
  assert.match(hint, /INTERACTIVE_OVERLAY_OPEN_EVENT/);
  assert.match(infoHoverCard, /INTERACTIVE_OVERLAY_OPEN_EVENT/);
  assert.match(popover, /announceInteractiveOverlayOpen/);
  assert.match(overlayEvents, /announceInteractiveOverlayOpen/);
});

test("Workbench chrome removes browser product topbar while preserving native host boundary", () => {
  assert.match(shell, /<WindowMenuBar/);
  assert.match(shell, /data-native-window=\{nativeWindowAvailable \? "true" : "false"\}/);
  assert.match(shellStyles, /data-native-window="false"\][\s\S]*?\.chrome-topbar[\s\S]*?height: 0/);
  assert.match(shellStyles, /\.chrome-layout\.is-sidebar-collapsed[\s\S]*?grid-template-columns: 0 0 minmax\(0, 1fr\)/);
  assert.match(shellStyles, /\.chrome-layout\.is-sidebar-collapsed \.chrome-sidebar-boundary[\s\S]*?width: 0/);
  assert.match(readFileSync(new URL("../review/review-workspace-app-sidebar.tsx", import.meta.url), "utf8"), /<strong>错题复盘<\/strong>/);
});

test("UiHint is the shared non-interactive overlay and migrated controls avoid native title conflicts", () => {
  assert.match(hint, /export function UiHint/);
  assert.match(hint, /label: string/);
  assert.match(hint, /badge\?: string/);
  assert.match(hint, /UiHintBadge/);
  assert.match(hint, /createPortal/);
  assert.match(hint, /computeUiOverlayPosition/);
  assert.match(hint, /activeTooltipId/);
  assert.match(hint, /TOOLTIP_DELAY_MS = 450/);
  assert.match(hint, /event\.key !== "Escape"/);
  assert.match(hint, /event\.pointerType === "touch"/);
  assert.match(hint, /onPointerLeave=\{closeTooltip\}/);
  assert.match(hint, /role="tooltip"/);
  assert.match(overlay, /const opposite =/);
  for (const source of [shell, composer, readFileSync(new URL("./conversation-workspace.tsx", import.meta.url), "utf8"), readFileSync(new URL("./conversation-topic-navigation.tsx", import.meta.url), "utf8"), readFileSync(new URL("./conversation-folder-tree.tsx", import.meta.url), "utf8")]) {
    assert.match(source, /UiHint/);
  }
  assert.doesNotMatch(composer, /title=/);
  assert.doesNotMatch(modelSelector, /title=/);
  assert.match(composer, /label="添加文件等内容" badge="@"/);
  assert.match(modelSelector, /label="选择模型" badge="Ctrl\+Shift\+M"/);
  assert.match(composer, /label="点击开始听写" badge="Ctrl\+Shift\+D"/);
  assert.match(composer, /event\.key\.toLowerCase\(\) === "m"/);
  assert.match(composer, /event\.key\.toLowerCase\(\) === "d"/);
});
