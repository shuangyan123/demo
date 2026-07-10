"use client";

import { useState, type FormEvent } from "react";
import { mcpSettingsRepository, type McpSettingsSnapshot } from "../../services/mcp-settings-repository.ts";
import type { McpServerProfile } from "../../types/review";
import { Button, Chip, EmptyState } from "../shared/ui-primitives";

type McpForm = {
  id?: string;
  label: string;
  endpoint: string;
  enabled: boolean;
};

const emptyForm: McpForm = { label: "本地 MCP Bridge", endpoint: "http://127.0.0.1:8765/mcp", enabled: true };

export function McpSettingsView({ onNotice }: { onNotice: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<McpSettingsSnapshot>(() => mcpSettingsRepository.load());
  const [form, setForm] = useState<McpForm>(emptyForm);

  function refresh() {
    setSnapshot(mcpSettingsRepository.load());
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = mcpSettingsRepository.saveProfile(form);
    setForm({ ...profile });
    refresh();
    onNotice("MCP 配置已保存");
  }

  function edit(profile: McpServerProfile) {
    setForm({ id: profile.id, label: profile.label, endpoint: profile.endpoint, enabled: profile.enabled });
  }

  function test(profile: McpServerProfile) {
    const result = mcpSettingsRepository.testProfile(profile);
    refresh();
    onNotice(result.message);
  }

  function remove(profile: McpServerProfile) {
    mcpSettingsRepository.removeProfile(profile.id);
    if (form.id === profile.id) setForm(emptyForm);
    refresh();
    onNotice("MCP 配置已删除");
  }

  return (
    <section>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">MCP</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          单独管理 MCP server。这里只保存 endpoint、启用状态和探测摘要，不保存工具调用内容，也不会自动写入文件、Vault 或数据库。
        </p>
      </header>

      <div className="mt-7 grid grid-cols-[minmax(0,0.9fr)_minmax(20rem,1.1fr)] gap-8 max-xl:grid-cols-1">
        <form className="grid gap-4" onSubmit={save}>
          <h2 className="text-lg font-semibold">{form.id ? "编辑 MCP Server" : "新增 MCP Server"}</h2>
          <label className="ui-field">
            名称
            <input className="ui-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} />
          </label>
          <label className="ui-field">
            Endpoint
            <input className="ui-input" placeholder="http://127.0.0.1:8765/mcp" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.currentTarget.value })} />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input checked={form.enabled} className="ui-checkbox" type="checkbox" onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} />
            启用
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary">保存</Button>
            {form.id ? <Button type="button" variant="ghost" onClick={() => setForm(emptyForm)}>新建</Button> : null}
          </div>
        </form>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Server</h2>
            <span className="text-sm text-muted">{snapshot.profiles.length} 个</span>
          </div>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {snapshot.profiles.length ? snapshot.profiles.map((profile) => {
              const discovery = snapshot.discovery[profile.id];
              return (
                <article key={profile.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <button className="min-w-0 text-left" type="button" onClick={() => edit(profile)}>
                      <span className="flex items-center gap-2">
                        <strong className="truncate text-sm">{profile.label}</strong>
                        <Chip tone={profile.enabled ? "green" : "neutral"}>{profile.enabled ? "启用" : "停用"}</Chip>
                        <Chip tone={discovery?.status === "ready" ? "blue" : discovery?.status === "error" ? "red" : "neutral"}>{discovery?.status ?? "未测试"}</Chip>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">{profile.endpoint}</span>
                      {discovery ? <span className="mt-1 block text-xs text-muted">Tools {discovery.tools.length} / Resources {discovery.resources.length} / Prompts {discovery.prompts.length}</span> : null}
                    </button>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => test(profile)}>测试</Button>
                      <Button size="sm" variant="ghost" onClick={() => edit(profile)}>编辑</Button>
                      <Button size="sm" variant="danger" onClick={() => remove(profile)}>删除</Button>
                    </div>
                  </div>
                  {discovery ? <p className="mt-2 text-xs leading-5 text-muted">{discovery.message}</p> : null}
                </article>
              );
            }) : <div className="py-4"><EmptyState>还没有 MCP server。添加一个 endpoint 后可以先做本地探测。</EmptyState></div>}
          </div>
        </section>
      </div>
    </section>
  );
}
