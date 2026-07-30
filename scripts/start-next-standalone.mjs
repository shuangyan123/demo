import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

// Next standalone 不会自动复制静态与 public 资源；浏览器 E2E 启动前补齐同一发布布局。
await mkdir(path.join(standaloneRoot, ".next"), { recursive: true });
await cp(path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"), {
  force: true,
  recursive: true,
});
await cp(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"), {
  force: true,
  recursive: true,
});

await import(pathToFileURL(path.join(standaloneRoot, "server.js")).href);
