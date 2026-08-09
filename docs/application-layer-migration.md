# Application Layer 渐进迁移计划

## 当前事实

`ReviewWorkspace` 已经完成根组件、Bootstrap、Controller、View Router、领域 Controller 和低频动态视图的拆分。当前主要风险不是根组件重新变大，而是多步骤业务流程继续停留在 React hook 或大型交互组件中。

目标依赖方向为：

```text
UI / View
  ↓
React Controller
  ↓
Application Use Case
  ↓
Service / Repository / Host Capability
```

Controller 继续负责表单事件、视图状态、焦点、导航和通知；Application Use Case 负责可在 React 之外执行和测试的业务编排。

## 候选清单与顺序

| 顺序 | 当前入口 | 候选 Use Case | 判断 |
| --- | --- | --- | --- |
| 1 | `app/features/interview/use-interview-data.ts` | `start-interview-session`、`submit-interview-turn` | 多 repository 写入和会话状态转换边界清晰，适合作为首个样板 |
| 2 | `app/features/automation/use-automation-center.ts` | `execute-automation` | 已有租约、运行记录和错误分类，抽取后可脱离 React 验证原子流程 |
| 3 | `app/features/import/use-import-drafts.ts` | `confirm-import-drafts` | 草稿确认与正式写入有明确提交边界，但需保留现有撤销和批量语义 |
| 4 | `app/features/conversation/conversation-workspace.tsx` | `send-conversation-message`、`accept-knowledge-proposal` | 价值高但涉及流式 AI、工具链、附件和实时媒体，风险最高，待前三个模式稳定后处理 |
| 暂不迁移 | `use-review-learning-controller` 等薄领域 Controller | 单次 repository 调用 | 抽取只会增加转发层，没有独立业务价值 |

## 0.4 Phase 1：Interview（2026-08-09）

首个样板已经落地：

```text
application/interview/start-interview-session.ts
application/interview/submit-interview-turn.ts
```

- 输入使用领域类型和显式依赖，不接收 React event、setter 或 JSX。
- 输出为包含 session/turn 的业务结果；失败抛出带稳定 `step` 与 `partialResult` 的 `InterviewApplicationError`，不直接弹 toast、不导航。
- repository 依赖通过窄接口注入；只有存在替换实现或测试隔离价值时才定义 port。
- 调用现有 service/repository，不复制规则，不改变表结构。
- `submit-interview-turn` 只返回 `shouldEvaluate`，React Controller 继续调用既有 `finishSession` 评分流程，避免 Application 反向依赖 Hook。

当前部分提交语义保持不变：session 创建、Candidate Turn、AI Turn 和 session 更新是依次发生的本地/外部步骤，不构成跨 IndexedDB 与 AI API 的 ACID 事务。失败时不回滚已经确认的用户回答，也不自动重试外部请求；Controller 刷新后展示真实已写记录。若 AI Turn 已写而 session 更新失败，turns 与 session transcript 可能暂时不一致，后续成功推进会从持久化 turns 重建 transcript。数据模型目前没有提交幂等键，因此用户显式重新提交仍可能产生重复 turn，本阶段不伪造自动去重保证。

## 0.4 Phase 2：Automation Execution（2026-08-09）

第二个真实用例已经落地：

```text
application/automation/execute-automation-run.ts
```

- `useAutomationCenter` 继续负责 Web Locks、busy 状态、调度触发、通知、刷新和示例模式；单次执行的租约、`AutomationRun` 与外部副作用顺序进入 Application。
- `automationExecutionRepository` 只暴露原子租约和运行记录持久化操作；Application 使用显式窄依赖调用现有 preview、executor、failure classifier 与 repository，不新增通用基类或容器。
- 获取租约后，预览或 `running` 记录写入失败也会进入清理；`running` 写入成功后才启动每分钟续租，终态形成后先停止续租，再由当前所有者释放租约。
- `running` 记录先于外部 AI、HTTP 采集和提案保存提交。外部执行与 IndexedDB 不构成 ACID 事务；成功/失败终态和当前所有者的调度推进仍在同一个本地 Dexie transaction 内提交。
- 外部执行错误只分类并写一次 `failed` 终态，不自动重放。外部执行开始后若终态写入或 cleanup 失败，`AutomationApplicationError` 以 `partialResult` 暴露已确认的 `running`/终态记录和输出证据，并将 `retrySafety` 标为 `manual-only`。
- cleanup 失败不会覆盖已有 Application 主错误：原 `step`、cause、`retrySafety` 与 `partialResult` 保持不变，停止续租/释放租约异常附加到 `cleanupErrors` 作为次级诊断。仅当主流程成功时，cleanup 才以稳定的 `release-lease` 主错误返回；若终态已经提交，部分结果仍明确保留该终态。

