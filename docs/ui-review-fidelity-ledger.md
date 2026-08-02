# UI 审查 Fidelity Ledger

视觉权威为 `docs/design` 中每个页面最新版本。本表把路由、审查数据包、状态与固定视口绑定；旧稿只用于追溯，不参与验收。

| 页面 | 工作台视图 | 数据包 | 必查状态 | 设计基线 | 视口 |
| --- | --- | --- | --- | --- | --- |
| 总览 | `dashboard` | learning / automation / integrations | first-use-empty、populated、dense、permission、conflict | 最新总览设计 | 1536×1024、1115×792、390×844 |
| 错题与复盘 | `library` / `review` | learning | filtered-empty、selection-empty、populated、long-content | 最新错题库与复盘设计 | 三个固定视口 |
| 知识与训练 | `knowledge` / `knowledgeTraining` | learning / integrations | first-use-empty、selection-empty、populated、permission、conflict | 最新知识库、训练、Obsidian 设计 | 三个固定视口 |
| 统计 | `stats` | learning | first-use-empty、populated、dense | 最新统计设计 | 三个固定视口 |
| 对话 | `conversation` | conversation | first-use-empty、populated、long-content、loading、error | 最新对话设计 | 三个固定视口 |
| 导入 | `import` | import | first-use-empty、populated、dense、error | 最新导入设计 | 三个固定视口 |
| 已安排 | `automation` | automation | first-use-empty、filtered-empty、selection-empty、populated、error | 最新已安排设计 | 三个固定视口 |
| 面试与辅导 | `interview` / `tutoring` | interview / tutoring | first-use-empty、populated、long-content、error | 最新面试与辅导设计 | 三个固定视口 |
| 设置与集成 | `settings` / `plugins` | settings / integrations | first-use-empty、filtered-empty、populated、loading、error、permission | 最新设置、MCP、扩展设计 | 三个固定视口 |

## 对照维度

- 文案、字体、图标、颜色、间距、容器几何、数据密度和响应式顺序逐项检查。
- 工作区顶边和左边只由 `<main>` 绘制；禁止蓝色 glow、重复边框、背景光晕和横向溢出。
- 主要结构目标偏差不超过 2px；键盘焦点、滚轮、触控和程序化滚动不得退化。

## 本轮证据

| 页面 / 状态 | 实现截图 | 对照结果 |
| --- | --- | --- |
| 已安排 populated / 1536×1024 | `docs/design/ui-review-sync-mcp-catalog/scheduled-1536x1024.png` | 宽屏保留任务与运行收件箱双栏；DOM 几何无横向溢出。IAB 截图受宿主可见区域限制，结构结论由固定 viewport 几何与 E2E 复核。 |
| 已安排 populated / 1115×792 | `docs/design/ui-review-sync-mcp-catalog/scheduled-1115x792.png` | 工作区实际宽 811px，按容器切换为任务/收件箱页签；筛选、任务行和按钮均在视口内，无裁切。 |
| 已安排 populated / 390×844 | `docs/design/ui-review-sync-mcp-catalog/scheduled-390x844.png` | 与 `docs/design/ai-connection-save-ui-closure/scheduled-mobile-390x844.png` 的标题、摘要、页签、卡片和筛选顺序一致；数据型状态替换空态，页面宽度与滚动未溢出。 |
| MCP 目录 / 1115×792 | `docs/design/ui-review-sync-mcp-catalog/mcp-catalog-1115x792-final.png` | 推荐和 Registry 保持两段信息层级；工作区不足 70rem 时 Server/详情/表单改为单列，修复窄中栏按钮纵向挤压；审查模式明确显示 Registry 已暂停。最终 DOM 复核页面宽度与滚动宽度均为 1115px，交互控件无裁切且控制台无错误。 |

当前主题由用户本地“桃雾”配置驱动，因此颜色不强制覆盖为旧截图中的默认浅色主题；结构、间距、顺序和响应式行为按最新设计基线核对。真实凭据、真实粉笔账户和用户 Vault 内容未进入截图。

## 2026-08-02 · 四页密集数据审查

