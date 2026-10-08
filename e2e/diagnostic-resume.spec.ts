import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { diagnosticStorageFixture } from "../test-support/diagnostic-storage.ts";
import type { DiagnosticHistorySnapshotV1 } from "../app/types/domains/diagnostic-history.ts";
import type { DiagnosticStateReconstruction } from "../app/server/diagnostic/reconstruction-types.ts";

type Fixture = ReturnType<typeof diagnosticStorageFixture>;
type Application = { child: ChildProcess; url: string; pid: number };
function assertTestPath(fixture: Fixture, target: string) {
  expect(path.dirname(fixture.root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(fixture.root)).toMatch(/^recall-durable-submission-test-/);
  const relative = path.relative(fixture.root, target);
  expect(path.isAbsolute(target)).toBe(true); expect(relative).not.toBe("");
  expect(relative).not.toMatch(/^\.\.(?:[\\/]|$)/); expect(path.isAbsolute(relative)).toBe(false);
}
function snapshot(fixture: Fixture): DiagnosticHistorySnapshotV1 {
  assertTestPath(fixture, fixture.file);
  return JSON.parse(readFileSync(fixture.file, "utf8"));
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function stop(app: Application) {
  if (app.child.exitCode !== null || app.child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`application ${app.pid} did not exit`)), 15_000);
    app.child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (!app.child.kill("SIGTERM")) { clearTimeout(timer); reject(new Error("application termination failed")); }
  });
  expect(app.child.exitCode !== null || app.child.signalCode !== null).toBe(true);
}
async function launch(fixture: Fixture): Promise<Application> {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/start-next-standalone.mjs"], { cwd: process.cwd(), windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port),
      REVIEW_DESKTOP_RUNTIME_TOKEN: "", RECALL_MANAGED_STORAGE_BOOTSTRAP: fixture.payload } });
  let output = "";
  child.stdout?.on("data", chunk => { output = (output + chunk).slice(-16000); });
  child.stderr?.on("data", chunk => { output = (output + chunk).slice(-16000); });
  if (!child.pid) throw new Error("application did not spawn");
  const app = { child, pid: child.pid, url: `http://127.0.0.1:${port}` };
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`application exited: ${output}`);
      try { if ((await fetch(app.url, { signal: AbortSignal.timeout(500) })).ok) return app; } catch { /* 等待本测试拥有的服务就绪。 */ }
      await delay(250);
    }
    throw new Error(`application startup timeout: ${output}`);
  } catch (error) { await stop(app); throw error; }
}
function canonical(fixture: Fixture, asOf: string) {
  // 私有测试进程只读 F4 API；raw facts 留在 test runner，绝不建立公共 history endpoint。
  const script = `import {initializeDiagnosticRuntime,closeDiagnosticRuntime} from './app/server/diagnostic/runtime.ts';
    import {reconstructDiagnosticLearnerState} from './app/server/diagnostic/state-reconstruction.ts';
    initializeDiagnosticRuntime(); const result=reconstructDiagnosticLearnerState({specId:'int-add-2-3',specRevision:'r1',asOf:process.argv[1]});
    closeDiagnosticRuntime(); process.stdout.write(JSON.stringify(result));`;
  const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, asOf],
    { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, RECALL_MANAGED_STORAGE_BOOTSTRAP: fixture.payload } })) as DiagnosticStateReconstruction;
  expect(result.kind).toBe("complete");
  if (result.kind !== "complete") throw new Error("canonical test read failed");
  return result;
}
async function fromDashboard(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "诊断与已保存作答", exact: true }).click();
  await expect(page).toHaveURL(/\/diagnostic\/resume$/);
}
async function answer(page: Page, choice: "five" | "four") {
  expect(await page.content()).not.toMatch(/verifiedCorrectOption|correctOptionId|canonicalAnswer|bounded-integer-addition|source-admission\/v1/);
  await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
  await page.locator(`input[value="${choice}"]`).check();
  const response = page.waitForResponse(value => value.url().endsWith("/api/diagnostic/submit") && value.request().method() === "POST");
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  expect((await response).status()).toBe(303);
  await expect(page.getByRole("heading", { name: "已提交", exact: true })).toBeVisible();
  await expect(page.getByText("正确答案：5", { exact: true })).toBeVisible();
}
function allStopped(apps: Application[]) {
  return apps.every(app => app.child.exitCode !== null || app.child.signalCode !== null);
}

