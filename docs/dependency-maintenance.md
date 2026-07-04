# 依赖维护记录

## 维护节奏

- 每月集中处理一次补丁和小版本更新，范围限定为同主版本、同 Next/React 稳定线、Node.js 22 兼容。
- 每季度单独预研破坏性 major 变更；ESLint、TypeScript、Node 类型基线不得混入安全补丁 PR。
- 遇到高危安全公告时可临时加急，但仍禁止 `npm audit fix --force` 自动跨 major 或降级修复。

## 固定检查

- 每次依赖维护必须记录 `npm outdated`、`npm audit`、排除项、剩余风险和 CI 链接。
- 本地质量门固定为 `git diff --check`、`npm run lint`、`npm run test:contracts`、`npm run build`、`npm run test:e2e`。
- GitHub Actions 必须继续在 Node.js 22 下执行 lint、contracts、build 和 E2E。

## 2026-07-04 补丁维护收尾

- PR #4 已通过 merge commit 合并到 `main`：https://github.com/shuangyan123/demo/pull/4
- 合并提交：`ea8c56d`，补丁维护提交：`97d2359`。
- PR CI 通过：`28707869345`；合并后 main CI 通过：`28708393323`。
- 合并后 `main` 保留 Node.js `>=22 <23`、TypeScript 5、ESLint 9、Tailwind 4.3.2。

## 2026-07-04 major 预研

- ESLint 10.6.0：阻断。`npm install` 可完成，但会产生 peer 覆盖提示；`npm run lint` 在 `eslint-config-next@16.2.10` 依赖的 `eslint-plugin-react` 中失败，错误为 `contextOrFilename.getFilename is not a function`。contracts、build、E2E 通过，但 lint 失败使其不能升级。
- TypeScript 6.0.3：本地质量门通过。`npm run lint`、`npm run test:contracts`、`npm run build`、`npm run test:e2e` 均通过；仍建议等待 Next 官方兼容矩阵或单独升级窗口后再正式升级。
- `@types/node` 26.1.0：本地质量门通过。该结果只说明 Node 26 类型声明未破坏当前代码，不改变项目运行时仍以 Node.js 22 为基线。

## 当前 audit 残留

- `npm audit` 仍报告 `next -> postcss <8.5.10` 的 moderate advisory。
- npm 给出的修复路径是降级到 `next@9.3.3`，属于不可接受的旧主版本回退，不执行。
- 后续处理方式：等待 Next 上游在当前稳定线提供可接受修复版本，再走常规补丁维护 PR。
