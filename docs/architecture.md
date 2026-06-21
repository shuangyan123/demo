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

- `persona-flash-card.tsx`：只负责 3:4 卡片正面、原始 PNG 镶边与悬停操作。
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

`public/personas/persona-card-frame-3x4.png` 由 `scripts/extract-persona-frame.mjs` 对多张参考卡做透视校正和像素共识提取。前端仅等比缩放，保留金色纹理、抗锯齿及底部蓝色，不再使用 SVG 或 CSS 重画。

## 扩展原则

新增人设字段时先扩展 `PersonaCustomization` 和 repository 归一化，再分别接入默认编辑器或定制卡背。新增主题只需增加预设，不得为单个主题新增名称判断或固定色分支。
