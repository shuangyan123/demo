import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Noto Sans SC 使用仓库内官方可变字体，避免构建时依赖 Google Fonts 网络连接。
const notoSansSC = localFont({
  src: "./fonts/NotoSansSC-Variable.woff2",
  variable: "--font-noto-sans-sc",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "错题复盘",
  description: "错题整理、复盘计划和薄弱分析工具",
};

// 定义 Next.js 根布局，注入全局字体变量和页面基础结构。
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${notoSansSC.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
