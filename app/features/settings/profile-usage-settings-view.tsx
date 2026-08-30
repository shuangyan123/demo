import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import { getProviderShortcuts } from "../../services/provider-shortcuts.ts";
import { getProviderContract } from "../../services/provider-contracts.ts";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { SettingsSectionHeader } from "./settings-section-header";

export function ProfileUsageSettingsView({ connections, conversationCount, importCount, knowledgeCount, mistakeCount, textModelId }: {
  connections: ApiConnectionProfile[];
  conversationCount: number;
  importCount: number;
  knowledgeCount: number;
  mistakeCount: number;
  textModelId?: string;
}) {
  const providerConnections = Array.from(new Map(connections.map((connection) => [connection.provider, connection])).values());
  return (
    <section className="profile-usage-settings">
      <SettingsSectionHeader title="个人资料 / 使用情况" description="汇总当前设备上的本地资料、模型选择与连接状态；不创建远端账号，也不推测厂商额度。" />
      <div className="profile-usage-grid" aria-label="本地使用概览">
        <dl>
          <div><dt>错题</dt><dd>{mistakeCount}</dd></div>
          <div><dt>知识条目</dt><dd>{knowledgeCount}</dd></div>
          <div><dt>导入记录</dt><dd>{importCount}</dd></div>
          <div><dt>对话</dt><dd>{conversationCount}</dd></div>
        </dl>
        <dl>
          <div><dt>AI 连接</dt><dd>{connections.length ? `${connections.length} 个已保存` : "尚未配置"}</dd></div>
          <div><dt>默认文本模型</dt><dd>{textModelId ?? "尚未选择"}</dd></div>
          <div><dt>资料范围</dt><dd>仅当前设备</dd></div>
        </dl>
      </div>
      <section className="profile-provider-links" aria-labelledby="profile-provider-links-title">
        <header><h2 id="profile-provider-links-title">厂商快捷入口</h2><p>链接来自应用内受控元数据；不会使用对话内容或自定义 Base URL。</p></header>
        <div>
          {providerConnections.map((connection) => {
            const shortcuts = getProviderShortcuts(connection.provider);
            if (!shortcuts.length) return null;
            return (
              <article key={connection.provider}>
                <span><ProviderIcon provider={connection.provider} size={18} /><strong>{getProviderContract(connection.provider).label}</strong></span>
                <nav aria-label={`${getProviderContract(connection.provider).label} 官方入口`}>
                  {shortcuts.map((shortcut) => <a key={shortcut.label} href={shortcut.url} target="_blank" rel="noreferrer">{shortcut.label}<AppIcon name="externalLink" size={14} /></a>)}
                </nav>
              </article>
            );
          })}
          {!providerConnections.length ? <p className="text-sm text-muted">保存 AI 连接后，这里会显示对应厂商的受控官方入口。</p> : null}
        </div>
      </section>
    </section>
  );
}
