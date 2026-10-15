import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { policyFetch, resolvePinnedTarget } from "./policy-fetch.ts";
import { validateOutboundNetworkTarget } from "./outbound-network-policy.ts";

function mockDns(context: TestContext, resolver: () => Promise<Array<{ address: string; family: number }>>) {
  context.mock.method(dns, "lookup", resolver);
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
}

async function server(context: TestContext, listener: RequestListener) {
  const instance = createServer(listener);
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  context.after(() => { instance.closeAllConnections(); instance.close(); });
  const address = instance.address();
  assert.ok(address && typeof address === "object");
  return { instance, url: `http://binding.test:${address.port}` };
}

test("AUD-10: actual socket uses one approved DNS snapshot and retains HTTP authority", async (context) => {
  let calls = 0;
  let authority: string | undefined;
  const fixture = await server(context, (request, response) => { authority = request.headers.host; response.end("bound response"); });
  mockDns(context, async () => { calls += 1; return [{ address: calls === 1 ? "127.0.0.1" : "169.254.169.254", family: 4 }]; });
  const response = await policyFetch(fixture.url, {}, { allowLoopback: true });
  assert.equal(await response.text(), "bound response");
  assert.equal(authority, new URL(fixture.url).host);
  assert.equal(calls, 1, "connector must not perform a second unrestricted lookup");
});

test("AUD-10: public preflight followed by private rebinding fails before sending credentials", async (context) => {
  let hits = 0;
  let calls = 0;
  const fixture = await server(context, (_request, response) => { hits += 1; response.end("forbidden"); });
  mockDns(context, async () => [{ address: ++calls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]);
  await validateOutboundNetworkTarget(fixture.url, { allowLoopback: false });
  await assert.rejects(policyFetch(fixture.url, { headers: { authorization: "Bearer fixture-only" } }, { allowLoopback: false }));
  assert.equal(calls, 2);
  assert.equal(hits, 0);
});

test("AUD-10: mixed A/AAAA and malformed records fail closed despite LAN permission", async () => {
  const url = new URL("https://binding.test");
  for (const address of ["169.254.169.254", "::ffff:a9fe:a9fe", "fe80::1", "100.64.0.1", "2001:db8::1"]) {
    await assert.rejects(resolvePinnedTarget(url, { allowPrivateNetwork: true }, async () => [
      { address: "8.8.8.8", family: 4 }, { address, family: address.includes(":") ? 6 : 4 },
    ]));
  }
  await assert.rejects(resolvePinnedTarget(url, {}, async () => [{ address: "8.8.8.8", family: 6 }]));
  await assert.rejects(resolvePinnedTarget(url, {}, async () => []));
  await assert.rejects(resolvePinnedTarget(url, { acquisition: true }, async () => [{ address: "192.0.1.1", family: 4 }]));
  await assert.rejects(resolvePinnedTarget(url, { acquisition: true }, async () => [{ address: "::ffff:c000:101", family: 6 }]));
  await assert.rejects(resolvePinnedTarget(new URL("https://metadata.google.internal"), { allowPrivateNetwork: true }, async () => [{ address: "8.8.8.8", family: 4 }]));
});

test("AUD-10: redirect follow cannot escape the per-request authority", async (context) => {
  let hits = 0;
  const fixture = await server(context, (_request, response) => { hits += 1; response.writeHead(302, { location: "http://169.254.169.254/" }); response.end(); });
  mockDns(context, async () => [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(policyFetch(fixture.url, { redirect: "follow" }, { allowLoopback: true }));
  assert.equal(hits, 1);
});

test("AUD-10: abort propagates through streaming body and closes the actual connection", async (context) => {
  let closed!: Promise<unknown>;
  const fixture = await server(context, (request, response) => {
    closed = once(request.socket, "close");
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: partial\n\n");
  });
  mockDns(context, async () => [{ address: "127.0.0.1", family: 4 }]);
  const abort = new AbortController();
  const response = await policyFetch(fixture.url, { signal: abort.signal }, { allowLoopback: true });
  const reading = response.text();
  abort.abort();
  await assert.rejects(reading);
  await closed;
});

test("AUD-10: native IPv6 loopback binds the actual approved socket", async (context) => {
  const instance = createServer((_request, response) => response.end("ipv6 bound"));
  instance.listen(0, "::1");
  await once(instance, "listening");
  context.after(() => { instance.closeAllConnections(); instance.close(); });
  const address = instance.address();
  assert.ok(address && typeof address === "object");
  const url = `http://[::1]:${address.port}`;
  await assert.rejects(policyFetch(url, {}, { allowLoopback: false }));
  const response = await policyFetch(url, {}, { allowLoopback: true });
  assert.equal(await response.text(), "ipv6 bound");
});

test("AUD-10: explicit environment proxy mode is rejected rather than silently bypassed", async (context) => {
  const previous = process.env.NODE_USE_ENV_PROXY;
  process.env.NODE_USE_ENV_PROXY = "1";
  context.after(() => { if (previous === undefined) delete process.env.NODE_USE_ENV_PROXY; else process.env.NODE_USE_ENV_PROXY = previous; });
  await assert.rejects(policyFetch("https://binding.test"), (error) => error instanceof Error && "code" in error && error.code === "outbound_proxy_unsupported");
});
