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

## 当前基线（2026-07-23）

- 运行时固定 Node.js `>=22 <23`，TypeScript 5、ESLint 9、Next.js 16.2。
- 2026-07-04 的补丁基线为 `ea8c56d`；历史 major 预研确认 ESLint 10 与当前 Next lint 插件不兼容，不进入本轮。
- 2026-07-23 审计发现 Next.js 16.2.10 与其 PostCSS/Sharp 依赖存在可由 16.2.11 修复的公告；MCP SDK 的 Hono server 依赖需通过客户端路径验证或限时风险例外闭环。
- `docs/upgrade-roadmap.md` 是本轮升级状态、验收证据和回滚点的唯一追踪表。

## 风险例外规则

- 例外必须精确到公告 ID、依赖路径、实际可达代码、负责人和到期日，不能使用模糊的“开发依赖不影响生产”说明。
- 到期日前必须重新运行审计；上游已有兼容修复时，例外自动失效并转为阻断项。
- 生产依赖 critical/high 为硬阻断；moderate 只有在不可达证据完整且不涉及密钥、SSRF、任意代码执行时才可限时接受。
