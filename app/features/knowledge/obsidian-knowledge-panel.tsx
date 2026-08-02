"use client";

import Image from "next/image";
import { useState } from "react";
import { Button, Chip, ConfirmDialog, EmptyState, Panel, SoftBlock, TextField } from "../shared/ui-primitives";
import type { useObsidianKnowledgeBridge } from "./use-obsidian-knowledge-bridge.ts";
import { ObsidianProposalReview } from "./obsidian-proposal-review";

type ObsidianController = ReturnType<typeof useObsidianKnowledgeBridge>;
type PendingAction =
  | { kind: "conflict"; path: string; choice: "vault" | "app" }
  | { kind: "reselect" };

const PERMISSION_LABELS = { granted: "已授权", prompt: "待授权", denied: "未授权", unsupported: "不支持" } as const;
const RUNTIME_LABELS = {
  watching: "监听中",
  syncing: "同步中",
  "needs-permission": "需授权",
  conflict: "有冲突",
  paused: "已暂停",
  error: "同步失败",
} as const;

/** Obsidian 面板只呈现连接、同步、冲突和提案；所有文件操作由 controller 委托给仓储。 */
export function ObsidianKnowledgePanel({ controller }: { controller: ObsidianController }) {
  const [managedRoot, setManagedRoot] = useState(controller.snapshot.managedRoot || "AI知识库");
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const snapshot = controller.snapshot;
  const confirmDescription = pendingAction?.kind === "conflict"
    ? pendingAction.choice === "vault"
      ? `将采用 Vault 中的“${pendingAction.path}”并覆盖应用内对应正文；操作前会再次检查双方版本。`
      : `将采用应用内版本并覆盖 Vault 中的“${pendingAction.path}”；操作前会再次检查双方版本。`
    : `将重新选择 Vault。现有 ${snapshot.mappedCount} 条映射会保留，并在下一次同步时按新 Vault 内容重新核对。`;

  if (!controller.pluginEnabled) {
    return (
      <Panel title={<span className="inline-flex items-center gap-2"><Image alt="" aria-hidden="true" height={20} src="/plugin-icons/obsidian.svg" width={20} />Obsidian 知识图谱</span>} eyebrow="Vault Bridge">
        <SoftBlock><strong>插件已停用</strong><p className="mt-2 text-sm text-muted">现有 Vault 配置、映射和知识数据均已保留。</p><Button className="mt-3" size="sm" onClick={controller.onOpenPlugins}>前往插件页启用</Button></SoftBlock>
      </Panel>
    );
  }

  // 确认后才执行覆盖或换库动作，避免误触直接修改本地文件。
  const confirmPendingAction = () => {
    const action = pendingAction;
    setPendingAction(undefined);
    if (!action) return;
    if (action.kind === "conflict") void controller.resolveConflict(action.path, action.choice);
    else void controller.connect(snapshot.managedRoot || managedRoot);
  };

  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Image alt="" aria-hidden="true" height={20} src="/plugin-icons/obsidian.svg" width={20} />Obsidian 知识图谱</span>} eyebrow="Vault Bridge">
      <div className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-lg:grid-cols-1">
          <TextField label="Vault 托管目录" value={snapshot.connected ? snapshot.managedRoot : managedRoot} onChange={snapshot.connected ? () => undefined : setManagedRoot} placeholder="AI知识库" />
          <div className="flex flex-wrap gap-2">
            {!snapshot.connected ? (
              <Button disabled={controller.busy || snapshot.permission === "unsupported"} type="button" variant="primary" onClick={() => void controller.connect(managedRoot)}>
                连接 Vault 文件夹
              </Button>
            ) : (
              <>
                <Button disabled={controller.busy} type="button" variant="primary" onClick={() => void controller.sync()}>立即同步</Button>
                {snapshot.recovery === "reauthorize" ? <Button disabled={controller.busy} type="button" variant="outline" onClick={() => void controller.requestPermission()}>重新授权</Button> : null}
                <Button disabled={controller.busy || snapshot.permission === "unsupported"} type="button" variant="outline" onClick={() => snapshot.mappedCount ? setPendingAction({ kind: "reselect" }) : void controller.connect(snapshot.managedRoot)}>重新选择 Vault 文件夹</Button>
              </>
            )}
            <Button disabled={controller.busy || !snapshot.connected} type="button" variant="soft" onClick={() => void controller.generateProposals()}>
              生成演进提案
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Chip tone={snapshot.connected ? "green" : "yellow"}>{snapshot.connected ? `已连接 ${snapshot.vaultName}` : "未连接 Vault"}</Chip>
          <Chip tone={controller.syncRuntime.status === "error" || controller.syncRuntime.status === "conflict" ? "red" : controller.syncRuntime.status === "watching" ? "green" : "yellow"}>
            {RUNTIME_LABELS[controller.syncRuntime.status]}
            {controller.syncRuntime.mode === "polling" ? " · 30 秒检查" : ""}
          </Chip>
          <Chip>权限 {PERMISSION_LABELS[snapshot.permission]}</Chip>
          <Chip>映射 {snapshot.mappedCount}</Chip>
          <Chip tone={snapshot.conflictCount ? "red" : "green"}>冲突 {snapshot.conflictCount}</Chip>
          <Chip tone={snapshot.pendingProposalCount ? "yellow" : "blue"}>待确认 {snapshot.pendingProposalCount}</Chip>
          {snapshot.lastSyncedAt ? <Chip>上次同步 {new Date(snapshot.lastSyncedAt).toLocaleString("zh-CN")}</Chip> : null}
        </div>
        {controller.syncRuntime.errorMessage ? <p className="text-sm text-danger">{controller.syncRuntime.errorMessage}</p> : null}

        <div className="grid gap-3 rounded-lg border border-line bg-surface-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-semibold">关系图谱</h4>
            <div className="flex flex-wrap gap-2 text-xs">
              <Chip tone="green">已同步 {controller.graph.syncedCount}</Chip>
              <Chip tone={controller.graph.issueCount ? "red" : "blue"}>待处理 {controller.graph.issueCount}</Chip>
              <Chip tone="yellow">外部链接 {controller.graph.externalCount}</Chip>
              <Chip>关系 {controller.graph.edges.length}</Chip>
            </div>
          </div>
          {controller.graph.edges.length ? (
            <div className="grid max-h-44 gap-2 overflow-y-auto pr-1">
              {controller.graph.edges.slice(0, 12).map((edge) => {
                const source = controller.graph.nodes.find((node) => node.id === edge.sourceId);
                const target = controller.graph.nodes.find((node) => node.id === edge.targetId);
                return (
                  <p key={edge.id} className="truncate text-sm text-muted">
                    <span className="font-medium text-foreground">{source?.title ?? edge.sourceId}</span>
                    <span aria-hidden="true"> → </span>
                    <span>{target?.title ?? edge.label}</span>
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">同步后会从 Markdown Wikilink 派生知识关系，并作为 AI 提案上下文。</p>
          )}
        </div>

        {snapshot.permission === "unsupported" || !snapshot.connected ? (
          <SoftBlock>
            <p className="text-sm leading-6 text-muted">请选择整个 Obsidian Vault 根文件夹，不要选择单个 .md 文件。双向目录桥接需要 Chrome 或 Edge 的安全上下文；不支持时可一次性导入 Markdown 文件夹，导入后不会继续同步。</p>
            <label className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold">
              一次性导入 Markdown 文件夹
              <input
                className="sr-only"
                type="file"
                accept=".md,text/markdown"
                multiple
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={(event) => {
                  void controller.importFiles(Array.from(event.currentTarget.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </SoftBlock>
        ) : null}

        {snapshot.recovery === "reselect" ? (
          <SoftBlock><p className="text-sm leading-6 text-muted">已保存的 Vault 句柄无法继续使用。请重新选择 Vault；现有映射和本地知识资料不会被删除。</p></SoftBlock>
        ) : null}

        {controller.issues.length ? (
          <div className="grid gap-3">
            <h4 className="font-semibold">同步待处理</h4>
            {controller.issues.map((mapping) => (
              <article key={mapping.path} className="ui-card ui-card-muted flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0"><strong className="block truncate text-sm">{mapping.path}</strong><span className="text-xs text-muted">{mapping.status === "conflict" ? "应用和 Vault 均有修改，尚未覆盖任何一方" : "Vault 文件已删除或移动"}</span></div>
                <div className="flex flex-wrap gap-2">
                  {mapping.status === "conflict" ? (
                    <><Button disabled={controller.busy} size="sm" type="button" variant="outline" onClick={() => setPendingAction({ kind: "conflict", path: mapping.path, choice: "vault" })}>采用 Vault</Button><Button disabled={controller.busy} size="sm" type="button" variant="soft" onClick={() => setPendingAction({ kind: "conflict", path: mapping.path, choice: "app" })}>采用应用</Button></>
                  ) : (
                    <><Button disabled={controller.busy} size="sm" type="button" variant="outline" onClick={() => void controller.recreate(mapping.path)}>重新创建</Button><Button disabled={controller.busy} size="sm" type="button" variant="ghost" onClick={() => void controller.detach(mapping.path)}>解除映射</Button></>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3">
          <h4 className="font-semibold">知识演进提案</h4>
          {controller.lastGenerationResult ? (
            <div className="rounded-lg border border-line bg-surface-muted p-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Chip tone={controller.lastGenerationResult.proposals.length ? "green" : "yellow"}>可用 {controller.lastGenerationResult.proposals.length}</Chip>
                <Chip>来源 {controller.lastGenerationResult.sourceCount}</Chip>
                <Chip>解析 {controller.lastGenerationResult.parsedCount}</Chip>
                <Chip tone={controller.lastGenerationResult.filteredCount ? "yellow" : "blue"}>过滤 {controller.lastGenerationResult.filteredCount}</Chip>
              </div>
              {controller.lastGenerationResult.emptyReason ? <p className="mt-2 text-muted">{controller.lastGenerationResult.emptyReason}</p> : null}
              {controller.lastGenerationResult.requestId ? <p className="mt-1 text-xs text-muted">请求 ID：{controller.lastGenerationResult.requestId}</p> : null}
              {controller.lastGenerationResult.diagnostics.length ? (
                <ul className="mt-2 grid gap-1 text-xs text-muted">
                  {controller.lastGenerationResult.diagnostics.slice(0, 4).map((item) => <li key={item.id}>{item.message}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          {controller.pendingProposals.length ? <ObsidianProposalReview controller={controller} /> : <EmptyState stateId="knowledge.obsidian.proposals.empty">AI 只会生成待确认提案，不会后台改写 Vault。</EmptyState>}
        </div>
      </div>
      <ConfirmDialog
        confirmLabel={pendingAction?.kind === "conflict" ? "确认覆盖" : "重新选择"}
        description={confirmDescription}
        open={Boolean(pendingAction)}
        title={pendingAction?.kind === "conflict" ? "确认处理同步冲突？" : "确认重新选择 Vault？"}
        onCancel={() => setPendingAction(undefined)}
        onConfirm={confirmPendingAction}
      />
    </Panel>
  );
}
