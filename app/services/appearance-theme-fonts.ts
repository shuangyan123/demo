/**
 * 应用内置主题共享的中文界面字体栈。
 * 用户自定义字体仍由外观设置单独保存，不受此常量强制覆盖。
 */
export const DEFAULT_UI_FONT_STACK =
  'var(--font-noto-sans-sc), "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';

/**
 * 应用内置主题共享的代码字体栈。
 * Geist Mono 由根布局通过 next/font 注入，本地回退保证字体加载前布局稳定。
 */
export const DEFAULT_CODE_FONT_STACK =
  'var(--font-geist-mono), "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace';

