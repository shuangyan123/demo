# 固定产物 Windows 安装验收

## 首次启动修复的下一次验收（尚未授权执行）

旧 run `39117755780` 的安装、来源核验和原生确认已执行，但工作台启动失败。`d7e9239` 的普通 CI、Windows E2E 或 NSIS 构建成功均不能关闭该失败。新修复用真实 Windows Electron 证明：原生确认仍打开时，Electron 可在 ready 后约十秒才发布 `Local State`；旧实现误把该运行时转换当成候选资料变更。旧安装包没有分类诊断，不能追认其确切文件变化。

再次安装前必须先取得用户批准。批准应明确一次性 GitHub-hosted Windows runner、精确产品 source SHA、验收 harness SHA，以及是否包括卸载与旧版交接；不得在开发机执行。具体顺序为：

1. 等新修复的 exact-head CI 和 `Windows NSIS Production` 完成，获取 finalized artifact 的 run ID、artifact ID、ZIP digest、manifest、安装 EXE SHA-256，逐项核验 source commit、Node runtime 和同源产物。禁止复用下面仍指向 `98178f3` 的旧固定策略。
2. 在单独的验收准备提交中，把 `scripts/nsis-install-acceptance.json` 的 source/run/artifact/digest/EXE SHA 和 workflow 的唯一 label 同步锁定新产物。先审查该提交和来源，再按批准范围触发一次 label 验收；本次修复不改 label、不触发安装。
3. 首次创建至少包含一个保持原生确认打开直到观察到 Electron 自行发布 `Local State` 的场景；以文件事件为依据，不能只凭固定睡眠假设已发生。记录脱敏的发布/确认顺序，随后操作唯一属于被测进程的原生创建按钮。另验取消后完全退出，再启动并创建；不删除或改写 `Local State`。
4. 成功标准：无“本地学习资料无法确认”；真实 installed EXE 加载工作台；identity/bootstrap 均严格可解析且 profileId/epochId 一致；合成 localStorage/IndexedDB 写入经独立 Main 进程重启读回；metadata identity 不变；退出状态正常。失败必须保留原生截图、CDP discovery、脱敏分类日志和退出状态，禁止 retry 改写结果。
5. 安装、首次创建、取消后创建、重启保留分别报告 PASS/FAIL。卸载、旧版交接只在明确获批时执行并独立报告；未执行项标为 NOT_RUN。只有新产物真实安装首次创建通过后，才可宣称首次安装缺陷解决。

以下为现有旧产物入口的准确固定信息，不能直接作为新修复验收入口。

本入口只用于 PR #148 的固定提交 `98178f3b286f65341677e05c1f4abf70e599a310`，不是发布或任意安装权限。禁止在开发机、用户现用主机或 Pilot 上调用安装/卸载/升级。PowerShell 和浏览器探针均检查 GitHub-hosted Windows 身份；安装脚本另核对 PR 与 label，且没有本机 override。

## 触发与费用

新 `workflow_dispatch` 文件不在默认分支时不可依赖手动运行。本入口使用 `pull_request: labeled`，从 PR merge ref 加载 workflow，再 checkout 精确 PR head 的测试工具。PR head 可继续修复验收脚本，但固定被测产物仍来自上述 CI run；二者必须分别报告。显式 label `recall-install-acceptance-98178f3` 只对本仓库 PR #148、同仓库固定分支触发一个 `windows-latest` job，20 分钟上限、无矩阵、无自动重试、无 npm ci/打包/付费服务调用。默认 CI 的 synchronize 事件不受此 label 触发；只使用 read contents/actions 权限，不用 pull_request_target。

测试工具可以随 PR head 审查，**被安装的二进制始终来自固定旧 run/artifact ID**，不把工具提交冒充产品源提交。固定策略锁定 CI run `39114236172` 的 finalized NSIS artifact `12132012074`，源提交 `98178f3b286f65341677e05c1f4abf70e599a310`，ZIP SHA-256 `c374a7f234cad9e39d6e01d77821aaaa6f26e9fbebbb60ada0b1bced4415b78b`，安装 EXE SHA-256 `e7e2e9a3625ffc4c87ef324ebc746aa6d7da0310d562c2108e31a9cc77635b40`。固定策略见 `scripts/nsis-install-acceptance.json`；下载时核对原 run 的精确 source SHA / success、artifact ID / digest / expiration、ZIP digest 与内容 allowlist、manifest 与 EXE SHA256。CI 构建的 EXE 摘要与同源本机重建包不同，不能混用。

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
