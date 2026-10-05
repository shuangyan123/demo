import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_CHANGE_GATES = Object.freeze([
  "installer_sensitive",
  "migration_sensitive",
  "browser_runtime_sensitive",
  "windows_runtime_sensitive",
]);

// 仅列出已有架构守卫保护的纯 shadow 模块；Phase D bridge 及其传递依赖仍有 runtime consumer。
export const PURE_RECALL_CONTRACT_PATHS = Object.freeze([
  "app/services/learning-kernel/derive-learner-state.ts",
  "app/services/learning-kernel/learner-state-policy.ts",
  "app/services/learning-kernel/verification-policy.ts",
  "app/services/learning-kernel/evidence-shadow.ts",
  "app/services/learning-kernel/derive-learner-state.contract.test.ts",
  "app/services/learning-kernel/learner-state-policy.contract.test.ts",
  "app/services/learning-kernel/verification-policy.contract.test.ts",
  "app/services/learning-kernel/verified-assessment-adapter.contract.test.ts",
  "app/services/learning-kernel/legacy-event-adapter.contract.test.ts",
  "app/services/learning-kernel/evidence.contract.test.ts",
  "app/services/learning-kernel/compatibility-snapshot.contract.test.ts",
  "app/services/verification-source/verification-source-admission-core.ts",
  "app/services/verification-source/verification-source-admission.ts",
  "app/services/verification-source/verification-source-admission.contract.test.ts",
  "app/types/domains/learning-kernel.ts",
  "app/types/domains/verification-source.ts",
]);
const PURE_RECALL_PATHS = new Set(PURE_RECALL_CONTRACT_PATHS);
const RECALL_RUNTIME_PATHS = new Set([
  "app/services/learning-kernel/compatibility-snapshot.ts",
  "app/services/learning-kernel/derive-evidence.ts",
  "app/services/learning-kernel/evidence-policy.ts",
  "app/services/learning-kernel/learning-event.ts",
  "app/services/learning-kernel/legacy-event-adapter.ts",
  "app/services/learning-kernel/verified-assessment-adapter.ts",
]);

const WORKFLOW_PATH = /^\.github\/workflows(?:\/|$)/;
const DEPENDENCY_OR_RUNTIME_CONFIG_PATH = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-lock\.yml|bun\.lockb|\.npmrc|\.nvmrc|\.node-version)$/;
const INSTALLER_PATHS = [
  /^desktop(?:\/|$)/,
  /^public(?:\/|$)/,
  /^app\/favicon\.ico$/,
  /^(?:electron-builder(?:\.[^/]+)?|forge\.config(?:\.[^/]+)?)$/,
  /^(?:next|postcss|tailwind|tsconfig)\.config\.[^/]+$/,
  /^scripts\/(?:compile-desktop|prepare-desktop[^/]*|prepare-electron-archive|electron-packager-windows-resource-preload|embed-electron-asar-integrity|read-electron-asar-integrity|read-windows-executable-info|electron-builder[^/]*|generate-electron-builder[^/]*|squirrel[^/]*|windows-squirrel[^/]*|desktop-preload[^/]*|verify-desktop-release-provenance|review-workspace-version)[^/]*$/,
];
const MIGRATION_PATHS = [
  /^desktop\/(?:main|squirrel-lifecycle)(?:\.[^/]+)?$/,
  /^scripts\/(?:squirrel[^/]*|windows-squirrel-m3-migration[^/]*)$/,
  /^(?:electron-builder(?:\.[^/]+)?|forge\.config(?:\.[^/]+)?)$/,
];
const BROWSER_PATHS = [
  /^app\/(?:features|application|services|server|api|db|platform|types)(?:\/|$)/,
  /^app\/(?:page|layout|error|global-error|not-found|loading)\.[^/]+$/,
  /^app\/(?:globals\.css|fonts(?:\/|$))/,
  /^(?:components|styles)(?:\/|$)/,
  /^public(?:\/|$)/,
  /^e2e(?:\/|$)/,
  /^(?:next|postcss|tailwind|playwright)\.config\.[^/]+$/,
  /^(?:proxy|middleware)\.[^/]+$/,
];
// 共享业务/持久化默认仍验证 Windows；仅普通 View/style 与 Windows gate 解耦。
const WINDOWS_PATHS = [
  /^app\/(?:application|services|server|api|db|platform|types)(?:\/|$)/,
  /^app\/features\/(?:settings|fenbi)(?:\/|$)/,
  /^app\/features\/shared\/(?:workspace-shell\.|[^/]*desktop[^/]*)/,
  /^e2e(?:\/|$)/,
  /^scripts\/(?:windows[^/]*|read-windows[^/]*|release-artifact[^/]*|finalize-release[^/]*|verify-release-artifact[^/]*)$/,
];
const GATE_POLICY_PATHS = new Set([
  "scripts/classify-ci-changes.mjs",
  "scripts/ci-cost-classification.contract.test.mjs",
  "app/features/performance/architecture-boundary.contract.test.ts",
]);

