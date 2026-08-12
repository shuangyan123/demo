# Declarative Extension 权限与停用边界

## 当前模型

Review Workspace 当前的 declarative extension 是受签名校验的 `data.json` 数据包，不是可执行插件运行时。`ExtensionManifestV1` 只描述包的身份、版本、类型、数据入口、受限权限声明和资产摘要；包内禁止脚本、HTML、JSX、WASM、远程运行时 URL 和任意模板执行。安装记录保存在独立的 `review_extensions` v1 数据库，核心 `review_workspace` 继续保持 v16。

当前真实应用入口只有主题和教师人设：主题可以改变已有外观设置，人设可以写入已有的可卸载人设设置。学习路径、已安排模板和评分标准包目前只是经过校验的数据声明，没有对应的执行 runtime；即使记录为 enabled，也不会获得执行入口。

## 声明不等于授权

Manifest 的 `permissions` 是扩展声明“可能需要什么”，不是用户授权。执行前由纯 TypeScript 决策核重新计算：

```text
enabled
∩ valid declaration
∩ current application capability
∩ current lower-level product permission
```

只有交集完整时才是 `ready`。当前 reason code 只有实际需要的四类：`extension_disabled`、`extension_invalid`、`capability_unavailable` 和 `permission_missing`。解析器不访问 Dexie、React、凭据、网络、AI、MCP 或 Vault。

`enabled` 与 `authorized` 有意分开：用户可以看到一个已安装但停用、声明无效或当前能力不可用的记录；这些状态不会被静默折叠为可执行。启用操作本身也必须通过当前能力预检，不能自动授予底层权限。升级包如果改变类型或权限声明，会清除旧的 enabled 状态，避免继承旧包授权。

## 执行时复核与停用

声明式扩展的真实主题/人设入口通过 `executeInstalledExtensionAction` 在回调执行前重新读取安装记录和当前授权。`setEnabled(true)` 也在同一独立数据库事务中复核，停用后的旧 UI callback 不能绕过边界；拒绝发生在应用副作用之前。

内置 Obsidian 和粉笔集成不与 declarative package registry 混合，但同样在真实边界复核当前的 `review_settings_plugins_v1` 状态：Obsidian 在 Vault 连接、同步、导入、提案/冲突操作和应用级监听前复核；粉笔在解析、Cookie 解密、网络验证/同步和同步结果进入草稿前复核。停用会停止 Obsidian 监听，保留已有数据、凭据、草稿和配置。已经开始且不可取消的外部请求不承诺回溯取消，但下一次执行不会继续使用旧快照。

底层权限仍由既有边界决定：MCP 继续使用现有 `ask`、`allow_session`、`allow_scheduled`、`deny` 和 execution boundary；Vault 继续使用既有 Host/Repository/路径约束；AI 继续使用统一连接与 provider adapter。声明式扩展不会自动获得网络、MCP、scheduled、Vault 或 AI 权限，也不会切换到其他工具、资源、provider 或 host。

## 隐私与兼容

权限决策和错误只携带扩展 ID、类型、稳定 reason code 和安全产品文案，不保存凭据、Token、MCP 参数/结果、完整 prompt、Vault 正文、原始 provider 响应或私有 URL 查询。旧安装记录缺少包声明时按 `extension_invalid` 处理；缺少/异常 enabled 不会扩大权限。停用不是卸载，卸载仍由现有插件目录显式执行并按既有主题/人设回滚语义处理。

本 Phase 没有新增 Dexie migration、MCP registry、插件 runtime、脚本执行器、远程下载或新的审计表。

0.6 的跨边界 Acceptance Closure 证据见 `docs/permission-model-acceptance.md`；本声明式扩展边界仍与既有 MCP、Host、Vault 和 AI authority 分离。
