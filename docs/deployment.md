# 部署与验证

## GitHub Actions 质量门

Pull Request 和 `main` 推送统一使用 Node.js 20 执行 `npm ci`、ESLint、契约测试和生产构建；全部通过后方可合并。真实 Vault 与外部 AI 连接只在本地 Chrome/Edge 验收，不向 CI 上传目录内容或 API Key。

## 构建要求

```bash
npm ci
npm run lint
npm run test:contracts
npm run build
```

部署产物必须包含 `public/personas/persona-card-frame-2x3.png`。若重新提取镶边，使用 `scripts/extract-persona-frame.mjs` 处理 1024×1536 原始参考图并保留来源记录，不得改用生成式补画。

## 浏览器验收

至少在 1536×1024 与 390×844 检查：2:3 卡片正面纹样与底部蓝色、闪卡/头像切换持久化、无框背面、默认编辑器滚动、高清上传、独立音色、屏幕共享停止同步、键盘焦点、控制台错误和横向溢出。

Obsidian 双向桥接要求 HTTPS 或 localhost，并以 Chrome 111+ / Edge 111+ 做目录权限和真实 Vault 写入验收。部署不得申请托管目录之外的权限；不支持 File System Access API 时必须保留只读 Markdown 文件夹导入。

## 自动化运行边界

本地自动化依赖页面存活，不需要 cron 服务器、Service Worker 或云端队列。浏览器关闭后不会执行；重新打开、恢复可见或网络恢复时合并补跑一次。浏览器通知只在页面打开且用户主动授权时显示，核心结果始终保存在 IndexedDB 收件箱。

部署环境必须允许动态加载 `cron-parser`，并保持系统 IANA 时区数据可用。时区、夏令时、五段式 Cron、最短五分钟间隔、租约续期和旧定义拒绝执行属于发布前契约测试范围。
