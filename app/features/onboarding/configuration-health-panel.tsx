import { Button, Chip, cx } from "../shared/ui-primitives";
import { AppIcon } from "../shared/app-icon";
import type {
  ConfigurationHealth,
  ConfigurationHealthAction,
  ConfigurationHealthItem,
  ConfigurationHealthStatus,
} from "./use-configuration-health.ts";

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

/** 总览页配置健康使用紧凑 disclosure，展开前只占一行状态空间。 */
export function ConfigurationHealthPanel({ health, onAction }: ConfigurationHealthPanelProps) {
  return (
    <details className="dashboard-configuration-health">
      <summary>
        <span>配置健康</span>
        <span aria-hidden="true">·</span>
        <strong>{health.summary}</strong>
        <AppIcon name="chevronRight" size={16} />
      </summary>
      <section aria-labelledby="configuration-health-title">
        <h2 id="configuration-health-title">配置健康</h2>
        <div className="dashboard-configuration-health-overview">
          <p>AI、Obsidian、已安排与学习数据闭环</p>
          <div>
            <Chip tone={statusTone[health.status]}>{statusLabel[health.status]}</Chip>
            <Chip tone="blue">{health.readyCount} 项就绪</Chip>
          </div>
        </div>
        <div className="dashboard-configuration-health-grid">
          {health.sections.map((section) => (
            <article key={section.id}>
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
                    {item.action && item.actionLabel ? (
                      <div>
                        <Button className="max-w-full whitespace-normal text-left" size="sm" type="button" variant="soft" onClick={() => onAction(item.action!)}>
                          {item.actionLabel}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </details>
  );
}
