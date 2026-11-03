import assert from "node:assert/strict";
import test from "node:test";
import { isIP } from "node:net";
import { isPrivateAddress, safeFetchAcquisition } from "../acquisition/safe-fetch.ts";
import { classifyIpAddress } from "./ip-address-classification.ts";

const ranges: Array<{ kind: "public" | "private" | "loopback" | "blocked"; addresses: string[] }> = [
  { kind: "public", addresses: ["8.8.8.8", "100.63.255.255", "100.128.0.0", "198.17.255.255", "198.20.0.0", "192.0.0.9", "192.0.0.10", "192.31.196.1", "192.52.193.1", "192.175.48.1", "2001:4860::1", "2606:4700:4700::1111", "2001:1::1", "2001:1::2", "2001:1::3", "2001:3::1", "2001:4:112::1", "2001:20::1", "2001:3f::1", "2001:200::1", "2620:4f:8000::1", "3fff:1000::1", "64:ff9b::808:808"] },
  { kind: "private", addresses: ["10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.255.255", "fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"] },
  { kind: "loopback", addresses: ["127.0.0.0", "127.255.255.255", "::1", "0:0:0:0:0:0:0:0001"] },
  { kind: "blocked", addresses: ["0.0.0.0", "0.255.255.255", "100.64.0.0", "100.127.255.255", "169.254.0.0", "169.254.255.255", "192.0.0.0", "192.0.0.8", "192.0.0.11", "192.0.0.255", "192.0.2.0", "192.0.2.255", "192.88.99.0", "192.88.99.255", "198.18.0.0", "198.19.255.255", "198.51.100.0", "198.51.100.255", "203.0.113.0", "203.0.113.255", "224.0.0.0", "255.255.255.255", "::", "::2", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b:1::808:808", "100::1", "100:0:0:1::1", "2001::1", "2001:2::1", "2001:4:111::1", "2001:10::1", "2001:40::1", "2001:1ff::1", "2001:db8::1", "2002:808:808::1", "3fff::", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff", "5f00::1", "fe80::1", "febf::1", "fec0::1", "ff02::1", "FE80:0:0:0:0:0:0:1", "2606:4700::1%eth0", "invalid", "127.1", "0127.0.0.1", "[::1]", ""] },
];

for (const { kind, addresses } of ranges) {
  test(`规范化地址分类：${kind} 的边界与特殊用途分配`, () => {
    for (const address of addresses) assert.equal(classifyIpAddress(address).kind, kind, address);
  });
}

test("IPv4 映射的 dotted、hex、展开及 URL canonical 形式分类完全一致", () => {
  for (const { kind, addresses } of ranges) {
    for (const address of addresses.filter((value) => isIP(value) === 4)) {
      const [a, b, c, d] = address.split(".").map(Number);
      const tail = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
      for (const mapped of [`::ffff:${address}`, `::ffff:${tail}`, `0:0:0:0:0:FFFF:${tail}`]) {
        assert.equal(classifyIpAddress(mapped).kind, kind, mapped);
        assert.equal(classifyIpAddress(new URL(`https://[${mapped}]`).hostname.slice(1, -1)).kind, kind, mapped);
      }
    }
  }
});

test("采集保留 192.0/16 额外限制，包括映射别名，不扩大现有允许范围", () => {
  for (const address of ["192.0.0.9", "192.0.5.1", "::ffff:c000:9", "::ffff:192.0.5.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("采集 fake DNS 的展开 IPv6 与映射私网在 transport 前拒绝；公网保留 manual redirect", async () => {
  for (const address of ["0:0:0:0:0:0:0:1", "::ffff:a00:1", "100.64.0.1", "ff02::1"]) {
    let transports = 0;
    await assert.rejects(safeFetchAcquisition({
      url: "https://fixture.test/article", allowedOrigins: ["https://fixture.test"],
      lookupImpl: async () => [{ address: "8.8.8.8" }, { address }],
      fetchImpl: async () => { transports += 1; throw new Error("mock only"); },
    }), /私网、环回或保留地址/);
    assert.equal(transports, 0, address);
  }
  const result = await safeFetchAcquisition({
    url: "https://fixture.test/article", allowedOrigins: ["https://fixture.test"],
    lookupImpl: async () => [{ address: "2606:4700:4700::1111" }, { address: "::ffff:808:808" }],
    fetchImpl: async (_url, init) => {
      assert.equal(init?.redirect, "manual");
      assert.ok(init?.signal);
      return new Response("<article>controlled fixture</article>", { headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(result.text, "controlled fixture");
});
