### 2026-10-19：已完成单次真实安装，取消重启后的存储读回仍待定位

- [run 39226496070](https://github.com/shuangyan123/demo/actions/runs/39226496070) 对 264bb11 固定 NSIS 产物的首次 Create/重启读回、卸载、Cancel/再 Create 均已通过。
- `restart-after-cancel` 的 IndexedDB 访问返回 `SecurityError`，后续可信旧版交接未执行；整体验收仍 FAIL，不得标记 Ready/合并。
- 本次只修改 CDP 验收探针及合成测试：先只读确认目标 origin、document.readyState 和实际工作台已加载，再 **仅一次** 执行合成 IndexedDB/localStorage 检查；若实际权限仍拒绝，继续 FAIL 并记录脱敏诊断，不清理、不重试、不修改产品启动逻辑。
- 本次没有新一轮安装授权，固定产物策略与已有 label 不变，必须等独立批准后才能重新执行 hosted NSIS 安装及卸载。

# 固定产物 Windows 安装验收

## 当前状态：新修复已获单次 hosted Windows 完整安装验收批准，尚未执行

### 新版固定安装产物与执行边界

- 产品源 SHA：`264bb1193b8b01b2aaa298df740b52bce288c08f`；8/8 CI：`39200193208`；private finalized artifact ID：`12163412765`。
- ZIP SHA-256：`3cc3a4efc3879dd18689ae0e5056f7e56d8b4cb302b4289c6c5b0c4d04c917b1`；EXE SHA-256：`a31591ba9ca922a788e56c521f2e267b5337a7533468b00251891354e8bfd611`。已独立核对 ZIP、SHA256SUMS.txt 和 EXE。安装程序名称仍为 `ReviewWorkspace-0.3.1-Windows-x64-Setup.exe`。
- 本轮新标签：`recall-install-acceptance-264bb11`；固定策略文件 `scripts/nsis-install-acceptance.json`。测试 harness HEAD 与二进制 source SHA 不相同，必须分别记录。
- 用户已批准恰好一次 GitHub-hosted Windows 临时 runner 的安装、原生确认、合成资料重启读回、取消后重新创建、卸载和来源可信的 v0.2.2 Squirrel-to-NSIS 存储交接。不可在开发机或 Pilot 上执行。
- 首次确认期间观察合法 `Local State`：**允许窗口可见之前就已存在**，或者窗口可见后出现；两种情况分别脱敏记录，均需完整稳定的文件格式。观察工具不会删除或修改运行时文件，也不声称之前存在的文件是后生成的。
- 不以 CI 成功或安装成功代替真实工作台、meta identity、重启持久化、卸载/交接各阶段成功。任何失败禁止自动 retry，未运行阶段标为 NOT_RUN。PR 维持 Draft。

### 上次失败产物的历史记录

- 上次被测产品源码 `1be3f28eca90bb9a9ac63c4036e275cb42a48889`，成功 CI `39121611474`，finalized artifact `12133559719`。
- ZIP SHA256 `6bad4fec47d18aa70de0f1f1f00fadebad9226441240dda275e6d3311a8e57a9`；EXE SHA256 `f81b0d70bbd142446c90b5818375fd129f8e411dfc6be79eb8544761864fb36b`，两者已独立与 manifest 核对。
- 上述产物的真实安装验收已执行：harness `888a9895f74d74f6cb52eb8f9220055bc4157cfb`，run `39123883282`，证据 artifact `12134708714`。来源/摘要、安装、文件、注册及快捷方式通过；原生确认出现前以 `profile_not_pristine` 停止。首次创建为 FAIL，后续取消重建、重启及交接未完成，不能标为 PASS。
- 上述旧产物仅是历史失败来源；当前策略已换成 264bb11。不得重放旧标签以冒充本轮验收。

旧 run `39117755780` 的安装、来源核验和原生确认已执行，但工作台启动失败。`d7e9239` 的普通 CI、Windows E2E 或 NSIS 构建成功均不能关闭该失败。新修复用真实 Windows Electron 证明：原生确认仍打开时，Electron 可在 ready 后约十秒才发布 `Local State`；旧实现误把该运行时转换当成候选资料变更。旧安装包没有分类诊断，不能追认其确切文件变化。

最近一次 `39123883282` 在确认之前失败，属于不同现场。其证据没有目录分类，不能归因为 Local State。按验收的 CDP 参数启动生产 Main 的隔离 ASAR 实验，已复现旧 pristine predicate 拒绝 Chromium 生成的 `DevToolsActivePort`；该记录与实验进程真实 CDP 端点一致。新增严格格式识别、维持目录与 Local State 安全材料绑定后，同一 ASAR 实验能进入真实原生确认并取消。运行时端点记录的正常更替不承担资料身份。后续 hosted 原生回归 `39197889343` 还直接记录了取消重启后的 `post_ready_resolution` / `debug_port_record_invalid`：只接受稳定格式仍不足以处理 Chromium 的异步发布。候选检查因此单独承认有界、身份未变的空记录或完整格式尚不稳定的发布中状态；它只能进入原生确认，不能发布 metadata。用户确认后及各发布 checkpoint 必须完整稳定验证，未完成则停止并保留现场。未知非空内容和相邻历史资料继续拒绝，无等待或重试。来源、格式、安全边界和历史证据限制见 [首次创建设计](../recall-fresh-profile-bootstrap.md#debugger-discovery-before-native-consent)。这些实验未执行 Setup，也未验证 installed 工作台。

本轮已取得上述明确范围的单次授权，触发前仍须验证 harness 精确 HEAD 与来源签名、契约以及预检；不得在开发机执行。流程为：

1. 已核对 264bb11 的 exact-head CI、finalized artifact、ZIP/manifest/EXE SHA；触发脚本仍需对精确源 SHA、Run/Artifact、Node runtime 和同源产物重新验证，不能使用旧产物。
2. 在独立验收准备提交中锁定新产物的 source/run/artifact/digest/EXE SHA 与唯一 label，审核 CI 与脚本后仅触发一次 label 验收，触发后立即移除 label 防止重复。
3. 在原生确认可见时验证完整稳定的 Electron Local State：已存在与后出现是两种正常情形，分别记录，禁止要求一个已存在的文件重新出现；没有观察到新增事件不得声称观察到晚期发布。随后对唯一 owned 控件执行 Create，另验 Cancel 完全退出后重新创建；不删除或改写 Local State。
4. 使用相同 CDP 启动参数。成功标准：原生创建确认确实出现，无“本地学习资料无法确认”；真实 installed EXE 加载工作台；identity/bootstrap 均严格可解析且 profileId/epochId 一致；合成 localStorage/IndexedDB 写入经独立 Main 进程重启读回；metadata identity 不变；退出状态正常。取消退出不发布 Recall metadata，随后创建成功。不得删除 Local State 或 debugger discovery 记录来伪造可创建现场。失败必须保留原生截图、CDP discovery、脱敏分类日志和退出状态，禁止 retry 改写结果。
5. 安装、首次创建、取消后创建、重启保留分别报告 PASS/FAIL。卸载、旧版交接只在明确获批时执行并独立报告；未执行项标为 NOT_RUN。只有新产物真实安装首次创建通过后，才可宣称首次安装缺陷解决。

## 更早固定产物入口的历史说明

以下 `98178f3` 信息仅为更早验收的历史记录；当前策略已改为上文 `1be3f28`，两者都不能作为本次新修复的验收入口。

本入口只用于 PR #148 的固定提交 `98178f3b286f65341677e05c1f4abf70e599a310`，不是发布或任意安装权限。禁止在开发机、用户现用主机或 Pilot 上调用安装/卸载/升级。PowerShell 和浏览器探针均检查 GitHub-hosted Windows 身份；安装脚本另核对 PR 与 label，且没有本机 override。

## 触发与费用

新 `workflow_dispatch` 文件不在默认分支时不可依赖手动运行。本入口使用 `pull_request: labeled`，从 PR merge ref 加载 workflow，再 checkout 精确 PR head 的测试工具。PR head 可继续修复验收脚本，但固定被测产物仍来自上述 CI run；二者必须分别报告。显式 label `recall-install-acceptance-98178f3` 只对本仓库 PR #148、同仓库固定分支触发一个 `windows-latest` job，20 分钟上限、无矩阵、无自动重试、无 npm ci/打包/付费服务调用。默认 CI 的 synchronize 事件不受此 label 触发；只使用 read contents/actions 权限，不用 pull_request_target。

测试工具可以随 PR head 审查，**被安装的二进制始终来自固定旧 run/artifact ID**，不把工具提交冒充产品源提交。当时固定 CI run `39114236172` 的 finalized NSIS artifact `12132012074`，源提交 `98178f3b286f65341677e05c1f4abf70e599a310`，ZIP SHA-256 `c374a7f234cad9e39d6e01d77821aaaa6f26e9fbebbb60ada0b1bced4415b78b`，安装 EXE SHA-256 `e7e2e9a3625ffc4c87ef324ebc746aa6d7da0310d562c2108e31a9cc77635b40`。下载时核对原 run 的精确 source SHA / success、artifact ID / digest / expiration、ZIP digest 与内容 allowlist、manifest 与 EXE SHA256。CI 构建的 EXE 摘要与同源本机重建包不同，不能混用。

## 断言

1. 临时 runner 不存在 Recall 注册、profile、bootstrap、旧 Squirrel 目录及同名快捷方式。
2. `/S /currentuser /D=...` 安装到 RUNNER_TEMP 下唯一目录，无提升权限。验证 EXE、ASAR、bundled Node/server、版本、HKCU 卸载注册及快捷方式目标。
3. 实际安装 EXE 首次启动，操作原生创建资料确认；通过仅 loopback 的 CDP 检查真实工作台加载，写入完全合成的 localStorage / 独立 IndexedDB namespace，截图并重启读回、核对 profile identity。
4. 运行实际卸载器；先断言 payload、注册、快捷方式删除、用户 profile 保留，再清理合成 profile/bootstrap。不能手动删注册表或先 rm payload 来伪造卸载成功。路径删除前校验绝对范围与 reparse point。
5. 仅能获取并核验同仓库固定 tag commit 和 release asset API digest 时执行旧包测试；失败则记录 NOT_RUN 原因。v0.2.2 使用 Squirrel，新版 NSIS，因此准确称为 Squirrel-to-NSIS 存储交接测试，不声称 NSIS 原位更新。合成浏览器存储读回只能证明该 partition/origin 数据保留，不等于全部业务 schema migration 验收。

生产权限/fuses/IPC/业务代码不因测试而修改。CDP 只在一次性 runner 的测试启动参数开启，关闭已拥有进程后停止。没有真实 API Key、Cookie、用户资料或远程 Provider 请求。可信旧版是仓库来源与固定摘要验证，不冒称 unsigned 安装包拥有发布者签名。

## 证据与限制

无论成败都上传仅合成数据的 artifact：来源/摘要记录、逐项 assertions、transcript、首次启动/重启/升级读回和工作台截图；失败现场保留并明确 FAIL，runner 随 job 销毁。installer 本身不重复上传，证据保留 7 天。

固定 98178f3 的安装验收与新依赖 HEAD 的 CI/NSIS 构建是不同证据。最终报告必须分别列 source SHA、harness SHA、run ID、断言和 NOT_RUN；不得据旧包安装成功宣称新包或所有历史升级路径已验收。

依据：[GitHub pull_request 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)、[NSIS 参数](https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers)、[Electron 测试调试端口](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport)。
