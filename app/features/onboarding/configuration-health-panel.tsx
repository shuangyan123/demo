import { Button, Chip, Panel, cx } from "../shared/ui-primitives";
import type {
  ConfigurationHealth,
  ConfigurationHealthAction,
  ConfigurationHealthItem,
  ConfigurationHealthStatus,
} from "./use-configuration-health";

type ConfigurationHealthPanelProps = {
  health: ConfigurationHealth;
  onAction: (action: ConfigurationHealthAction) => void;
};

const statusLabel: Record<ConfigurationHealthStatus, string> = {
  missing: "待配置",
  ready: "已就绪",
  warning: "需处理",
};

const statusTone: Record<ConfigurationHealthStatus, "blue" | "green" | "yellow" | "red"> = {
  missing: "red",
  ready: "green",
  warning: "yellow",
};

function visibleItems(items: ConfigurationHealthItem[]): ConfigurationHealthItem[] {
  const issues = items.filter((item) => item.status !== "ready");
  return (issues.length ? issues : items).slice(0, 2);
}

/** 总览页配置健康面板，只展示已有状态和导航入口，不触发外部连接或保存动作。 */
export function ConfigurationHealthPanel({ health, onAction }: ConfigurationHealthPanelProps) {
  return (
    <Panel title="配置健康" eyebrow="Configuration Health">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">快速确认 AI、Obsidian、自动化和学习数据闭环是否可用。</p>
          <strong className="mt-1 block text-2xl leading-tight">{health.summary}</strong>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone={statusTone[health.status]}>{statusLabel[health.status]}</Chip>
          <Chip tone="blue">{health.readyCount} 项就绪</Chip>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {health.sections.map((section) => (
          <article key={section.id} className="ui-card ui-card-muted grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <strong>{section.title}</strong>
              <Chip tone={statusTone[section.status]}>{statusLabel[section.status]}</Chip>
            </div>
            <div className="grid gap-3">
              {visibleItems(section.items).map((item) => (
                <div key={item.id} className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx("font-medium", item.status === "missing" && "text-red", item.status === "warning" && "text-yellow")}>
                      {item.title}
                    </span>
                    <Chip tone={statusTone[item.status]}>{statusLabel[item.status]}</Chip>
                  </div>
                  <p className="text-sm leading-6 text-muted">{item.description}</p>
                  {item.action && item.actionLabel && (
                    <div>
                      <Button className="max-w-full whitespace-normal text-left" size="sm" type="button" variant="soft" onClick={() => onAction(item.action!)}>
                        {item.actionLabel}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