function allGatesTrue() {
  return Object.fromEntries(CI_CHANGE_GATES.map((gate) => [gate, true]));
}

function normalizeChangedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return undefined;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || /^[a-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === ".." || part === "." || part === "")
  ) return undefined;
  return normalized;
}

function isDocumentationOrRepositoryOnlyBrandPath(path) {
  return (
    /^docs(?:\/|$)/.test(path)
    || /^(?:readme|changelog|license)(?:\.[^/]*)?$/i.test(path)
    || /^assets\/brand\/recall(?:\/|$)/.test(path)
  );
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => pattern.test(path));
}

/**
 * Classify changed paths for PR-only heavyweight gates.
 *
 * The allowlist is intentionally narrow: a path that is not explicitly known
 * to be documentation, repository-only artwork, or a lighter runtime class
 * makes every heavyweight gate eligible.
 */
export function classifyChangedFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return allGatesTrue();

  const paths = files.map(normalizeChangedPath);
  if (paths.some((path) => path === undefined)) return allGatesTrue();

  const classification = Object.fromEntries(CI_CHANGE_GATES.map((gate) => [gate, false]));
  for (const path of paths) {
    if (
      WORKFLOW_PATH.test(path)
      || DEPENDENCY_OR_RUNTIME_CONFIG_PATH.test(path)
      || GATE_POLICY_PATHS.has(path)
    ) return allGatesTrue();

    if (PURE_RECALL_PATHS.has(path)) continue;
    if (/^app\/services\/(?:learning-kernel|verification-source)(?:\/|$)/.test(path)
      && !RECALL_RUNTIME_PATHS.has(path)) return allGatesTrue();
    if (matchesAny(path, INSTALLER_PATHS)) classification.installer_sensitive = true;
    if (matchesAny(path, MIGRATION_PATHS)) classification.migration_sensitive = true;
    if (matchesAny(path, BROWSER_PATHS)) classification.browser_runtime_sensitive = true;
    if (matchesAny(path, WINDOWS_PATHS) || matchesAny(path, INSTALLER_PATHS) || matchesAny(path, MIGRATION_PATHS))
      classification.windows_runtime_sensitive = true;

    if (
      !isDocumentationOrRepositoryOnlyBrandPath(path)
      && !matchesAny(path, INSTALLER_PATHS)
      && !matchesAny(path, MIGRATION_PATHS)
      && !matchesAny(path, BROWSER_PATHS)
      && !matchesAny(path, WINDOWS_PATHS)
    ) return allGatesTrue();
  }
  return classification;
}

export function parseChangedFileInput(input) {
  if (typeof input !== "string") return undefined;
  if (input.includes("\0")) return input.split("\0").filter((path) => path.length > 0);
  return input.split(/\r?\n/).filter((path) => path.length > 0);
}

function writeGitHubOutputs(classification) {
  for (const gate of CI_CHANGE_GATES) {
    process.stdout.write(`${gate}=${classification[gate] ? "true" : "false"}\n`);
  }
}

function main() {
  let input;
  try {
    input = readFileSync(0, "utf8");
  } catch {
    input = undefined;
  }
  writeGitHubOutputs(classifyChangedFiles(parseChangedFileInput(input)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
