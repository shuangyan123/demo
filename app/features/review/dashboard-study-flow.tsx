import type { StudyDomainFlowStep } from "../../types/domains/workspace.ts";
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

/** 渲染桌面星图与移动端纵向路线；装饰路径不进入无障碍树。 */
export function DashboardStudyFlow({ items }: { items: DashboardFlowItem[] }) {
  return (
    <section className="dashboard-study-flow" aria-labelledby="dashboard-study-flow-title">
      <h2 id="dashboard-study-flow-title">公考学习链路</h2>
      <div className="dashboard-study-flow-canvas">
        <svg className="dashboard-study-flow-path dashboard-study-flow-path-desktop" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1" >
            <path data-flow-segment="top" d="M125 40 C215 40 285 60 375 60 S535 36 625 36 S785 54 875 54" vectorEffect="non-scaling-stroke" />
            <path data-flow-segment="bend" d="M875 54 C970 54 960 144 850 164 S710 190 625 190" vectorEffect="non-scaling-stroke" />
            <path data-flow-segment="return" d="M625 190 C535 190 465 210 375 210 S215 184 125 184" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        <svg className="dashboard-study-flow-path dashboard-study-flow-path-mobile" viewBox="0 0 64 700" preserveAspectRatio="none" aria-hidden="true">
          <path d="M32 50 V650" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        <ol className="dashboard-study-flow-list">
          {items.map((item, index) => (
            <li key={item.step.id} data-flow-index={index + 1} data-tone={item.tone}>
              <button type="button" onClick={item.action}>
                <span className="dashboard-study-flow-node" data-flow-node={index + 1} aria-hidden="true">{index + 1}</span>
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
