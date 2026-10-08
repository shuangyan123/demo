# Recall Phase F5 Slice 1 — Diagnostic-first Resume

本片从 F4 exact HEAD `f8393f6611297c5dd3d521319e3a580e8d6c13f1` 独立实现。
只支持已有有效 managed profile 的固定第一方诊断，不表示 Phase F 完成或 packaged Electron 验收。

## 产品路径

```text
总览「诊断与已保存作答」
→ /diagnostic/resume（只读）
→ 用户点击「再次作答这道诊断题」
→ /diagnostic（既有受控表单）
→ POST /api/diagnostic/submit（既有 durable/admission/Evidence/reveal 门）
→ 关闭应用进程
→ 同 profile/epoch 启动新进程
→ 总览 → /diagnostic/resume
→ 用户显式发起新作答
```

所有 diagnostic 链接使用 `prefetch={false}`。进入恢复页不发 session、不提交、不初始化、不调度。
既有作答页只新增恢复页链接；原 session 的封存答案、手动续交、重复提交拒绝及揭示门保持不变。
旧 session 不跨进程恢复；重启后的新作答由既有 capture authority 生成新的真实身份。

## 只读 facade 与安全投影

`loadDiagnosticResumeView()` 无 caller 参数。它在 server 固定选择 `int-add-2-3 / r1`，生成当前 `asOf`，
调用未修改的 `reconstructDiagnosticLearnerState()`，再白名单投影。当前 profile/epoch 继续由既有受信 runtime 提供。

成功保留 `kind=complete`，另含 `history=complete-empty|resumed`：

- source completeness、generation、source capture count；不传 profile/epoch 内部 ID。
- target attempt/evidence count、measurement、明确的 `asOf`。
- 每条确认 attempt 的原 UUID、occurredAt、支持/反驳方向、assistance 与有限确定性评分 provenance。
- 四维 state 值、实际证据/验证时间与既有 null `nextVerificationAt`；无 eligibility 集合和内部引用。
- 原 WHAT discriminant、target（仅原 `verify` 分支）和 reason；没有另选验证目标。

Admission 的 attempt ID 使用固定 source tuple 包装原 capture UUID；投影只核对包装并取出原 UUID，
不生成替代身份。无法安全展示的身份 fail closed。内部 target、answer-bound Event/Evidence IDs、
raw payload、selected option、key、完整 authority、capture 正文均不进入浏览器。

失败只投影原 `kind/code`：unavailable、incomplete、corrupt、unsupported、authority_failure。
失败不携带 state/attempts，不变成 complete-empty，不回退旧结果。真正 complete-empty 只解释当前授权来源没有确认作答，
不表示用户从未学习。未来 capture 仍保留为历史事实；asOf 前没有有效状态时保持 unmeasured/null。

## 事实与权限

唯一 durable authority 仍为 source-owned CapturedAttempt。Event、Evidence、State、WHAT 重新派生，不落盘。
本片不修改 repository、atomic publication/confirmation、runtime、spec/capture/admission、Kernel 或 WHAT policy。
没有新来源、模型评分 authority、数据库 schema、公共 history API 或 renderer authority import。

正确的受控无内建辅助作答仍是 emerging/independent 与 `none/no_authorized_verification_target`；
较晚错误作答仍是 unknown/unknown 与 `none/ambiguous_verification_target`。
历史支持证据保留，重复作答及时间间隔不会增加 authority。retention/transfer 保持 untested。
source-scoped independence 不证明没有外部帮助，也不表示 mastered。

「再次作答这道诊断题」是用户主动的重复测量，不是 Kernel 选中的保持/迁移验证。
不新增 WHEN/HOW、scheduler、后台测试或自动重放。新安装 profile onboarding、迁移、全局 backup/reset、
题库扩张及旧 dashboard learner-state cutover 均不在本片。
缺少 trusted managed profile 的 Web 环境明确 unavailable，不提供持久化 fallback。

## 验证入口

Facade contracts 使用真实 source 提交构造成功事实，覆盖 complete-empty、所有失败 code、白名单投影、
未来事实与无初始化/写入。架构守卫只增加 exact facade/page named edges，仍拒绝 renderer 与生产测试 seam。

`playwright.diagnostic-resume.config.ts` 的 test runner 持有隔离 Host fixture；分别启动 standalone A/B，
终止 A 后用同 profile/epoch 启动 B，使用全新浏览器 context。测试通过私有只读 F4 子进程比较同一 asOf 的
完整 canonical facts/state/WHAT，并验证恢复页面不改文件字节、新 attempt 身份不同、旧 Evidence 保留、较晚反证有效。
故障流程覆盖 503/锁定/手动续交/重复拒绝、missing initialized record 不变空历史。
只有所有应用进程退出后才清理测试 profile；不操作安装 profile。

```bash
node --test --experimental-strip-types app/server/diagnostic/resume-view.contract.test.ts app/features/performance/diagnostic-resume-boundary.contract.test.ts
npm run typecheck
npm run lint
npm run test:contracts
npm run build
npm run check:bundle
npx playwright test --config playwright.diagnostic-resume.config.ts
```

这些浏览器证据证明 standalone 产品路径和真实 Node 进程重启，不证明 packaged Electron 的
`review-app://workspace` 原生表单、协议重定向、安装路径或生命周期。依赖 advisory 应另行记录；本片不升级依赖。
