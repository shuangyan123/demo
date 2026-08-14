# Desktop Credential Threat Model & Host Boundary

状态：0.7 Phase 1 COMPLETE（2026-08-12）；0.7 credential-security closure COMPLETE（2026-08-14）。本文件仍不声明跨机器、跨账户或一般 DPAPI portability。

本文件只定义当前凭据边界、Electron 宿主能力和后续迁移契约。Phase 1 不改写现有用户凭据、不删除旧材料、不升级 Dexie schema，也不宣布 Windows 实际迁移验收完成。

## 2026-08-14 closure boundary

后续独立 Windows acceptance 已由 `docs/release-smoke.md` 归档：在同一台机器、专用 Windows 测试用户/profile 和同一 application profile 中，operator-attested evidence 记录了 Desktop-preferred migration、`3 → 0` retained Web sources、shared Web key removal、Desktop record/migration authority preservation、full restart，以及 cleanup 后 DeepSeek/MiniMax credential-backed operation。该记录关闭 0.7-owned credential-security blockers，但不改变本文件对不同 machine/account、copied `userData`、一般 DPAPI portability、adjacent-version、uninstall/reinstall 和 corruption/interruption no-safe-seam 的边界。

## 当前 Secret Inventory

| Secret 类型 | 当前存储 | 当前格式与上下文绑定 | 读取 / 写入 | 迁移与清理 | Renderer / Web 共用 |
| --- | --- | --- | --- | --- | --- |
| AI provider API Key | `review_workspace.apiConnectionProfiles` 的 `encryptedKey` / `iv`；旧兼容表为 `apiSettings.default` | `v2:` AES-GCM；`ai-connection:<id>:api-key` 或 `ai-connection:legacy-default:api-key` AAD | `ai-connections-repository.ts` 在发起请求前解密；设置保存时加密 | `secret-migration-service.ts` 负责 legacy v1 → Web v2；删除连接时删除对应记录 | 是；Web/Electron 共用 repository 和 WebCrypto |
| 额度插件凭据 | `localStorage` 的 `review-workspace:ai-quota-plugin-configs` | `encryptedCredentials.<key>` 分字段 v2；旧单字段仍可读取；AAD 为 `quota:<configId>:<credentialKey>` | `ai-quota-repository.ts` 保存、请求前解密 | 迁移服务处理分字段与旧单字段；导出排除 | 是；不进入 Dexie |
| MCP Bearer Token | `localStorage` 的 `review-workspace:mcp-settings:v2`，并兼容 `:v1` | `encryptedToken` / `encryptedTokenIv`；AAD 为 `mcp:<profileId>:bearer-token` | `mcp-settings-repository.ts` 在 discovery/call 前解密 | 迁移服务处理 v1/v2 存储键；删除 profile 清理配置 | 是；原始 Token 不进入快照、审计或 MCP 结果 |
| 粉笔 Cookie | `localStorage` 的 `review-workspace:fenbi-import-credential` | `encryptedCookie` / `iv`；AAD 为 `fenbi:default:cookie` | `fenbi-credential-repository.ts` 保存与单次同步前解密 | 迁移服务处理 Web v1 → v2；显式 clear 删除记录 | 是；服务端只在单次请求内存中使用 |
| Legacy JWK | `localStorage` 的 `review_workspace_crypto_key_v1` | 可导出的旧 JWK，仅为旧密文恢复迁移保留 | `crypto-service.ts` 只在 legacy ciphertext 解密路径读取 | 所有旧记录确认迁移完成后才允许删除；Phase 1 不删除 | 是；不得进入日志、诊断或导出 |
| Web v2 主密钥 | 独立 IndexedDB `review_workspace_secure_keys` / `keys`，不升级 `review_workspace` | 不可导出的 AES-GCM `CryptoKey`，`primary-aes-gcm-v2` | `secure-key-store.ts` 创建与只读解密 | 用户确认的完整重置或测试 teardown 才删除；Phase 1 不删除 | 浏览器 profile/origin 绑定；不进入导出 |
| 临时请求凭据 | React 表单、一次性 repository 结果或 route body 的短生命周期内存 | 没有持久化 ciphertext；不作为迁移源 | AI、MCP、Fenbi、Realtime route 在副作用边界消费 | 请求结束释放；无自动持久化或恢复 | Web/Electron 共用请求链，但不属于本地存储 |

