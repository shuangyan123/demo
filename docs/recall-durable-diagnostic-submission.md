# Recall Phase F Slice 3 — Production Durable Diagnostic Submission & Owner Recovery

本片从 Slice 2 exact HEAD `735ac2b249a0c03f6e4b5f83a3f294265a589ccf` 开始，接通固定 `recall-diagnostic`
production source 到 durable capture → admission → Evidence → reveal。Phase E 保持 COMPLETE，Phase F 整体与 DOGFOOD READY 未成立。

## Trusted process composition

Main 在 single-instance lock 后、session/runtime 创建前完成 Slice 1 storage gate。
`startDesktopRuntime(storageState.config)` 的 child env 显式覆盖 `RECALL_MANAGED_STORAGE_BOOTSTRAP`，不信继承的同名值。
payload 仅含 `formatVersion:1`、profileId、epochId、managedRoot、profileRoot、managedFilesRoot；不含题目、key、历史或凭据。

Nominal brand 不跨序列化。Server `storage-config.ts` 先验证 8 KiB 上限、canonical exact JSON fields/encoding、UUIDv4、
native absolute normalized paths 和既有 profile/managed-files 布局，再重建内部 `ManagedStorageHostConfig`。
这是一条由 Main/受信 standalone launcher 控制的 OS process transport，不是 payload 自证 Main 来源，也不抵抗 OS/env compromise。
HTTP/preload/renderer 没有配置入口；repository 仍只接 typed config，不读 env 或猜 cwd/AppData/temp。

Standalone Web 未提供 explicit trusted bootstrap 时 diagnostic 不可用。独立集成测试和专用 Playwright launcher
通过真实 Slice 1 resolver 创建隔离临时 Host profile，显式提供同一 payload；临时目录仅用于测试，不是生产 fallback。

## Startup 与 owner index

Next 的 Node `instrumentation.register` 在处理请求前初始化 runtime。沿用 Slice 2 同步 bounded snapshot IO，
admission API 仍同步，Kernel/spec/capture/admission core 不接存储。
只有 `readCompleteSnapshot().kind === uninitialized` 时显式 initialize 新 diagnostic-history domain。
完整确认后才建立 owner index 并标记 ready；不加载部分 records，不把其他失败初始化为空。

Typed readiness：ready、storage_config_unavailable、storage_unavailable、history_incomplete、history_corrupt、
unsupported_history、initialization_failed。非 ready 不发新 session。写入失败会撤销当前 owner index/readiness，
保留已有 session 的 sealed continuation；手动 append 确认完整快照后才恢复 ready。

同一 Node process 的 page、route、startup bundles 通过私有 Symbol 共用一个 runtime。
它持有同一 repository/capture issuer 的闭包，既有 WeakSet issuance 与 capture authority semantics 不变。
Owner resolve 只读完整验证的内存 index，不在 admission 内初始化或读取文件；无公开 owner registration。
Index 包含启动恢复和新 durable-confirmed captures，排除仅封存、写入未确认和 caller records。

## Submission 与 continuation

固定顺序：validate session/selection → capture seal → append → exact durable confirmation → owner index →
同步 admission → adapter/Event → Evidence → allow reveal → submitted。

| 结果 | durable facts | reveal / continuation |
| --- | --- | --- |
| rejected / capture failure | 没有新 canonical attempt | 不 reveal |
| captured_not_durable | 已封存；落盘状态未确认，不能声称 saved | 不 reveal；同 session 手动续交 |
| durable_not_admitted | durable attempt 已存在 | 不删除、不 reveal；可续交或重开 admission |
| durable_without_evidence | durable attempt 已存在 | 不 reveal；不声称 Evidence 成功 |
| submitted | durable + admission + Evidence 均成功 | 当前 session 才允许 reveal |

Continuation 只复用同一 sealed 对象，保留 ID、occurredAt、selection、assistance/provenance，不再次调用 capture。
不同答案拒绝为 sealed_response_conflict，提交成功后的相同/不同重复请求均拒绝。
Repository 同 ID/同事实 confirmed，generation 不变；不同事实仍 conflict。
没有自动重试；pending 页面只显示锁定状态与手动重试按钮，不显示 key/explanation。
HTTP 503 不表示未落盘；封存后的失败页提供返回锁定作答页的链接，不声称 saved。
捕获失败、写入未确认和已落盘未 admission 的内部结果保持区分。

