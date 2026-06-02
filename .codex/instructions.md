# 项目级 Codex 指令

本项目是 Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 应用。

每次开始排查或修改 Next.js 相关问题时，优先使用 `next-devtools` MCP：

1. 先调用 `init` 初始化 Next DevTools MCP。
2. 再检查当前 dev server、路由、运行时错误和官方 Next 文档。
3. 如果 MCP 不可用，再回退到本地文件、`npm run lint`、`npm run build` 和浏览器验证。

不要把 API Key 写入 `.env.local`；当前应用内 API 设置使用 IndexedDB + Web Crypto 保存。
