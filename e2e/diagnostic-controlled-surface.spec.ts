import { expect, test } from "@playwright/test";
import { readFileSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";

test.describe.configure({ mode: "serial" });

for (const choice of ["five", "four"]) {
  test(`controlled diagnostic captures ${choice} before answer reveal and survives reload`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const initial = await page.goto("/diagnostic");
    expect(await initial!.text()).not.toMatch(/verifiedCorrectOptionId|correctOptionId|keyRule|canonicalAnswer|bounded-integer-addition/);
    await expect(page).toHaveTitle("错题复盘");
    await expect(page.getByTestId("diagnostic-prompt")).toHaveText("2 + 3 = ?");
    await expect(page.locator('input[type="radio"]').first()).toHaveAttribute("name", "selectedOptionId");
    expect(await page.locator('input[type="radio"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
      .toEqual(["four", "five", "six"]);
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
    await expect(page.getByText("正确答案：", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveText(["提交答案"]);
    await expect(page.locator('input[name="assistance"], input[name="attemptId"], input[name="occurredAt"]')).toHaveCount(0);
    await page.locator(`input[value="${choice}"]`).check();
    const posted = page.waitForResponse((response) => response.url().endsWith("/api/diagnostic/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "提交答案" }).click();
    const submission = await posted;
    expect(submission.status()).toBe(303);
    expect(await submission.request().allHeaders()).toMatchObject({ origin: "null", "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
    await expect(page.getByRole("heading", { name: "已提交" })).toBeVisible();
    await expect(page.getByText(`你的选择：${choice === "five" ? "5" : "4"}`, { exact: true })).toBeVisible();
    await expect(page.getByText("正确答案：5", { exact: true })).toBeVisible();
    await expect(page.getByTestId("diagnostic-explanation")).toHaveText("2 + 3 = 5。");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "已提交" })).toBeVisible();
    await expect(page.getByText(`你的选择：${choice === "five" ? "5" : "4"}`, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "重新作答" }).click();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("real route rejects forged capture authority before accepting a valid learner action", async ({ page, request }) => {
  await page.goto("/diagnostic");
  const sessionId = await page.locator('input[name="sessionId"]').inputValue();
  for (const field of ["assistance", "attemptId", "occurredAt", "specRevision", "managedRoot", "profileId", "epochId", "canonicalAnswer", "verified", "sourceOwnerId"]) {
    const response = await request.post("/api/diagnostic/submit", { form: { sessionId, selectedOptionId: "five", [field]: "caller" } });
    expect(response.status()).toBe(400);
  }
  await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
  await page.locator('input[value="five"]').check();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.getByText("正确答案：5", { exact: true })).toBeVisible();
  const duplicate = await request.post("/api/diagnostic/submit", { form: { sessionId, selectedOptionId: "four" } });
  expect(duplicate.status()).toBe(409);
  const identical = await request.post("/api/diagnostic/submit", { form: { sessionId, selectedOptionId: "five" } });
  expect(identical.status()).toBe(409);
  await page.reload();
  await expect(page.getByText("你的选择：5", { exact: true })).toBeVisible();
});

test("offline managed profile locks the answer and manual continuation confirms it before reveal", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(".cache/f3-validation/diagnostic-server-fixture.json", "utf8")) as {
    root: string; managedRoot: string; file: string;
  };
  // 故障只作用于本次 launcher 创建的临时 profile，先核对两个 rename 目标的绝对边界。
  expect(path.dirname(fixture.root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(fixture.root)).toMatch(/^recall-durable-submission-test-/);
  const offline = fixture.managedRoot + "-offline";
  for (const target of [fixture.managedRoot, offline, fixture.file]) {
    expect(path.isAbsolute(target)).toBe(true);
    expect(path.relative(fixture.root, target)).not.toMatch(/^\.\./);
    expect(path.relative(fixture.root, target)).not.toBe("");
  }
  await page.goto("/diagnostic");
  await page.locator('input[value="four"]').check();
  const before = JSON.parse(readFileSync(fixture.file, "utf8"));
  renameSync(fixture.managedRoot, offline);
  let isOffline = true;
  try {
    const posted = page.waitForResponse(response => response.url().endsWith("/api/diagnostic/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "提交答案" }).click();
    expect((await posted).status()).toBe(503);
    await page.getByRole("link", { name: "返回作答页" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "答案已锁定" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
    await expect(page.getByText("正确答案：", { exact: false })).toHaveCount(0);
    await expect(page.locator('input[name="selectedOptionId"]')).toHaveValue("four");
    renameSync(offline, fixture.managedRoot); isOffline = false;
    await page.getByRole("button", { name: "重试提交" }).click();
    await expect(page.getByRole("heading", { name: "已提交" })).toBeVisible();
    await expect(page.getByText("你的选择：4", { exact: true })).toBeVisible();
    await expect(page.getByText("正确答案：5", { exact: true })).toBeVisible();
    const after = JSON.parse(readFileSync(fixture.file, "utf8"));
    expect(after.generation).toBe(before.generation + 1);
    expect(after.captures).toHaveLength(before.captures.length + 1);
    expect(after.captures.at(-1).selectedOptionId).toBe("four");
  } finally { if (isOffline) renameSync(offline, fixture.managedRoot); }
});
