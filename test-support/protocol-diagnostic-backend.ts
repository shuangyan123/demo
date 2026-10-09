import { createServer } from "node:http";
import { initializeDiagnosticRuntime, closeDiagnosticRuntime } from "../app/server/diagnostic/runtime.ts";
import { issueDiagnostic, readDiagnostic } from "../app/server/diagnostic/assessment-store.ts";
import { loadDiagnosticResumeView } from "../app/server/diagnostic/resume-view.ts";
import { POST } from "../app/api/diagnostic/submit/route.ts";
import { authorizeProtocolDiagnosticBackend, protocolRequestAuthorized } from "./protocol-diagnostic-guard.ts";

// IPC 父进程授权、fixture ownership/layout 与 token 必须全部通过，才能打开存储。
if (!process.send || !process.connected) throw new Error("protocol_test_authorization_required");
const invocation = await new Promise<unknown>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("protocol_test_authorization_required")), 5000);
  const disconnected = () => { clearTimeout(timer); reject(new Error("protocol_test_authorization_required")); };
  process.once("disconnect", disconnected);
  process.once("message", message => { clearTimeout(timer); process.removeListener("disconnect", disconnected); resolve(message); });
});
const authorized = authorizeProtocolDiagnosticBackend(invocation, { connected: process.connected, parentPid: process.ppid,
  token: process.env.REVIEW_DESKTOP_RUNTIME_TOKEN, payload: process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP });
initializeDiagnosticRuntime();
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url!, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  if (!protocolRequestAuthorized(incoming.headers["x-review-runtime-token"], authorized.token)) {
    outgoing.writeHead(403); outgoing.end("denied"); return;
  }
  if (incoming.method === "POST") {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of incoming) { bytes += chunk.length; if (bytes > 2048) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string" && name !== "x-review-runtime-token") headers.set(name, value);
    const result = await POST(new Request(url, { method: "POST", headers, body: Buffer.concat(chunks) }));
    process.send?.({ method: "POST", status: result.status, site: headers.get("sec-fetch-site") });
    outgoing.writeHead(result.status, Object.fromEntries(result.headers)); outgoing.end(Buffer.from(await result.arrayBuffer())); return;
  }
  outgoing.setHeader("content-type", "text/html; charset=utf-8"); outgoing.setHeader("referrer-policy", "no-referrer");
  if (url.pathname === "/diagnostic/resume") {
    const view = loadDiagnosticResumeView();
    outgoing.end(`<pre id="view">${escape(JSON.stringify(view))}</pre><a id="repeat" href="/diagnostic">repeat</a>`); return;
  }
  const assessment = url.searchParams.has("session") ? readDiagnostic(url.searchParams.get("session")!) : issueDiagnostic();
  if (assessment.kind === "issued") outgoing.end(`<form action="/api/diagnostic/submit" method="post">
    <input type="hidden" name="sessionId" value="${escape(assessment.sessionId)}">
    ${assessment.presentation.content.options.map(option => `<input type="radio" name="selectedOptionId" value="${escape(option.id)}">`).join("")}
    <button type="submit">submit</button></form>`);
  else if (assessment.kind === "revealed") outgoing.end('<h1 id="revealed">submitted</h1><a id="resume" href="/diagnostic/resume">resume</a>');
  else outgoing.end('<p id="unavailable">unavailable</p>');
});
server.listen(0, "127.0.0.1", () => process.send?.({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
process.on("message", message => { if (message === "stop") server.close(() => { closeDiagnosticRuntime(); process.exit(0); }); });