当前没有发现第二套业务凭据数据库、`.env.local` 读取、`credentials.json`、`secret.txt` 或 Electron `userData` 凭据 vault。备份和诊断会排除密文、IV、密钥、Token、Cookie 与目录句柄。

## Browser / Web current model

Web 生产路径继续使用 `crypto-service.ts`：

- Web v2 使用 AES-GCM、随机 IV、不可导出的 AES-256-GCM `CryptoKey`，并用每条记录的 `secretContext.*` 作为 AAD。
- 解密只读取现有 secure key；缺 key、损坏 key、AAD 不匹配或密文损坏都转成稳定错误，绝不为旧 ciphertext 静默生成一把新 key。
- Legacy JWK 仅用于 v1 → v2 恢复迁移；旧记录没有全部确认迁移成功前不得删除 JWK。
- 设置 UI 只显示掩码值；raw secret 不进入 React 长期状态、localStorage、diagnostics、Automation audit、导出或错误日志。

它能防护：

- 直接把 WebCrypto `CryptoKey` 导出成 JWK；
- 不同记录之间的 ciphertext / AAD context 替换；
- 普通数据导出、备份和诊断意外携带凭据；
- 缺少当前 key 时把不可解密数据错误地当作新 key 数据。

它不能防护：

- 已在同一 origin 执行的恶意脚本或 XSS，因为脚本可以调用产品已有解密路径；
- 具有当前 Windows 用户权限、能控制浏览器/Electron profile 或读取运行期内存的恶意进程；
- 用户主动删除浏览器 profile、IndexedDB 或 localStorage 后的本机 key 丢失；
- 凭据在发起 Provider/MCP/Fenbi 请求时短暂存在于业务内存和请求头中的风险。

IndexedDB 与 localStorage 的可用性依赖当前 origin/profile。profile 或安全 key 缺失时，恢复语义是稳定错误和重新输入凭据，不是生成新 key、猜测掩码值或从旧 ciphertext 伪造恢复。

## Electron Windows host model

仓库实际安装版本为 `electron@43.2.0`。本地 `node_modules/electron/electron.d.ts` 核对出 `safeStorage.isAsyncEncryptionAvailable()`、`encryptStringAsync()`、`decryptStringAsync()` 和 `shouldReEncrypt`；本轮实现不依赖更高版本才有的额外返回字段。

Electron 官方 [safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage) 定义了这些事实：模块属于 Main Process；异步 API 推荐用于非阻塞、密钥轮换和临时不可用处理；Windows 使用 DPAPI，通常保护同一台机器上的其他用户，但不保护同一用户空间中的其他应用。它不是 TPM、硬件密钥、Windows Credential Manager 或 zero-trust vault 的同义词。

当前 Main 进程只在 `app.whenReady()` 之后安装 capability IPC。状态探测使用异步可用性：

- `available`：异步 host protection 可用；
- `temporarily_unavailable`：应用尚未 ready 或异步 provider 尚未就绪；
- `unavailable`：provider 探测或运行时调用失败；
- `unsupported`：平台不在当前支持范围，或 Linux 选中了 `basic_text`。

任何非 `available` 状态都拒绝 protect/unprotect。绝不调用 `setUsePlainTextEncryption(true)`，绝不把不可用状态回退成明文、普通文本或假的内存 host。

Windows 保护边界应这样理解：同一 Windows 用户下的其他进程仍是风险；跨 Windows 用户、换机或复制到另一 profile 不应假定可解密。覆盖升级、卸载后保留 `userData`、删除 `userData`、账户变化和机器变化的最终可恢复性必须由真实 Windows 验收确认，不能仅凭“安全存储”四个字推断。

