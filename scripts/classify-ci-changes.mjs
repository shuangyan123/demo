import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_CHANGE_GATES = Object.freeze([
  "installer_sensitive",
  "migration_sensitive",
  "browser_runtime_sensitive",
]);

const WORKFLOW_PATH = /^\.github\/workflows(?:\/|$)/;
const DEPENDENCY_OR_RUNTIME_CONFIG_PATH = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-lock\.yml|bun\.lockb|\.npmrc|\.nvmrc|\.node-version)$/;
const INSTALLER_PATHS = [
  /^desktop(?:\/|$)/,
  /^public(?:\/|$)/,
  /^app\/favicon\.ico$/,
  /^(?:electron-builder(?:\.[^/]+)?|forge\.config(?:\.[^/]+)?)$/,
  /^(?:next|postcss|tailwind|tsconfig)\.config\.[^/]+$/,
  /^scripts\/(?:compile-desktop|prepare-desktop[^/]*|prepare-electron-archive|electron-packager-windows-resource-preload|embed-electron-asar-integrity|read-electron-asar-integrity|read-windows-executable-info|electron-builder[^/]*|generate-electron-builder[^/]*|squirrel[^/]*|windows-squirrel[^/]*|desktop-preload[^/]*|verify-desktop-release-provenance)[^/]*$/,
];
const MIGRATION_PATHS = [
  /^desktop\/(?:main|squirrel-lifecycle)(?:\.[^/]+)?$/,
  /^scripts\/(?:squirrel[^/]*|windows-squirrel-m3-migration[^/]*)$/,
  /^(?:electron-builder(?:\.[^/]+)?|forge\.config(?:\.[^/]+)?)$/,
];
const BROWSER_PATHS = [
  /^(?:app|components|src|pages|styles)(?:\/|$)/,
  /^public(?:\/|$)/,
    /^e2e(?:\/|$)/,
    /^(?:next|postcss|tailwind|playwright)\.config\.[^/]+$/,
    /^(?:proxy|middleware)\.[^/]+$/,
  ];

function allGatesTrue() {
  return Object.fromEntries(CI_CHANGE_GATES.map((gate) => [gate, true]));
}

function normalizeChangedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return undefined;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || /^[a-z]:\//.test(normalized)
    || normalized.split("/").includes("..")
  ) return undefined;
  return normalized;
}

function isDocumentationOrRepositoryOnlyBrandPath(path) {
  return (
    /^docs(?:\/|$)/.test(path)
    || /^(?:readme|changelog|license)(?:\.[^/]*)?$/.test(path)
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
    ) return allGatesTrue();

    if (matchesAny(path, INSTALLER_PATHS)) classification.installer_sensitive = true;
    if (matchesAny(path, MIGRATION_PATHS)) classification.migration_sensitive = true;
    if (matchesAny(path, BROWSER_PATHS)) classification.browser_runtime_sensitive = true;

    if (
      !isDocumentationOrRepositoryOnlyBrandPath(path)
      && !matchesAny(path, INSTALLER_PATHS)
      && !matchesAny(path, MIGRATION_PATHS)
      && !matchesAny(path, BROWSER_PATHS)
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
