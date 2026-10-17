import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { importEdges, testEntrypoints } from "./repository-audit-inventory.mjs";

const contractPattern = /\.contract\.test\.(?:[cm]?[jt]sx?)$/;

/** 只审查可执行入口/静态注册，不执行产品模块、live请求或安装流程。 */
export function evaluateContractCoverage({ paths, texts, packageJson, policy }) {
  const edges = [...texts].filter(([file]) => /\.(?:[cm]?[jt]sx?)$/.test(file)).flatMap(([file, source]) => importEdges(file, source, paths).edges);
  const { entrypoints } = testEntrypoints(packageJson, texts, paths, edges);
  const ci = entrypoints.filter(entry => entry.kind === "workflow" && entry.name.startsWith(".github/workflows/ci.yml:"));
  const reached = new Set(ci.flatMap(entry => entry.tests));
  const exceptions = Array.isArray(policy?.exceptions) ? policy.exceptions.filter(item => item && typeof item === "object") : [];
  const errors = [];
  if (policy?.schemaVersion !== 1) errors.push("unsupported coverage policy version");
  if (!Array.isArray(policy?.exceptions) || exceptions.length !== policy.exceptions.length) errors.push("invalid coverage exception list");
  const declared = new Set();
  for (const exception of exceptions) {
    if (declared.has(exception.file)) errors.push(`duplicate exception: ${exception.file}`);
    declared.add(exception.file);
    if (!paths.has(exception.file) || !contractPattern.test(exception.file)) errors.push(`stale exception: ${exception.file}`);
    if ([exception.reason, exception.kind, exception.command].some(value => typeof value !== "string" || !value.trim())) errors.push(`unjustified exception: ${exception.file}`);
    if (reached.has(exception.file)) errors.push(`exception is now covered by CI; review and remove: ${exception.file}`);
  }
  const tests = [...paths].filter(file => contractPattern.test(file)).sort().map(file => {
    const entries = ci.filter(entry => entry.tests.includes(file)).map(entry => ({ name: entry.name, condition: entry.condition }));
    if (!entries.length && !declared.has(file)) errors.push(`orphaned contract: ${file}`);
    return { file, entrypoints: entries, exception: exceptions.find(exception => exception.file === file) ?? null };
  });
  return { tests, errors, limits: ["Import reachability is not proof of execution, pass or behavioral coverage", "Conditional CI/OS/artifact gates remain conditional", "Live tests and Playwright discovery require their own acceptance"] };
}

export function readCheckoutContractCoverage() {
  // 包括尚未stage的新tests；忽略文件遵循Git规则，不扫描用户数据或node_modules。
  const paths = new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean));
  const texts = new Map([...paths].filter(file => /\.(?:[cm]?[jt]sx?|ya?ml)$/.test(file) && !file.startsWith("docs/audits/")).map(file => [file, readFileSync(file, "utf8")]));
  return evaluateContractCoverage({ paths, texts, packageJson: JSON.parse(readFileSync("package.json", "utf8")), policy: JSON.parse(readFileSync("scripts/contract-test-coverage-policy.json", "utf8")) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = readCheckoutContractCoverage();
  const report = { status: "STATIC_DISCOVERY", execution: "NOT_REPORTED", ...result };
  console.log(JSON.stringify(process.argv.includes("--json") ? report : { status: report.status, execution: report.execution, discovered: result.tests.length, exceptions: result.tests.filter(item => item.exception).length, errors: result.errors, limits: result.limits }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