Phase 1 不新增 host durable store。当前 `userData` 中已有 Vault 状态仍由 Vault 模块管理；凭据 host capability 只处理调用者传入的版本化保护包，不保存学习状态，也不改变现有 Web ciphertext。

## 设计选择

| 方案 | 优点 | 主要代价 / 风险 | Phase 1 判断 |
| --- | --- | --- | --- |
| A. 每条 credential 直接由 Main `safeStorage` 保护 | 接入小；不需要新 wrapping key | 需要在 envelope 中补回 AAD/context binding；unprotect 会把明文跨 IPC 返回 renderer；当前 records 需要 cutover | 不作为当前生产 write backend |
| B. `safeStorage` 只保护 Desktop wrapping key，记录继续 AES-GCM + AAD | 可保留现有记录级 AAD；便于 key rotation 和统一 envelope | 需要 Main-held key、更多生命周期与恢复设计；容易扩大通用 crypto IPC；迁移与回滚更复杂 | 留给后续设计审查，不在 Phase 1 引入 |
| C. 保持 WebCrypto ciphertext，Phase 1 仅建立 Host boundary 与资格 planner | 零生产数据改写；Web 兼容和当前 AAD 不变；可先验证 Electron 生命周期、IPC 和恢复契约 | 本轮不会声称现有凭据已完成 Desktop cutover；未来仍需独立迁移与 Windows 验收 | **选中** |

本轮采用 C，并实现一个窄化的 `desktop-v1` capability 作为后续 Phase 2 的安全 seam。它不被任何现有 credential repository 调用，也不改变当前写入 authority。Host envelope 的 protected payload 内含 `version + context + secret`；外层只保存 `version + context + base64 payload`。safeStorage 本身没有产品级 AAD 参数，因此 decrypt 后必须再次校验 context，跨记录替换 fail closed。

`unprotectCredential(context, envelope)` 可能把明文返回 renderer，这是明确的未来迁移风险，而不是被掩盖的安全保证。Phase 1 只用 synthetic/test seam 和 direct contract 证明包格式、上下文绑定及失败语义；后续 Phase 2 若要迁移真实 records，必须重新审查是否改为 Main-held key / record operation，以减少明文跨 IPC。

## Host Capability / IPC boundary

调用链为：

```text
Feature / Service
  → app/platform/host.ts
  → app/platform/desktop/desktop-host-adapter.ts
  → reviewDesktopCredentialProtection preload bridge
  → narrow credential IPC
  → desktop/credential-storage.ts
  → Electron Main safeStorage async API
```

约束如下：

- Web adapter 不伪造 Desktop capability；纯 Web 仍选择 `web_crypto`。
- preload 只暴露 `getStatus`、`protectCredential(context, secret)`、`unprotectCredential(context, envelope)`，不暴露 `safeStorage`、`encryptString`、`decryptString`、任意 path 或任意 OS resource。
- Main 验证 trusted sender、context 格式、envelope version、外层 context、base64 payload 和大小上限；错误只返回稳定短消息，不返回 stack、路径、OS 用户名、raw encrypted payload 或 secret。
- context 只允许现有产品语义前缀：`ai-connection`、`quota`、`mcp`、`fenbi`。调用方不能以任意文件路径或机器资源标识替代 context。
- 不新增通用文件 API，不新增 provider/credential manager，也不让 Application Layer 直接依赖 IPC。

## Migration contract

`app/services/credential-migration-planner.ts` 是纯 TypeScript、无 Electron/React/DOM/network/decrypt/storage side effect 的资格计算器。输入必须同时声明非敏感的 `expectedIds` 与实际找到的 inventory summary；缺失 ID 会确定性补成 `missing`，输出不会包含 secret、ciphertext、key 或路径。

Planner 的核心结果为：

- `no_op`：纯 Web、没有凭据或全部已经是 host-protected；
- `eligible`：Desktop host available，所有待迁移材料是可识别的 Web v2，允许后续 Phase 2 进入 preflight/staging；
- `blocked`：host 不可用、legacy 未先完成 Web normalization、unknown/invalid version、状态机不一致或需要 recovery；
- `requires_reentry`：缺 key、不可用记录或 masked-only 输入，必须重新输入真实凭据。

