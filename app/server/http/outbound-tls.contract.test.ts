import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:https";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";

function openssl(): string {
  try { execFileSync("openssl", ["version"], { stdio: "ignore" }); return "openssl"; }
  catch {
    const gitExec = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const candidate = resolve(gitExec, "../../bin/openssl.exe");
    assert.ok(existsSync(candidate), "TLS fixture requires OpenSSL (on Windows, supplied by Git for Windows)");
    return candidate;
  }
}

test("real TLS preserves hostname SNI and Host, checks IP SAN, rejects wrong identity and untrusted CA", async () => {
  const root = mkdtempSync(join(tmpdir(), "recall-outbound-tls-"));
  const key = join(root, "ephemeral.key"), cert = join(root, "ephemeral.crt");
  const observed: Array<{ host?: string; servername?: string }> = [];
  const command = openssl();
  try {
    // 私钥只在本次测试自己的临时目录生成，不进入 Git、日志或审计生成物。
    execFileSync(command, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=identity.test", "-addext", "subjectAltName=DNS:identity.test,IP:127.0.0.1"], { stdio: "ignore" });
    const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
      observed.push({ host: request.headers.host, servername: (request.socket as import("node:tls").TLSSocket).servername || undefined });
      response.end("tls fixture");
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const modulePath = fileURLToPath(new URL("./outbound-fetch.ts", import.meta.url));
    const script = `import {outboundFetch} from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const response=await outboundFetch(process.argv[1],{}, {allowLoopback:true,lookupAll:async()=>[{address:"127.0.0.1",family:4}]});
      if(await response.text()!=="tls fixture") throw new Error("unexpected TLS body");`;
    const run = (host: string, trust: boolean) => new Promise<{ code: number | null; stderr: string }>((resolveRun, reject) => {
      const env = { ...process.env }; delete env.NODE_TLS_REJECT_UNAUTHORIZED; delete env.NODE_EXTRA_CA_CERTS;
      if (trust) env.NODE_EXTRA_CA_CERTS = cert;
      const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, `https://${host}:${address.port}/`], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = ""; child.stderr.on("data", data => { stderr += String(data); });
      child.on("error", reject); child.on("close", code => resolveRun({ code, stderr }));
    });
    try {
      assert.equal((await run("identity.test", true)).code, 0);
      assert.equal((await run("127.0.0.1", true)).code, 0);
      const wrong = await run("wrong.test", true); assert.notEqual(wrong.code, 0); assert.match(wrong.stderr, /ERR_TLS_CERT_ALTNAME_INVALID/);
      const untrusted = await run("identity.test", false); assert.notEqual(untrusted.code, 0); assert.match(untrusted.stderr, /SELF_SIGNED_CERT/);
      assert.deepEqual(observed, [{ host: `identity.test:${address.port}`, servername: "identity.test" }, { host: `127.0.0.1:${address.port}`, servername: undefined }]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); }
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "recall-outbound-tls-"));
    rmSync(root, { recursive: true, force: true });
  }
});