| 页面 / 场景 | 1536×1024 | 390×844 | 对照结论 |
| --- | --- | --- | --- |
| 薄弱分析 / `library-insights-dense` | `docs/design/ui-review-four-pages/library-insights-1536.png` | `docs/design/ui-review-four-pages/library-insights-390.png` | 保留学习数据统一筛选作用域；补齐 30 天折线、7 日均线、六板块趋势表与三项优先动作。移动端按筛选、趋势、板块、行动顺序单列。 |
| 插件 / `plugins-directory-dense` | `docs/design/ui-review-four-pages/plugins-1536.png` | `docs/design/ui-review-four-pages/plugins-390.png` | 桌面使用注册表列表与检查器；移动端详情为可滚动底部覆盖层。声明式扩展生命周期仍由真实扩展仓储驱动。 |
| 导入资料 / `import-console-mixed` | `docs/design/ui-review-four-pages/import-console-1536.png` | `docs/design/ui-review-four-pages/import-console-390.png` | 桌面保持来源/最近批次与草稿/详情双栏；移动端切为来源、草稿、确认三步。所有确认和删除仅命中 `ui-review:` 记录。 |
| AI 连接 / `settings-ai-connections-dense` | `docs/design/ui-review-four-pages/ai-connections-1536.png` | `docs/design/ui-review-four-pages/ai-connections-390.png` | 桌面完整展示三连接、详情、文本/多模态/语音默认能力；移动端按列表、详情、能力纵向排列。凭据恢复变体另验行内测试禁用与重新输入编辑器。 |

本轮生产浏览器请求监听仅观察到应用自身 `127.0.0.1` 静态资源与路由，没有模型、粉笔、Vault、MCP 或插件远程请求。设计稿中的蓝色仅保留为图表、状态和品牌语义；通用焦点、选中与主交互继续使用中性令牌。

## 2026-08-02 · 设置审查隔离、粉笔专用化与图标治理

| 页面 / 状态 | 1536×1024 | 390×844 | 对照结论 |
| --- | --- | --- | --- |
| 粉笔导入 / `import-console-mixed` | `docs/design/ui-review-four-pages/import-console-1536.png` | `docs/design/ui-review-four-pages/import-console-390.png` | 删除通用知识资料入口，保留账户、官方导出文件/截图和粉笔文本三类输入；桌面保持来源/草稿主从布局，移动端保持来源、草稿、确认三步流。 |
| AI 连接 / `settings-ai-connections-dense` | `docs/design/ui-review-four-pages/ai-connections-1536.png` | `docs/design/ui-review-four-pages/ai-connections-390.png` | 三连接、选中详情和默认能力均由脱敏仓储记录驱动；移动端列表与详情纵向排列且无横向溢出。 |
| 设置 UI 审查启动器 | `docs/design/ui-review-four-pages/settings-review-launcher-1536.png` | `docs/design/ui-review-four-pages/settings-review-launcher-390.png` | 桌面仅占侧栏单行并向上弹出 360px 操作层；移动端使用全视口宽底部操作层。场景只在 AI 连接分区出现。 |

与确认稿相比，本轮有意差异是：粉笔页不再展示通用“文件 / 粉笔实验导入”切换，也不再承载知识资料草稿；AI 连接沿用现有中性主题和更紧凑的真实操作列。按钮中的上传、导入、保存、测试、删除和确认统一采用 Lucide 语义图标，危险与重要操作仍保留文字。

## 2026-08-02 · Codex 对话、插件与 Electron 顶部栏

| 对照点 | 最终实现 | 与确认稿比较 |
| --- | --- | --- |
| 信息层级 | 对话正文仍为主内容；主题目录收敛到消息左缘；插件标题、目录、详情按单一路径展开 | 保持确认稿的低密度、开放式层级，不恢复固定主题侧栏或插件检查器分栏 |
| 布局与间距 | 插件内容限制在约 920px；列表无外框、无分隔线；详情复用同一内容轴 | 与插件列表稿、详情稿的留白和对齐基线一致；真实 Obsidian 面板接在元数据下方 |
| 字体与图标 | 侧栏导航统一 16px Lucide 图标和 0.8rem 文字；插件使用统一图标、标题与摘要 | 修正原主页 18px 图标造成的节奏差异，未引入 Emoji 或混合图标风格 |
| 颜色与边界 | 沿用用户主题的中性色和品牌色；工作区共边只由 `<main>` 绘制，无 glow、详情外框或列表横线 | 比概念稿中的蓝色开关更克制，行为语义不变并符合项目的中性交互约定 |
| 交互状态 | 主题 hover/focus 展开标签；插件整行进详情，开关与三点菜单独立；菜单支持 Escape、外部点击和焦点恢复 | 覆盖确认稿中的核心状态，并为键盘与粗指针补齐可达性 |
| 响应式与顶部安全区 | 1120px 以下保留锁焦点主题抽屉；390×844 无横向溢出；浏览器保留普通 52px 顶栏，Electron 使用 Window Controls Overlay 安全区 | 浏览器不伪造系统窗口按钮；原生最小化、最大化、关闭区域由 Electron 保留 |

最终证据位于 `.playwright-results/`：`p3-plugins-list-desktop.png`、`p3-plugins-desktop.png`、`v0.2.2-conversation-topics-desktop.png` 与 `v0.2.2-conversation-topics-mobile.png`。截图已通过 `view_image` 与三张确认稿逐项复核；应用内浏览器控制台未发现 error 或 warning。
