# API 约定

## 生成

文本和多模态任务统一调用 `/api/ai/generate`。业务 service 调用 `generateWithConnection(connection, purpose, input)` 时必须显式传入 `text` 或 `vision`；连接不具备对应能力时，请求会在密钥解密和网络调用前失败。

旧 `/api/ai` OpenAI-compatible 路由已移除。厂商 endpoint、鉴权头、请求字段和响应解析只允许存在于服务端 provider adapter。

## 语音

人设朗读使用 `/api/ai/speech`。客户端只提交默认语音连接和当前角色的 `VoiceProfile`；没有语音能力、角色音色、Voice ID 或默认语音连接时不发起请求，并保持静音。

## 图片

角色图片完全在浏览器处理，不新增服务端 API。输入仅允许 PNG、JPEG、WebP 且不超过 20MB；新上传图片输出为居中裁切的 2:3 WebP，最大 2400×3600，按质量和尺寸逐级压缩后写入 IndexedDB。既有 3:4 Data URL 不重写，仅在 2:3 展示框内居中裁切。

## 屏幕关键帧

屏幕共享不新增流媒体 API。浏览器只在手动截取或低频观察时生成宽度不超过 960px 的 JPEG，并通过默认多模态连接随当前辅导轮次提交；缺少多模态连接时明确提示，不回退到文本或其他能力连接。

## 兼容边界

旧 `apiSettings`、全局音色与卡片比例只允许 repository 读取并迁移，活跃设置结构和导出结果不得再包含这些字段。默认文本连接更新时同步刷新旧表；清空默认值或移除文本能力时同步删除旧记录。

## Obsidian 本地桥接

Obsidian 不新增服务端 API，也不安装第三方插件。浏览器通过 File System Access API 读写用户明确选择的 Vault，并只访问配置的托管目录。Markdown 使用 YAML Properties 保存 `review-id`、分类、标签和来源引用，正文使用标准 `[[Wikilink]]`；Firefox、Safari 等不支持写目录的环境只提供一次性 `.md` 文件夹导入。

知识演进仍调用 `/api/ai/generate` 的默认文本连接。模型只能返回待确认 JSON 提案，不能获取目录句柄、直接写文件或绕过冲突检查。

Vault Adapter 对外提供目录选择、权限查询/恢复、Markdown 遍历、单文件复读和受限写删能力。所有路径必须是托管根目录内不含 `.`、`..` 的相对路径；目录缺失、句柄失效、权限拒绝、文件占用和用户取消均转换为可操作的中文错误。同步和提案写入不新增服务端接口。

提案确认语义固定为：`create` 创建稳定 `review-id` 的新笔记，`merge` 更新摘要、标签、AI 演进区块与托管链接，`link` 只更新 Wikilink/来源引用。目标映射不是最新 `synced` 基线时必须先同步或处理冲突。

## 自动化调用约定

自动化不新增服务端 Route。每日简报、每周总结和自定义任务通过 `generateWithConnection(connection, "text", input)` 调用默认文本连接；缺少连接时只写入失败运行记录。自动化上下文按用户选择的范围在本地临时组装，不包含密钥、目录句柄或未授权模块数据。

知识演进自动化复用既有提案 JSON 契约，只把提案保存为 `pending`。来源表按勾选范围读取；未勾选知识库时不得读取或发送候选知识条目，此时模型只能生成新增提案。用户确认前不得更新知识条目、映射或 Vault 文件。
