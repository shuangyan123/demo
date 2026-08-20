import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const metadataSource = readFileSync(resolve(workspaceRoot, "app", "config", "app-metadata.ts"), "utf8");
const nextConfigSource = readFileSync(resolve(workspaceRoot, "next.config.ts"), "utf8");

test("the non-Next version fallback cannot silently drift from package.json", () => {
  const fallback = metadataSource.match(/process\.env\.npm_package_version\s*\?\?\s*["']([^"']+)["']/)?.[1];
  assert.equal(fallback, packageJson.version, "app-metadata.ts fallback must match package.json.version");
  assert.match(metadataSource, /NEXT_PUBLIC_REVIEW_WORKSPACE_VERSION/);
  assert.doesNotMatch(metadataSource, /(?:from|require\()\s*["']\.\/package\.json["']/);
  assert.match(nextConfigSource, /NEXT_PUBLIC_REVIEW_WORKSPACE_VERSION:\s*packageJson\.version/);
});
