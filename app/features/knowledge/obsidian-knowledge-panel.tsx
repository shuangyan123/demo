"use client";

import { useState } from "react";
import { Button, Chip, ConfirmDialog, EmptyState, Panel, SoftBlock, TextField } from "../shared/ui-primitives";
import type { useObsidianKnowledgeBridge } from "./use-obsidian-knowledge-bridge";

type ObsidianController = ReturnType<typeof useObsidianKnowledgeBridge>;
type PendingAction =
  | { kind: "conflict"; path: string; choice: "vault" | "app" }
  | { kind: "reselect" };

const PERMISSION_LABELS = { granted: "已授权", prompt: "待授权", denied: "未授权", unsupported: "不支持" } as const;

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

  // 确认后才执行覆盖或换库动作，避免误触直接修改本地文件。
  const confirmPendingAction = () => {
    const action = pendingAction;
    setPendingAction(undefined);
    if (!action) return;
    if (action.kind === "conflict") void controller.resolveConflict(action.path, action.choice);
    else void controller.connect(snapshot.managedRoot || managedRoot);
  };

  return (
    <Panel title="Obsidian 知识图谱" eyebrow="Vault Bridge">
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
          <Chip>权限 {PERMISSION_LABELS[snapshot.permission]}</Chip>
          <Chip>映射 {snapshot.mappedCount}</Chip>
          <Chip tone={snapshot.conflictCount ? "red" : "green"}>冲突 {snapshot.conflictCount}</Chip>
          <Chip tone={snapshot.pendingProposalCount ? "yellow" : "blue"}>待确认 {snapshot.pendingProposalCount}</Chip>
          {snapshot.lastSyncedAt ? <Chip>上次同步 {new Date(snapshot.lastSyncedAt).toLocaleString("zh-CN")}</Chip> : null}
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
          {controller.pendingProposals.length ? controller.pendingProposals.map((proposal) => (
            <article key={proposal.id} className="ui-card ui-card-muted p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex flex-wrap gap-2"><Chip tone="blue">{proposal.mode}</Chip><Chip>{proposal.category}</Chip><Chip>置信度 {Math.round(proposal.confidence * 100)}%</Chip></div><strong className="mt-2 block">{proposal.title}</strong><p className="mt-1 text-sm leading-6 text-muted">{proposal.reason}</p></div>
                <div className="flex gap-2"><Button disabled={controller.busy} size="sm" type="button" variant="primary" onClick={() => void controller.acceptProposal(proposal.id)}>确认写入</Button><Button disabled={controller.busy} size="sm" type="button" variant="ghost" onClick={() => void controller.rejectProposal(proposal.id)}>忽略</Button></div>
              </div>
              {proposal.content ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{proposal.content}</p> : null}
              {proposal.proposedLinks.length ? <p className="mt-2 text-xs text-muted">建议双链：{proposal.proposedLinks.join("、")}</p> : null}
            </article>
          )) : <EmptyState>AI 只会生成待确认提案，不会后台改写 Vault。</EmptyState>}
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
