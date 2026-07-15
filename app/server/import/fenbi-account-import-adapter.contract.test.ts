import assert from "node:assert/strict";
import test from "node:test";
import { FenbiAccountImportAdapter, FenbiAccountImportError } from "./fenbi-account-import-adapter.ts";
import { markDuplicateDrafts } from "../../services/dedupe-service.ts";
import { normalizeFenbiDraft } from "../../services/fenbi-parser.ts";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

test("粉笔账户同步只访问固定题库域名，并按 100 条批次补齐解析", async () => {
  const requested: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.pathname.endsWith("keypoint-tree")) return json({ data: [] });
    if (url.pathname.endsWith("/errors")) return json({ data: { list: [{ id: 42, question: { id: 42, content: "题干", options: [{ key: "A", value: "选项" }] }, keypointName: "判断推理", userAnswer: "B" }], total: 1 } });
    if (url.pathname.endsWith("/solutions")) return json({ data: [{ questionId: 42, answer: "A", analysis: "解析" }] });
    return json({}, 404);
  };
  const stages: string[] = [];
  const drafts = await new FenbiAccountImportAdapter({ fetchImpl, sleep: async () => undefined }).sync("session=masked", { wrongOnly: true, sinceDays: 30 }, (event) => {
    if (event.stage) stages.push(event.stage);
  });

  assert.deepEqual(stages, ["validate", "catalog", "questions", "normalize"]);
  assert.equal(requested.every((url) => url.origin === "https://tiku.fenbi.com"), true);
  assert.equal(requested.filter((url) => url.pathname.endsWith("/solutions"))[0].searchParams.get("ids"), "42");
  assert.equal(drafts[0].sourceId, "42");
  assert.equal(drafts[0].answer, "A");
  assert.equal(drafts[0].board, "判断推理");
});

test("粉笔会话失效和限流返回稳定错误分类，不暴露上游正文", async () => {
  for (const [status, code] of [[401, "invalid_cookie"], [429, "rate_limited"]] as const) {
    const adapter = new FenbiAccountImportAdapter({ fetchImpl: async () => json({ message: "raw secret response" }, status) });
    await assert.rejects(() => adapter.validate("session=masked"), (error: unknown) => {
      assert.equal(error instanceof FenbiAccountImportError, true);
      assert.equal((error as FenbiAccountImportError).code, code);
      assert.doesNotMatch((error as Error).message, /raw secret response/);
      return true;
    });
  }
});

test("粉笔稳定题目 ID 优先于题干指纹去重", () => {
  const draft = normalizeFenbiDraft({ id: "fenbi-1", stem: "不同写法题干", answer: "A", board: "常识判断" });
  const [marked] = markDuplicateDrafts([draft], [{ id: "m1", sourceId: "fenbi-1", board: "常识判断", source: "粉笔", stem: "旧题干", answer: "A", explanation: "", reasons: [], tags: [], mastery: 2, nextReviewAt: "", createdAt: "", updatedAt: "" }]);
  assert.equal(marked.issues?.includes("duplicate"), true);
  assert.equal(marked.needsReview, true);
});

