/* eslint-disable @typescript-eslint/no-require-imports -- Forge preload must patch CommonJS modules before they load. */
const path = require("node:path");

if (process.platform === "win32") {
  const traceEnabled = process.env.DESKTOP_BUILD_TRACE === "1";
  const traceAsync = (target, key, label) => {
    const original = target[key];
    target[key] = async (...args) => {
      const startedAt = Date.now();
      if (traceEnabled) {
        console.error(`[desktop-build] ${label} started`);
      }
      try {
        return await original(...args);
      } finally {
        if (traceEnabled) {
          console.error(`[desktop-build] ${label} finished in ${Date.now() - startedAt}ms`);
        }
      }
    };
  };

  const asar = require("@electron/asar");
  const fsExtra = require(
    path.join(
      process.cwd(),
      "node_modules",
      "@electron",
      "packager",
      "node_modules",
      "fs-extra",
    ),
  );
  traceAsync(asar, "createPackageWithOptions", "asar.createPackageWithOptions");
  traceAsync(fsExtra, "copy", "fs.copy");

  const fastGlobPath = require.resolve("fast-glob");
  const originalFastGlob = require(fastGlobPath);
  const normalizeGlobInput = (input) => (
    Array.isArray(input)
      ? input.map((value) => value.replaceAll("\\", "/"))
      : input.replaceAll("\\", "/")
  );
  const windowsSafeFastGlob = (input, options) => (
    originalFastGlob(normalizeGlobInput(input), options)
  );
  Object.assign(windowsSafeFastGlob, originalFastGlob);
  require.cache[fastGlobPath].exports = windowsSafeFastGlob;

  const packagerResedit = require(
    path.join(
      process.cwd(),
      "node_modules",
      "@electron",
      "packager",
      "dist",
      "resedit.js",
    ),
  );

  // Electron 43 的主程序超过 200MB，Packager 的纯 JS PE 重写会耗尽构建机内存。
  // Squirrel 继续负责安装信息，Electron ASAR 完整性资源由 afterComplete 原生写入。
  packagerResedit.resedit = async () => undefined;

}
