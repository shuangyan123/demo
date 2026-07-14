import { useEffect, useState } from "react";
import { Button, Chip, Panel, cx } from "../shared/ui-primitives";
import type { LocalDiagnosticAction, LocalDiagnosticItem, LocalDiagnosticStatus, LocalDiagnostics } from "./use-local-diagnostics";
import { DataManagementPanel } from "./data-management-panel";

type LocalDiagnosticsPanelProps = {
  diagnostics: LocalDiagnostics;
  onAction: (action: LocalDiagnosticAction) => void;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  onDataChanged?: () => Promise<void> | void;
};

const statusLabel: Record<LocalDiagnosticStatus, string> = {
  error: "错误",
  ready: "正常",
  warning: "注意",
};

const statusTone: Record<LocalDiagnosticStatus, "green" | "yellow" | "red"> = {
  error: "red",
  ready: "green",
  warning: "yellow",
};

function visibleItems(items: LocalDiagnosticItem[]): LocalDiagnosticItem[] {
  const issues = items.filter((entry) => entry.status !== "ready");
  return (issues.length ? issues : items).slice(0, 3);
}

/** 设置页本地诊断面板；只展示当前快照和复制报告，不触发外部请求或配置写入。 */
export function LocalDiagnosticsPanel({ diagnostics, onAction, onDataChanged, onRefresh, refreshing }: LocalDiagnosticsPanelProps) {
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copyReport() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unsupported");
      await navigator.clipboard.writeText(diagnostics.report);
      setFeedback("诊断信息已复制");
    } catch {
      setFeedback("复制失败，请手动选择下方诊断报告");
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">诊断</h1>
          <p className="mt-2 text-sm leading-6 text-muted">查看当前本地配置、浏览器能力和最近失败状态，便于复制给排障人员。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void onRefresh()} disabled={refreshing}>
            {refreshing ? "刷新中" : "刷新诊断"}
          </Button>
          <Button type="button" variant="primary" onClick={() => void copyReport()}>
            复制诊断信息
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        <Panel title="当前诊断快照" eyebrow="Local Diagnostics">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong className="text-2xl">{diagnostics.summary}</strong>
              <p className="mt-1 text-sm text-muted">生成时间：{new Date(diagnostics.generatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip tone={statusTone[diagnostics.status]}>{statusLabel[diagnostics.status]}</Chip>
              <Chip tone="blue">{diagnostics.readyCount} 项正常</Chip>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {diagnostics.sections.map((section) => (
              <article key={section.id} className="ui-card ui-card-muted grid gap-3" data-testid={`diagnostic-section-${section.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <strong>{section.title}</strong>
                  <Chip tone={statusTone[section.status]}>{statusLabel[section.status]}</Chip>
                </div>
                <div className="grid gap-3">
                  {visibleItems(section.items).map((entry) => (
                    <div key={entry.id} className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx("font-medium", entry.status === "error" && "text-red", entry.status === "warning" && "text-yellow")}>{entry.title}</span>
                        <Chip tone={statusTone[entry.status]}>{statusLabel[entry.status]}</Chip>
                      </div>
                      <p className="text-sm leading-6 text-muted">{entry.description}</p>
                      {entry.action && entry.actionLabel ? (
                        <div>
                          <Button className="max-w-full whitespace-normal text-left" size="sm" type="button" variant="soft" onClick={() => onAction(entry.action!)}>
                            {entry.actionLabel}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="可复制报告" eyebrow="Copyable Report">
          <textarea
            aria-label="诊断报告"
            className="min-h-80 w-full resize-y rounded-lg border border-line bg-surface-muted p-4 font-mono text-xs leading-6 text-foreground"
            readOnly
            value={diagnostics.report}
          />
          {feedback ? (
            <div className="mt-3 text-sm text-muted" role="status">
              {feedback}
            </div>
          ) : null}
        </Panel>
        <DataManagementPanel onChanged={onDataChanged} />
      </div>
    </section>
  );
}
