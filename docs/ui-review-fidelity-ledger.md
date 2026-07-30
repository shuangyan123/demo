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
