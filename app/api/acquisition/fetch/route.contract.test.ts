import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

function request(body: unknown, origin?: string): Request {
  return new Request("http://localhost/api/acquisition/fetch", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}

test("acquisition API cannot override trusted server origins or cross-origin request authorization", async () => {
  const original = process.env.RECALL_ACQUISITION_ALLOWED_ORIGINS;
  process.env.RECALL_ACQUISITION_ALLOWED_ORIGINS = '["https://selected.test"]';
  try {
    const denied = await POST(request({ url: "https://other.test/path?token=manufactured", allowedOrigins: ["https://other.test"] }));
    assert.equal(denied.status, 403);
    const payload = await denied.json(); assert.equal(payload.code, "acquisition_origin_not_authorized");
    assert.ok(!JSON.stringify(payload).includes("manufactured"));
    const foreign = await POST(request({ url: "https://selected.test", allowedOrigins: ["https://selected.test"] }, "https://foreign.test"));
    assert.equal(foreign.status, 403); assert.equal((await foreign.json()).code, "cross_origin_request");
    process.env.RECALL_ACQUISITION_ALLOWED_ORIGINS = "invalid";
    assert.equal((await POST(request({ url: "https://selected.test", allowedOrigins: ["https://selected.test"] }))).status, 503);
  } finally {
    if (original === undefined) delete process.env.RECALL_ACQUISITION_ALLOWED_ORIGINS;
    else process.env.RECALL_ACQUISITION_ALLOWED_ORIGINS = original;
  }
});

test("caller-selected origin cannot authorize loopback, mapped, NAT64 or metadata acquisition", async () => {
  for (const host of ["127.0.0.1", "[::1]", "[::ffff:7f00:1]", "[64:ff9b::7f00:1]", "169.254.169.254", "100.64.0.1"]) {
    const url = `http://${host}/`;
    const response = await POST(request({ url, allowedOrigins: [url] }));
    assert.equal(response.status, 400, host);
    assert.match((await response.json()).code, /loopback_not_allowed|blocked_outbound_target/);
  }
});