test("dashboard → durable five → independent A/B restart → exact recovery → explicit four counterevidence", async ({ browser }, testInfo) => {
  const fixture = diagnosticStorageFixture(); const apps: Application[] = []; let context: BrowserContext | undefined;
  try {
    const a = await launch(fixture); apps.push(a);
    context = await browser.newContext({ baseURL: a.url, viewport: { width: 1440, height: 900 } });
    let page = await context.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const emptyBytes = readFileSync(fixture.file, "utf8");
    await fromDashboard(page);
    await expect(page.getByTestId("diagnostic-resume-complete")).toHaveAttribute("data-history", "complete-empty");
    await expect(page.getByTestId("diagnostic-resume-empty")).toContainText("不表示你从未学习");
    expect(readFileSync(fixture.file, "utf8")).toBe(emptyBytes);
    await page.getByRole("link", { name: "再次作答这道诊断题", exact: true }).click();
    await answer(page, "five"); const oldSessionUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    const first = snapshot(fixture); expect(first.captures).toHaveLength(1);
    expect(first.generation).toBe(1); expect(first.captures[0].selectedOptionId).toBe("five");
    expect(first.captures[0].provenance).toEqual({ mechanism: "first-party-diagnostic-capture/v1",
      presentation: "controlled_surface_delivered", assistanceBasis: "controlled_surface_no_builtin_assistance", ordering: "submitted_before_reveal" });
    const asOf = new Date().toISOString(); const live = canonical(fixture, asOf);
    expect(live.evidence).toHaveLength(1); expect(live.evidence[0].outcome.direction).toBe("supports");
    const committedBytes = readFileSync(fixture.file, "utf8");
    await page.getByRole("link", { name: "查看已保存作答", exact: true }).click();
    await expect(page.getByTestId("diagnostic-resume-attempt")).toHaveAttribute("data-attempt-id", first.captures[0].id);
    expect(readFileSync(fixture.file, "utf8")).toBe(committedBytes);
    await context.close(); context = undefined; await stop(a);
    const b = await launch(fixture); apps.push(b); expect(b.pid).not.toBe(a.pid);
    context = await browser.newContext({ baseURL: b.url, viewport: { width: 1440, height: 900 } });
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await fromDashboard(page);
    await expect(page.getByTestId("diagnostic-resume-count")).toHaveText("已确认 1 次作答，重新派生 1 条证据。");
    await expect(page.getByTestId("diagnostic-resume-attempt")).toHaveAttribute("data-attempt-id", first.captures[0].id);
    await expect(page.locator('[data-dimension="understanding"]')).toHaveAttribute("data-value", "emerging");
    await expect(page.locator('[data-dimension="independence"]')).toHaveAttribute("data-value", "independent");
    await expect(page.locator('[data-dimension="retention"]')).toHaveAttribute("data-value", "untested");
    await expect(page.locator('[data-dimension="transfer"]')).toHaveAttribute("data-value", "untested");
    await expect(page.getByTestId("diagnostic-resume-decision")).toHaveAttribute("data-kind", "none");
    await expect(page.getByTestId("diagnostic-resume-decision")).toHaveAttribute("data-reason", "no_authorized_verification_target");
    const recovered = canonical(fixture, asOf);
    expect(recovered).toEqual(live); expect(snapshot(fixture)).toEqual(first);
    await page.reload(); expect(readFileSync(fixture.file, "utf8")).toBe(committedBytes);
    expect(await page.content()).not.toMatch(/selectedOption|verifiedCorrect|source-admission\/v1|sourceRecordRefs|measurementGroupId/);
    mkdirSync("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/f5-resumed-desktop.png", fullPage: true });
    await page.goto(oldSessionUrl);
    await expect(page.getByRole("alert").filter({ hasText: "本次作答已失效" })).toBeVisible();
    await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
    await page.getByRole("link", { name: "查看已保存作答", exact: true }).click();
    expect(readFileSync(fixture.file, "utf8")).toBe(committedBytes);
    await page.getByRole("link", { name: "再次作答这道诊断题", exact: true }).click();
    await answer(page, "four");
    const second = snapshot(fixture); expect(second.captures).toHaveLength(2); expect(second.generation).toBe(2);
    expect(second.captures[0]).toEqual(first.captures[0]); expect(second.captures[1].id).not.toBe(first.captures[0].id);
    expect(Date.parse(second.captures[1].occurredAt)).toBeGreaterThan(Date.parse(first.captures[0].occurredAt));
    const later = canonical(fixture, new Date().toISOString()); expect(later.evidence).toHaveLength(2);
    expect(later.events.find(event => event.id === live.events[0].id)).toEqual(live.events[0]);
    expect(later.evidence.find(item => item.id === live.evidence[0].id)).toEqual(live.evidence[0]);
    expect(later.state?.understanding).toBe("unknown"); expect(later.state?.independence).toBe("unknown");
    expect(later.decision).toEqual({ kind: "none", reason: "ambiguous_verification_target" });
    const refute = later.evidence.find(item => item.outcome.direction === "refutes")!;
    expect(later.state?.promotionEligibility.understanding.effectiveEvidenceIds).toEqual([refute.id]);
    expect(later.state?.promotionEligibility.understanding.historicalQualifiedEvidenceIds).toEqual([live.evidence[0].id]);
    await page.getByRole("link", { name: "查看已保存作答", exact: true }).click();
    await expect(page.getByTestId("diagnostic-resume-attempt")).toHaveCount(2);
    await expect(page.locator('[data-dimension="understanding"]')).toHaveAttribute("data-value", "unknown");
    await expect(page.getByTestId("diagnostic-resume-decision")).toHaveAttribute("data-reason", "ambiguous_verification_target");
    const laterBytes = readFileSync(fixture.file, "utf8");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "output/playwright/f5-counterevidence-mobile.png", fullPage: true });
    await page.reload(); expect(readFileSync(fixture.file, "utf8")).toBe(laterBytes); expect(errors).toEqual([]);
    await testInfo.attach("restart-facts", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      processA: a.pid, processB: b.pid, profileId: first.profileId, epochId: first.epochId,
      firstAttempt: first.captures[0], secondAttempt: second.captures[1], canonicalBefore: live, canonicalAfterRestart: recovered,
      canonicalAfterRepeat: later, restartCanonicalEqual: true, resumeBytesUnchanged: true,
    }, null, 2)) });
  } finally {
    await context?.close(); for (const app of apps) await stop(app);
    expect(allStopped(apps)).toBe(true); fixture.cleanup(); expect(existsSync(fixture.root)).toBe(false);
  }
});

