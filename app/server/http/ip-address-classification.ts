import { isIP } from "node:net";

type AddressKind = "public" | "loopback" | "private" | "blocked";
export type IpAddressClassification = { kind: AddressKind; ipv4?: readonly number[] };

function classifyIpv4(octets: readonly number[]): AddressKind {
  const [a, b, c, d] = octets;
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  // IANA 特殊用途网段；私网授权不包括共享、链路本地、文档、测试或保留网络。
  if (a === 0 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "blocked";
  // 192.0.0/24 内只有 PCP/TURN anycast 的更具体分配明确 globally reachable。
  if (a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10) return "blocked";
  return "public";
}

/** 调用前已由 isIP 严格验证；将压缩、展开及 dotted-tail IPv6 解析为同一组 16-bit words。 */
function ipv6Words(address: string): number[] {
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const tailStart = source.lastIndexOf(":") + 1;
    const octets = source.slice(tailStart).split(".").map(Number);
    source = `${source.slice(0, tailStart)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = source.split("::");
  const head = halves[0] ? halves[0].split(":").map((word) => Number.parseInt(word, 16)) : [];
  if (halves.length === 1) return head;
  const tail = halves[1] ? halves[1].split(":").map((word) => Number.parseInt(word, 16)) : [];
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function embeddedIpv4(words: readonly number[]): number[] {
  return [words[6] >>> 8, words[6] & 255, words[7] >>> 8, words[7] & 255];
}

function classifyIpv6(words: readonly number[]): AddressKind {
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return "loopback";
  if ((words[0] & 0xfe00) === 0xfc00) return "private";
  // 普通公网 unicast 位于 2000::/3；其余未分配、link-local、site-local、multicast 等拒绝。
  if ((words[0] & 0xe000) !== 0x2000) return "blocked";
  if ((words[0] === 0x2001 && words[1] === 0x0db8) || (words[0] === 0x3fff && (words[1] & 0xf000) === 0)) return "blocked";
  // 6to4 / Teredo 不作为普通公网连接；IETF 2001::/23 仅保留明确可达的更具体分配。
  if (words[0] === 0x2002) return "blocked";
  if (words[0] === 0x2001 && words[1] < 0x0200) {
    const anycast = words[1] === 1 && words.slice(2, 7).every((word) => word === 0) && [1, 2, 3].includes(words[7]);
    const assigned = words[1] === 3 || (words[1] === 4 && words[2] === 0x0112)
      || (words[1] >= 0x20 && words[1] <= 0x3f);
    return anycast || assigned ? "public" : "blocked";
  }
  return "public";
}

/** 地址分类与功能授权分离。IPv4-mapped IPv6 必须继承嵌入 IPv4 的分类，不能依赖字符串前缀。 */
export function classifyIpAddress(address: string): IpAddressClassification {
  // zone ID 只对本地接口有意义，不接受为公网目标；不剥离它再放行。
  const family = address.includes("%") ? 0 : isIP(address);
  if (family === 4) {
    const ipv4 = address.split(".").map(Number);
    return { kind: classifyIpv4(ipv4), ipv4 };
  }
  if (family !== 6) return { kind: "blocked" };
  const words = ipv6Words(address);
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const ipv4 = embeddedIpv4(words);
    return { kind: classifyIpv4(ipv4), ipv4 };
  }
  // well-known NAT64 只允许嵌入公网 IPv4；它不构成访问 LAN/loopback 的授权。
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    const ipv4 = embeddedIpv4(words);
    return { kind: classifyIpv4(ipv4) === "public" ? "public" : "blocked", ipv4 };
  }
  return { kind: classifyIpv6(words) };
}
