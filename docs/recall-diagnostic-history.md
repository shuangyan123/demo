# Recall Phase F Slice 2 — Diagnostic Durable Capture Repository

基线为 Slice 1 `d2d80e68756058feb8bae57805110637bd6fbd3a`。本片只交付 source-owned repository authority，
不接 production submit、source owner reload、Event/Evidence history、learner state、decision 或 UI。
以上为 Slice 2 交付边界；后续 [Slice 3 production durable submission/owner recovery](recall-durable-diagnostic-submission.md)
已接通 Main→Next trusted composition、完整 owner index 与 submit→Evidence→reveal。下文保留 repository contract。
Phase E 保持 COMPLETE；Phase F 整体和 DOGFOOD READY 均未成立。

## 路径与 identity

内部入口 `app/server/diagnostic/history/repository.ts` 只接受 Slice 1 的 nominal `ManagedStorageHostConfig`。
路径为 `path.join(config.managedFilesRoot, "diagnostic-history", "history.json")`，不读取 Electron、cwd、resourcesPath、
temp 或环境变量，不接 renderer root。Tests 也通过真实 Host resolver 获取临时 profile 的 trusted config。
没有 Desktop→server repository 或 server→Desktop bootstrap 实现依赖。

Snapshot 绑定 `profileId + epochId`；位置不是身份。未来同一 profile 换路径仍保留两者；显式 reset/replace 才改变 epoch。
reopen 身份不匹配返回 corrupt，不导入旧 epoch。没有 repositoryId。
Slice 2 本片不传 Main→Next config；后续 Slice 3 通过严格 process composition 显式传入，不用环境/cwd 猜路径。

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

同步 whole-snapshot commit：同目录 exclusive temp 通过既有 `writeFileSync(..., { flush: true })` 完整写入；
初次发布 hard link，替换发布 rename。本片不改变 temp 写入/flush primitive，不增加硬件持久化保证。
成功后再读取并验证 exact snapshot，只有确认新 generation 完整可读才报告 committed。
模拟 temp 写入中断、publish 前中断、publish 后中断，reopen 只返回旧或新完整快照。
orphan temp 不参与 reads，不后台清理；不原地覆盖，不先删除旧 record，不静默降级 publish。
初始化中断可以为 incomplete；不是可验证 complete-empty。

