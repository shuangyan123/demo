# 视觉差异记录

验收日期：2026-06-20

## 桌面端 1536×1024

- 正面镶边加载原始透明 PNG，源尺寸 1200×1600；页面实测 278×371.33，比例 0.7487，未发生非等比拉伸。
- 四角金色卷草和底部连续卷草与参考图结构一致，底部蓝色带作为原图细节保留；中央人物区域保持透明。
- 悬停操作键均为 32×32 图标按钮；删除键不再使用冗长文字。
- 定制卡背实测镶边元素数量为 0、头像上传元素数量为 0，只保留名称、描述和独立音色。
- 独立 Voice ID 在关闭、保存和刷新后仍为 `persona-test-voice`，没有全局音色回退。
- 弥散由五组非对称页面色场和两组侧栏色场组成；侧栏底色为不透明十六进制色，`backdrop-filter` 为 `none`。

截图：

- `test-results/persona-card-front-desktop.png`
- `test-results/persona-card-back-desktop.png`
- `test-results/theme-diffuse-desktop.png`

## 移动端 390×844

- 页面 `scrollWidth` 与 `clientWidth` 均为 390，无横向溢出。
- 默认人设弹层左右各保留 8px，宽 374px；内容区高度 826px、滚动内容高度 1323px，头像与完成操作固定可见，底部音色可滚动访问。
- 卡片保持 3:4，操作图标在触摸宽度下直接可见。

截图：

- `test-results/persona-card-front-mobile.png`
- `test-results/persona-default-editor-mobile.png`

## 主题与可访问性

- 菜单依次显示晴空、米白、薄荷、晨雾、深海、暮紫、石墨、夜樱。
- 键盘 `ArrowDown` 可打开主题菜单，`End` 聚焦晨雾，`Escape` 关闭并恢复触发器焦点。
- 浏览器控制台错误 0，页面运行时错误 0；桌面和移动端均无横向溢出。
