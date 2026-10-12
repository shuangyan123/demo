# Recall Phase F Slice 4 — Complete Diagnostic History → Learner State → WHAT

本片从 Slice 3 exact HEAD `393098c1b08cd55e89a26b93969ea4517e6bf7ba` 开始，接通内部 server 只读重建。
Phase E 保持 COMPLETE；本片不表示 Phase F 整体完成或 DOGFOOD READY。

## 内部 API 与事实源

`app/server/diagnostic/learning-history.ts` 的 `loadCompleteDiagnosticLearningHistory()` 无 caller records、target 或 dependencies 参数。
`state-reconstruction.ts` 的 `reconstructDiagnosticLearnerState({ specId, specRevision, asOf })` 只接 exact spec locator 和 Kernel time context。
额外字段、getter、caller target/history/verified/Host config 均被拒绝。接口没有 HTTP/renderer/preload 入口；F5 才负责 learner-facing continuation。
故障 dependencies seam 仅允许专用 contracts 使用，架构守卫禁止 production consumer 注入或 re-export。

唯一 durable authority 仍是 Slice 2 的 source-owned canonical CapturedAttempt。
Event、Evidence、LearnerTargetState、VerificationDecision 都在内存重新派生，不新增文件、表、schema、缓存事实源或 answer-key persistence。
Kernel/spec/capture/admission/policy 与 repository 格式、容量、写入保证不变。

## 完整性与读取顺序

成功结果的 `scope.completeness = all_durable_captures_in_source_epoch` 明确限定：

`current trusted profileId + current epochId + recall-diagnostic + all captures in validated committed generation`。

每次读取先由现有 repository 重验整个 snapshot，包括所有 capture、profile/epoch、格式、generation、identity、spec binding 和 digest。
成功后 runtime 刷新固定 owner 的完整 index；失败撤销旧 index/readiness，不回退旧 Map。
Owner admission 本身仍同步且只读这个完整 index，不在 admission 内读文件或初始化。

随后对**每条** capture 解析 exact canonical spec revision，读取 authority-owned `learningTarget`，
经唯一固定 `recall-diagnostic` owner 的 `admitVerifiedAssessment`，再调用既有 adapter。
Event target 必须等于 resolved spec target；全部 source Events 必须通过 canonical `deriveEvidence` 与逐条 coverage/lineage 校验。
只有整个 source 成功后才按 canonical target 分组。任一无效、未知或未准入 record 都使整体失败，不能跳过其他 target 或未来 record。
Loader 不包含题目语义、caller target mapping、latest-per-spec 去重、分页或 latest-100 截断。

这不承诺 lifetime/pre-Phase-F/旧 ephemeral history、其他 profile/epoch、Fenbi 或其他来源的完整性。
Digest 沿用普通意外损坏检测，不是签名；不抵抗 OS/files/env compromise。单机单用户、Main 单实例与一个 Next writer 的既有边界不变，
不新增多进程 writer/跨系统 ACID 保证。4096 captures / 4 MiB 上限仍由 Slice 2 显式失败，不发生 eviction。

## State 与 WHAT

完整 target history 传入未改动的 `deriveLearnerTargetStates(events, evidence, { asOf })`。
Loader 不预删未来记录，Kernel 先完成 canonical/identity/lineage/conflict 验证，再应用既有 asOf 语义。
`evidence_after_as_of` 是合法过滤诊断；其他 state derivation diagnostics 返回 typed failure。
随后调用未改动的 `decideNextVerification`，不制造 next task 或改变政策。

| 当前 capture history | 既有 state / WHAT |
| --- | --- |
| complete-empty / canonical target 无 captures | `measurement=unmeasured`、`state=null`；`none/incomplete_effective_state` |
| 正确 five、source-controlled assistance none | emerging / independent；`none/no_authorized_verification_target` |
| 错误 four | unknown / unknown（已测量）；`none/ambiguous_verification_target` |
| earlier wrong → later correct | later support effective；earlier 历史保留；emerging / independent |
| earlier correct → later wrong | later refute effective；earlier 历史保留；unknown / unknown |
| 同一实际 occurrence instant support + refute | 二者进入 effective set，冲突 blocked；`none/ambiguous_evidence_qualification` |

所有 attempt IDs、occurredAt、Event/Evidence identity/facts 原样保留，不按 spec 去重或覆盖早期错误。
retention/transfer 继续 untested，不声明 mastery、全球无帮助或学习效果。

## 空历史与失败

成功 complete 结果携带 scope、canonical target、targetCaptureCount、Events、Evidence、measurement、state、derivation、decision。
source captureCount 与 targetCaptureCount 分离；零 target records 只在整个 source 已通过验证时才合法。
未来记录在完整历史中保留，asOf 前无测量也可以得到 unmeasured；此时 targetCaptureCount 仍可非零。

