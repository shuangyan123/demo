import assert from "node:assert/strict";
import test from "node:test";
import "./ip-address-classification.contract.test.ts";
import { safeFetchAcquisition } from "../acquisition/safe-fetch.ts";
import { networkPolicyFromProviderOptions, validateOutboundNetworkTarget } from "./outbound-network-policy.ts";
import { RouteSecurityError } from "./route-security.ts";

const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
const securityCode = (code: string) => (error: unknown) => error instanceof RouteSecurityError && error.code === code;

test("AUD-08: URL 规范化后的映射 loopback 在任何采集传输前拒绝", async () => {
  for (const literal of ["::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "0:0:0:0:0:0:0:1", "ff02::1"]) {
    const url = new URL(`https://[${literal}]/article`);
    let transports = 0;
    await assert.rejects(safeFetchAcquisition({
      url: url.href, allowedOrigins: [url.origin],
      lookupImpl: async () => { assert.fail("IP literal must not use DNS"); },
      fetchImpl: async () => { transports += 1; return new Response("<p>fixture</p>", { headers: { "content-type": "text/html" } }); },
    }), /私网、环回或保留地址/, literal);
    assert.equal(transports, 0, literal);
  }
});

for (const host of ["provider.example", "mcp.test", "example.com"]) {
  test(`AUD-09: ${host} 不能绕过 fake DNS 的私网结果`, async () => {
    let lookups = 0;
    await assert.rejects(validateOutboundNetworkTarget(`https://${host}/v1`, {}, async () => {
      lookups += 1;
      return [{ address: "10.0.0.9", family: 4 }];
    }), securityCode("private_network_confirmation_required"));
    assert.equal(lookups, 1);
    assert.equal((await validateOutboundNetworkTarget(`https://${host}/v1`, {}, publicDns)).hostname, host);
  });
}

test("AUD-09: 特殊用途地址不能被 LAN 或 loopback 授权放行", async () => {
  for (const address of ["100.64.0.1", "100.127.255.255", "198.18.0.1", "198.19.255.255", "192.0.0.8", "192.0.2.1", "198.51.100.1", "203.0.113.1", "2001:db8::1", "3fff::1", "fec0::1", "ff02::1"]) {
    const host = address.includes(":") ? `[${address}]` : address;
    await assert.rejects(validateOutboundNetworkTarget(`https://${host}/`, {
      allowPrivateNetwork: true, allowLoopback: true,
    }), securityCode("blocked_outbound_target"), address);
  }
});

test("AUD-09: Provider 选项严格授权，映射地址与原生 LAN/loopback 使用同一策略", async () => {
  assert.deepEqual(networkPolicyFromProviderOptions({ allowPrivateNetwork: "TRUE" }), { allowPrivateNetwork: false, allowLoopback: true });
  for (const address of ["10.0.0.9", "172.16.0.9", "192.168.0.9", "fd00::9", "::ffff:a00:9"]) {
    const host = address.includes(":") ? `[${address}]` : address;
    await assert.rejects(validateOutboundNetworkTarget(`https://${host}/`, networkPolicyFromProviderOptions()), securityCode("private_network_confirmation_required"));
    await validateOutboundNetworkTarget(`https://${host}/`, networkPolicyFromProviderOptions({ allowPrivateNetwork: "true" }));
  }
  for (const address of ["127.0.0.9", "::1", "::ffff:7f00:9"]) {
    const host = address.includes(":") ? `[${address}]` : address;
    await validateOutboundNetworkTarget(`http://${host}/`, networkPolicyFromProviderOptions());
    await assert.rejects(validateOutboundNetworkTarget(`http://${host}/`, { allowLoopback: false }), securityCode("loopback_not_allowed"));
  }
});

test("所有 fake DNS 结果均须通过策略；失败、空结果和映射私网均拒绝", async () => {
  await assert.rejects(validateOutboundNetworkTarget("https://mixed.test", {}, async () => [
    { address: "8.8.8.8", family: 4 }, { address: "::ffff:a00:1", family: 6 },
  ]), securityCode("private_network_confirmation_required"));
  await assert.rejects(validateOutboundNetworkTarget("https://empty.test", {}, async () => []), securityCode("outbound_dns_failed"));
  await assert.rejects(validateOutboundNetworkTarget("https://failed.test", {}, async () => { throw new Error("fake DNS failure"); }), securityCode("outbound_dns_failed"));
});
