# 视觉差异记录

验收日期：2026-06-21

## 桌面端 1536×1024

- 默认人设卡高度压缩到 64px，桌面三列排列；页面级“语音连接”区已移除。
- 默认人设弹层实测 900×760，头部固定在独立网格行，正文滚动区高 670px、内容高 849px；底部角色音色输入可聚焦访问。
- 定制闪卡实测 190×285，比例 0.667；网格可排列五列，边框加载 `persona-card-frame-2x3.png`。
- 头像模式使用 72×72 头像；保存并刷新后仍保持头像模式，未持久化的无图草稿不会复活。

截图：

- `test-results/persona-default-editor-fixed.png`
- `test-results/persona-flashcard-2x3-desktop.png`

## 移动端 390×844

- 页面 `scrollWidth` 与 `clientWidth` 均为 390，无横向溢出。
- 头像模式三列排列，卡片约 98×138、头像 72×72。
- 闪卡模式为双列，单卡约 147×221，比例保持 0.667。
- 默认人设弹层实测 374×828；正文可用高度 738px、内容高度 1232px，头部和完成按钮不参与正文滚动。
- 屏幕共享取消后显示明确授权提示、视频流为空且按钮恢复描边态，不再伪装为共享中。

截图：

- `test-results/persona-avatar-mobile-390x844.png`
- `test-results/persona-flashcard-mobile-390x844.png`
- `test-results/persona-default-editor-mobile-390x844.png`
- `test-results/tutoring-screen-share-error-mobile.png`

## 可访问性与运行状态

- 闪卡/头像切换使用 `aria-pressed`，编辑弹层保留焦点锁定、Escape、遮罩关闭和触发器焦点恢复。
- 应用内浏览器控制台错误和警告均为 0，未出现 Next.js 错误覆盖层。
- 应用内浏览器的系统共享选择器自动返回取消，因此真实共享轨道的浏览器工具栏停止事件仍需在 Chrome、Edge 等目标浏览器复测。
