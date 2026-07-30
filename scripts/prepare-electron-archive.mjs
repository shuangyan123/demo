/**
 * 为 Electron Forge 准备经过官方 checksum 校验的本地 Electron 归档。
 * npm 安装 electron 时已经下载过同一文件，桌面打包不应再次依赖外网。
 */
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    throw new Error(
      `未找到已校验的 ${archiveName}；请先完成 npm install 以填充 Electron 安装缓存。`,
    );
  }
  await copyFile(cachedArchive, archivePath);
}

if (!await isVerifiedArchive(archivePath)) {
  throw new Error(`Electron 归档校验失败：${archivePath}`);
}

console.log(`Prepared verified Electron archive: ${archiveName}`);
