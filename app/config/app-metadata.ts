/**
 * 版本由 Next 配置从根 package.json 注入；fallback 只服务于不经过 Next 的契约测试。
 * 不直接把完整 package.json 带入浏览器，避免开发依赖改变首屏 bundle。
 */
export const REVIEW_WORKSPACE_VERSION = process.env.NEXT_PUBLIC_REVIEW_WORKSPACE_VERSION
  ?? process.env.npm_package_version
  ?? "0.3.0";
