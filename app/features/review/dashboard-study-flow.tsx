import type { StudyDomainFlowStep } from "../../types/review";
import { AppIcon } from "../shared/app-icon";

export type DashboardFlowTone = "teal" | "blue" | "indigo" | "violet" | "coral" | "amber" | "green";

export type DashboardFlowItem = {
  action: () => void;
  status: string;
  step: StudyDomainFlowStep;
  tone: DashboardFlowTone;
};

/** 七阶段固定色阶只用于路径识别，状态含义仍由可读文本表达。 */
export const dashboardFlowTones: DashboardFlowTone[] = ["teal", "blue", "indigo", "violet", "coral", "amber", "green"];

/** 渲染桌面蛇形与移动端 S 曲线；装饰路径不进入无障碍树。 */
export function DashboardStudyFlow({ items }: { items: DashboardFlowItem[] }) {
  return (
    <section className="dashboard-study-flow" aria-labelledby="dashboard-study-flow-title">
      <h2 id="dashboard-study-flow-title">公考学习链路</h2>
      <div className="dashboard-study-flow-canvas">
        <svg className="dashboard-study-flow-path dashboard-study-flow-path-desktop" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="dashboard-flow-gradient-desktop" x1="0" x2="1">
              <stop offset="0%" stopColor="var(--study-flow-teal)" />
              <stop offset="18%" stopColor="var(--study-flow-blue)" />
              <stop offset="36%" stopColor="var(--study-flow-indigo)" />
              <stop offset="52%" stopColor="var(--study-flow-violet)" />
              <stop offset="68%" stopColor="var(--study-flow-coral)" />
              <stop offset="84%" stopColor="var(--study-flow-amber)" />
              <stop offset="100%" stopColor="var(--study-flow-green)" />
            </linearGradient>
          </defs>
          <path d="M125 62 H875 C950 62 958 198 875 198 H125" fill="none" stroke="url(#dashboard-flow-gradient-desktop)" strokeWidth="2.25" vectorEffect="non-scaling-stroke" />
        </svg>
        <svg className="dashboard-study-flow-path dashboard-study-flow-path-mobile" viewBox="0 0 100 700" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="dashboard-flow-gradient-mobile" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--study-flow-teal)" />
              <stop offset="18%" stopColor="var(--study-flow-blue)" />
              <stop offset="36%" stopColor="var(--study-flow-indigo)" />
              <stop offset="52%" stopColor="var(--study-flow-violet)" />
              <stop offset="68%" stopColor="var(--study-flow-coral)" />
              <stop offset="84%" stopColor="var(--study-flow-amber)" />
              <stop offset="100%" stopColor="var(--study-flow-green)" />
            </linearGradient>
          </defs>
          <path d="M28 50 C28 100 72 100 72 150 S28 200 28 250 S72 300 72 350 S28 400 28 450 S72 500 72 550 S28 600 28 650" fill="none" stroke="url(#dashboard-flow-gradient-mobile)" strokeWidth="2.25" vectorEffect="non-scaling-stroke" />
        </svg>
        <ol className="dashboard-study-flow-list">
          {items.map((item, index) => (
            <li key={item.step.id} data-flow-index={index + 1} data-tone={item.tone}>
              <button type="button" onClick={item.action}>
                <span className="dashboard-study-flow-node" aria-hidden="true">{index + 1}</span>
                <span className="dashboard-study-flow-label">{item.step.label}</span>
                <span className="dashboard-study-flow-status">{item.status}</span>
                <AppIcon name="chevronRight" size={18} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
