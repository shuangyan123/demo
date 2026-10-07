# Recall Phase F Slice 2 — Diagnostic Durable Capture Repository

基线为 Slice 1 `d2d80e68756058feb8bae57805110637bd6fbd3a`。本片只交付 source-owned repository authority，
不接 production submit、source owner reload、Event/Evidence history、learner state、decision 或 UI。
Phase E 保持 COMPLETE；Phase F 整体和 DOGFOOD READY 均未成立。

## 路径与 identity

内部入口 `app/server/diagnostic/history/repository.ts` 只接受 Slice 1 的 nominal `ManagedStorageHostConfig`。
路径为 `path.join(config.managedFilesRoot, "diagnostic-history", "history.json")`，不读取 Electron、cwd、resourcesPath、
temp 或环境变量，不接 renderer root。Tests 也通过真实 Host resolver 获取临时 profile 的 trusted config。
没有 Desktop→server repository 或 server→Desktop bootstrap 实现依赖。

Snapshot 绑定 `profileId + epochId`；位置不是身份。未来同一 profile 换路径仍保留两者；显式 reset/replace 才改变 epoch。
reopen 身份不匹配返回 corrupt，不导入旧 epoch。没有 repositoryId。
本片不传 Main→Next config；Slice 3 仍需显式可信 composition，不能用环境/cwd 猜路径。

## 完整快照与源事实

V1 JSON exact fields：

```ts
{
  formatVersion: 1,
  profileId: string,
  epochId: string,
  generation: number,
  captures: DiagnosticCapturedAttemptV1[],
  integrity: string // canonical payload 的 SHA-256，纯损坏检测
}
```

无 delete/eviction/compaction；generation 从 0 开始，每个新 attempt 加一，等于 captures 数量。
最多 4096 captures / 4 MiB；超过边界返回 typed capacity failure，原历史保留。
顺序是 repository commit order，绝不替换 occurredAt；同一时刻不同 attempt ID 仍独立保存。

每个 capture 保留既有 schemaVersion、id、sourceOwnerId、specId、specRevision、contentRevision、optionIds、
responseFormat、selectedOptionId、assistance、occurredAt 与完整 provenance。
Mechanism version、presentation binding、assistance basis、submit/reveal ordering 已在 provenance 中，不再复制 storage authority 字段。
不保存 prompt/options 正文、answer key、explanation、canonical target、correctness、Event、Evidence、state、decision 或 caller verified flag。

## Writer authority 与 reopen

既有 capture authority 输出增加内部 nominal `IssuedDiagnosticCapturedAttemptV1`，并用私有 WeakSet 确认真实签发对象。
Brand 不进入序列化；capture/spec authority 无 storage/fs 依赖，capture lifecycle 与事实语义不变。
Writer 同时检查 type 与运行时 issuance；JSON clone、spread、类型断言、caller flags 不成为 writer capability。
不存在 public import-verified-JSON API。磁盘恢复的事实不重新签发为 live capture capability。

read 每次验证实际磁盘 record，不使用缓存替代它。Strict validation 覆盖全部 root/nested fields、重复 JSON keys、
格式版本、profile/epoch、generation、完整 capture identities、时间、assistance/provenance、response schema、机制版本与 presentation binding。
再由现有 canonical spec owner 验证 exact spec/revision/content revision、ordered options 与 selected option identity。
未知历史 revision fail closed，不升级到 latest；key、正文、target 与 correctness 仍属于独立 spec/后续 derivation authority。
最后校验普通 digest，并返回 deeply immutable complete snapshot。

同 ID、相同 canonical facts 返回 confirmed，generation 不变；任何不同 facts 返回 conflict，原记录不改。
新 learner retry 必须新 attempt ID；不按 specId 去重。重复磁盘 ID（包括冲突）使整个 snapshot corrupt。

## 初始化与 completeness

`open` 建立内部 handle，`readCompleteSnapshot`/lookup/append 不初始化目录或历史。

| 条件 | 结果 |
| --- | --- |
| active profile 可访问，域目录不存在 | uninitialized，无写入，不是 complete-empty |
| 显式 initialize 成功发布 generation 0 | complete snapshot，captures 为空 |
| 已有域目录，但 history.json 缺失 | incomplete，initialize 也不重建为空 |
| malformed/truncated/多余字段/digest 错误/身份或 spec 不匹配 | corrupt，无部分结果 |
| 未知正整数 formatVersion | unsupported_version |
| active profile 或 record 无法访问 | unavailable / storage_unavailable，无 fallback |
| 发布结果无法确认 | unavailable / commit_unconfirmed；需 reopen 查看实际完整 generation |
| handle close 后操作 | closed |

域目录由显式 initialize 非递归 exclusive 创建，作为初始化 reservation；随后安全发布空 snapshot。
目录建立后发布失败保留 reservation，reopen 返回 incomplete，不自动重建、重试或修复。
不删除域目录，history 文件丢失不能成为 empty。若用户删除整个域目录，重开可能为 uninitialized，仍绝不自动 complete-empty；
V1 不承诺抵抗本机所有者同时删除 initialization evidence 或执行磁盘 rollback。

## Commit 与 recovery 保证

同步 whole-snapshot commit：同目录 exclusive temp 完整写入 + file fsync；初次发布 hard link，替换发布 rename。
成功后再读取并验证 exact snapshot，只有确认新 generation 完整可读才报告 committed。
模拟 temp 写入中断、publish 前中断、publish 后中断，reopen 只返回旧或新完整快照。
orphan temp 不参与 reads，不后台清理；不原地覆盖，不先删除旧 record，不静默降级 publish。
初始化中断可以为 incomplete；不是可验证 complete-empty。

不承诺目录 fsync、硬件断电后的 rename durability 或跨文件事务。文件系统不支持安全 publish 时失败。
依据为 [Node 24 fs API](https://nodejs.org/docs/latest-v24.x/api/fs.html)。验证固定 Node 24.20.0 / npm 11.19.0。
同一进程同一路径只允许一个 open handle；额外 handle 返回 unavailable。没有跨进程锁、多 writer 或 merge protocol，
后续 composition 必须保证独占 writer；V1 不支持多进程同时打开同一 history。

## Threat model 与 policy

保护 malformed、意外损坏、truncation、partial publication、unsupported versions、内部身份冲突与 profile/epoch 混用。
SHA-256 不是 authenticity proof；不抵抗有本地文件写权限的恶意用户、OS compromise、刻意 rollback 或 forensic edits。
不引入 MAC、DPAPI signing、keychain 或签名密钥。

复用唯一 `diagnostic-history` domain，implementation 更新为 current；backup/reset/migration relevance 均为 true。
当前 backup/reset integration 仍 not-implemented；既有 export/restore/reset 行为不变，不声称已经备份或清理新文件。
迁移 policy 仍 managed-files，仅表达未来需求，不执行 copy/move。

Architecture contracts 保护 repository 仅内部 server 使用、Host config 输入、Kernel/Evidence/state/policy 隔离、
spec/capture storage independence、writer capability 和无 production owner/admission 改动。
后续 Slice 3 才接 production submit → durable commit → durable owner resolution；本片不加载 Event/Evidence 或运行 Kernel state。
