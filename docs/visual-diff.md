# 视觉差异记录

## 2026-07-26 · API 密钥与对话体验收口

- 基线：既有对话确认稿、1536×1024 桌面图与 390×844 移动图；本轮不重做整页结构。
- 已收口：空白对话恢复靠近输入框的简短能力说明；AI 正文从单段文本改为语义化段落、列表、引用和代码；模型旁新增紧凑实色推理按钮与滑杆。
- 已收口：右键和省略号菜单桌面使用同一行锚点，移动端使用同一底部操作层；不新增蓝紫渐变、Glow、背景光晕或无意义动画。
- 验收证据：本轮浏览器验证截图写入 `test-results/visual/api-key-conversation-ux/`，该目录仅保存可复现的无凭据界面，不包含浏览器配置或密钥。

验收日期：2026-06-21

## 桌面端 1536×1024

- 定制闪卡固定为 150×225px、比例 2:3；网格采用 8px 间距，可排列 7 列，更宽窗口可扩展至 8 列。
- 透明边框资产有效像素范围为完整 1024×1536，四边透明余量均为 0；前端取消额外边线，PNG 只做等比缩放，金色镶边和底部蓝带贴齐卡边。
- 空卡使用浅蓝灰到暖白珠光渐变，名称为深蓝灰；无角色图时不渲染黑色暗角。
- Obsidian 面板展示 Vault 连接、权限、映射、冲突和待确认提案状态；未连接时 AI 演进按钮禁用，一次性 Markdown 导入仍可用。
- 自动化中心在 1536×1024 下使用任务列表/编辑器双栏，运行收件箱独占下一行；创建、立即运行和已读状态均可到达。
- 缺少默认文本连接时，手动运行生成明确失败记录和侧栏未读徽标，不发起网络请求。
- 页面 `scrollWidth` 与 `clientWidth` 一致，无横向溢出。

## 移动端 390×844

- 闪卡网格固定三列，单卡实测约 100×150px，比例保持 2:3。
- 上传入口、名称和操作按钮缩小后仍可键盘聚焦；空卡在浅色珠光背景上保持可读。
- Obsidian 面板改为单列，连接、回退导入、状态标签和演进提案均可到达。
- 自动化中心在 390×844 下改为单列；时区输入不再撑宽表单，任务启用控件保持单行，主内容无横向溢出。
- 页面 `scrollWidth` 与 `clientWidth` 均为 390，无横向溢出。

## 可访问性与运行状态

- 闪卡/头像切换使用 `aria-pressed`，定制卡上传、编辑和删除均保留可访问名称。
- 空白闪卡只显示加号；“添加角色图片”和“未命名角色”不再可见，但上传按钮仍保留“为未命名角色添加图片”的无障碍名称。
- 应用内浏览器控制台错误和警告为 0，未出现 Next.js 错误覆盖层。
- 自动化浏览器无法把目录选择器调用标记为真实用户手势；界面已将该安全限制转换为中文提示。真实 Vault 目录授权、磁盘写入和 Obsidian 图谱显示仍需在 Chrome 或 Edge 中人工复测。

## 截图证据

截图保存在本地 `test-results/`，不纳入 Git：

- `persona-flashcard-compact-desktop.png`
- `persona-flashcard-compact-mobile.png`
- `obsidian-bridge-desktop.png`
- `obsidian-bridge-mobile.png`
- `automation-center-desktop.png`
- `automation-center-mobile.png`
- `persona-blank-card-no-text.png`

## 2026-07-26 单色 UI 与安全收口

已确认 P0–P3 信息架构继续作为基线，本轮仅统一交互语言并补齐对话树两级菜单：

- 桌面一级菜单锚定当前树行右侧，使用 208px 图标+文字列表；“移动到”在右侧打开 224px 文件夹列表，当前目录使用中性勾选。
- 移动端沿用单一底部层，二级目标列表提供返回和关闭；不在窄屏复用桌面绝对坐标。
- 主按钮、选择、焦点、页签、Toggle 与 Slider 不再使用蓝色；学习链路、数值图表、品牌和红绿黄语义状态保持原编码。
- 插件主从结构、设置密度、总览链路和工作区共边与已确认稿一致；未引入阴影高光、蓝紫渐变、Glow 或背景光晕。

本轮归档截图：

- `docs/design/security-ui-unification/dashboard-desktop-light-1536x1024.png`
- `docs/design/security-ui-unification/conversation-menu-desktop-light-1536x1024.png`
- `docs/design/security-ui-unification/conversation-move-submenu-desktop-light-1536x1024.png`
- `docs/design/security-ui-unification/conversation-menu-mobile-light-390x844.png`
- `docs/design/security-ui-unification/conversation-move-mobile-light-390x844.png`
- `docs/design/security-ui-unification/plugins-focus-desktop-light-1536x1024.png`
- `docs/design/security-ui-unification/settings-appearance-desktop-dark-1536x1024.png`
- `docs/design/security-ui-unification/settings-appearance-mobile-dark-390x844.png`

## AI 连接保存与 UI 批注归档（2026-07-26）

- `docs/design/ai-connection-save-ui-closure/ai-connection-save-feedback-1536x1024.png`
- `docs/design/ai-connection-save-ui-closure/command-search-focus-1536x1024.png`
- `docs/design/ai-connection-save-ui-closure/conversation-menu-1115x792.png`
- `docs/design/ai-connection-save-ui-closure/conversation-menu-2560x1440.png`
- `docs/design/ai-connection-save-ui-closure/scheduled-top-spacing-2560x1440.png`
- `docs/design/ai-connection-save-ui-closure/scheduled-mobile-390x844.png`

## 额度生命周期与组件示例归档（2026-07-26）

- 视觉基线覆盖设置融合壳层、非空连接表、Claude 品牌色、额度状态、插件搜索焦点和粉笔窄详情。
- 截图归档目录为 `docs/design/quota-ui-preview-closure/`；示例只在开发服务器中启用，生产截图继续使用真实数据或空状态。
- `connections-example-1536x1024.png`：设置融合壳层、连接列中心与 Claude 品牌色。
- `quota-stale-dark-1115x792.png`：深色额度过期状态与单厂商操作。
- `fenbi-drafts-1468x674.png`：矮屏粉笔详情、内部滚动与草稿确认布局。
- `mcp-example-mobile-390x844.png`：移动设置抽屉后的 MCP 示例与双行开发标识。