本阶段不修改任务、运行记录或提案 schema，不改变试运行、调度频率、Web Locks、通知、Electron/Host、凭据或外部执行协议。

## 0.4 Phase 3：Import Confirmation（2026-08-09）

第三个真实用例已经落地：

```text
application/import/confirm-import-drafts.ts
```

- `importDraftRepository.confirmDrafts()` 继续在一个 Dexie transaction 内创建正式 Mistakes、删除实际有效 Drafts，并按实际确认数量更新相关 Batch；Application 不复制或拆分该事务。
- Repository 返回 `confirmedDrafts` 与 `createdMistakes`，Application 据此生成包含 requested、confirmed、skipped 集合的稳定 receipt。不存在 ID 和空题干草稿不会进入确认集合、savedCount 或撤销凭据。
- `reviewRepository.createImportJob()` 是确认 transaction 之后的审计/旧 UI 记录，不是正式 Mistake 入库的核心提交。若已有实际确认提交且该步骤失败，`ImportApplicationError` 以 `record-import-job`、`manual-only` 和 `partialResult.confirmation` 表达已完成的确认，不回滚或隐式重跑；实际确认数为零时仍可安全重试。
- `useImportDrafts` 只保留示例模式、选择、notice、刷新和 30 秒内存撤销计时；成功或 partial success 都从 Application receipt 建立真实撤销凭据。
- `undoConfirmation()` 仍是单一 Repository transaction，因此不为目录对称新增 Use Case；撤销 token 不持久化，页面刷新后继续失效。

本阶段不迁移文本/文件/AI/OCR/Fenbi parsing、Draft CRUD、Provider plugin 或 Conversation；不修改 Dexie v16、Electron/Host、凭据和 UI 视觉结构。

## 架构守卫

建立 `app/application/` 后，沿用现有文本契约测试，至少保证：

- Application 不导入 React、CSS、UI component 或 feature view。
- UI/View 不直接导入 `app/db`、repository 实现、provider adapter 或 Electron preload global。
- Host adapter 不反向导入 feature、application、service、database 或 server。
- Electron preload global 只允许在 `app/platform/desktop/` 和 ambient 类型声明中出现。

不引入重量级依赖图工具；当文本契约无法准确表达真实边界时，再评估 TypeScript AST 检查。

## 每批迁移的验收问题

1. 用例是否包含真实业务编排，而不是把一个 repository 方法换个名字？
2. React Controller 的职责是否减少，交互行为是否保持？
3. 用例能否在无 DOM 环境通过契约测试覆盖成功、失败和部分提交？
4. 是否保持 Dexie v16、凭据、Vault、对话和自动化数据兼容？
5. 删除新用例并恢复原 Controller 调用，是否能在单个提交内回滚？

## Phase 3 状态与后续边界

- Interview：`start-interview-session`、`submit-interview-turn` 已完成，并有成功、失败、调用顺序与部分提交的直接 Node 测试。
- Automation：`execute-automation-run` 已完成，并有租约竞争、调用顺序、外部失败、部分提交、重试安全和 cleanup 失败的直接 Node 测试。
- Import：`confirm-import-drafts` 已完成，并有实际确认集合、mixed validity、ImportJob partial success、精确撤销和无隐式重跑的直接测试。
- Conversation：deferred；上下文预算、压缩、主题、插件和工具链仍在高频变化，本阶段不迁移。
- Host Capability、Electron、Dexie v16、Provider/Vault/凭据格式均未扩展。
- 0.4 当前计划范围已满足验收；Conversation 的 deferred 状态不因本阶段完成而改变，后续迁移需要独立授权。
