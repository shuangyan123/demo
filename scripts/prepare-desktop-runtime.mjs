import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const nodeVersion = "24.20.0";
const nodeArchive = `node-v${nodeVersion}-win-x64.zip`;
// 固定版本同时固定官方 SHASUMS256，缓存命中时无需再次访问外网。
const nodeArchiveSha256 = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, ".desktop-runtime");
const cacheRoot = path.join(projectRoot, ".cache", "desktop-runtime");
const archivePath = path.join(cacheRoot, nodeArchive);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "app"), { recursive: true });
await mkdir(path.join(outputRoot, "node"), { recursive: true });
await cp(path.join(projectRoot, ".next", "standalone"), path.join(outputRoot, "app"), { recursive: true });
await cp(path.join(projectRoot, ".next", "static"), path.join(outputRoot, "app", ".next", "static"), { recursive: true });
await cp(path.join(projectRoot, "public"), path.join(outputRoot, "app", "public"), { recursive: true });

await mkdir(cacheRoot, { recursive: true });
if (!(await exists(archivePath))) {
  const response = await fetch(`https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`);
  if (!response.ok) throw new Error(`下载 Node.js 失败：HTTP ${response.status}`);
  await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()));
}
if (await hashFile(archivePath) !== nodeArchiveSha256) {
  throw new Error("Node.js 官方归档 SHA-256 校验失败");
}

const extractRoot = path.join(cacheRoot, `node-v${nodeVersion}-win-x64`);
if (!(await exists(path.join(extractRoot, "node.exe")))) {
  await execFileAsync("tar.exe", ["-xf", archivePath, "-C", cacheRoot], { windowsHide: true });
}
await cp(path.join(extractRoot, "node.exe"), path.join(outputRoot, "node", "node.exe"));

const files = await listFiles(outputRoot);
const manifest = {
  algorithm: "sha256",
  nodeVersion,
  generatedAt: new Date().toISOString(),
  files: Object.fromEntries(await Promise.all(files.map(async (absolutePath) => [
    path.relative(outputRoot, absolutePath).replaceAll("\\", "/"),
    await hashFile(absolutePath),
  ]))),
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared desktop runtime with ${files.length} verified files.`);

async function exists(target) {
  try { await readFile(target); return true; } catch { return false; }
}

async function listFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(target));
    else if (entry.name !== "manifest.json") result.push(target);
  }
  return result.sort();
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve);
  });
  return hash.digest("hex");
}
