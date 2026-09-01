import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFenbiSessionAuthority,
  FENBI_SESSION_PARTITION,
} from "./fenbi-session-authority.ts";
import {
  createFenbiWebPreferences,
  FENBI_REQUEST_ALLOWED_HOSTS,
  FENBI_WEB_ALLOWED_HOSTS,
  installFenbiRemoteContentPolicy,
  installFenbiWebContentsPolicy,
  isAllowedFenbiRequestUrl,
  isAllowedFenbiWebUrl,
  isFenbiPermissionAllowed,
} from "./fenbi-policy.ts";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("./fenbi-session.ts", import.meta.url), "utf8");
const sessionIpc = readFileSync(new URL("./fenbi-session-ipc.ts", import.meta.url), "utf8");
const ipcTrust = readFileSync(new URL("./fenbi-ipc-trust.ts", import.meta.url), "utf8");
const policy = readFileSync(new URL("./fenbi-policy.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
const desktopContract = readFileSync(new URL("./desktop.contract.test.ts", import.meta.url), "utf8");
const artifactContract = readFileSync(new URL("../scripts/desktop-preload-artifact.contract.test.mjs", import.meta.url), "utf8");
const fenbiAdapter = readFileSync(new URL("../app/server/import/fenbi-account-import-adapter.ts", import.meta.url), "utf8");

type FakeSession = { id: string };
type FakeHandler = (...args: unknown[]) => unknown;

test("Fenbi 使用唯一 persistent dedicated partition，不复用 Recall workspace", () => {
  assert.equal(FENBI_SESSION_PARTITION, "persist:review-fenbi");
  assert.notEqual(FENBI_SESSION_PARTITION, "persist:review-workspace");
  assert.match(session, /session\.fromPartition\(partition\)/);
  assert.doesNotMatch(session, /persist:review-workspace/);
  assert.match(main, /const partition = "persist:review-workspace"/);
  assert.match(main, /initializeFenbiSession\(\)/);
});

test("session authority 只创建一次、只安装一次 policy，并保持 status 保守", async () => {
  const createdPartitions: string[] = [];
  const installedFor: FakeSession[] = [];
  const cleared: FakeSession[] = [];
  const fakeSession: FakeSession = { id: "fenbi-only" };
  const authority = createFenbiSessionAuthority<FakeSession>({
    fromPartition: (partition) => {
      createdPartitions.push(partition);
      return fakeSession;
    },
    installPolicy: (targetSession) => installedFor.push(targetSession),
    hasSessionData: async () => true,
    clearSession: async (targetSession) => {
      cleared.push(targetSession);
    },
  });

  assert.equal(authority.getFenbiSession(), fakeSession);
  assert.equal(authority.initializeFenbiSession(), fakeSession);
  assert.deepEqual(createdPartitions, ["persist:review-fenbi"]);
  assert.deepEqual(installedFor, [fakeSession]);
  assert.deepEqual(await authority.getFenbiSessionStatus(), {
    available: true,
    persistent: true,
    hasSessionData: true,
    authentication: "unknown",
  });
  await authority.clearFenbiSession();
  assert.deepEqual(cleared, [fakeSession]);
});

test("session status never claims authenticated from session data", async () => {
  const authority = createFenbiSessionAuthority<FakeSession>({
    fromPartition: () => ({ id: "fenbi-only" }),
    installPolicy: () => undefined,
    hasSessionData: async () => true,
    clearSession: async () => undefined,
  });
  const status = await authority.getFenbiSessionStatus();
  assert.equal(status.authentication, "unknown");
  assert.doesNotMatch(JSON.stringify(status), /authenticated|Cookie|token|secret/i);
});

test("Fenbi web navigation and request targets use separate exact-host policies", () => {
  assert.deepEqual(FENBI_WEB_ALLOWED_HOSTS, ["www.fenbi.com", "tiku.fenbi.com"]);
  assert.deepEqual(FENBI_REQUEST_ALLOWED_HOSTS, ["tiku.fenbi.com"]);
  assert.equal(isAllowedFenbiWebUrl("https://www.fenbi.com/"), true);
  assert.equal(isAllowedFenbiWebUrl("https://www.fenbi.com/member/login.php"), true);
  assert.equal(isAllowedFenbiWebUrl("https://tiku.fenbi.com/"), true);
  assert.equal(isAllowedFenbiRequestUrl("https://tiku.fenbi.com/api/account"), true);
  assert.equal(isAllowedFenbiRequestUrl("https://www.fenbi.com/member/login.php"), false);

  for (const check of [isAllowedFenbiWebUrl, isAllowedFenbiRequestUrl]) {
    assert.equal(check("http://tiku.fenbi.com/"), false);
    assert.equal(check("https://example.com/"), false);
    assert.equal(check("https://fenbi.com.evil.example/"), false);
    assert.equal(check("https://tiku.fenbi.com.evil.example/"), false);
    assert.equal(check("https://user:password@tiku.fenbi.com/"), false);
    assert.equal(check("https://tiku.fenbi.com:8443/"), false);
  }
  for (const value of ["javascript:alert(1)", "file:///tmp/account", "data:text/html,login", "custom://fenbi/login"]) {
    assert.equal(isAllowedFenbiWebUrl(value), false, value);
    assert.equal(isAllowedFenbiRequestUrl(value), false, value);
  }
});

test("Fenbi remote policy is deny-by-default and can be exercised with fakes", () => {
  const permissionHandlers: FakeHandler[] = [];
  const requestHandlers: FakeHandler[] = [];
  const displayHandlers: FakeHandler[] = [];
  const sessionEvents = new Map<string, FakeHandler>();
  const fakeSession = {
    setPermissionCheckHandler: (handler: FakeHandler) => permissionHandlers.push(handler),
    setPermissionRequestHandler: (handler: FakeHandler) => requestHandlers.push(handler),
    setDisplayMediaRequestHandler: (handler: FakeHandler) => displayHandlers.push(handler),
    on: (event: string, handler: FakeHandler) => sessionEvents.set(event, handler),
  };
  installFenbiRemoteContentPolicy(fakeSession as never);
  assert.equal(isFenbiPermissionAllowed("media"), false);
  assert.equal(isFenbiPermissionAllowed("fileSystem"), false);
  assert.equal(permissionHandlers[0]?.(null, "media", "https://tiku.fenbi.com/", {}), false);
  let permissionResult: boolean | undefined;
  requestHandlers[0]?.(null, "notifications", (value: boolean) => { permissionResult = value; });
  assert.equal(permissionResult, false);
  let displayResult: unknown;
  displayHandlers[0]?.(null, (value: unknown) => { displayResult = value; });
  assert.deepEqual(displayResult, {});
  let downloadPrevented = false;
  sessionEvents.get("will-download")?.({ preventDefault: () => { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);
});

test("future Fenbi WebContents policy rejects navigation and popup escape", () => {
  const handlers = new Map<string, FakeHandler>();
  let popupResult: unknown;
  const fakeContents = {
    setWindowOpenHandler: (handler: () => unknown) => { popupResult = handler(); },
    on: (event: string, handler: FakeHandler) => handlers.set(event, handler),
  };
  installFenbiWebContentsPolicy(fakeContents as never);
  assert.deepEqual(popupResult, { action: "deny" });
  let navigationPrevented = false;
  handlers.get("will-navigate")?.({ preventDefault: () => { navigationPrevented = true; } }, "https://example.com/");
  assert.equal(navigationPrevented, true);
  navigationPrevented = false;
  handlers.get("will-navigate")?.({ preventDefault: () => { navigationPrevented = true; } }, "https://www.fenbi.com/member/login.php");
  assert.equal(navigationPrevented, false);
  handlers.get("will-redirect")?.({ preventDefault: () => { navigationPrevented = true; } }, "https://fenbi.com.evil.example/");
  assert.equal(navigationPrevented, true);
});

test("future Fenbi content keeps the Electron isolation baseline", () => {
  assert.deepEqual(createFenbiWebPreferences(), {
    partition: FENBI_SESSION_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
  assert.match(policy, /partition:\s*FENBI_SESSION_PARTITION/);
  assert.doesNotMatch(policy, /new\s+WebContentsView|WebContentsView\s*\(/);
});

test("preload bridge is sanitized and has no raw-cookie getter", () => {
  assert.match(preload, /reviewFenbiSession/);
  assert.match(preload, /getStatus/);
  assert.match(preload, /clear/);
  assert.doesNotMatch(preload, /getCookie|getCookies|getCookieHeader|revealFenbiSecret|cookies\.get|Set-Cookie|document\.cookie/);
  assert.doesNotMatch(preload, /fromPartition|webContents|ipcRenderer\.send/);
  assert.match(ipcTrust, /event\.senderFrame\?\.url \?\? event\.sender\.getURL\(\)/);
  assert.match(ipcTrust, /review-app:\/\/workspace\//);
});

test("clear seam only targets the dedicated Fenbi session and not Recall data", () => {
  assert.match(session, /clearStorageData\(\)/);
  assert.match(session, /clearCache\(\)/);
  assert.match(session, /clearAuthCache\(\)/);
  assert.doesNotMatch(session, /review-workspace|reviewDesktopCredentialProtection|reviewDb|localStorage/);
  assert.doesNotMatch(session, /clearAll|defaultSession|fromPartition\("persist:review-workspace"/);
  assert.match(desktopContract, /fenbi-session\.contract\.test\.ts/);
});

test("main-only request seam validates target URL and is absent from preload", () => {
  const fenbiPreload = preload.slice(preload.indexOf("const reviewFenbiSession"));
  assert.match(session, /readFenbiRequestCookieHeader/);
  assert.match(session, /isAllowedFenbiRequestUrl\(targetUrl\)/);
  assert.match(session, /cookies\.get\(\{ url: targetUrl \}\)/);
  assert.match(session, /FENBI_TARGET_NOT_ALLOWED/);
  assert.doesNotMatch(fenbiPreload, /readFenbiRequestCookieHeader|Cookie|token|secret/i);
  assert.doesNotMatch(session, /console\.(log|error|warn)/);
});

test("manual Fenbi adapter remains the existing app/server authority", () => {
  assert.match(fenbiAdapter, /const FENBI_ORIGIN = "https:\/\/tiku\.fenbi\.com"/);
  assert.match(fenbiAdapter, /export class FenbiAccountImportAdapter/);
  assert.doesNotMatch(session, /app\/server|fenbi-account-import-adapter/);
  assert.doesNotMatch(sessionIpc, /app\/server|fenbi-account-import-adapter/);
});

test("desktop artifact contract includes only the five explicit bridges", () => {
  assert.match(artifactContract, /reviewFenbiSession/);
  assert.match(artifactContract, /reviewFenbiView/);
  assert.match(policy, /isAllowedFenbiWebUrl/);
  assert.match(policy, /FENBI_WEB_ALLOWED_HOSTS/);
  assert.match(policy, /FENBI_REQUEST_ALLOWED_HOSTS/);
  assert.match(session, /isAllowedFenbiRequestUrl/);
  assert.match(policy, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(policy, /setPermissionRequestHandler/);
  assert.match(policy, /setDisplayMediaRequestHandler/);
});
