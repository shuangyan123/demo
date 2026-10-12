# Recall Managed Data Root Foundation — Phase F Slice 1

本片从 Phase E COMPLETE integration `5002f27cc7f535e1442078eb0b11a69794a26585` 开始。
Slice 1 只建立 Host storage foundation；该片未实现 diagnostic durable repository、迁移、位置选择 UI 或 learner-state persistence。

后续 [Slice 2 Diagnostic Durable Capture Repository](recall-diagnostic-history.md) 已建立独立 repository authority；
下文记录 Slice 1 的 foundation 范围。[Slice 3](recall-durable-diagnostic-submission.md) 已接通 trusted Main→Next
与 durable submit/owner recovery；production profile relocation 仍 deferred。

## Bootstrap 与 identity

生产入口为 `desktop/managed-storage.ts`。Electron Main 在 Squirrel lifecycle 排除、single-instance lock 成功后，
同步读取 `app.getPath("appData")`、当前 effective `userData` 与 `sessionData`，在 `app.whenReady()`、
session 创建、Next runtime 和 BrowserWindow 前完成 resolution/startup gate。Squirrel lifecycle 与第二实例不采用或写入 profile。

OS-stable bootstrap：`path.join(app.getPath("appData"), "recall-storage", "bootstrap.json")`。
它独立于可被未来重定向的 active `userData`，不使用用户名、cwd、resourcesPath、temp 或环境变量推测数据位置。
不接受 bootstrap 位于 active managed root 内的配置。
Electron 的 `appData` 与 `sessionData` 默认规则见 [官方 app API](https://www.electronjs.org/docs/latest/api/app#appgetpathname)。

V1 record 的全部字段为：

```ts
Readonly<{
  formatVersion: 1;
  profileId: string;       // random UUID v4
  epochId: string;         // random UUID v4
  activeManagedRoot: string;
  profileLayout: "legacy-root" | "managed-root";
}>
```

严格拒绝额外/重复字段、无效 UUID、非 canonical absolute path、超出 8 KiB 的 record、malformed JSON。
未知正整数版本返回 `unsupported_version`，不重建或升级 record。记录不含学习历史、attempts、Evidence、凭据、Vault 正文或诊断历史。

Profile identity anchor 位于 `profileRoot/.recall-storage/identity.json`，只包含 `formatVersion/profileId/epochId`。
它不是 bootstrap，也不负责找 active root；它随 profile 保存身份并验证配置指向的确是预期数据 generation。
bootstrap 与 anchor 必须完全匹配；缺失、损坏或不匹配均阻断启动。

`profileId` 首次合法 legacy adoption 时随机生成，之后独立于路径和进程生命周期。
`epochId` 表示 data generation；普通启动、bootstrap 恢复或未来位置变化均保留它。
将来显式 reset/replace history 才能更新 epoch，必须协调 anchor/bootstrap 与业务写入。
本片不接管既有 `resetAll`，也不提供 epoch/reset 操作；当前 identity 尚未用于任何学习事实。
没有 repository UUID；未来域身份使用 `profileId + epochId + domainId`。

## Legacy adoption 与状态

bootstrap 缺失时先检查 Host 提供的默认 profile，不直接解释成“新用户”。

| 条件 | 结果 / 副作用 |
| --- | --- |
| 默认 parent 可访问，profile 不存在或真正为空 | `uninitialized`；不创建 profile、identity 或 bootstrap，不启动 authoritative consumer |
| 默认 profile 不可访问、parent 不可访问或非空且无法识别 | `unavailable / storage_unavailable`；保留原数据，不 fallback |
| 默认 profile 有既有 `Partitions/review-workspace` 或 `Partitions/review-fenbi` | `legacy_existing_profile`；原地采用，先持久化随机 anchor，再创建 bootstrap |
| 默认 profile 已有合法 anchor，但 bootstrap 缺失 | `legacy_existing_profile`；使用原 ID 重建 bootstrap，不换 identity |
| bootstrap、root、profile 和 anchor 全部合法且匹配 | `ready`；返回 immutable trusted Host config |
| bootstrap/anchor malformed 或身份不匹配 | `corrupt`；不解释为空历史，不覆盖原记录 |
| bootstrap/anchor 版本未知 | `unsupported_version`；fail closed |
| configured root 缺失、离线或不可访问 | `unavailable / storage_unavailable`；不创建路径，不修改 bootstrap，不回落默认 profile |

首次 adoption 只写少量 metadata；不读/写 IndexedDB 内容，不移动用户文件，也不解密或重加密凭据。
anchor 发布成功而 bootstrap 发布中断时，下一次仍使用同一 anchor。
删除 bootstrap 不产生新 UUID；同时删除 anchor 与 bootstrap 超出该恢复保证，不能据此承诺恢复原身份。
不自动扫描磁盘上的其他 profiles；多 profile 仍为 follow-up。F5 Slice 2 的 Main 原生显式初始化、orphan 拒绝与只读 readiness gate 见 [Trusted Fresh Profile Bootstrap](recall-fresh-profile-bootstrap.md)。

## Trusted configuration 与 Host path

`app/platform/managed-storage.d.ts` 只提供类型；私有 nominal brand 阻止普通路径对象代替 trusted config。
唯一构造边界是 Desktop record/resolver，config 包含 `profileId/epochId/managedRoot/profileRoot/managedFilesRoot`。

| Layout | profileRoot | managedFilesRoot |
| --- | --- | --- |
| `legacy-root` | activeManagedRoot，即现有 effective userData | activeManagedRoot / managed-files |
| `managed-root` | activeManagedRoot / profile | activeManagedRoot / managed-files |

**B：本片只建立 trusted configuration seam，production path relocation deferred。**
不调用 `app.setPath`，现有 userData/sessionData、`persist:review-workspace`、`persist:review-fenbi` 和
`review-app://workspace` 保持不变；localhost dev origin 仍是独立 origin。
Resolver 可验证未来 managed layout；实际 startup gate 只放行当前 effective profile/session location。
其他 configured layout/location 返回 `storage_unavailable / profile_relocation_deferred`，不会启动旧默认 profile 代替它。
现有禁止 `app.setPath("userData")` 的 release/Squirrel contracts 保留。

失败 gate 不进入 runtime launch/retry loop，不向 Kernel 输入 `[]`，不重放提交。
Renderer 没有新的 preload/IPC/HTTP root selector，Kernel/Evidence/state/policy/Preparation/Planning 不接触配置或路径。
未来 server-side diagnostic 文件仓库必须通过显式 Host composition 获得该已解析 config；不能自己读取 Electron path、环境或 cwd。
本片未将 config 传给 Next child，也没有新增 filesystem consumer；后续 repository composition 仍需明确 Main→server 信任边界。

## Metadata 写入保证

同目录 exclusive temp file 完整写入并执行 file fsync，初次发布用不覆盖目标的 hard link，替换发布用 rename。
任何写入失败均 fail closed；不 unlink 旧 record 后再写、不把 temp 当有效 record，也不自动降级到原地覆盖。
目标已存在时 create 失败；F1 adoption 使用 create，replace primitive 仅为未来受控 bootstrap 更新建立基础，不执行迁移。

在当前 Windows/Node 24 文件系统 contract tests 中，模拟发布前/后中断只能读到旧或新完整 record。
不承诺跨文件事务、目录 fsync、断电后的 rename durability、硬件缓存行为或所有文件系统均支持 hard links。
不支持安全 publish 的文件系统返回 unavailable，不能静默降级。
依据为 [Node fs API](https://nodejs.org/docs/latest-v24.x/api/fs.html)；本机验证固定 Node 24.20.0 / npm 11.19.0。

Desktop compiler 的 `rewriteRelativeImportExtensions` 让新纯 Host modules 既可直接运行 Node strip-types contracts，
也可编译为既有 `.desktop/*.js`；输出位置及 CommonJS preload 不变。
见 [TypeScript 官方说明](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)。

## Registry 与现有 coverage

`app/services/storage-domain-registry.ts` 从 `CORE_DATA_STORE_POLICIES`、`LOCAL_STORAGE_DATA_POLICIES`、
`NON_CORE_DATA_STORE_POLICIES` 派生，不创建平行 backup allowlist，也不改造 repositories。
Core table 与 localStorage 的显式 owner metadata 受类型完整性检查。
每项声明 domainId、logical owner、class、rootType、physicalUnit、implementation、backup/reset 当前覆盖及 relevance、
migration policy/relevance、sensitivity 与 regenerability。

当前 managed owners 覆盖 Review、Knowledge、Import、Interview、Tutoring、Conversation、Automation、
Appearance、Personalization、非 secret AI config、Vault app-side state、Extensions、study-module preferences。
Secure key DB、credential envelopes、migration/cleanup journals、quota/MCP/Fenbi credentials、Workspace/Fenbi session
单独分类为 protected security。它们与业务 DB/localStorage 共享 `chromium-profile` 物理迁移单位，不能逐表移动文件。
OS protection 不被描述为额外应用 secrets 文件库，也不是普通 managed-file migration。
reset relevance 独立于 backup relevance：凭据、session、restore transfer 和 bootstrap/identity 的 epoch 协调仍需 reset policy，
即使它们不进 portable backup。Registry 同时声明当前未覆盖，不改变本片 reset 行为。

Provider cache、quota snapshots、Chromium/Next caches、temporary runtime state 与 diagnostics/logs 分类为 ephemeral/diagnostics。
Desktop runtime diagnostic JSON 属于 logs physical unit，API/renderer 与 diagnostic TTL store 的内存状态归 temporary runtime。
Ephemeral lifetime 不证明 public；cache、额度快照、临时事件均按潜在 user-data sensitivity 处理。
外部 Vault 正文、用户保存的导出/下载文件属于 external user-owned；默认迁移只涉及 Vault 引用/应用状态，不搬正文。
Cache、temp、OS secrets 与 logs 不默认迁移；将来 logs 需独立显式选择。

`diagnostic-history` 在 Slice 1 登记为 reserved；Slice 2 repository 实现后更新为 current。
first-party-diagnostic owner、managed-durable、managed-files physical unit 与 backup/reset/migration relevance 不变；
当前 backup/reset 标记 `not-implemented`；production durable submit/owner integration 已在 Slice 3 接通。

既有 V2 export/restore 与 resetAll 行为不变：

- Core export 继续来自现有 allowlist 并执行 sanitize，extensions 同样 sanitize；凭据和授权材料仍排除。
- localStorage 不进入 V2 export；新增 study-module preference policy 仅修复 inventory，不新增备份行为。
- resetAll 仍只删除 core/extensions/secure-key DB 与匹配的 localStorage；不删除 identity/bootstrap、transfer DB、
  Fenbi session、Vault pointer file、外部文件或日志。
- 未解决 restore transfer jobs 的 future migration policy 为 `block-unresolved`；registry 不自行查询或执行恢复。
- 在 managed root 内不等于 portable backup included；protected profile materials 还需要原 OS/用户保护 context。

AST/symbol contracts 仅扫描 repo-owned app production boundaries，追踪 literal、const/import、template、wrapper key 与 storage alias。
新增未分类 writer 或无法确认 key 的 writer fail closed，不扫描第三方 source；缺失 study-module policy 的真实 writer fixture 必须失败。

## Slice 2 前提与边界

后续 diagnostic repository 应消费 trusted config、固定 diagnostic-history domain 与 identity，先验证数据 availability，
再独立建立 owner-captured durable attempts、严格 reload validation、完整 history responsibility 与副作用语义。
其 repository 不能把本片 metadata、TTL store 剩余记录或单条 complete_record 当作完整学习历史。

本片未实现目录 picker、数据 copy/move、profile redirect、迁移 manifest/progress/rollback UI、多 profile、portable mode、
cloud sync、diagnostic durable writes、跨进程 attempt sharing、backup/reset overhaul 或 Kernel authority cutover。
Web 模式不伪造 Desktop storage capability。Phase E 保持 COMPLETE；Phase F 后续 slices 与 Phase G 未交付。
