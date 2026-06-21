# API 约定

## 生成

文本和多模态任务统一调用 `/api/ai/generate`。业务 service 调用 `generateWithConnection(connection, purpose, input)` 时必须显式传入 `text` 或 `vision`；连接不具备对应能力时，请求会在密钥解密和网络调用前失败。

旧 `/api/ai` OpenAI-compatible 路由已移除。厂商 endpoint、鉴权头、请求字段和响应解析只允许存在于服务端 provider adapter。

## 语音

人设朗读使用 `/api/ai/speech`。客户端只提交默认语音连接和当前角色的 `VoiceProfile`；没有语音能力、角色音色、Voice ID 或默认语音连接时不发起请求，并保持静音。

## 图片

角色图片完全在浏览器处理，不新增服务端 API。输入仅允许 PNG、JPEG、WebP 且不超过 20MB；输出为居中裁切的 3:4 WebP，最大 2400×3200，按质量和尺寸逐级压缩后写入 IndexedDB。

## 兼容边界

旧 `apiSettings`、全局音色与卡片比例只允许 repository 读取并迁移，活跃设置结构和导出结果不得再包含这些字段。默认文本连接更新时同步刷新旧表；清空默认值或移除文本能力时同步删除旧记录。
