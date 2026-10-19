import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXPOSURES = Object.freeze({
  "@xmldom/xmldom": ["packaging-input", "plist -> app-builder/Forge macOS metadata; attacker-controlled XML/plist can reach parser/serializer in packaging"],
  "baseline-browser-mapping": ["build-input", "Next/PostCSS/browserslist build metadata and query mapping; not an outbound socket boundary"],
  "brace-expansion": ["build-pattern", "minimatch in Forge, node-gyp, ESLint and app-builder; malicious build paths/globs can exhaust memory/stack"],
  "braces": ["build-pattern", "fast-glob -> micromatch -> braces in Forge/Next lint; crafted nested repository patterns cause DoS"],
  "browserslist": ["build-config", "Next/Tailwind build target queries and custom stats; malicious configuration can crash or exhaust build process"],
  "extract-zip": ["downloaded-build-archive", "@electron/packager/dist/unzip.js extracts the Electron ZIP downloaded through @electron/get; symlink entries can write outside destination"],
  "hono": ["runtime-library", "@modelcontextprotocol/sdk server transport dependency; application uses SDK client, but package remains runtime-shipped; patched rather than accepting route reachability assumptions"],
  "http-cache-semantics": ["build-download-cache", "make-fetch-happen/lib/cache/policy.js under Electron node-gyp; cache policy can leak shared cached responses"],
  "ip-address": ["address-validation-library", "express-rate-limit/dist/index.cjs and socks/build/client/socksclient.js parse IPv6/client addresses. Transitive server/proxy usage requires review; application outbound policy uses its own classifier and socket binding"],
  "joi": ["build-config", "wait-on/lib/wait-on.js validates launcher options; unsafe messages/schema configuration and pathological values can pollute or exhaust process"],
  "js-yaml": ["runtime-input-parser", "app/services/obsidian-markdown.ts parses/dumps user frontmatter; workflow tooling also parses repository YAML. Untrusted import input can trigger parsing/alias weaknesses"],
  "sprintf-js": ["runtime-and-build-formatting", "mammoth/node_modules/argparse uses root sprintf-js; roarr/dist/factories/createLogger.js uses its nested copy in proxy logging. Hostile format strings require caller review; no blanket unreachable claim"],
  "tar": ["downloaded-build-archive", "@electron/rebuild/lib/clang-fetcher.js and @electron/node-gyp/lib/install.js use tar 6 for downloaded toolchains/headers. Path traversal can overwrite build host files; critical remains blocking"],
  "tmp": ["build-editor-filesystem", "external-editor/main/index.js uses tmp 0.0.33 via Inquirer/Forge interactive prompts; symlink/prefix attacks can write outside temporary directory"],
});

export function reviewDependencies(before, after) {
  for (const report of [before, after]) {
    const counts = report?.metadata?.vulnerabilities;
    if (report?.error || !report?.vulnerabilities || typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities)
      || !counts || !["info", "low", "moderate", "high", "critical", "total"].every(key => Number.isInteger(counts[key]) && counts[key] >= 0)) throw new Error("Invalid audit report");
  }
  const roots = (name, report, seen = new Set()) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const value = report.vulnerabilities[name];
    if (!value || !Array.isArray(value.via)) throw new Error(`Missing audit edge: ${name}`);
    return value.via.flatMap(via => typeof via === "string" ? roots(via, report, new Set(seen)) : [{ ...via, owner: name }]);
  };
  const names = [...new Set([...Object.keys(before.vulnerabilities), ...Object.keys(after.vulnerabilities)])].sort();
  const packages = names.map(name => {
    const original = before.vulnerabilities[name];
    const current = after.vulnerabilities[name];
    const report = current ? after : before;
    const value = current ?? original;
    const advisories = [...new Map(roots(name, report).map(via => {
      if (!/^https:\/\/github\.com\/advisories\/GHSA-[\w-]+$/.test(via.url)) throw new Error("Invalid advisory URL");
      if (!EXPOSURES[via.owner]) throw new Error(`Unclassified advisory owner: ${via.owner}`);
      return [`${via.owner}:${via.source}`, { id: via.url.split("/").at(-1), package: via.owner, severity: via.severity, title: via.title, range: via.range, url: via.url, exposure: EXPOSURES[via.owner][0], pathAssessment: EXPOSURES[via.owner][1] }];
    })).values()];
    if (!advisories.length || !Array.isArray(value.nodes) || value.nodes.some(node => typeof node !== "string" || !node.startsWith("node_modules/"))) throw new Error(`Invalid finding: ${name}`);
    return { package: name, severity: value.severity, direct: value.isDirect, affectedPaths: value.nodes, status: current ? "UNRESOLVED_NOT_ACCEPTED" : "NO_LONGER_REPORTED", inherited: value.via.every(via => typeof via === "string"), advisories };
  });
  return { schemaVersion: 1, nature: "AUDIT_CLASSIFICATION_NOT_RISK_ACCEPTANCE", before: before.metadata.vulnerabilities, after: after.metadata.vulnerabilities, riskAccepted: false, packages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [beforeFile, afterFile] = process.argv.slice(2);
  if (!beforeFile || !afterFile) throw new Error("Usage: dependency-risk-review.mjs before.json after.json");
  console.log(JSON.stringify(reviewDependencies(JSON.parse(readFileSync(beforeFile, "utf8").replace(/^\uFEFF/, "")), JSON.parse(readFileSync(afterFile, "utf8").replace(/^\uFEFF/, ""))), null, 2));
}
