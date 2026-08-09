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

## 首个样板的形态

建议从面试会话选择一个完整但低耦合的事务流程：

```text
application/interview/submit-interview-turn.ts
```

- 输入使用领域类型和显式依赖，不接收 React event、setter 或 JSX。
- 输出为业务结果或稳定错误，不直接弹 toast、不导航。
- repository 依赖通过窄接口注入；只有存在替换实现或测试隔离价值时才定义 port。
- 调用现有 service/repository，不复制规则，不改变表结构。

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

## 本轮边界

0.3 只建立 Host Capability Layer、迁移计划和守卫。本轮不创建空的 `app/application/` 目录，也不迁移正在高频变化的对话发送链路，避免把架构准备变成跨领域重写。

