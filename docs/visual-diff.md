# 视觉差异记录

验收日期：2026-06-21

## 桌面端 1536×1024

- 定制闪卡固定为 150×225px、比例 2:3；网格采用 8px 间距，可排列 7 列，更宽窗口可扩展至 8 列。
- 透明边框资产有效像素范围为完整 1024×1536，四边透明余量均为 0；前端取消额外边线，PNG 只做等比缩放，金色镶边和底部蓝带贴齐卡边。
- 空卡使用浅蓝灰到暖白珠光渐变，名称为深蓝灰；无角色图时不渲染黑色暗角。
- Obsidian 面板展示 Vault 连接、权限、映射、冲突和待确认提案状态；未连接时 AI 演进按钮禁用，一次性 Markdown 导入仍可用。
- 页面 `scrollWidth` 与 `clientWidth` 一致，无横向溢出。

## 移动端 390×844

- 闪卡网格固定三列，单卡实测约 100×150px，比例保持 2:3。
- 上传入口、名称和操作按钮缩小后仍可键盘聚焦；空卡在浅色珠光背景上保持可读。
- Obsidian 面板改为单列，连接、回退导入、状态标签和演进提案均可到达。
- 页面 `scrollWidth` 与 `clientWidth` 均为 390，无横向溢出。

## 可访问性与运行状态

- 闪卡/头像切换使用 `aria-pressed`，定制卡上传、编辑和删除均保留可访问名称。
- 应用内浏览器控制台错误和警告为 0，未出现 Next.js 错误覆盖层。
- 自动化浏览器无法把目录选择器调用标记为真实用户手势；界面已将该安全限制转换为中文提示。真实 Vault 目录授权、磁盘写入和 Obsidian 图谱显示仍需在 Chrome 或 Edge 中人工复测。

## 截图证据

截图保存在本地 `test-results/`，不纳入 Git：

- `persona-flashcard-compact-desktop.png`
- `persona-flashcard-compact-mobile.png`
- `obsidian-bridge-desktop.png`
- `obsidian-bridge-mobile.png`
