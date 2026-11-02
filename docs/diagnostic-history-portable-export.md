# Diagnostic history：只读归档与恢复审查

基线：`8b8c3ffdd9cce0f2fde78a0ac775693c2bdeec66`。本切片只实现只读导出及范围提示。
跨设备恢复、写入、自动更新、签名和发布均未实现或启用。

## 实际所有权与缺口

| 数据 | 事实源 / 当前覆盖 | 本轮处理 |
| --- | --- | --- |
| 核心学习记录与扩展 | `review_workspace` v16 / `review_extensions` v1；现有 V2 支持 | 保持格式和恢复算法 |
| diagnostic captures | Main 受信配置定位的 `managed-files/diagnostic-history/history.json`；固定 Repository 验证并拥有 | 新增独立只读归档；仍不支持恢复 |
| canonical spec、正文、正确答案、target | first-party spec authority；不由 capture 提供 | 不导出，不从包导入替换 |
| Evidence、learner state、WHAT | 基于完整历史及固定 authority 派生 | 不导出为学习事实 |
| profileId、epochId、generation、磁盘 integrity | 源设备身份与本地发布状态 | 不导出；目标设备必须独立建立 |
| Bootstrap/Identity、路径、目录句柄 | Host storage boundary | 不导出、不复制、不修改 |
| 凭据、Cookie、密钥、Vault 正文/授权、原始 Provider/MCP 输出 | 各安全或外部所有权边界 | 不访问、不导出 |

`local-data-reliability.ts` 的“reserved / durable repository 尚未实现”已过时，现已修正。
`storage-domain-registry.ts` 的 implementation=current 正确；backup/reset=not-implemented 仍正确：
独立归档不等于可恢复备份。V2 仍有明确的 diagnostic-history 覆盖缺口，不能称为全部学习历史备份。
当前归档只覆盖当前源 epoch 的磁盘完整校验快照；不含仅在内存的作答、其他设备、旧 epoch 或终身完整历史。
导出读回不能证明之前某次提交的响应已送达用户，也不会解除 owner readiness 或恢复作答流程。

## 导出 contract

用户点击设置 → 诊断 → 数据管理 →“导出诊断学习历史”。
固定 `POST /api/diagnostic/export` 不接受 query/body、路径、过滤器或 caller records。
请求须有固定 intent header，并通过既有 origin 校验。普通浏览器要求 same-origin 元数据；
review-app fetch 实测不发送 Fetch Metadata，且 Main 转发移除 Origin，因此仅兼容两者均缺失的桌面转发形态。
缺失元数据本身不是授权；桌面访问权限仍由既有 Main protocol token/proxy 保护，cross-site/same-site/none 与 opaque Origin 均拒绝。
普通 Web 没有已组合的 trusted storage runtime 时返回 unavailable，不伪造桌面能力。