## Recovery 与 evidence authority

独立 Node process A 保存 five/four 后退出；B 使用同一 trusted profile/epoch/root 重开完整 snapshot，
无需原 session token/Map，重新 admission、adapter、Evidence。Event/Evidence IDs 与 factual meaning 保持一致：
five supports correctness，four refutes correctness。另一个进程在 durable commit 后、admission/HTTP success 前退出，
B 仍恢复并 re-admit 原 attempt。未确认写入的现场 attempt 若随进程退出，不作 saved/history claim。

Session Map 只限 active presentation、30 分钟/256 sessions 和当前进程 sealed continuation，TTL 不限制 owner 历史。
恢复事实不重新变成 live issuance capability，不持久化 Event/Evidence，不调用 state derivation 或 WHAT policy。

## Remaining limits

仅固定单题 r1；没有真实 exam items、complete target history → State → WHAT、profile onboarding 或位置迁移。
Fresh Host profile 全局 uninitialized 的产品限制仍存在；本片只初始化已有效 profile 的新 domain。
`diagnostic-history` backup/reset/migration relevance 保持 true，但全局 backup/reset integration 仍 not-implemented。

继承 Slice 2 的 4096 captures/4 MiB、whole-snapshot sync IO、single writer composition 和普通 digest threat model。
无跨进程 writer lock/merge，production 由 Main single-instance/一个 Next child 保证单 writer。
不承诺硬件断电/目录 fsync、抵抗本机所有者删除完整初始化 evidence 或 rollback；若整个 domain reservation
被本机所有者删除，V1 无法区分新 domain，参见 repository threat model。未知 revision/损坏/初始化 record 缺失 fail closed。
Owner index 是 startup/confirmed append 的完整快照，不是对磁盘外部编辑的持续监控。

验证入口：生产提交/恢复 contracts、F1/F2/spec/capture/admission 回归、architecture/full/desktop、
typecheck/lint/build/diff，及 `playwright test --config playwright.diagnostic.config.ts` 的真实 standalone 浏览器流程。

本地 acceptance：新 F3 contracts 25（22 runtime/submission + 3 capability guards）；既有 runtime 12；
F2 repository/boundary 47；F1/storage/spec/capture/admission 73；architecture 573；full contracts 1076；desktop 86。
Targeted Chromium Playwright 4：five/four、forged fields/duplicates、真实临时 profile 离线→锁定→手动续交→durable reveal。
测试不操作安装 profile，不运行 hosted Actions 或全量 E2E。

Typecheck/lint/build/diff 均通过；lint 为 0 errors、1 条既有 application-error-state.tsx warning。

## Files changed

本片共 30 个文件，repository/Kernel/spec/capture/admission 核心、Dexie schema、preload、partition、package/workflow 保持原样。

```text
app/api/diagnostic/submit/route.ts
app/diagnostic/page.tsx
app/features/performance/architecture-boundary.contract.test.ts
app/features/performance/diagnostic-history-boundary.contract.test.ts
app/features/performance/durable-runtime-boundary.contract.test.ts
app/features/performance/managed-storage-boundary.contract.test.ts
app/platform/managed-storage.d.ts
app/server/diagnostic/assessment-runtime.contract.test.ts
app/server/diagnostic/assessment-store.ts
app/server/diagnostic/assessment-submission.ts
app/server/diagnostic/durable-submission.contract.test.ts
app/server/diagnostic/runtime-core.ts
app/server/diagnostic/runtime.ts
app/server/diagnostic/storage-config.ts
desktop/main.ts
desktop/runtime.ts
desktop/squirrel-lifecycle.contract.test.ts
desktop/storage-runtime-config.ts
docs/architecture.md
docs/product-roadmap-0.3-to-1.0.md
docs/recall-diagnostic-history.md
docs/recall-durable-diagnostic-submission.md
docs/recall-kernel-architecture.md
docs/recall-managed-storage.md
e2e/diagnostic-controlled-surface.spec.ts
instrumentation.ts
playwright.config.ts
playwright.diagnostic.config.ts
scripts/start-diagnostic-test-server.mts
test-support/diagnostic-storage.ts
```

`READY_FOR_PHASE_F_SLICE_4 = YES`，仅表示 F3 本地交付和验收完成。停止，不自动进入 F4。
