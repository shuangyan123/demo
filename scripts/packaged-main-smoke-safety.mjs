import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";

const REQUIRED_GATES = ["artifactBinding", "desktopInteraction", "knownFolderIsolation", "freshProfile", "networkBoundary", "processContainment", "storageBoundary"];
const REQUIRED_ASSERTIONS = ["packagedExecutable", "bundledStandalone", "externalRendererRejected", "reviewAppDocument", "mockDisabledInWindow", "networkConfined", "storageConfined", "normalExit"];
const SAFE_CODES = new Set(["precondition_failed", "assertion_incomplete", "deadline_exceeded", "driver_failed", "containment_unconfirmed", "cleanup_failed"]);

/** 只删除本调用独占创建的目录；链接或身份变化时保留现场，不跟随到无关资料。 */
export async function createSmokeScope(parent = os.tmpdir()) {
  const canonicalParent = await realpath(parent);
  const root = await mkdtemp(path.join(canonicalParent, "recall-packaged-smoke-"));
  const owner = await lstat(root);
  const nonce = randomBytes(24).toString("hex");
  const marker = path.join(root, ".smoke-owner");
  await writeFile(marker, nonce, { flag: "wx", mode: 0o600 });
  const scope = Object.freeze({ root, profile: path.join(root, "profile"), temp: path.join(root, "temp") });
  await mkdir(scope.profile); await mkdir(scope.temp);
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const item = await lstat(file);
      if (item.isSymbolicLink()) throw new Error("unsafe_cleanup_link");
      if (item.isDirectory()) await inspect(file);
    }
  }
  async function cleanup() {
    const current = await lstat(root);
    if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== owner.dev || current.ino !== owner.ino
      || path.dirname(root) !== canonicalParent || await realpath(root) !== root
      || (await lstat(marker)).isSymbolicLink() || await readFile(marker, "utf8") !== nonce) throw new Error("unsafe_cleanup_owner");
    await inspect(root);
    await rm(root, { recursive: true });
  }
  return { scope, cleanup };
}

/** 环境白名单不是 Known Folder 隔离证明；真实驱动仍须用测试用户令牌独立核验。 */
export function smokeEnvironment(scope, systemRoot, executableDirectory, sentinelUrl) {
  const url = new URL(sentinelUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash)
    throw new Error("invalid_sentinel");
  for (const value of [scope.root, scope.profile, scope.temp, systemRoot, executableDirectory]) {
    if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error("invalid_environment_path");
  }
  for (const value of [scope.profile, scope.temp]) {
    const relative = path.relative(scope.root, value);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("invalid_environment_root");
  }
  return Object.freeze({ SystemRoot: systemRoot, WINDIR: systemRoot,
    PATH: [executableDirectory, path.join(systemRoot, "System32")].join(path.delimiter),
    USERPROFILE: scope.profile, TEMP: scope.temp, TMP: scope.temp,
    ELECTRON_RENDERER_URL: url.href, RECALL_UPDATE_MOCK_SCENARIO: "available" });
}

function field(record, key) {
  try { return Object.getOwnPropertyDescriptor(record, key)?.value; }
  catch { return undefined; }
}
function verified(record) { return field(record, "executed") === true && field(record, "passed") === true; }
export function missingSmokeGates(records) { return REQUIRED_GATES.filter(key => !verified(field(records, key))); }

/** 只投影固定断言名和状态，不传播驱动异常、原始环境、URL、日志或令牌。 */
export function judgeSmokeEvidence(records, simulation) {
  const missing = REQUIRED_ASSERTIONS.filter(key => !verified(field(records, key)));
  const http = field(records, "http409");
  return { status: missing.length ? "INCOMPLETE" : simulation ? "SIMULATION_PASSED" : "EVIDENCE_REQUIRES_OS_VALIDATION",
    actualPackagedAcceptance: false,
    assertions: Object.fromEntries(REQUIRED_ASSERTIONS.map(key => [key, verified(field(records, key)) ? "reported" : "unverified"])),
    http409: field(http, "executed") === true && field(http, "source") === "independent-os-observation" && field(http, "status") === 409
      ? simulation ? "simulated" : "reported_unvalidated" : "unobserved" };
}

function deadline(milliseconds, operation, abort) {
  let timer;
  return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(Object.assign(new Error(), { smokeCode: "deadline_exceeded" })); }, milliseconds);
  })]).finally(() => clearTimeout(timer));
}

/** 测试驱动是受信依赖，不接受进程环境中的“证明 JSON”。此模块没有真实应用启动 CLI。 */
export async function exerciseSmokeTool(driver, { parent, timeoutMs = 3000, stopTimeoutMs = 3000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120000
    || !Number.isInteger(stopTimeoutMs) || stopTimeoutMs < 10 || stopTimeoutMs > 30000) throw new Error("invalid_deadline");
  const owned = await createSmokeScope(parent);
  const abort = new AbortController();
  let code, evidence, operation, settled = false, stopped = false, cleaned = false;
  try {
    operation = Promise.resolve().then(async () => {
      const gates = await driver.prepare(owned.scope, abort.signal);
      if (abort.signal.aborted) return;
      if (missingSmokeGates(gates).length) throw Object.assign(new Error(), { smokeCode: "precondition_failed" });
      await driver.start(owned.scope, abort.signal);
      if (abort.signal.aborted) return;
      evidence = await driver.observe(owned.scope, abort.signal);
      if (abort.signal.aborted) return;
      await driver.closeNormally(abort.signal);
    }).finally(() => { settled = true; });
    await deadline(timeoutMs, () => operation, abort);
    if (judgeSmokeEvidence(evidence, true).status === "INCOMPLETE") code = "assertion_incomplete";
  } catch (error) { const failure = field(error, "smokeCode"); code = SAFE_CODES.has(failure) ? failure : "driver_failed"; }
  finally {
    abort.abort();
    // 停止确认失败时保留目录，避免仍存活的进程访问已清理/重建的位置。
    try {
      stopped = await deadline(stopTimeoutMs, () => driver.stopAndConfirm(), new AbortController()) === true;
      if (operation && !settled) await deadline(stopTimeoutMs, () => operation.catch(() => {}), new AbortController());
      stopped = stopped && settled;
    }
    catch { stopped = false; }
    if (!stopped) code = "containment_unconfirmed";
    if (stopped) {
      try { await owned.cleanup(); cleaned = true; }
      catch { code = "cleanup_failed"; }
    }
  }
  // 本地工具验证永不返回真实 packaged PASS；真实 OS 驱动必须另行验证后实现。
  return { ...judgeSmokeEvidence(code ? undefined : evidence, true), code: code ?? null,
    stopped, cleaned, actualPackagedAcceptance: false };
}
