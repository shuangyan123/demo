import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { FenbiAccountImportAdapter, FenbiAccountImportError } from "./fenbi-account-import-adapter.ts";
import { markDuplicateDrafts } from "../../services/dedupe-service.ts";
import { normalizeFenbiDraft } from "../../services/fenbi-parser.ts";
import { normalizeFenbiCookie } from "../../services/fenbi-cookie.ts";

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

test("Cookie 前缀和换行会被规范化，控制字符与登录重定向会被拒绝", async () => {
  assert.equal(normalizeFenbiCookie("Cookie: session=abc;\r\n token=def"), "session=abc;token=def");
  assert.equal(
    normalizeFenbiCookie("curl 'https://tiku.fenbi.com/api/xingce/errors' -H 'Accept: application/json' -H 'Cookie: session=abc; token=def'"),
    "session=abc; token=def",
  );
  assert.equal(normalizeFenbiCookie('curl "https://tiku.fenbi.com" --cookie "session=abc; token=def"'), "session=abc; token=def");
  assert.throws(() => normalizeFenbiCookie("curl 'https://tiku.fenbi.com' -H 'Accept: application/json'"), /找到 Cookie/);
  assert.throws(() => normalizeFenbiCookie("session=abc\u0000token=def"), /控制字符/);

  let receivedCookie = "";
  const validAdapter = new FenbiAccountImportAdapter({
    fetchImpl: async (_input, init) => {
      receivedCookie = new Headers(init?.headers).get("cookie") ?? "";
      return json({ data: [] });
    },
  });
  await validAdapter.validate("Cookie: session=abc;\r\n token=def");
  assert.equal(receivedCookie, "session=abc;token=def");

  const redirectAdapter = new FenbiAccountImportAdapter({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "/login" } }),
  });
  await assert.rejects(() => redirectAdapter.validate("session=abc"), (error: unknown) => {
    assert.equal((error as FenbiAccountImportError).code, "invalid_cookie");
    return true;
  });
});

test("分页重复题按稳定 ID 去重并进入非秘密诊断", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, question: { id: index + 1, content: `题干 ${index + 1}` } }));
  const adapter = new FenbiAccountImportAdapter({
    sleep: async () => undefined,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("keypoint-tree")) return json({ data: [] });
      if (url.pathname.endsWith("/errors")) {
        return json({ data: { list: url.searchParams.get("offset") === "0" ? firstPage : [firstPage[99]], total: 101 } });
      }
      if (url.pathname.endsWith("/solutions")) return json({ data: [] });
      return json({}, 404);
    },
  });
  const drafts = await adapter.sync("session=masked", { wrongOnly: true }, () => undefined);
  assert.equal(drafts.length, 100);
  assert.equal(adapter.diagnostics().duplicates, 1);
});

test("粉笔请求使用有界超时并返回稳定 timeout 分类", async () => {
  const adapter = new FenbiAccountImportAdapter({
    requestTimeoutMs: 1,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  await assert.rejects(() => adapter.validate("session=abc"), (error: unknown) => {
    assert.equal((error as FenbiAccountImportError).code, "timeout");
    return true;
  });
});

test("粉笔稳定题目 ID 优先于题干指纹去重", () => {
  const draft = normalizeFenbiDraft({ id: "fenbi-1", stem: "不同写法题干", answer: "A", board: "常识判断" });
  const [marked] = markDuplicateDrafts([draft], [{ id: "m1", sourceId: "fenbi-1", board: "常识判断", source: "粉笔", stem: "旧题干", answer: "A", explanation: "", reasons: [], tags: [], mastery: 2, nextReviewAt: "", createdAt: "", updatedAt: "" }]);
  assert.equal(marked.issues?.includes("duplicate"), true);
  assert.equal(marked.needsReview, true);
});

test("候选 Cookie 先验证后替换旧密文，错误留在配置弹层并显示请求 ID", () => {
  const hook = readFileSync(new URL("../../features/import/use-fenbi-quick-import.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../features/import/fenbi-quick-import-panel.tsx", import.meta.url), "utf8");
  const validationStart = hook.indexOf('fetchLocalApi("/api/import/fenbi/validate"');
  const candidateSave = hook.indexOf("if (candidate) await fenbiCredentialRepository.save");
  assert.ok(validationStart >= 0 && candidateSave > validationStart);
  assert.match(panel, /正在验证粉笔会话/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /请求 ID/);
});

