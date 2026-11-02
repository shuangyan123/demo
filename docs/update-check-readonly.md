# Recall：本地模拟版本检查切片

本轮继续 `feature/recall-update-backup-delivery`，基线为 `8b8c3ffdd9cce0f2fde78a0ac775693c2bdeec66`。
只交付版本查询与展示，未实现自动下载、安装、替换、重启、降级或生产更新通道。

## 导出改动有限收尾审查

- diagnostic-history 导出仅由数据管理按钮调用；没有启动 effect、定时器或自动导出调用方。
- 文件同时包含 `restoreSupport=not_implemented` 和中文 `notice=目前不可导入恢复`；设置页和下载提示也明确目前无法恢复。
- 明确投影 capture 白名单：记录 ID、spec/revision、选项及答案、时间、assistance、provenance；不复制磁盘原文件。
- 排除源 profileId/epochId/generation、Bootstrap/Identity、目录路径/授权、凭据、Cookie、Vault、隐藏 authority brand。
- 读取仍经固定 route → runtime 导出读取 → 原 Repository；无任意路径、preload/IPC 扩权，失败不初始化或修复历史。
- V2 的 schema、表白名单、导出和恢复算法未变；Repository diff 仅增加恢复预览的覆盖提示。
- diagnostic-history 的 append、publication、确认读回和 owner admission 未变；新增 accessor 仅调用完整快照读取。
- 既有桌面全套结果继续为 **128/129**：未修改的 native cancel 用例退出超时。本轮只静态核对其影响范围，不重跑全套或调查其根因。
- 独立归档的中文 notice 为本分支尚未发布格式的补充；不改变旧 V2，也不提供任何新的导入 writer。

## 当前版本与模拟源

设置 → 诊断 → 版本与更新。当前版本复用 `app/config/app-metadata.ts`，由 Next 配置从根 package.json 注入（当前 0.3.1）。
打开设置只展示版本，不查询；用户点击“检查模拟更新”才发起一次固定同源 `GET /api/updates/mock`。
该接口返回进程内的固定模拟 JSON，不访问远程站点、磁盘更新目录或安装包。模拟源默认关闭，不能通过请求参数设置。
Electron Main 以 `app.isPackaged` 判定打包模式。打包窗口忽略 `ELECTRON_RENDERER_URL`，只加载宿主启动的 standalone 服务。
Main 启动该子进程时以新生成的 `REVIEW_DESKTOP_RUNTIME_TOKEN` 覆盖父环境值。路由检测到该变量便忽略模拟场景并返回 `409 mock_disabled`，通过宿主鉴权的请求同样如此。

本地运行示例（只在任务工作树内）：

```powershell
$env:RECALL_UPDATE_MOCK_SCENARIO = 'available'
npm.cmd run dev
```

独立的本地 Web 测试服务也可在 `npm run build` 后使用 `npm run start` 验证模拟场景。它与打包桌面子进程共用同一份 Next 构建，是否允许模拟由宿主边界区分。
允许场景：`available`、`current`、`older`、`incompatible`、`invalid`、`failure`。
未设置或其他值均返回模拟源关闭；URL、文件路径和未知场景不能成为源。`available` 固定模拟 0.3.2，不代表真实发布。

## 元数据合同与失败语义

精确字段为 schemaVersion、product、channel、platform、arch、installer、version、minimumCurrentVersion、releaseNotes。
schemaVersion 必须为 1，product=recall、channel=local-mock；目标为 Windows x64 NSIS。
任何额外字段（包括下载 URL、哈希或“签名”字段）、缺失字段、重复字段（含 Unicode 别名）、非法类型均拒绝。
版本只接受无前导零的稳定版 `major.minor.patch`，各段为安全整数，按数值比较；预发布、build metadata、v 前缀不做隐式转换。
当前阶段要求同 major 且当前版本不低于 minimumCurrentVersion；不兼容只报告，不推断可安全安装。
相同版本与源版本较旧分别显示明确状态，不推荐降级。

仅接受 JSON 响应，最多 8 KiB；声明长度和实际流均检查，读取有 5 秒超时、卸载取消和超限取消，无自动重试。
客户端不携带 Cookie/凭据，不跟随 redirect，不缓存公告。只持有组件局部状态，不写入 IndexedDB、localStorage、managed-files 或用户资料。
UI 提供未检查、检查中、可用、相同、较旧、不兼容、无效、失败/超时、模拟源关闭状态，失败不阻断应用启动或设置导航。
更新说明最多 2000 字符，按 React 纯文本展示，不渲染 HTML、Markdown 链接或执行动作。查询期间阻止重复点击；之后仅允许用户手动再查。

## 正式可信更新仍需单独设计和批准

1. 指定正式渠道、受信端点、channel/平台/架构/NSIS 适配和版本策略，并验证元数据来源、过期与降级/重放保护。
2. 确定 Windows 代码签名证书与发布者信任策略，以及安装包和元数据的真实性验证；普通 SHA-256 只做完整性检查，不能建立来源信任。
3. 设计用户确认后的下载：固定允许的目的地、重定向策略、体积上限、取消、隔离暂存及独立验证，不能由公告字段直接触发任意程序。
4. 单独审查安装执行：进程权限、写入暂停、安全退出/重启、失败保全及版本回退。只读检查成功不授予下载或执行权限。
5. 验证可恢复备份及跨存储数据保护；diagnostic-history 恢复仍停在设计边界，不以本轮查询结果代替恢复/掉电证明。
6. 经授权的签名、Release、真实 NSIS 验收与发布通道操作。本轮未执行这些步骤，未调整 Squirrel 迁移。

测试入口为 `app/services/update-check.contract.test.ts` 和 `e2e/update-check.spec.ts`。
浏览器测试需对专属测试服务设置 `RECALL_UPDATE_MOCK_SCENARIO=available`，相关错误状态用受控响应覆盖。
完整补丁、文件清单与本轮验证结果将在 ignored `.cache/recall-product-delivery-review/` 中交付，不暂存任何文件。

## 本轮验证结果（2026-10-30）

固定 Node.js 24.20.0；所有数据写入测试均为独立测试资料，不涉及真实用户资料。

| 验证 | 实际结果 |
| --- | --- |
| typecheck / build | 通过 |
| lint | 通过；0 error，保留 `application-error-state.tsx:44` 的既有 navigation warning |
| 导出 + 新版本检查聚焦合同 | 38/38（各 19 项） |
| `npm run test:contracts` | **1276/1277**；未修改的 `history/repository.contract.test.ts` 用例 `instrumentation retains rename failure; exact NEW true controls bounded recovery` 失败：expected `already_published`，actual `attempt_cap_exhausted` |
| 相关 Chromium E2E | **15/15**；新版本检查 9 项、诊断归档 2 项、原 V2 数据可靠性 4 项；单 worker，零重试 |
| 桌面全套 | **沿用 128/129，未重跑**；既有 native cancel 退出超时仍保留 |

静态 diff 确认上述失败合同及其 history 写入实现均未修改；本轮没有重试该失败、削弱断言、改变 publication 策略或开展旁支调查。
完整合同门并未全绿，不能将聚焦合同与 UI 通过描述为全部质量门通过。
本轮没有实际 Electron 更新安装、真实 NSIS 验收、签名或 Release 验证。