状态机表达 `idle → preflight → staging → verifying → ready_to_commit → committing → complete`，并保留 `blocked` / `recovery_required` / `cancelled`。中断或用户取消后重新 inventory，恢复到 `preflight`；Phase 1 输出固定 `writeStrategy: none_phase_1` 和 `destructiveActions: none_phase_1`，所以 `eligible` 不等于已迁移。

后续真实迁移必须遵守：

1. deterministic inventory：完整列出 expected、found、already-host-protected、web-v2、legacy-v1、missing、invalid、masked-only、unavailable；不能只遍历成功项后宣称 complete；
2. dual-read / single-write：cutover 前保留 Web v2 读路径，确认全部 host records verified 后才允许 preferred backend single-write；禁止永久 dual-write；
3. prepare → stage → verify → commit references → cleanup later；不同 IndexedDB/localStorage/host 存储之间不是一个 ACID transaction；
4. 每个 staged envelope 必须 decrypt、context match、semantic identity match；生产不记录 plaintext、plaintext hash 或 raw provider material；
5. 中断、部分 staging、host 暂时不可用都能安全 retry，source credential 不因 retry 被删除；commit 半失败进入 recovery_required；
6. 旧 JWK、v2 ciphertext、source record 与 secure key 只有在后续独立确认 cleanup 阶段才允许删除。

## Residual closure classification

The recovery matrix intentionally separates four questions: whether deterministic behavior is covered, whether installed-app evidence exists, whether a safe test seam exists, and whether the row blocks 0.7 credential-security closure.

- `host unavailable`, `requires-reentry`, `context mismatch`, and `partial commit recovery` have automated fail-closed/recovery coverage. Their installed-app rows remain `PENDING` and are **DOCUMENTED RESIDUAL** unless a safe installed seam is later provided; automated evidence is not relabeled as installed evidence.
- `corrupted envelope` and `interrupted pre-commit` are **NO SAFE INSTALLED SEAM** in the current product. Do not inject them by random process kill, editing userData/ciphertext/journal, destroying DPAPI material, corrupting a real credential, or patching ASAR.
- Adjacent-version overwrite upgrade and uninstall/reinstall are **DEFERRED TO 0.8 Windows desktop distribution**. 0.8 owns installer, signing, release, and distribution lifecycle evidence; 0.7 continues to own credential authority and fail-closed semantics.
- Different machine/account, copied `userData`, and general DPAPI portability are **MANUAL-ONLY / NON-CLAIM**. Same-machine/same-user/same-profile persistence does not imply portability.
- Real Credential Cleanup is **PASS within the scoped operator-attested installed-app record**. The deterministic Cleanup Foundation contracts remain the evidence for ordering, fail-closed behavior, and recovery semantics; the 2026-08-14 record supplies the installed-app deletion, reconciliation, restart, and post-cleanup operation evidence.

The labels above do not change any `PASS`/`PENDING` result. They prevent an unexecuted installed-app observation from being treated as either a security defect or a passing test without evidence.

## Failure / Recovery Matrix

