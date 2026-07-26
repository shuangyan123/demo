import { ReviewWorkspace } from "./components/review-workspace";
import { AiActivityPanel } from "./features/shared/ai-activity-panel";

// 首页保持静态渲染；开发示例参数由客户端工作台读取，避免把生产首屏升级为动态路由。
export default function Home() {
  return <><ReviewWorkspace /><AiActivityPanel /></>;
}