test("failed commit stays locked; manual continuation saves once; recovery failure never becomes empty history", async ({ browser }, testInfo) => {
  const fixture = diagnosticStorageFixture(); const apps: Application[] = []; let context: BrowserContext | undefined;
  const offline = fixture.config.managedRoot + "-offline"; const missingRecord = fixture.file + "-offline";
  let profileOffline = false; let recordOffline = false;
  try {
    assertTestPath(fixture, offline); assertTestPath(fixture, missingRecord);
    const app = await launch(fixture); apps.push(app); context = await browser.newContext({ baseURL: app.url });
    const page = await context.newPage(); await fromDashboard(page);
    await page.getByRole("link", { name: "再次作答这道诊断题", exact: true }).click();
    const sessionId = await page.locator('input[name="sessionId"]').inputValue();
    const before = snapshot(fixture); await page.locator('input[value="five"]').check();
    renameSync(fixture.config.managedRoot, offline); profileOffline = true;
    const posted = page.waitForResponse(response => response.url().endsWith("/api/diagnostic/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "提交答案", exact: true }).click(); expect((await posted).status()).toBe(503);
    await expect(page.getByRole("alert").filter({ hasText: "提交尚未完成" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "已提交", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "返回作答页", exact: true }).click();
    await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
    await expect(page.locator('input[name="sessionId"]')).toHaveValue(sessionId);
    await expect(page.locator('input[name="selectedOptionId"]')).toHaveValue("five");
    await page.getByRole("link", { name: "查看已保存作答", exact: true }).click();
    await expect(page.getByTestId("diagnostic-resume-failure")).toHaveAttribute("data-kind", "unavailable");
    await expect(page.getByTestId("diagnostic-resume-empty")).toHaveCount(0);
    renameSync(offline, fixture.config.managedRoot); profileOffline = false;
    await page.goto(`/diagnostic?session=${sessionId}`);
    await expect(page.getByTestId("diagnostic-explanation")).toHaveCount(0);
    await page.getByRole("button", { name: "重试提交", exact: true }).click();
    await expect(page.getByRole("heading", { name: "已提交", exact: true })).toBeVisible();
    const saved = snapshot(fixture); expect(saved.generation).toBe(before.generation + 1); expect(saved.captures).toHaveLength(1);
    const duplicate = await context.request.post("/api/diagnostic/submit", { form: { sessionId, selectedOptionId: "five" } });
    expect(duplicate.status()).toBe(409); expect(snapshot(fixture)).toEqual(saved);
    const bytes = readFileSync(fixture.file, "utf8"); renameSync(fixture.file, missingRecord); recordOffline = true;
    await page.goto("/diagnostic/resume");
    await expect(page.getByTestId("diagnostic-resume-failure")).toHaveAttribute("data-kind", "incomplete");
    await expect(page.getByTestId("diagnostic-resume-empty")).toHaveCount(0); await expect(page.getByTestId("diagnostic-resume-state")).toHaveCount(0);
    expect(existsSync(fixture.file)).toBe(false);
    renameSync(missingRecord, fixture.file); recordOffline = false;
    await page.getByRole("link", { name: "重新读取已保存作答", exact: true }).click();
    await expect(page.getByTestId("diagnostic-resume-attempt")).toHaveAttribute("data-attempt-id", saved.captures[0].id);
    expect(readFileSync(fixture.file, "utf8")).toBe(bytes);
    await testInfo.attach("manual-continuation-facts", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      process: app.pid, failedStatus: 503, finalGeneration: saved.generation, finalAttemptCount: saved.captures.length,
      attempt: saved.captures[0], duplicateStatus: duplicate.status(), missingRecordReadDidNotInitialize: true,
    }, null, 2)) });
  } finally {
    await context?.close(); for (const app of apps) await stop(app); expect(allStopped(apps)).toBe(true);
    if (profileOffline) renameSync(offline, fixture.config.managedRoot);
    if (recordOffline) renameSync(missingRecord, fixture.file);
    fixture.cleanup(); expect(existsSync(fixture.root)).toBe(false);
  }
});
