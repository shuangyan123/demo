import Link from "next/link";
import { loadDiagnosticResumeView } from "../../server/diagnostic/resume-view.ts";

export const dynamic = "force-dynamic";

const failureMessages = {
  unavailable: "已保存作答暂不可用",
  incomplete: "已保存作答历史不完整",
  corrupt: "已保存作答未通过完整性检查",
  unsupported: "当前历史格式暂不支持恢复",
  authority_failure: "作答证据恢复未完成",
};
const stateLabels = {
  understanding: { unknown: "未知", emerging: "初步支持", developing: "发展中", supported: "有证据支持" },
  independence: { unknown: "未知", assisted: "有辅助", partial: "部分独立", independent: "独立作答" },
  retention: { untested: "未测量", at_risk: "有风险", supported: "有证据支持" },
  transfer: { untested: "未测量", weak: "薄弱", supported: "有证据支持" },
};
const decisionReasons = {
  assistance_present: "当前支持证据包含辅助，需要验证独立作答。",
  incomplete_effective_state: "尚无完整有效状态可选择下一验证目标。",
  unsupported_effective_state: "当前状态不在现有验证政策的支持范围内。",
  ambiguous_evidence_qualification: "证据资格存在歧义，未选择下一验证目标。",
  no_qualified_direct_evidence: "缺少合格的直接测量证据。",
  ambiguous_verification_target: "当前反证不足以确定下一次应验证的维度。",
  no_authorized_verification_target: "当前证据未授权下一验证目标。",
};
const assistanceLabels = { none: "此受控来源未提供内建辅助", unknown: "辅助情况未知",
  hint: "此测量使用提示", guided: "此测量使用引导", solution: "此测量使用解答" };

/** 独立只读 server surface；不挂载工作台辅助，也不恢复原进程的作答 session。 */
export default function DiagnosticResumePage() {
  const view = loadDiagnosticResumeView();
  return <main className="mx-auto w-full max-w-2xl px-6 py-12 text-[var(--foreground)]">
    <Link href="/" prefetch={false} className="text-sm underline">返回总览</Link>
    <p className="mb-3 mt-6 text-sm text-[var(--muted)]">Recall · 第一方诊断</p>
    <h1 className="mb-6 text-2xl font-semibold">诊断与已保存作答</h1>
    {view.kind !== "complete" ? <section role="alert" data-testid="diagnostic-resume-failure" data-kind={view.kind} data-code={view.code}>
      <h2 className="font-medium">{failureMessages[view.kind]}</h2>
      <p className="mt-3">{view.kind === "unavailable" && view.code === "storage_config_unavailable"
        ? "当前环境无法使用持久诊断。请在已有有效本地学习资料的应用环境中打开。"
        : "本次无法确认完整历史，因此不展示作答证据或学习状态。未完成的提交不会被视为已保存。"}</p>
      <Link href="/diagnostic/resume" prefetch={false} className="mt-5 inline-block underline">重新读取已保存作答</Link>
    </section> : <section data-testid="diagnostic-resume-complete" data-history={view.history}>
      <p className="text-sm text-[var(--muted)]">仅覆盖当前本地资料中的第一方诊断历史；不代表全部学习经历。</p>
      {view.history === "complete-empty" ? <p className="mt-5" data-testid="diagnostic-resume-empty">当前授权来源暂无已确认保存的作答。这不表示你从未学习。</p> : <>
        <h2 className="mt-6 text-lg font-medium">基础计算 · 已保存作答</h2>
        <p className="mt-2" data-testid="diagnostic-resume-count">已确认 {view.attemptCount} 次作答，重新派生 {view.evidenceCount} 条证据。</p>
        <p className="mt-2 text-sm text-[var(--muted)]">来源：第一方受控诊断 r1。证据由确定性答案比较产生，不是模型判断。</p>
        <ol className="mt-4 space-y-3" aria-label="已确认作答记录">
          {view.attempts.map(attempt => <li key={attempt.attemptId} className="rounded-lg border border-[var(--line)] p-4"
            data-testid="diagnostic-resume-attempt" data-attempt-id={attempt.attemptId} data-direction={attempt.direction}>
            <p>{attempt.direction === "supports" ? "支持本题正确性" : "反驳本题正确性"}</p>
            <time className="mt-1 block text-sm" dateTime={attempt.occurredAt}>{attempt.occurredAt}</time>
            <p className="mt-1 break-all text-xs text-[var(--muted)]">作答标识：{attempt.attemptId}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{assistanceLabels[attempt.assistance]}</p>
          </li>)}
        </ol>
      </>}
      <section className="mt-6 border-t border-[var(--line)] pt-5" aria-labelledby="diagnostic-state-title" data-measurement={view.measurement}>
        <h2 id="diagnostic-state-title" className="font-medium">当前学习状态</h2>
        {view.state ? <dl className="mt-3 grid grid-cols-2 gap-4" data-testid="diagnostic-resume-state">
          <div><dt className="text-sm text-[var(--muted)]">理解</dt><dd data-dimension="understanding" data-value={view.state.understanding}>{stateLabels.understanding[view.state.understanding]}</dd></div>
          <div><dt className="text-sm text-[var(--muted)]">独立性</dt><dd data-dimension="independence" data-value={view.state.independence}>{stateLabels.independence[view.state.independence]}</dd></div>
          <div><dt className="text-sm text-[var(--muted)]">保持</dt><dd data-dimension="retention" data-value={view.state.retention}>{stateLabels.retention[view.state.retention]}</dd></div>
          <div><dt className="text-sm text-[var(--muted)]">迁移</dt><dd data-dimension="transfer" data-value={view.state.transfer}>{stateLabels.transfer[view.state.transfer]}</dd></div>
        </dl> : <p className="mt-3">截至本次读取，尚无可用的有效测量状态。</p>}
        {view.state?.lastVerifiedAt ? <p className="mt-3 text-sm">最近有效验证：<time dateTime={view.state.lastVerifiedAt.value}>{view.state.lastVerifiedAt.value}</time></p> : null}
        <p className="mt-3 text-sm text-[var(--muted)]">独立作答仅指此受控来源未提供内建辅助，不证明没有外部帮助。保持和迁移仍未测量。</p>
      </section>
      <section className="mt-6 border-t border-[var(--line)] pt-5" data-testid="diagnostic-resume-decision"
        data-kind={view.decision.kind} data-reason={view.decision.reason}>
        <h2 className="font-medium">下一验证判断</h2>
        <p className="mt-3">{decisionReasons[view.decision.reason]}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">不会自动安排或执行验证。下方再次作答由你主动选择，不属于保持或迁移测量，也不会自动提高证据权限。</p>
      </section>
      <Link href="/diagnostic" prefetch={false} className="mt-6 inline-block rounded-lg bg-[var(--interactive-primary-bg)] px-5 py-2.5 text-[var(--interactive-primary-fg)]">再次作答这道诊断题</Link>
      <p className="mt-5 text-xs text-[var(--muted)]">状态读取时间：<time dateTime={view.asOf}>{view.asOf}</time></p>
    </section>}
  </main>;
}
