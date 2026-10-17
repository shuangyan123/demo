import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server, type RequestListener } from "node:http";
import { Socket } from "node:net";
import { once } from "node:events";
import { buildConnector } from "undici";
import { outboundFetch, assertDirectConnection, endpointFetch, outboundTransport } from "./outbound-fetch.ts";
import { approveOutboundNetworkTarget } from "./outbound-network-policy.ts";
import { createPinnedConnector, pinnedLookup } from "./pinned-connection.ts";
import { safeFetchAcquisition } from "../acquisition/safe-fetch.ts";
import { acquisitionOrigins } from "../acquisition/origin-policy.ts";

async function fixture(handler: RequestListener, task: (url: URL, server: Server) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await task(new URL(`http://127.0.0.1:${address.port}`), server); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("actual HTTP uses one approved lookup, keeps Host, denies rebinding and does not reuse an earlier policy", async () => {
  let accepted = 0;
  await fixture((request, response) => { accepted++; assert.match(request.headers.host ?? "", /^rebinding\.test:/); response.end("fixture"); }, async url => {
    url.hostname = "rebinding.test";
    let lookups = 0;
    const lookupAll = async () => [{ address: ++lookups === 1 ? "127.0.0.1" : "169.254.169.254", family: 4 }];
    const response = await outboundFetch(url, {}, { lookupAll, allowLoopback: true });
    assert.equal(await response.text(), "fixture");
    assert.equal(lookups, 1, "connector must not freely re-resolve the hostname");
    await assert.rejects(outboundFetch(url, {}, { lookupAll, allowLoopback: true }), /特殊网络/);
    assert.equal(lookups, 2);
    assert.equal(accepted, 1, "revoked/new DNS policy cannot reuse an earlier socket");
  });
});

test("actual IPv6 loopback HTTP keeps the authorized local MCP path usable", async () => {
  const server = createServer((_request, response) => response.end("ipv6 fixture"));
  server.listen(0, "::1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const response = await outboundFetch(`http://[::1]:${address.port}/`, {}, { allowLoopback: true });
    assert.equal(await response.text(), "ipv6 fixture");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("mixed DNS, empty/malformed answers and localhost DNS overrides fail before transport", async context => {
  let calls = 0;
  context.mock.method(outboundTransport, "fetch", async () => { calls++; throw new Error("must not send"); });
  try {
    for (const answers of [[], [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:a9fe:a9fe", family: 6 }], [{ address: "8.8.8.8", family: 6 }]]) {
      await assert.rejects(outboundFetch("https://mixed.test", {}, { lookupAll: async () => answers }));
    }
    await assert.rejects(outboundFetch("http://localhost", {}, { lookupAll: async () => [{ address: "8.8.8.8", family: 4 }] }), /localhost/);
    assert.equal(calls, 0);
  } finally { context.mock.restoreAll(); }
});

test("connector pins fallback addresses and verifies remote address before releasing HTTP/TLS socket", async () => {
  const target = await approveOutboundNetworkTarget("https://identity.test/path", {}, async () => [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700::1111", family: 6 }]);
  let settings: (buildConnector.BuildOptions & { servername?: string; rejectUnauthorized?: boolean }) | undefined;
  let released = false;
  const socket = new Socket();
  Object.defineProperties(socket, { remoteAddress: { value: "127.0.0.1" }, remotePort: { value: 443 } });
  const factory: typeof buildConnector = options => { settings = options; return (connection, callback) => {
    assert.equal(connection.servername, "identity.test", "call-level override cannot change certificate identity");
    assert.equal(connection.host, "identity.test");
    callback(null, socket);
  }; };
  const connect = createPinnedConnector(target, factory);
  connect({ hostname: "identity.test", host: "foreign.test", servername: "foreign.test", protocol: "https:", port: "443" }, (error, socketResult) => { assert.equal(socketResult, null); released = true; assert.match(String(error), /绑定批准地址/); });
  assert.equal(released, true);
  assert.equal(socket.destroyed, true);
  assert.equal(settings?.servername, "identity.test");
  assert.equal(settings?.rejectUnauthorized, true);
  assert.equal(settings?.maxCachedSessions, 0);
  const lookup = pinnedLookup(target);
  await new Promise<void>((resolve, reject) => lookup("identity.test", { all: true }, (error, addresses) => { if (error) return reject(error); assert.deepEqual(addresses, target.addresses); resolve(); }));
  await new Promise<void>(resolve => lookup("other.test", {}, error => { assert.ok(error); resolve(); }));
});

test("conflicting Host is rejected before DNS or transport even for an otherwise allowed public target", async context => {
  let calls = 0;
  context.mock.method(outboundTransport, "fetch", async () => { calls++; throw new Error("must not send"); });
  try {
    await assert.rejects(outboundFetch("https://identity.test", { headers: { Host: "foreign.test" } }, { lookupAll: async () => { calls++; return [{ address: "8.8.8.8", family: 4 }]; } }), /Host 与已授权地址不一致/);
    assert.equal(calls, 0);
  } finally { context.mock.restoreAll(); }
});

test("explicit LAN authorization reaches only the approved private peer and keeps TLS identity", async () => {
  const lookupAll = async () => [{ address: "10.0.0.9", family: 4 }];
  await assert.rejects(approveOutboundNetworkTarget("https://owned-lan.test", {}, lookupAll), /显式开启/);
  const target = await approveOutboundNetworkTarget("https://owned-lan.test", { allowPrivateNetwork: true }, lookupAll);
  const socket = new Socket();
  Object.defineProperties(socket, { remoteAddress: { value: "10.0.0.9" }, remotePort: { value: 443 } });
  let released = 0;
  const factory: typeof buildConnector = options => {
    assert.ok(options && "servername" in options && options.servername === "owned-lan.test");
    return (_options, callback) => callback(null, socket);
  };
  createPinnedConnector(target, factory)({ hostname: "owned-lan.test", protocol: "https:", port: "443" }, (error, actual) => {
    assert.equal(error, null); assert.equal(actual, socket); released++;
  });
  assert.equal(released, 1);
  socket.destroy();
});

test("redirects never implicitly follow, acquisition validates exact origins and each hop", async () => {
  let finalCalls = 0;
  await fixture((request, response) => {
    if (request.url === "/start") { response.writeHead(302, { location: "/final" }); response.end(); }
    else { finalCalls++; response.end("should not reach"); }
  }, async url => {
    await assert.rejects(outboundFetch(new URL("/start", url), {}, { allowLoopback: true }), /fetch failed/);
    assert.equal(finalCalls, 0);
  });
  let lookups = 0, requests = 0;
  const response = () => new Response(null, { status: 302, headers: { location: "https://next.test/article" } });
  await assert.rejects(safeFetchAcquisition({ url: "https://source.test/start", allowedOrigins: ["https://source.test"], lookupImpl: async () => { lookups++; return [{ address: "8.8.8.8" }]; }, fetchImpl: async () => { requests++; return response(); } }), /允许域名/);
  assert.equal(requests, 1); assert.equal(lookups, 1);
  lookups = 0; requests = 0;
  await assert.rejects(safeFetchAcquisition({ url: "https://source.test/start", allowedOrigins: ["https://source.test", "https://next.test"], lookupImpl: async () => [{ address: ++lookups === 1 ? "8.8.8.8" : "10.0.0.1" }], fetchImpl: async () => { requests++; return response(); } }), /私网/);
  assert.equal(requests, 1); assert.equal(lookups, 2);
});

test("request cancellation and deadline cover DNS, headers and streaming body without replay", async () => {
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(outboundFetch("https://cancel.test", { signal: cancellation.signal }, { lookupAll: async () => [] }), { name: "AbortError" });
  const keepAlive = setInterval(() => undefined, 1000);
  try { await assert.rejects(outboundFetch("https://dns-timeout.test", {}, { timeoutMs: 10, lookupAll: () => new Promise(() => {}) }), { name: "TimeoutError" }); }
  finally { clearInterval(keepAlive); }
  await fixture((_request, response) => { response.writeHead(200); response.write("first"); }, async url => {
    const response = await outboundFetch(url, {}, { allowLoopback: true, timeoutMs: 150 });
    await assert.rejects(response.text());
  });
});

test("proxy policy fails closed and only explicit NO_PROXY entries permit direct transport", () => {
  assert.throws(() => assertDirectConnection(new URL("https://target.test"), { HTTPS_PROXY: "http://proxy.test" }), /代理/);
  assert.doesNotThrow(() => assertDirectConnection(new URL("https://target.test"), { HTTPS_PROXY: "http://proxy.test", NO_PROXY: "other.test,.target.test" }));
  assert.throws(() => assertDirectConnection(new URL("https://eviltarget.test"), { HTTPS_PROXY: "http://proxy.test", NO_PROXY: ".target.test" }), /代理/);
});

test("SDK request scope and server origin policy cannot be expanded by request selection", async () => {
  const fetcher = endpointFetch(new URL("https://mcp.test/mcp?session=fixture"), {});
  for (const url of ["https://other.test/mcp", "https://mcp.test/token", "http://mcp.test/mcp?session=fixture", "https://mcp.test/mcp?session=other"]) await assert.rejects(fetcher(url), /超出已授权端点/);
  assert.deepEqual(acquisitionOrigins(["https://source.test/article"], undefined), ["https://source.test"]);
  assert.deepEqual(acquisitionOrigins(["https://source.test"], '["https://source.test"]'), ["https://source.test"]);
  for (const selection of [["https://other.test"], ["https://source.test.evil.test"], ["http://source.test"], ["https://source.test:444"]]) assert.throws(() => acquisitionOrigins(selection, '["https://source.test"]'), /授权范围/);
  assert.throws(() => acquisitionOrigins(["https://source.test"], "malformed"), /策略无效/);
});
