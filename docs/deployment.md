# 部署与验证

## 构建要求

```bash
npm ci
npm run lint
npm run test:contracts
npm run build
```

部署产物必须包含 `public/personas/persona-card-frame-3x4.png`。若重新提取镶边，使用 `scripts/extract-persona-frame.mjs` 并保留原始参考图来源记录，不得改用生成式补画。

## 浏览器验收

至少在 1536×1024 与 390×844 检查：卡片正面纹样与底部蓝色、无框背面、默认编辑器滚动、高清上传、独立音色、八个主题、弥散色场、键盘焦点、减少动态效果、控制台错误和横向溢出。
