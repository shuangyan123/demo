import { REVIEW_WORKSPACE_VERSION } from "../../config/app-metadata.ts";
import type { MockUpdateMetadata } from "../../types/domains/update-check.ts";

/** 固定进程内模拟源，无网络和文件 IO；未知环境配置不能变成任意 URL。 */
export function readMockUpdate(scenario: string | undefined): { status: number; source: string } {
  const base: MockUpdateMetadata = { schemaVersion: 1, product: "recall", channel: "local-mock", platform: "win32", arch: "x64",
    installer: "nsis", version: "0.3.2", minimumCurrentVersion: "0.3.1", releaseNotes: "模拟版本说明：改进本地学习体验。\n仅用于只读版本检查验收，不代表正式发布。" };
  switch (scenario) {
    case "available": return { status: 200, source: JSON.stringify(base) };
    case "current": return { status: 200, source: JSON.stringify({ ...base, version: REVIEW_WORKSPACE_VERSION }) };
    case "older": return { status: 200, source: JSON.stringify({ ...base, version: "0.3.0", minimumCurrentVersion: "0.3.0" }) };
    case "incompatible": return { status: 200, source: JSON.stringify({ ...base, version: "1.0.0" }) };
    case "invalid": return { status: 200, source: '{"schemaVersion":99}' };
    case "failure": return { status: 503, source: '{"code":"mock_unavailable"}' };
    default: return { status: 409, source: '{"code":"mock_disabled"}' };
  }
}
