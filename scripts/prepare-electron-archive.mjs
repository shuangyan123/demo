/**
 * 为 Electron Forge 准备经过官方 checksum 校验的本地 Electron 归档。
 * npm 安装 electron 时已经下载过同一文件，桌面打包不应再次依赖外网。
 */
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { downloadArtifact } = require("@electron/get");
const electronRoot = path.join(projectRoot, "node_modules", "electron");
const electronPackage = JSON.parse(
  await readFile(path.join(electronRoot, "package.json"), "utf8"),
);
const checksums = JSON.parse(
  await readFile(path.join(electronRoot, "checksums.json"), "utf8"),
);
const archiveName = `electron-v${electronPackage.version}-win32-x64.zip`;
const expectedChecksum = checksums[archiveName];
const archiveDirectory = path.join(projectRoot, ".cache", "electron");
const archivePath = path.join(archiveDirectory, archiveName);

if (typeof expectedChecksum !== "string") {
  throw new Error(`Electron checksum 缺失：${archiveName}`);
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function isVerifiedArchive(filePath) {
  try {
    return (await stat(filePath)).isFile()
      && await sha256(filePath) === expectedChecksum;
  } catch {
    return false;
  }
}

async function findArchive(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isFile() && entry.name === archiveName && await isVerifiedArchive(entryPath)) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        const nestedArchive = await findArchive(entryPath);
        if (nestedArchive) return nestedArchive;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

await mkdir(archiveDirectory, { recursive: true });
if (!await isVerifiedArchive(archivePath)) {
  const cacheRoots = [
    process.env.ELECTRON_CACHE,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "electron", "Cache")
      : undefined,
    path.join(os.homedir(), ".cache", "electron"),
  ].filter(Boolean);

  let cachedArchive;
  for (const cacheRoot of cacheRoots) {
    cachedArchive = await findArchive(cacheRoot);
    if (cachedArchive) break;
  }
  if (!cachedArchive) {
    // GitHub runner 的 npm 缓存可能只恢复已解压 dist，不保留原始 ZIP；官方下载器会按 checksums.json 校验。
    cachedArchive = await downloadArtifact({
      version: electronPackage.version,
      artifactName: "electron",
      platform: "win32",
      arch: "x64",
      checksums,
    });
  }
  await copyFile(cachedArchive, archivePath);
}

if (!await isVerifiedArchive(archivePath)) {
  throw new Error(`Electron 归档校验失败：${archivePath}`);
}

// npm cache 在 CI 上可能只有经过校验的 ZIP；runtime readback 需要实际的
// Electron executable，因此把同一归档展开到受控缓存目录。
const electronExecutablePath = path.join(archiveDirectory, "electron.exe");
if (!await isFile(electronExecutablePath)) {
  await execFileAsync("tar.exe", ["-xf", archivePath, "-C", archiveDirectory], { windowsHide: true });
}
if (!await isFile(electronExecutablePath)) {
  throw new Error(`Electron runtime executable missing after extraction: ${electronExecutablePath}`);
}

console.log(`Prepared verified Electron archive and runtime: ${archiveName}`);

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
