import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("对话树使用可访问的 dnd-kit 传感器并保留根目录目标", async () => {
  const source = await readFile(new URL("./conversation-folder-tree.tsx", import.meta.url), "utf8");
  assert.match(source, /PointerSensor/);
  assert.match(source, /TouchSensor/);
  assert.match(source, /KeyboardSensor/);
  assert.match(source, /sortableKeyboardCoordinates/);
  assert.match(source, /collisionDetection=\{pointerWithin\}/);
  assert.match(source, /dropId \?\? \(folderId \? `folder:/);
  assert.match(source, /: "root"/);
  assert.match(source, /dropId="root" dataDropRootTarget/);
  assert.match(source, /dropId="root-surface" dataDropRoot/);
  assert.match(source, /conversationRepository\.moveFolder/);
  assert.match(source, /conversationRepository\.moveConversation/);
  assert.doesNotMatch(source, /draggable=/);
  assert.doesNotMatch(source, /dataTransfer/);
  assert.doesNotMatch(source, /AppIcon name="drag"/);
  assert.doesNotMatch(source, /title=\{`拖动/);
  assert.match(source, /onContextMenu=/);
  assert.match(source, /conversation-tree-inline-rename/);
  assert.match(source, /conversation-tree-disclosure-slot/);
  assert.doesNotMatch(source, /depth \* 10/);
});

test("模型列表点击后直接选择，不再暴露二次确认按钮", async () => {
  const source = await readFile(new URL("./conversation-model-picker.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => chooseModel\(model\.id\)\}/);
  assert.match(source, /onSelect\(\{ connection: activeConnection, modelId: nextModelId/);
  assert.doesNotMatch(source, /使用此模型/);
  assert.doesNotMatch(source, /sourceLabels/);
  assert.match(source, /selectedRuntimeValues/);
  assert.match(source, /getAiModelRuntimeDescriptor/);
  assert.match(source, /title=\{modelTooltip\(model\)\}/);
  assert.doesNotMatch(source, /reasoningClass/);
  assert.doesNotMatch(source, /speedClass/);
  assert.doesNotMatch(source, /selectedSpeedMode/);
});
