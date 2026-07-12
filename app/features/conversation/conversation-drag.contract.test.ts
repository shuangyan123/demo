import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("对话树使用可访问的 dnd-kit 传感器并保留根目录目标", async () => {
  const source = await readFile(new URL("./conversation-folder-tree.tsx", import.meta.url), "utf8");
  assert.match(source, /PointerSensor/);
  assert.match(source, /TouchSensor/);
  assert.match(source, /KeyboardSensor/);
  assert.match(source, /sortableKeyboardCoordinates/);
  assert.match(source, /id: folderId \? `folder:/);
  assert.match(source, /: "root"/);
  assert.match(source, /conversationRepository\.moveFolder/);
  assert.match(source, /conversationRepository\.moveConversation/);
  assert.doesNotMatch(source, /draggable=/);
  assert.doesNotMatch(source, /dataTransfer/);
});

test("模型列表点击后直接选择，不再暴露二次确认按钮", async () => {
  const source = await readFile(new URL("./conversation-model-picker.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => chooseModel\(model\.id\)\}/);
  assert.match(source, /onSelect\(\{ connection: activeConnection, modelId: nextModelId/);
  assert.doesNotMatch(source, /使用此模型/);
  assert.doesNotMatch(source, /sourceLabels/);
});
