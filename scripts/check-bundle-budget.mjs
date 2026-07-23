import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const nextRoot = path.join(root, ".next");
const baselinePath = path.join(root, "docs", "performance-budget.json");
const outputPath = path.join(nextRoot, "diagnostics", "bundle-budget.json");

async function bytes(relativePath) {
  return (await stat(path.join(nextRoot, relativePath))).size;
}

async function pageManifest() {
  const source = await readFile(path.join(nextRoot, "server", "app", "page_client-reference-manifest.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  return sandbox.__RSC_MANIFEST["/page"];
}

/** 从生产构建清单读取真实首屏资产，而不是依赖易漂移的 chunk 文件名。 */
async function currentMetrics() {
  const manifest = await pageManifest();
  const buildManifest = JSON.parse(await readFile(path.join(nextRoot, "server", "app", "page", "build-manifest.json"), "utf8"));
  const initialJavaScriptFiles = [...new Set([
    ...(manifest.entryJSFiles["[project]/app/page"] ?? []),
    ...(buildManifest.rootMainFiles ?? []),
    ...(buildManifest.polyfillFiles ?? []),
  ])];
  const initialCssFiles = [...new Set((manifest.entryCSSFiles["[project]/app/page"] ?? []).map((entry) => entry.path))];
  const chunkDirectory = path.join(nextRoot, "static", "chunks");
  const allChunkNames = await readdir(chunkDirectory);
  const allJavaScriptFiles = allChunkNames.filter((name) => name.endsWith(".js")).map((name) => `static/chunks/${name}`);
  return {
    initialCssBytes: (await Promise.all(initialCssFiles.map(bytes))).reduce((sum, value) => sum + value, 0),
    initialJavaScriptBytes: (await Promise.all(initialJavaScriptFiles.map(bytes))).reduce((sum, value) => sum + value, 0),
    largestJavaScriptChunkBytes: Math.max(...await Promise.all(allJavaScriptFiles.map(bytes))),
    initialCssFiles,
    initialJavaScriptFiles,
    initialClientModules: Object.keys(manifest.clientModules),
  };
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const current = await currentMetrics();
const failures = [];
for (const metric of ["initialJavaScriptBytes", "initialCssBytes", "largestJavaScriptChunkBytes"]) {
  const limit = Math.floor(baseline.metrics[metric] * (1 + baseline.maxGrowthPercent / 100));
  if (current[metric] > limit) failures.push(`${metric}: ${current[metric]} > ${limit}`);
}
for (const marker of baseline.forbiddenInitialClientModules) {
  if (current.initialClientModules.some((moduleName) => moduleName.includes(marker))) {
    failures.push(`低频模块误入首屏客户端边界: ${marker}`);
  }
}

const report = {
  baseline: baseline.metrics,
  current: {
    initialCssBytes: current.initialCssBytes,
    initialJavaScriptBytes: current.initialJavaScriptBytes,
    largestJavaScriptChunkBytes: current.largestJavaScriptChunkBytes,
  },
  failures,
  generatedAt: new Date().toISOString(),
  initialCssFiles: current.initialCssFiles,
  initialJavaScriptFiles: current.initialJavaScriptFiles,
  maxGrowthPercent: baseline.maxGrowthPercent,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
