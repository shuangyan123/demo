import assert from "node:assert/strict";
import test from "node:test";
import { FenbiAccountImportAdapter } from "./fenbi-account-import-adapter.ts";

const enabled = process.env.RUN_LIVE_FENBI_TESTS === "1" && Boolean(process.env.FENBI_COOKIE);

test("真实粉笔只读同步 smoke", { skip: !enabled }, async () => {
  const cookie = process.env.FENBI_COOKIE ?? "";
  const drafts = await new FenbiAccountImportAdapter().sync(cookie, { wrongOnly: true, sinceDays: 1 }, () => undefined, AbortSignal.timeout(30_000));
  assert.equal(Array.isArray(drafts), true);
});

