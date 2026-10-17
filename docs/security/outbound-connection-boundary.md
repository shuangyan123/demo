# 出站连接安全边界

本实现替代 `URL → DNS 预检 → fetch 再解析`。地址校验本身不构成 DNS rebinding 修复，实际调用必须使用 `app/server/http/outbound-fetch.ts`。

## 连接机制

1. 校验最终 HTTP(S) URL、元数据 hostname 与内嵌凭据；规范化 IPv4、IPv6、mapped IPv6 和 NAT64。RFC1918/ULA 需要显式 LAN 授权，Provider/MCP 保留 loopback；采集、固定厂商/Registry 下载只允许公网。CGNAT、链路本地、文档、测试、保留、多播与特殊地址不因 LAN 开关放行。localhost 必须实际解析为 loopback，不再豁免 DNS。
2. 每次请求读取全部 DNS 答案，任意一个不符合策略则拒绝。DNS 预检与连接之间没有自由的第二次解析；connector 的异步 lookup 仅返回本次批准集合，IPv4/IPv6 fallback 也只在其中选择。DNS/连接各有 10 秒预算，总 deadline 与请求取消贯穿 headers/body。
3. 使用显式锁定的直接生产依赖 Undici 7.29.1。它已是锁文件中的传递依赖；直接声明是为了使用其公开 Agent/buildConnector/fetch API，不依赖 Node 或 SDK 的内部实现。每请求独占池、单连接、无 pipelining、无跨请求 TLS session cache；禁止授权撤销后复用旧池。
4. HTTP 写入 Authorization/正文前核对 socket 的规范化 remoteAddress 和 remotePort。URL 与 Host 保持原值，域名 TLS 保留原 hostname 的 SNI/证书验证，IP literal 使用 IP SAN，强制 `rejectUnauthorized:true`。不更改全局 fetch、全局 dispatcher 或 CA。
5. 使用 Undici 公开 fetch，避免 Next 或 SDK 重建 Request 丢弃 dispatcher。Node 内置 Request 的可见 HTTP 字段显式转交，流式 upload 保留 duplex，response 逐块保留背压。读完、取消、异常或 deadline 都销毁池；不自动重试请求或 fallback 到其他 Provider/模型。

分类参考 [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) 和 [IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/)。地址注册表会变化；特殊地址之外的公网 IP 也不代表内容可信。操作系统路由、可信 CA 被替换或宿主进程已被控制不在本边界内。

## 实际调用路径

| 路径 | 策略 |
| --- | --- |
| Acquisition | 精确 origin，每跳重新授权和绑定，最多 3 跳，10 秒/跳、1MB 内容预算；取消上一跳 body |
| Provider generate/stream/models | 最终 adapter URL 按连接 LAN 许可绑定，禁止自动重定向；官方 Google Interactions 使用已有 HTTP wire adapter，保持 `store:false`、零重试、原 SSE/可见终态契约 |
| Speech/transcribe | 最终地址（包括 speechEndpoint）重新授权、绑定和取消，禁止重定向；Qwen 音频下载仅公网、15 秒、16MB |
| MCP SDK | 公开 custom fetch 覆盖 POST/GET/DELETE；每次只允许原 endpoint 的 origin/path/query，拒绝所有重定向，关闭 SSE 自动恢复重试；15 秒会话 deadline 与 finally close |
| Registry/quota/realtime credential exchange/Fenbi | 固定业务主机，公网连接绑定，禁止重定向；不把用户输入当作 URL authority |
| GLM WSS | 固定主机、独占 HTTPS Agent 和批准 lookup，保留 hostname TLS、15 秒握手、禁止重定向；关闭时销毁 Agent |

Desktop 对自己拥有的 Next runtime 的内部 loopback 请求仍由现有 runtime token/Host 边界保护，不将其当成用户提供的外部目标，不扩大 preload/IPC。

## 代理兼容性

本实现不声称能够约束通过代理重新解析的目标。存在 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY（含小写）且目标未命中明确 NO_PROXY 时，返回 `outbound_proxy_unsupported`，不静默改为直连。NO_PROXY 支持精确 hostname、hostname:port、点前缀域名范围与 `*`；不推测 CIDR 等其他格式。未使用 EnvHttpProxyAgent、全局代理或未受控 HTTP CONNECT/SOCKS。后续如支持代理，需要单独约束代理地址、已批准 tunnel 目的 IP 与原域名 TLS。

## Acquisition allowedOrigins 语义

请求中的 `allowedOrigins` 是单机用户为采集任务选择的来源范围，由任务/来源配置交集派生；它不授予访问私网、loopback 或特殊网络的权限。默认允许用户选择任意公网 HTTP(S) origin，保持既有本地采集功能。

部署者可在服务端设置 `RECALL_ACQUISITION_ALLOWED_ORIGINS`，值为 JSON origin 数组，例如 `["https://source.example"]`。这时请求选择必须是可信配置的子集；越权返回 403，配置无效返回 503，空数组拒绝所有来源。客户端不能覆盖此配置，跨来源浏览器请求仍由 `readRouteJson` 拒绝。不新增账户、数据库或持久化权限。

## 验证与边界

`outbound-fetch.contract.test.ts`、`outbound-tls.contract.test.ts`、`mcp/transport.contract.test.ts`、acquisition route contracts 覆盖 fake DNS rebinding/混合答案、真实 HTTP、真实 TLS Host/SNI/IP SAN、错误证书身份/不可信 CA、重定向、代理失败关闭、取消、超时、独占池与 MCP SDK 实际会话。

TLS fixture 的私钥只在测试自己创建的临时目录生成并删除，Git 和审计输出不包含私钥。所有网络 fixture 都由测试自己创建；不扫描用户已有私网服务。Windows 测试使用 Git for Windows 附带的 OpenSSL，Linux 使用系统 OpenSSL，缺失会导致测试失败。实际通过次数与未执行项见本轮验收记录；静态发现不是执行、通过或行为覆盖证据。
