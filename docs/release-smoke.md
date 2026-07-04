# 发布前手工冒烟清单

## 范围

此清单用于 CI 之外的真实浏览器与真实 Vault 发布验收。CI 仍不得连接真实 Vault、真实模型服务或外网 API Key。

## 基础质量门

- 运行 `npm run lint`。
- 运行 `npm run test:contracts`。
- 运行 `npm run build`。
- 涉及 UI 或关键流程时运行 `npm run test:e2e`。

## 浏览器通用冒烟

- 首页 title 为“错题复盘”。
- 总览配置健康面板可见。
- 设置 -> 诊断可达，诊断报告可复制，页面无 Next/React overlay。
- 自动化中心可达，预览读取范围、试运行失败恢复入口、收件箱详情可见。
- 控制台无 runtime error，页面无横向溢出。

## Obsidian Vault 真实授权冒烟

- connect：使用真实浏览器选择临时 Vault，确认托管目录和权限状态显示正常。
- sync：首次同步应导入 Vault 中已有托管 Markdown，也应写入本地未映射知识资料。
- conflict：应用侧与 Vault 侧同时修改同一条映射后必须进入冲突，不得静默覆盖。
- proposal confirm：确认一条 `create` / `merge` / `link` 提案前会复读 Vault；过期 hash 必须拒绝，失败后 proposal 保持 pending 可重试。

## 剩余风险记录

- 真实 Vault 写入仍只在人工 smoke 中验证，不能放进 CI。
- 数据层索引升级必须先有真实慢查询记录和页面访问路径证据。
- 若发现性能瓶颈，先记录页面、操作、数据量、耗时、调用 repository，再设计 Dexie schema 版本升级。
