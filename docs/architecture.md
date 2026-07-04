# 应用架构

## AI 连接边界

```text
ReviewWorkspace → feature hook → AI service
→ ai-connection-client → /api/ai/generate|speech → provider adapter
```

- `ReviewWorkspace` 只向业务模块注入已按用途解析的 `ApiConnectionProfile`。
- 文本、关键帧和朗读分别声明 `text`、`vision`、`speech` 能力；连接级客户端在解密前拒绝能力不匹配的请求。
- `ai-connections-repository` 统一维护默认连接、密钥密文、旧表同步和失效默认值清理。业务 service 不读取 `apiSettings`，也不推断厂商协议。
- `/api/ai/generate` 与 `/api/ai/speech` 是仅有的浏览器代理入口，厂商 endpoint、鉴权和响应解析集中在 provider adapter。

## 人设与主题架构

## 模块边界

- `persona-flash-card.tsx`：只负责 2:3 卡片正面、原始 PNG 镶边与悬停操作。
- `persona-avatar-card.tsx`：复用同一人设数据和编辑动作，提供更高密度的头像视图。
- `persona-card-back-dialog.tsx`：只负责定制角色的名称、描述和独立音色。
- `persona-default-editor.tsx`：只负责默认人设头像及完整字段，采用固定外壳和独立滚动区。
- `personalization-settings-repository.ts`：负责旧数据迁移、归一化、独立音色解析和 IndexedDB 持久化。
- `appearance-settings-repository.ts`：负责主题迁移、色彩变量和弥散色场生成。

## 数据流

```text
IndexedDB 读取 → repository 一次性迁移与归一化 → 页面本地草稿
→ 用户编辑/预览 → repository 保存 → 业务模块按实际人设解析独立音色
```

页面不引入全局状态库。朗读只接收默认语音连接与当前人设音色，不跨能力回退；无音色时明确提示并保持静音。

## 资产策略

`public/personas/persona-card-frame-2x3.png` 由 `scripts/extract-persona-frame.mjs` 对用户确认的 1024×1536 参考图执行确定性透明化。前端仅等比缩放，保留金色纹理、抗锯齿及底部蓝色，不使用 SVG 或生成式重画。

## 屏幕共享边界

`TutoringWorkspace → useTutoringMedia → useFrameSampler → tutoring AI service` 保持单向依赖。`MediaStream` 和最近关键帧只存在浏览器内存；浏览器停止共享时立即清理采样状态。多模态连接只接收手动或三秒低频采样的 JPEG，不接收连续视频或系统音频。

## Obsidian 知识图谱桥接

```text
KnowledgeView → useObsidianKnowledgeBridge → knowledge evolution service
→ obsidian-knowledge-repository → Vault adapter / IndexedDB v12
```

- React 只保存 `ObsidianVaultSnapshot`、映射和提案；`FileSystemDirectoryHandle` 仅由 repository 与 Vault adapter 读取。
- Vault 的 `AI知识库/政治理论|常识判断|申论` 是 Markdown 正文和 Wikilink 主源；IndexedDB 保存正文镜像、训练状态、三方哈希与冲突。
- 手动同步以最后同步哈希为基线：单边变化自动同步，双边变化保留两份内容并等待选择，文件消失只标记断开。
- AI 自动收集错题、面试复盘、辅导摘要和知识条目作为候选，但只生成 `create | merge | link` 提案；确认后才修改显式 AI 演进区块并写入 Vault。
- 同步采用“完整遍历与重复 ID 预检 → Vault 写入 → IndexedDB 事务提交”；预检或文件写入失败时不得更新同步基线。托管根目录缺失属于连接故障，不等同于空目录。
- 冲突选择和提案确认都会重新读取 Vault 并校验三方哈希，过期页面不得覆盖新版本；`link` 提案只更新 Wikilink 和来源引用。

## 扩展原则

新增人设字段时先扩展 `PersonaCustomization` 和 repository 归一化，再分别接入默认编辑器或定制卡背。新增主题只需增加预设，不得为单个主题新增名称判断或固定色分支。

## 本地自动化中心

```text
AutomationView → TaskList / Editor / Inbox → useAutomationCenter
→ scheduler / executor → automation-repository
→ IndexedDB v13 / 默认文本连接
```

- 自动化定义和运行收件箱由 IndexedDB 管理；React 只保存可序列化快照，任务运行次数一次遍历派生，定时器、Web Locks 和租约留在 hook/repository。
- 应用启动、恢复可见和网络恢复时检查到期任务。关闭期间的多个周期合并为一次补跑，执行后直接推进到下一计划时间。
- 自定义任务只读取明确勾选的错题、知识、面试、辅导或 Obsidian 映射；知识演进来源和候选知识同样按范围读取。除保存待确认知识演进提案外，不修改业务数据。
- 多标签页先申请 Web Lock，再由 IndexedDB 五分钟可续期租约兜底；计划执行前校验定义版本，提交结果前复核所有者。任务失败同样写入收件箱并推进计划，避免无限重试。
