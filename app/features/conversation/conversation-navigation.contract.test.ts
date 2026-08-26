import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildConversationTopics } from "./use-conversation-navigation.ts";
import type { ConversationTurnTimeline } from "../../services/conversation-turns.ts";

test("topic labels use the first non-empty user line and fall back to the turn ordinal", () => {
  const timeline: ConversationTurnTimeline = {
    standaloneTools: [],
    turns: [
      {
        id: "turn-1",
        system: [],
        tools: [],
        user: {
          id: "message-1",
          conversationId: "conversation-1",
          role: "user",
          content: "\n  如何拆解资料分析题？\n第二行",
          attachmentIds: [],
          createdAt: "2026-07-30T00:00:00.000Z",
        },
      },
      {
        id: "turn-2",
        system: [],
        tools: [],
        user: {
          id: "message-2",
          conversationId: "conversation-1",
          role: "user",
          content: "\n \n",
          attachmentIds: [],
          createdAt: "2026-07-30T00:01:00.000Z",
        },
      },
    ],
  };

  assert.deepEqual(buildConversationTopics(timeline), [
    { attachments: [], id: "turn-1", label: "如何拆解资料分析题？", ordinal: 1, summary: undefined },
    { attachments: [], id: "turn-2", label: "第 2 轮", ordinal: 2, summary: undefined },
  ]);
});

test("conversation navigation keeps scrolling local and exposes accessible controls", () => {
  const workspace = readFileSync(new URL("./conversation-workspace.tsx", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("./conversation-topic-navigation.tsx", import.meta.url), "utf8");
  const navigationStyles = readFileSync(new URL("./conversation-navigation.module.css", import.meta.url), "utf8");
  const overlayPosition = readFileSync(new URL("../shared/ui-overlay-position.ts", import.meta.url), "utf8");
  const hook = readFileSync(new URL("./use-conversation-navigation.ts", import.meta.url), "utf8");

  assert.match(workspace, /aria-label="跳到最新消息"/);
  assert.match(navigation, /aria-label="对话主题目录"/);
  assert.match(navigation, /aria-modal="true"/);
  assert.match(hook, /overflowing && !atBottom/);
  assert.match(hook, /followNextUpdateRef/);
  assert.doesNotMatch(workspace, /bottomRef\.current\?\.scrollIntoView/);
  assert.match(navigation, /index === topics\.length - 1/);
  assert.match(navigation, /className=\{latest \? "is-latest"/);
  assert.match(navigation, /role="tooltip"/);
  assert.match(navigation, /createPortal/);
  assert.match(navigation, /computeUiOverlayPosition/);
  assert.match(navigation, /topic\.attachments\.slice\(0, 2\)/);
  assert.match(navigationStyles, /left: clamp\(1rem, 1\.5vw, 1\.5rem\)/);
  assert.match(navigationStyles, /height: 100%/);
  assert.doesNotMatch(navigationStyles, /calc\(50% -/);
  assert.match(overlayPosition, /placement === "right"/);
  assert.match(overlayPosition, /preferredTop >= gutter \? preferredTop : flippedTop/);
});

test("topic navigation auto-scroll effect never exposes the scroll return value as cleanup", () => {
  const navigation = readFileSync(new URL("./conversation-topic-navigation.tsx", import.meta.url), "utf8");

  assert.match(
    navigation,
    /useEffect\(\(\) => \{\s*latestRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\);\s*\}, \[topics\.length\]\);/,
  );
  assert.doesNotMatch(navigation, /useEffect\(\(\) => latestRef\.current\?\.scrollIntoView/);
});
