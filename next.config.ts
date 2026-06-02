import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 隐藏 Next 开发期左下角指示器，避免它遮挡应用自己的底部设置入口；错误覆盖层仍会正常显示。
  devIndicators: false,
};

export default nextConfig;
