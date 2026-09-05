import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectNsisProductionEvidence, getNsisProductionPaths, assertNsisProductionEvidence } from "./electron-builder-nsis-evidence.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = path.join(getNsisProductionPaths().outputRoot, "production-evidence.json");
const evidence = await collectNsisProductionEvidence();
assertNsisProductionEvidence(evidence);
await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Generated ${path.relative(workspaceRoot, evidencePath).replaceAll("\\", "/")}`);
