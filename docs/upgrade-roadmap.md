# 0.2.0 企业级升级闭环

## 状态矩阵

| 阶段 | 风险/目标 | 验收证据 | 回滚边界 | 状态 |
| --- | --- | --- | --- | --- |
| 基线 | 建立 `develop`，恢复依赖维护事实源 | typecheck、lint、203 contracts | 删除新分支与治理提交 | 已完成 |
| P0 安全 | 生产 high/critical 清零，统一本机 API 防护 | audit、Route 安全契约、Provider/MCP contracts | 安全补丁提交 | 已完成 |
| P1 可靠性 | 全局恢复、统一错误、脱敏诊断、零 Hook 豁免 | 错误边界 E2E、诊断契约、lint | 可靠性提交 | 待处理 |
| P2 性能/无障碍 | 包体回归不超过 5%，axe 严重问题清零 | analyzer、桌面/移动 E2E | 性能门禁提交 | 待处理 |
| P3 架构 | 领域类型直引、超预算服务拆分、Dexie v16 不变 | 架构契约、全量 contracts/build | 各领域拆分提交 | 待处理 |
| 发布 | `develop` 到 `main` 的 0.2.0 发布 | CI、浏览器 smoke、人工 Vault/凭据记录 | release PR revert | 待处理 |

## 证据登记规则

- 每个阶段只登记提交、CI、测试命令、脱敏截图和剩余风险，不记录密钥、额度数值、Vault 正文、模型原始响应或完整 prompt。
- 任何红色门禁必须回到所属阶段处理；禁止在发布 PR 中顺手修改其他阶段。
- 人工 smoke 只记录环境、成功/失败、失败分类和恢复动作；真实 Vault 与真实模型服务不进入 CI。

## 默认技术决定

- 本机单用户、local-first，不新增账号、多租户或云端数据层。
- Provider registry、Repository、领域 controller 继续分别承担协议、持久化和视图状态边界。
- 不升级 `review_workspace` v16；无真实慢查询证据不增加索引。
- 普通 major 升级延后，Node.js 22、TypeScript 5、ESLint 9 保持不变。