| 情况 | Planner / Host 结果 | 恢复语义 |
| --- | --- | --- |
| Web current key 存在 | Web normal；Desktop migration `no_op` | 继续现有 WebCrypto |
| Web current key 缺失 | `requires_reentry` | 重新输入并保存对应凭据；不生成替代 key |
| Legacy key + legacy records | `blocked` / normalize-first | 先走既有 v1 → v2 Web 迁移；旧材料保留 |
| Legacy key 缺失但仍有 legacy records | `requires_reentry` | 重新输入对应凭据 |
| Desktop host available + valid v2 inventory | `eligible` | 仅允许后续 Phase 2 preflight/staging |
| Desktop host unavailable / unsupported / temporary | `blocked` | 不改写、不删除；host 恢复后可重试 |
| protect 失败 | `host_protection_failed` | 保留 Web source；不得回退明文 |
| decrypt / verify 失败 | `host_unprotect_failed` 或 `host_context_mismatch` | 保留 source；要求重新输入或进入 recovery |
| 进程在 commit 前退出 | staging 可 retry | 重新 inventory；不把部分 staging 当 complete |
| AAD/context mismatch | fail closed | 拒绝跨记录替换，重新输入对应记录 |
| masked-only value | `requires_reentry` / reject | 掩码只能显示，不能当 plaintext 迁移 |
| unknown ciphertext version | `blocked` | 不猜测版本，不自动降级 |
| safeStorage protected blob 换机/换账户不可读 | manual-only / reentry | 重新输入，不从掩码猜测 |

## Recovery and lifecycle semantics

| 事件 | 预期语义 |
| --- | --- |
| 同版本更新 / 覆盖升级 | 保留现有 Web v2 与配置；是否能恢复未来 host envelope 要由 Windows acceptance 证明 |
| Electron `userData` 保留 | 业务 IndexedDB/origin 可能保留；不能因此假定 DPAPI 或 provider 一定可读 |
| `userData` 删除 | 视为本机状态丢失；需要重新配置 |
| 卸载重装且保留数据 | 同 Windows 用户的可恢复性列入人工验收，不提前承诺 |
| Windows 账户变化 | 需要重新输入；不把安全失败变成明文 fallback |
| 机器变化或复制 blob | 不假定可迁移；需要重新输入 |
| 缺少 Web key / host material | stable error → re-entry；不生成替代 key |

JavaScript 无法提供真正可证明的 secure memory wipe。本轮只限制 plaintext 生命周期：只在必要调用 scope 中持有，不进 React 长期 state、global cache、localStorage、diagnostics、logs 或 snapshots。

## Security contracts and acceptance

已增加的直接 contracts 覆盖：

- Web backend 选择与 WebCrypto / Desktop 分离；
- fake Desktop host round-trip 只存在于测试 seam；
- envelope version、大小、base64、context mismatch 和 invalid shape；
- Main async safeStorage、ready timing、trusted sender、key rotation signal 和无 plaintext fallback；
- preload 不暴露 generic crypto primitive；
- planner 的 Web/no-op、Desktop eligible、host unavailable、legacy normalize-first、missing key、masked-only、unknown version 与 inconsistent completion；
- architecture guard 阻止 Feature/Service/Application 直接 import Electron 或 preload global。

当前 Linux/CI contract 只能证明 platform-neutral adapter、fake host、IPC source shape 与 Electron compile；不能声称已完成 Windows DPAPI 真实验收。后续 Windows acceptance 至少应执行：

1. fresh install；
2. 已有 Web v2 credential 的覆盖升级；
3. host available、暂时不可用、进程在 staging 时被杀、restart/retry；
4. WebCrypto key 缺失、host material 缺失、context mismatch；
5. 同用户保留 `userData` 的卸载/重装；
6. 删除 `userData` 的卸载/重装；
7. 复制 userData/blob 到另一账户和另一台机器；
8. 确认失败时仍保留 source、没有明文回填、没有旧材料误删。

Controlled fixtures or an explicit Host test seam may prove deterministic failure/recovery semantics without claiming installed-app evidence. If no safe seam exists, retain `PENDING` plus **NO SAFE INSTALLED SEAM** and do not manufacture a destructive test profile.

## Phase 1 non-goals

- 不自动迁移全部现有凭据；
- 不自动切换 production write backend；
- 不删除 `review_workspace_secure_keys`、legacy JWK、v2 ciphertext 或 source credentials；
- 不新增 durable migration journal、credential vault database、keytar、electron-store 或 sqlite；
- 不扩大 preload 为 generic file/native API；
- 不改变 `review_workspace` v16、`review_extensions` v1、Web API、Provider/MCP/Automation 语义；
- 不进入 0.8 Windows distribution、installer、signing 或 update 工作。
