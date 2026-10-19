# 依赖维护

## 维护节奏

- 每月集中处理一次补丁和小版本更新，范围限定为同主版本、同 Next/React 稳定线和 Node.js 24 兼容版本。
- 每季度单独预研破坏性 major；ESLint、TypeScript、Node 类型基线不得混入安全补丁 PR。
- 高危公告可加急，但禁止使用 `npm audit fix --force` 自动跨 major、降级或覆盖 peer 约束。

## 固定闭环

1. 记录 `npm outdated`、`npm audit`、生产依赖树、排除项和剩余风险。
2. 每个候选升级独立修改锁文件，运行 `npm run typecheck`、`npm run lint`、`npm run test:contracts`、`npm run build` 和相关 E2E。
3. 安全补丁从最新 `origin/main` 的任务分支进入 PR；等待精确 HEAD 的 CI 通过后再合入 `main`，major 预研不得混入发布提交。
4. 发布 PR 记录合并提交、CI 链接、回滚提交和未解决公告的负责人、复查日期。

## 当前基线（2026-09-04）

- 运行时固定 Node.js `>=24 <25`，本地/CI/桌面验收使用 Node.js 24.20.0；TypeScript 5、ESLint 9、Next.js 16.3。
- 2026-07-04 的补丁基线为 `ea8c56d`；历史 major 预研确认 ESLint 10 与当前 Next lint 插件不兼容，不进入本轮。
- 0.2.0 发布候选使用 Next.js/`eslint-config-next` 16.2.12、ESLint 9.39.5、`js-yaml` 5.2.2，并定向覆盖 Next 子树为 `postcss` 8.5.23。
- `npm run audit:prod` 优先读取 npm audit 的有效 JSON；只有端点异常时才回退官方 Bulk Advisory API。两条路径都不可用、报告无效或生产依赖树为空时必须失败关闭。
- `docs/upgrade-roadmap.md` 是本轮升级状态、验收证据和回滚点的唯一追踪表。

## 2026-08-09 生产安全补丁批次

- `npm run audit:prod` 识别出 `fast-uri`、`ip-address`、`nanoid`、`pdfjs-dist` 与 `undici` 的 high 公告，以及 `hono` 的 moderate 公告。
- 在不跨 major 的前提下固定 `fast-uri@3.1.5`、`ip-address@10.4.0`、`nanoid@3.3.17`、`undici@7.29.0`、`hono@4.12.34`，并把直接依赖 `pdfjs-dist` 提升到 `6.2.108`。
- 未使用 `npm audit fix --force`。锁文件更新后生产审计为 0 low / 0 moderate / 0 high / 0 critical；MCP、SSRF、文件导入、desktop、contracts、build 与 E2E 继续作为回归边界。
- 回滚必须整体撤销本批 `package.json` 与 `package-lock.json`，不得只降级单个 override 后继续发布。

## 已关闭风险例外

- Next 内置 `postcss@8.4.31` 的 moderate 例外已于 2026-07-26 关闭：新披露的 high 公告使旧例外失效，改由 Next 子树 `postcss@8.5.23` 定向 override 消除。
- `GHSA-pm4m-ph32-ghv5` 通过 `js-yaml@5.2.2` 修复；PostCSS 的 `GHSA-6g55-p6wh-862q` 与 `GHSA-r28c-9q8g-f849` 通过 `postcss@8.5.23` 修复。
- 禁止恢复旧版本、降级 Next 或使用 `npm audit fix --force` 绕过门禁。

## 风险例外规则

- 例外必须精确到公告 ID、依赖路径、实际可达代码、负责人和到期日，不能使用模糊的“开发依赖不影响生产”说明。
- 到期日前必须重新运行审计；上游已有兼容修复时，例外自动失效并转为阻断项。
- 生产依赖 critical/high 为硬阻断；moderate 只有在不可达证据完整且不涉及密钥、SSRF、任意代码执行时才可限时接受。

## 2026-10-17 出站整改候选

- Undici 7.29.1 从已有传递依赖改为显式运行依赖，使用公开 connector/fetch API 绑定批准的 DNS 地址。
- 定向覆盖 `axios@1.20.0`、`shell-quote@1.11.0`、ESLint 子树 `js-yaml@4.3.2`；锁文件只改变这三个已有工具链包和 Undici 根依赖声明，没有跨 major 或更换打包栈。
- Axios 的 [HTTP/2 DNS/proxy 绕过](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v)与 [fetch adapter 重定向绕过](https://github.com/advisories/GHSA-r4gj-5m52-g5wh)由 1.20.0 修复；shell-quote 的 [命令注入](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)由 1.11.0 修复。
- 本轮查询的生产审计为 0 high / 0 critical / 10 moderate；全依赖审计仍为 3 low / 18 moderate / 34 high / 1 critical，命令非零退出。Axios 与 shell-quote 已不在审计发现列表。剩余项主要位于 Forge/打包/开发工具链，包括 `tar@6.2.1`；这是实际残余风险，不是自动获批的例外，也不代表工具链已完成安全验收。生产 moderate 项也未在本轮获得新的风险接受。
- 不通过强制 audit fix、major 打包迁移或放宽门禁消除报告；完整发布安全验收仍需单独核对剩余公告的可达路径与兼容修复。本轮只形成综合 Draft PR，不发布版本。

### PR #148 剩余验收与兼容修复

- 后续同线修复将完整审计降至 3 low / 10 moderate / 25 high / 1 critical，生产审计降至 3 moderate / 0 high / 0 critical。原审计和后续审计属于不同锁文件快照，不能覆盖历史结果。
- 全部 56 个原包级 findings、53 个公告的分类及剩余阻断见 [逐项审查](security/dependency-risk-review-2026-10-17.md)。没有未经批准接受 high/critical，也没有用 dev 标记当作不可达证明。
- 固定提交的安装验收使用 [临时 hosted Windows 入口](security/windows-install-acceptance.md)，不得在用户主机或现有 Pilot 上执行；该二进制证据不能替代后续新依赖 HEAD 的验证。
