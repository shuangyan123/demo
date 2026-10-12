import { diagnosticStorageFixture } from "../test-support/diagnostic-storage.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const fixture = diagnosticStorageFixture();
const metadata = path.join(process.cwd(), ".cache", "f3-validation");
mkdirSync(metadata, { recursive: true });
// 只向 test runner 提供其独立临时目录，供 browser-level 离线/恢复故障验收。
writeFileSync(path.join(metadata, "diagnostic-server-fixture.json"), JSON.stringify({ root: fixture.root,
  managedRoot: fixture.config.managedRoot, file: fixture.file }));
process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP = fixture.payload;
process.on("exit", () => fixture.cleanup());
await import("./start-next-standalone.mjs");