调用链：client → 固定 route → `exportDiagnosticHistory()` → `readDiagnosticExportSnapshot()`
→ 既有 runtime 的 `readExportSnapshot()` → `repository.readCompleteSnapshot()`。
导出不 compose/initialize runtime、不初始化 domain、不刷新 owner index/readiness、不 repair、不 append、无自动重试。
不新增 preload/IPC，不接受任意文件路径，源文件从不复制给浏览器。
按已安装 Next.js 的 [Route Handlers 文档](https://nextjs.org/docs/app/getting-started/route-handlers) 使用 POST/Response；成功与失败均 `no-store`。

只有完整校验通过的 snapshot 才投影导出；缺失、损坏、身份不符、未知版本、spec 缺失/不兼容、重复 ID、读失败及正在提交均拒绝整个包。
合法已初始化的空历史可导出 0 条；缺失历史不能解释成空历史。读异常只返回固定错误，不把路径/异常正文传给 UI。

独立格式：`format=recall-diagnostic-history-export`、`formatVersion=1`。
包含 exportedAt、sourceOwnerId、scope、captureCount、captures、restoreSupport=not_implemented、notice=目前不可导入恢复、authority=unverified_portable_copy。
capture 显式白名单保留 id、schemaVersion、specId/specRevision/contentRevision、optionIds 的顺序、responseFormat、
selectedOptionId、assistance、原始 occurredAt 及 provenance；不改时间、不生成新 attempt ID，不带隐藏 authority brand。

`integrity.algorithm=sha256`；digest 是对按导出属性顺序 `JSON.stringify(payloadWithoutIntegrity)` 的 UTF-8 字节计算。
校验和只检测意外损坏，不能证明来源真实；导出的 provenance 是保存的历史声明，不能让可编辑 JSON 获得 source-owner 验证权限。
本轮不提供读取外部归档的 parser、导入 API 或 provenance promotion。
UI 只声明“已请求下载”，要求用户确认文件保存，不声称浏览器下载已落盘。

## V2 兼容性

不改变 V2 schemaVersion、表白名单、manifest、excludedCategories 或恢复事务。
旧带 manifest / 不带 manifest 的 V2 都继续由原 reader 接受；只增加界面和恢复预览的覆盖范围提示。
独立 diagnostic 归档没有 schemaVersion=2，传入 V2 reader 必须在任何 destructive apply 前拒绝。
两个独立导出不是跨 IndexedDB/managed-files 的同一时点事务快照，也不能合称可完整恢复的联合备份。

## 恢复设计（尚未授权实现）

1. **先建立目标身份。** 目标 Main 通过现有显式新 profile 流程创建自己的 profileId/epochId、Bootstrap/Identity；
   验证现有目标 identity 后固定恢复操作的 binding。禁止采用源 identity、修改 root 或用环境变量/HTTP 参数覆盖 Host。
   目标 generation 由目标历史条数按本地规则生成，不能照抄源 generation；不能将归档冒充内存 issued capture。
2. **严格 preflight。** 独立未来 reader 验证版本、容量、重复 JSON 字段、精确白名单、计数、checksum、ID/time/provenance、
   每条完整 canonical spec binding。目标缺 spec 或 revision/content/order 不兼容时，整体拒绝；保留原归档和目标，
   不过滤未知记录、不重算“等价”规格、不导入包内正确答案/target。需另行可信发布对应 spec 后重试。
3. **来源真实性是未解决 gate。** 当前 JSON/checksum 可被重算，合法结构不证明用户真的在 controlled surface 作答。
   未来必须审查可信来源证明或独立的 imported-unverified 语义，不能静默把导入数据送入既有 verified owner。
   原始 ID、时间、sourceOwnerId、provenance 可作为声明保留；恢复来源及目标 binding 必须有独立 lineage，不能伪造为目标刚产生的 capture。
   现有磁盘格式不容纳该 lineage，也无安全 import capability；本轮不升级格式或弱化 append 的 issued-capability 保护。
4. **重复与目标已有历史。** 首个可交付恢复建议仅允许经 Main 确认、完整且为空的目标历史。
   归档内重复 ID 一律拒绝；目标非空则停止，不能自动 merge/覆盖。后续若支持合并：同 ID 完全相同只可显式幂等，
   同 ID 不同事实必须冲突，不能生成新 ID 躲避；合并仍须用户预览、完整引用与 provenance 校验。
5. **跨存储协调。** 现有 transfer DB 仅覆盖两个 IndexedDB，无法回滚 managed-files。未来需要单一恢复 operation ID、
   源/目标 binding、core/extensions/history 三方旧/新摘要，以及完整旧/新快照；在任何修改前可靠 prepare 并独立读回。
   Main 必须先建立恢复 gate，暂停 captures 和所有业务写入，并处理/拒绝已有 V2 applying jobs、多窗口/多进程 writer。
   Web V2 restore 不能暗中参与该 Desktop 联合流程。
6. **阶段与中断。** 候选阶段为 prepared → applying → verifying → committed → cleanup；
   每个数据库替换仍各自原子，managed-files 继续同目录原子发布和严格确认。不得声称跨三方 ACID。
   在任何有副作用阶段失败，应向所有三方恢复旧快照并读回验证；失败保留 journal、旧/新快照并阻断业务启动。
   下次启动必须先经 Main gate 再启动会读取 owner 历史的 runtime，最后才挂载 renderer/controllers。
   不能靠当前 renderer Bootstrap 的 IndexedDB-only recovery 冒充这种能力。
7. **掉电与误判。** journal 与三个存储之间不存在共同 fsync/commit。提交后清理失败和提交前失败必须区分；
   restart 必须用 durable phase + 实际三方摘要核对，混合或未知状态保持 blocked，不能按时间猜测“最新”或自动删除。
   Windows filesystem / Chromium durability、目录元数据持久性、读回成功后掉电、profile identity 更改后的恢复均尚未证明。
8. **独立读回。** 从磁盘重新打开并严格验证目标 identity/captures；从各 IndexedDB 重新读表及关键引用，核对预期集合与摘要。
   不能用内存对象、行数或单条成功记录代替完整验证。目标 runtime 重新启动后的 owner admission/Evidence/derived state
   还需要独立验收，且必须先解决第 3 项来源真实性。

**审查结论：当前不能证明安全的跨 IndexedDB 与 managed-files 回滚和掉电恢复，因此停止在设计边界。**
上述协议是需要证明的候选方案，不是已有恢复保证；不提供真实导入、替换、删除或自动修复入口。
后续授权应先收敛导入信任模型、目标非空策略、journal authority/启动 gate，再对每个持久化阶段做中断/重启/回滚失败测试。

## 本轮本地验证（2026-10-30）

以下是初始只读导出切片的验证记录；同分支后续版本检查续作的最新结果见 [本轮验证](update-check-readonly.md#本轮验证结果2026-10-30)，不可将历史通过数量作为后续完整质量门结果。

运行时为固定 Node.js 24.20.0；Electron 开发运行时为 43.5.0。所有写入验证使用专属临时 fixture / 测试 IndexedDB，未访问真实用户资料。

| 检查 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，0 error；保留未修改的 `application-error-state.tsx:44` 一条 Next navigation warning |
| `npm run test:contracts` | 1258/1258；含旧 V2 无 manifest 兼容、既有恢复回滚、架构边界和新导出合同 |
| 导出 + 桌面协议定向合同 | 31/31：`history-export.contract.test.ts` 19 项、protocol backend 11 项、原生 Electron protocol 1 项 |
| `npm run build` | 通过；新导出 route 为动态 Node route |
| Chromium 相关 E2E | 6/6，单 worker、零重试；覆盖真实下载、原数据不变、V2 拒绝归档、失败提示及旧 V2 恢复/启动回滚 |
| `npm run test:desktop` | 128/129；未修改的 `profile-native.contract.test.ts` cancel 用例返回取消结果后出现进程退出超时。未扩展调查或重试掩盖；后续受本轮改动影响的协议测试已定向通过 |

浏览器验证文件为 `e2e/diagnostic-history-export.spec.ts` 与 `e2e/data-reliability.spec.ts`。
原生协议验证复用现有隔离 backend 和 sandbox；实测缺失 Fetch Metadata 的 review-app fetch 可导出，
无运行令牌及跨来源请求被拒绝，重启前后导出与磁盘 facts 一致，源历史字节不变。
Next.js 零字节 POST 的非空 body stream 已有真实浏览器回归和合同覆盖；非空/伪装长度的请求体仍拒绝。
本地日志位于 ignored `.cache/diagnostic-export-validation/`，没有将日志或测试资料加入版本控制。
桌面全套质量门尚未全绿；上述结果不代表 NSIS 安装、完整打包应用验收、真实资料恢复或掉电保证。

## 自动更新前的剩余工作

先完成可恢复备份与跨设备验证，补齐联合恢复 gate 和可信来源语义。
再单独决定更新渠道、包来源/签名验证、用户确认、运行中写入暂停、安装失败与版本回退策略。
本片不接触 NSIS、Squirrel、发布通道或安装程序。后续同分支的 [本地模拟版本检查](update-check-readonly.md) 也不提供下载或安装能力。
