import { ReviewWorkspace } from "./components/review-workspace";
import { AiActivityPanel } from "./features/shared/ai-activity-panel";

// 首页直接渲染错题复盘工作台。
export default function Home() {
  return <><ReviewWorkspace /><AiActivityPanel /></>;
}
