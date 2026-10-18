import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function storageExpression(mode) {
  assert.ok(["write", "read"].includes(mode));
  // 只写合成专用 namespace；不伪造业务 schema migration 或真实学习记录。
  return `(async()=>{
    const expected={id:'synthetic-only',text:'Recall disposable upgrade fixture',count:17};
    const db=await new Promise((ok,no)=>{const r=indexedDB.open('recall_install_acceptance',1);r.onupgradeneeded=()=>r.result.createObjectStore('fixtures',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
    if(${JSON.stringify(mode)}==='write'){
      localStorage.setItem('recall-install-acceptance-config',JSON.stringify({theme:'synthetic',version:1}));
      await new Promise((ok,no)=>{const t=db.transaction('fixtures','readwrite');t.objectStore('fixtures').put(expected);t.oncomplete=ok;t.onerror=()=>no(t.error)});
    }
    const data=await new Promise((ok,no)=>{const r=db.transaction('fixtures').objectStore('fixtures').get('synthetic-only');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});db.close();
    return {data,config:JSON.parse(localStorage.getItem('recall-install-acceptance-config')||'null'),origin:location.origin,ready:document.readyState,textLength:document.body.innerText.length,workspace:/错题|学习|设置/.test(document.body.innerText)};
  })()`;
}

async function run() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Never run installed-app probes on a local host");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(process.env.RUNNER_OS, "Windows");
  const [portText, mode, output] = process.argv.slice(2);
  assert.match(portText, /^\d{4,5}$/);
  const endpoint = `http://127.0.0.1:${portText}`;
  const deadline = Date.now() + 90_000;
  let target;
  let seenTargetKinds = [];
  let successfulDiscoveryPolls = 0;
  let failedDiscoveryPolls = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      assert.ok(Array.isArray(targets), "Owned CDP target discovery must return a list");
      successfulDiscoveryPolls++;
      // Keep only target kind and a coarse origin category; no runtime tokens or raw URLs.
      seenTargetKinds = targets.map(t => ({
        type: String(t.type ?? "unknown"),
        origin: typeof t.url === "string" && t.url.startsWith("review-app://workspace/")
          ? "review-app://workspace/" : t.url?.startsWith("devtools://") ? "devtools://" : "other",
      }));
      target = targets.find(t => t.type === "page" && typeof t.url === "string" && t.url.startsWith("review-app://workspace/"));
      if (target) break;
    } catch { failedDiscoveryPolls++; /* bounded readiness polling of the owned process */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!target) writeFileSync(output, JSON.stringify({
    status: "FAIL", phase: "workspace-page-discovery",
    successfulDiscoveryPolls, failedDiscoveryPolls, lastTargets: seenTargetKinds,
  }, null, 2));
  assert.ok(target, "Installed app must expose its loaded workspace page");
  const url = new URL(target.webSocketDebuggerUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.port, portText);
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const packet = JSON.parse(event.data);
    if (pending.has(packet.id)) {
      const cb = pending.get(packet.id); pending.delete(packet.id);
      if (packet.error) cb.reject(new Error(JSON.stringify(packet.error)));
      else cb.resolve(packet.result);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    let value;
    while (Date.now() < deadline) {
      const result = await send("Runtime.evaluate", { expression: storageExpression(mode), awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, "Storage probe must not throw");
      value = result.result.value;
      if (value?.workspace && value.textLength > 200 && value.ready === "complete") break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(value.workspace, true, "Actual installed workspace rendered");
    assert.ok(value.textLength > 200);
    assert.deepEqual(value.data, { id: "synthetic-only", text: "Recall disposable upgrade fixture", count: 17 });
    assert.deepEqual(value.config, { theme: "synthetic", version: 1 });
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${output}.png`, Buffer.from(screenshot.data, "base64"));
    writeFileSync(output, JSON.stringify({ status: "PASS", mode, ...value }, null, 2));
    console.log(JSON.stringify({ status: "PASS", mode, workspace: true, indexedDB: true, localStorage: true }));
  } finally { socket.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
