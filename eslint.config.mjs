import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".codex/**",
    // Trunk 会创建并快速清理源码镜像，ESLint 不应扫描工具工作副本。
    ".trunk/**",
    "out/**",
    "build/**",
    "*.log",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
