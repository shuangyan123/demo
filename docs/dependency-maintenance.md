# 依赖维护

## 维护节奏

- 每月集中处理一次补丁和小版本更新，范围限定为同主版本、同 Next/React 稳定线和 Node.js 22 兼容版本。
- 每季度单独预研破坏性 major；ESLint、TypeScript、Node 类型基线不得混入安全补丁 PR。
- 高危公告可加急，但禁止使用 `npm audit fix --force` 自动跨 major、降级或覆盖 peer 约束。

## 固定闭环

1. 记录 `npm outdated`、`npm audit`、生产依赖树、排除项和剩余风险。
2. 每个候选升级独立修改锁文件，运行 `npm run typecheck`、`npm run lint`、`npm run test:contracts`、`npm run build` 和相关 E2E。
3. 安全补丁先合入 `develop`；等待 CI 通过后再继续普通补丁，major 预研必须恢复依赖树且不得混入发布提交。
4. 发布 PR 记录合并提交、CI 链接、回滚提交和未解决公告的负责人、复查日期。

## 当前基线（2026-07-26）

- 运行时固定 Node.js `>=22 <23`，TypeScript 5、ESLint 9、Next.js 16.2。
- 2026-07-04 的补丁基线为 `ea8c56d`；历史 major 预研确认 ESLint 10 与当前 Next lint 插件不兼容，不进入本轮。
- 0.2.0 发布候选使用 Next.js/`eslint-config-next` 16.2.12、ESLint 9.39.5、`js-yaml` 5.2.2，并定向覆盖 Next 子树为 `postcss` 8.5.23。
- `npm run audit:prod` 优先读取 npm audit 的有效 JSON；只有端点异常时才回退官方 Bulk Advisory API。两条路径都不可用、报告无效或生产依赖树为空时必须失败关闭。
- `docs/upgrade-roadmap.md` 是本轮升级状态、验收证据和回滚点的唯一追踪表。

## 已关闭风险例外

- Next 内置 `postcss@8.4.31` 的 moderate 例外已于 2026-07-26 关闭：新披露的 high 公告使旧例外失效，改由 Next 子树 `postcss@8.5.23` 定向 override 消除。
- `GHSA-pm4m-ph32-ghv5` 通过 `js-yaml@5.2.2` 修复；PostCSS 的 `GHSA-6g55-p6wh-862q` 与 `GHSA-r28c-9q8g-f849` 通过 `postcss@8.5.23` 修复。
- 禁止恢复旧版本、降级 Next 或使用 `npm audit fix --force` 绕过门禁。

## 风险例外规则

- 例外必须精确到公告 ID、依赖路径、实际可达代码、负责人和到期日，不能使用模糊的“开发依赖不影响生产”说明。
- 到期日前必须重新运行审计；上游已有兼容修复时，例外自动失效并转为阻断项。
- 生产依赖 critical/high 为硬阻断；moderate 只有在不可达证据完整且不涉及密钥、SSRF、任意代码执行时才可限时接受。
