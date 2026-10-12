import Link from "next/link";
import { issueDiagnostic, readDiagnostic } from "../server/diagnostic/assessment-store.ts";

export const dynamic = "force-dynamic";

/** 独立 server surface；不挂载工作台、Tutor 或 AI Activity，不把 spec/key 交给 client component。 */
export default async function DiagnosticPage({ searchParams }: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const { session } = await searchParams;
  const assessment = session === undefined ? issueDiagnostic()
    : typeof session === "string" ? readDiagnostic(session) : { kind: "unavailable" } as const;
  return <main className="mx-auto w-full max-w-lg px-6 py-12 text-[var(--foreground)]">
    <p className="mb-3 text-sm text-[var(--muted)]">Recall · 单题作答</p>
    <h1 className="mb-6 text-2xl font-semibold">基础计算</h1>
    {assessment.kind === "unavailable" ? <>
      <p role="alert">作答暂不可用：本地存储不可用或本次作答已失效。</p>
      <Link className="mt-5 inline-block underline" href="/diagnostic" prefetch={false}>重新开始</Link>
    </> : <>
      <p className="mb-6 text-xl" data-testid="diagnostic-prompt">{assessment.presentation.content.prompt}</p>
      {assessment.kind === "issued" ? <form action="/api/diagnostic/submit" method="post">
        <input type="hidden" name="sessionId" value={assessment.sessionId} />
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm">选择一个答案</legend>
          {assessment.presentation.content.options.map((option) => <label key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--line)] px-4 py-3">
            <input type="radio" name="selectedOptionId" value={option.id} required />
            <span>{option.text}</span>
          </label>)}
        </fieldset>
        <button type="submit" className="mt-6 rounded-lg bg-[var(--interactive-primary-bg)] px-5 py-2.5 text-[var(--interactive-primary-fg)]">提交答案</button>
      </form> : assessment.kind === "pending" ? <section aria-live="polite">
        <p role="alert">答案已锁定，提交尚未完成。可重试完成此答案的提交。</p>
        <form action="/api/diagnostic/submit" method="post">
          <input type="hidden" name="sessionId" value={assessment.sessionId} />
          <input type="hidden" name="selectedOptionId" value={assessment.selectedOptionId} />
          <button type="submit" className="mt-6 rounded-lg border border-[var(--line)] px-5 py-2.5">重试提交</button>
        </form>
      </section> : <section aria-live="polite">
        <h2 className="mb-3 font-medium">已提交</h2>
        <p>你的选择：{assessment.presentation.content.options.find((option) => option.id === assessment.selectedOptionId)?.text}</p>
        <p className="mt-2">正确答案：{assessment.presentation.content.options.find((option) => option.id === assessment.correctOptionId)?.text}</p>
        <p className="mt-3" data-testid="diagnostic-explanation">{assessment.explanation}</p>
        <Link className="mt-6 inline-block underline" href="/diagnostic" prefetch={false}>重新作答</Link>
      </section>}
    </>}
    <Link className="mt-6 block text-sm underline" href="/diagnostic/resume" prefetch={false}>查看已保存作答</Link>
  </main>;
}