失败是另一个 discriminated union，不携带 Event/Evidence 数组、state 或 decision：

| kind | code |
| --- | --- |
| unavailable | storage_config_unavailable / storage_unavailable |
| incomplete | history_uninitialized / history_incomplete |
| corrupt | history_corrupt / profile_mismatch / epoch_mismatch |
| unsupported | history_unsupported |
| authority_failure | invalid_request / spec_resolution_failure / admission_failure / event_derivation_failure / evidence_derivation_failure / state_derivation_failure |

Storage failure 不能转成 complete `[]` 或 unknown learner state；完整性失败不会调用 State/WHAT，state failure 不会调用 WHAT。
F4 不调用 initializer，不修复 missing initialized file，不 reset、不替换 empty、不升级 spec。
新 domain 的显式初始化仍只属于 F3 startup；未启动的 F4 read 返回 unavailable。

## 验收与边界

定向 contracts 验证空/正确/错误、两种作答顺序、等时冲突、非时间顺序提交、未来记录、260 次同 spec 历史，
以及全部上述 failures、caller 拒绝、canonical Event/Evidence 不一致和无初始化/派生落盘。
另一个 approved target 的零 captures 场景只用专用 resolver fixture，不增加 production catalog。

7 个独立 Node A→B restart 场景覆盖 empty、correct、incorrect、wrong→correct、correct→wrong、等时冲突与非时间顺序提交。
A 使用真实 F3 submission，输出 live adapter/Event 与 Evidence；关闭后 B 只收到相同 Host bootstrap 与 spec/asOf。
B 不接收旧 session/Map/Event/Evidence/HTTP response，重新完整读 source、重建 owner、admission、State/WHAT。
两条路径的完整 canonical Event/Evidence facts、derivation、state、decision 相同，durable 文件字节不变。
所有 IO 都使用隔离的真实临时 Host profile；这是 boundary/restart 证据，不是 packaged Electron 真实学习效果验收。

架构守卫仅新增 exact server composition edges 与专用测试入口；继续阻止 Kernel→repository/filesystem、renderer→authority、
policy→storage 和 production dependency injection。无 UI、scheduler、WHEN/HOW、Planning、题库扩张或新来源。
位置迁移、全局 export/restore/reset integration、更多真实内容、learner continuation 与 Phase G 仍 deferred。

## 本地质量门与变更文件

使用 Node 24.20.0 / npm 11.19.0。下列计数存在重叠，不能相加；full 包含 architecture 与全部 F4 contracts。

| 验证组 | 结果 |
| --- | --- |
| F4 reconstruction / failures / independent restart + boundary guard | 40 PASS |
| F3 runtime / durable submission + boundary guard | 37 PASS |
| F2 repository + boundary guard | 47 PASS |
| F1 storage / registry / guard + spec / capture / source admission | 73 PASS |
| Kernel Evidence / State / eligibility / WHAT / verified adapter | 232 PASS |
| Architecture contracts | 613 PASS |
| Full contracts | 1116 PASS |
| Desktop contracts | 86 PASS |
| typecheck / build / diff check | PASS |
| lint | 0 errors；1 个未修改基线 warning：application-error-state.tsx:44 |

Playwright 未运行：无 production UI behavior 变化。未 push、未 PR、未运行 hosted Actions。
一次 full gate 的 fixture 提交出现通用失败，未获得具体终态；已补充提交结果诊断，随后 full/architecture 通过，F4 定向组再连续 3 轮均 40/40 通过。
没有因此更改生产故障语义或添加自动重试。

16 个变更文件（本片没有修改 F3 worktree）：

```text
app/features/performance/architecture-boundary.contract.test.ts
app/features/performance/durable-runtime-boundary.contract.test.ts
app/features/performance/diagnostic-reconstruction-boundary.contract.test.ts
app/server/diagnostic/runtime-core.ts
app/server/diagnostic/runtime.ts
app/server/diagnostic/reconstruction-types.ts
app/server/diagnostic/learning-history.ts
app/server/diagnostic/state-reconstruction.ts
app/server/diagnostic/state-reconstruction.contract.test.ts
app/server/diagnostic/reconstruction-failure.contract.test.ts
app/server/diagnostic/reconstruction-restart.contract.test.ts
docs/architecture.md
docs/product-roadmap-0.3-to-1.0.md
docs/recall-durable-diagnostic-submission.md
docs/recall-kernel-architecture.md
docs/recall-diagnostic-state-reconstruction.md
```
