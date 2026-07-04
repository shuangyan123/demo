import assert from "node:assert/strict";
import test from "node:test";
import { extractAiJsonText, parseAiJsonArray, parseAiJsonObject, parseAiJsonValue } from "./ai-json.ts";

test("AI JSON helper 能清理 markdown fence 并解析对象", () => {
  const parsed = parseAiJsonObject("```json\n{\"title\":\"ok\"}\n```");
  assert.equal(parsed.title, "ok");
});

test("AI JSON helper 能从解释文本中提取对象或数组主体", () => {
  assert.equal(extractAiJsonText("说明 {\"items\":[1]} 结束", "object"), "{\"items\":[1]}");
  assert.deepEqual(parseAiJsonArray<number>("前置说明 [1,2,3] 后置说明"), [1, 2, 3]);
});

test("AI JSON helper 对非法 JSON 和类型不匹配给出稳定错误", () => {
  assert.throws(() => parseAiJsonValue("{bad", "object", "自定义错误"), /自定义错误/);
  assert.throws(() => parseAiJsonObject("[1,2,3]"), /AI 返回不是有效 JSON 对象/);
  assert.throws(() => parseAiJsonArray("{\"items\":true}"), /AI 返回不是有效 JSON 数组/);
});
