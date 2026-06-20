<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## AI 连接架构约定

- 业务功能只接收 `ApiConnectionProfile`，不得读取或透传旧 `apiSetting`。
- 文本任务使用默认文本连接，图片/OCR/关键帧使用默认多模态连接，云端朗读使用默认语音连接；缺失时明确提示，不跨能力静默回退。
- `apiSettings` 旧表与 `ApiSetting` 类型只用于历史迁移和旧版本回退，清空默认文本连接时必须同步清理旧记录。
- 密钥解密和连接参数映射统一放在连接级 AI 客户端，业务 service 不得自行解密密钥或推断厂商协议。
- 回归验证至少运行 `npm run lint`、`npm run test:contracts` 和 `npm run build`，涉及交互时还要用应用内浏览器检查页面、控制台和关键流程。

## 字体与语音约定

- 全局中文 UI 默认使用 `next/font` 自托管的 Noto Sans SC，并通过 `--font-noto-sans-sc` 接入主题字体栈；已知旧内置字体栈应自动迁移，用户手写的自定义字体不得覆盖。
- 浏览器语音识别仅用于面试和辅导的输入转写；朗读不得调用 `speechSynthesis`、系统音色或任何本机静默回退。
- 朗读只能使用默认语音连接。缺少连接、Voice ID 或请求失败时必须明确提示并保持静音。
- 本地部署语音统一走自定义连接的 OpenAI 兼容 `/audio/speech` 协议；自定义连接允许无 API Key，且无 Key 时不得发送空 `Authorization` 请求头。

## 主题与侧栏约定

- `ThemeConfig` 只使用 `diffuseGradient`；`translucentSidebar` 仅在导入和 IndexedDB 归一化时作为旧字段读取，导出不得再写旧字段。
- 八个内置主题（晴空、米白、薄荷、晨雾、深海、暮紫、石墨、夜樱）的对比度均默认为 `0`。迁移时只把仍等于历史预设值的内置主题归零，用户主动修改过的数值必须保留。
- 顶栏始终使用主题实色背景；侧栏也必须保持不透明，弥散效果只允许用低透明度径向渐变叠加，禁止恢复 `backdrop-filter` 或透明窗口底色。
- 历史 GitHub Light 统一迁移为可编辑的“晴空”，不得固定侧栏色或禁用弥散；弥散由多组低透明度、非对称的大面积柔和色场组成。
- 主题菜单保持 Codex 式纯文本结构，只显示主题名和选中勾；调色板使用应用内控件，颜色字段保持圆形色样加 `#RRGGBB` 输入。

## 人设与角色图约定

- `personaDisplayMode` 只使用 `"default" | "custom"`；旧 `basic` / `flashcard` 在 repository 归一化，不升级 IndexedDB 索引版本。
- 内置人设定义保持不可变；`public/personas/` 只保存统一摄影规范的真人教师头像，文字、上传图和专属音色统一写入 `personaCustomizations[personaId]`。
- 角色原图只接受 PNG、JPEG、WebP，最大 20MB；浏览器端居中裁切为 3:4、最长输出 2400×3200 WebP 后以 Data URL 持久化。删除自定义人设时必须同步清理定制、默认选择和模块引用。
- `resolvePersona()` 负责合并文字覆盖，`resolvePersonaVoice()` 只返回实际模块人设的独立音色。旧全局音色仅在首次迁移时复制到缺少音色的人设，之后删除不得复活；仍只允许使用默认语音连接。
- 定制页只渲染 `customPersonas`，不得为内置人设生成卡片；空状态只显示独立“+”，新卡在选图成功前必须保持为不持久化草稿。
- 角色卡固定 3:4；旧比例字段只用于迁移读取，活跃类型和导出不得保留比例选择。
- 卡片正面使用 `public/personas/persona-card-frame-3x4.png` 原始像素纹样，只允许等比缩放。镶边保留四角金色卷草和原图底边蓝色，背面禁止出现镶边；姓名不得恢复黑色铭牌，也不得引入职阶、星级或原作标识。
- 定制角色背面只编辑角色名称、角色描述和独立音色；默认人设通过无金框编辑层显示头像和完整字段。两种编辑层不得共用会导致遮挡的滚动结构。
- 编辑层必须锁定焦点、支持 Escape 和遮罩关闭、恢复触发器焦点并锁定页面滚动；减少动态效果时取消闪箔和位移动画。

## 主题与人设验收约定

- 除 lint、contracts、build 外，至少检查 1536×1024 与 390×844；确认主题菜单键盘操作、调色板同步、晴空主题可编辑、弥散隔离、定制空状态、高清选图、固定 3:4 正面镶边、无框背面、默认头像编辑、独立音色错误反馈和刷新持久化。
- 视觉改动必须保存浏览器截图，并与已确认的 Image-2 规格图逐项比较；检查控制台、框架错误和横向溢出后才能交付。
