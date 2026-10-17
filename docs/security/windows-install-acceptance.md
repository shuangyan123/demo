# 固定产物 Windows 安装验收

本入口只用于 PR #148 的固定提交 `5c1e28c515b3779c1ddeb6030391f24201416f73`，不是发布或任意安装权限。禁止在开发机、用户现用主机或 Pilot 上调用安装/卸载/升级。PowerShell 和浏览器探针均检查 GitHub-hosted Windows 身份；安装脚本另核对 PR 与 label，且没有本机 override。

## 触发与费用

新 `workflow_dispatch` 文件不在默认分支时不可依赖手动运行。本入口使用 `pull_request: labeled`，从 PR merge ref 加载 workflow，再 checkout 精确 PR head 的测试工具。显式 label `recall-install-acceptance-5c1e28c` 只对本仓库 PR #148、同仓库固定分支触发一个 `windows-latest` job，20 分钟上限、无矩阵、无自动重试、无 npm ci/打包/付费服务调用。默认 CI 的 synchronize 事件不受此 label 触发；只使用 read contents/actions 权限，不用 pull_request_target。

测试工具可以随 PR head 审查，**被安装的二进制始终来自固定旧 run/artifact ID**，不把工具提交冒充产品源提交。固定策略见 `scripts/nsis-install-acceptance.json`；下载时核对原 run 的精确 source SHA / success、artifact ID / digest / expiration、ZIP digest 与内容 allowlist、manifest 与 EXE SHA256。CI 构建的 EXE 摘要与同源本机重建包不同，不能混用。

## 断言

1. 临时 runner 不存在 Recall 注册、profile、bootstrap、旧 Squirrel 目录及同名快捷方式。
2. `/S /currentuser /D=...` 安装到 RUNNER_TEMP 下唯一目录，无提升权限。验证 EXE、ASAR、bundled Node/server、版本、HKCU 卸载注册及快捷方式目标。
3. 实际安装 EXE 首次启动，操作原生创建资料确认；通过仅 loopback 的 CDP 检查真实工作台加载，写入完全合成的 localStorage / 独立 IndexedDB namespace，截图并重启读回、核对 profile identity。
4. 运行实际卸载器；先断言 payload、注册、快捷方式删除、用户 profile 保留，再清理合成 profile/bootstrap。不能手动删注册表或先 rm payload 来伪造卸载成功。路径删除前校验绝对范围与 reparse point。
5. 仅能获取并核验同仓库固定 tag commit 和 release asset API digest 时执行旧包测试；失败则记录 NOT_RUN 原因。v0.2.2 使用 Squirrel，新版 NSIS，因此准确称为 Squirrel-to-NSIS 存储交接测试，不声称 NSIS 原位更新。合成浏览器存储读回只能证明该 partition/origin 数据保留，不等于全部业务 schema migration 验收。

生产权限/fuses/IPC/业务代码不因测试而修改。CDP 只在一次性 runner 的测试启动参数开启，关闭已拥有进程后停止。没有真实 API Key、Cookie、用户资料或远程 Provider 请求。可信旧版是仓库来源与固定摘要验证，不冒称 unsigned 安装包拥有发布者签名。

## 证据与限制

无论成败都上传仅合成数据的 artifact：来源/摘要记录、逐项 assertions、transcript、首次启动/重启/升级读回和工作台截图；失败现场保留并明确 FAIL，runner 随 job 销毁。installer 本身不重复上传，证据保留 7 天。

固定 5c1e28c 的安装验收与新依赖 HEAD 的 CI/NSIS 构建是不同证据。最终报告必须分别列 source SHA、harness SHA、run ID、断言和 NOT_RUN；不得据旧包安装成功宣称新包或所有历史升级路径已验收。

依据：[GitHub pull_request 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)、[NSIS 参数](https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers)、[Electron 测试调试端口](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport)。