不承诺目录 fsync、硬件断电后的 rename durability 或跨文件事务。文件系统不支持安全 publish 时失败。
依据为 [Node 24 fs API](https://nodejs.org/docs/latest-v24.x/api/fs.html)。验证固定 Node 24.20.0 / npm 11.19.0。
同一进程同一路径只允许一个 open handle；额外 handle 返回 unavailable。没有跨进程锁、多 writer 或 merge protocol，
后续 composition 必须保证独占 writer；V1 不支持多进程同时打开同一 history。

### Windows replacement 的有限恢复

仅 Windows replacement `renameSync` 的 `EPERM`、`EBUSY`、`EACCES` 是候选；初次 link、temp 写入、
其他 IO 错误、解析/身份/内容/容量/格式失败都不重试。
[Node 24.20.0 内置 libuv](https://github.com/nodejs/node/blob/v24.20.0/deps/uv/src/win/error.c)
分别将 access denied / privilege not held 映射为 EPERM、sharing / lock violation 等映射为 EBUSY，
将 elevation required / cannot access file 等映射为 EACCES。
[同版本 Windows rename](https://github.com/nodejs/node/blob/v24.20.0/deps/uv/src/win/fs.c)
使用 `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`。这些分类不证明具体 actor 或瞬态原因。

保留本次 commit 的 immutable canonical OLD 与 NEW。每次候选失败后通过现有严格 read/parse/digest 规则：

* target 为 exact NEW：接受 publication，停止 rename，仍执行原有独立 post-publication confirmation。
* target 为 exact OLD 且 temp 为 exact NEW：允许等待；等待后、下一次 rename 前再次严格核对两者。
* 任意其他状态（含合法但不匹配的 generation/content、缺失、malformed、identity/integrity/format/capacity 失败）：
  fail closed，不覆盖 target，不重新生成 temp 或 capture。

首次候选失败后进入局部 async continuation，以 `performance.now()` 的单调时钟计时。
deadline 为 2000ms，目标探测 offsets 为 0/50/150/300/500/750/1000/1500/2000ms；0 为首次失败，
最多 9 次 native rename（含首次尝试，即最多 8 次 retries）。自然测量曾要求连续 7 次失败后第 8 次在约
1509ms 成功；attempt ceiling 不会提前截断该情形。offsets 是目标时间，不是保证的实际执行时间。
每次失败后先严格核对 OLD/NEW，再检查 elapsed；elapsed >=2000ms 不安排新 timer。
deadline 前已安排的 probe 在 timer 返回并完成再次严格核对后，仅在 elapsed <=2100ms 时可执行，
这 100ms scheduling grace 只允许该已安排 probe，不授权 deadline 后继续安排探测。
原有独立 confirmation 仍必需。全部候选失败通常在最终约 2000ms 探测后以 deadline exhausted 结束；
timer 不推进时仍受 9 次操作 cap 保护。没有 jitter、后台任务或通用 retry framework。

等待使用 Promise/setTimeout，即使目标 offset 已过也用 0ms timer 让出 event loop。正常首次成功仍同步
完成 publication/confirmation，没有 timer 或 recovery reads；F3 编排付出最小 Promise 成本。
rare tail 预期增加约 2s 请求等待，宽限最多 100ms；有限的同步 native IO、严格读取/解析与调度仍有开销，
所以 recovery deadline 不是总墙钟硬上限。每份读取沿用 4MiB/4096 captures 上限；最多 9 次 native rename，
候选恢复最多 34 次严格读取，另加原有 temp 写入、cleanup 与独立 confirmation。没有长窗口同步 sleep。

repository append 只有候选恢复返回 Promise；initialize/read/resolve 保持同步，F3/runtime append 与 HTTP
request 等待整个 durability result 后再发布 owner、同步 admission、Event/Evidence 和 reveal。
committing 占用跨 await 保留到 confirmation/cleanup 完成；并发 append/initialize/read fail closed 为
operation_in_progress，不排队。runtime 同时阻止新 session；重复同答案仍复用原 sealed attempt，不能 interleave。
close 拒绝后续操作，但不取消已开始的 commit，并保留同路径 open-handle 占用直到该 continuation 终结；
关闭的 runtime 不恢复 owner 索引或 reveal。HTTP body 接收并 capture 后，不以 request.signal/disconnect
取消 filesystem commit；同一请求等待结果，没有先告知失败再后台成功。进程退出/崩溃仍不能保证完成。

旧 500ms 同步窗口已有自然耗尽证据；5 个自然 duration episodes 中 3 个 >500ms、2 个 >1s，最大约1509ms。
这些有限样本不能证明所有环境的拒绝都在 2s 内解除，也不识别具体 actor。

预算耗尽仍为 `commit_unconfirmed`。cleanup 次要；F3 不获得 owner/admission/Evidence/reveal，
既有 sealed same-attempt manual continuation 保留，不 recapture。retry 成功或 exact NEW recovery 不绕过提交确认。
内部 WeakMap 诊断记录首次失败的 monotonic time、target/actual offset、attempt/cap/deadline/grace、成功、
每次 sanitized IO failure、失败后/等待后 disk-state 与 terminal reason（deadline/cap/state failure 区分）；
不扩充 public result，不记录 snapshot 正文。此恢复不提供跨进程锁或消除外部 writer 的检查/覆盖竞态。

## Threat model 与 policy

保护 malformed、意外损坏、truncation、partial publication、unsupported versions、内部身份冲突与 profile/epoch 混用。
SHA-256 不是 authenticity proof；不抵抗有本地文件写权限的恶意用户、OS compromise、刻意 rollback 或 forensic edits。
不引入 MAC、DPAPI signing、keychain 或签名密钥。

复用唯一 `diagnostic-history` domain，implementation 更新为 current；backup/reset/migration relevance 均为 true。
当前 backup/reset integration 仍 not-implemented；既有 export/restore/reset 行为不变，不声称已经备份或清理新文件。
迁移 policy 仍 managed-files，仅表达未来需求，不执行 copy/move。

Architecture contracts 保护 repository 仅内部 server 使用、Host config 输入、Kernel/Evidence/state/policy 隔离、
spec/capture storage independence 与 writer capability。Slice 2 本片无 production owner/admission 改动；
后续 Slice 3 已接 production submit → durable commit → durable owner resolution → Evidence；仍不加载完整 Event/Evidence history 或运行 Kernel state。
