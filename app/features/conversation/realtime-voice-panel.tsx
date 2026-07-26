"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getProviderModelCatalog } from "../../services/provider-contracts";
import { startRealtimeVoiceSession } from "../../services/realtime-voice-session";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { RealtimeVoiceEvent } from "../../types/domains/voice.ts";
import { ProviderIcon } from "../shared/provider-icon";
import { AppIcon } from "../shared/app-icon";

/** 实时通话浮层只保存运行时对象；结束后仅把最终转写交给对话仓储。 */
export function RealtimeVoicePanel({ connections, onClose, onFinalTranscript }: { connections: ApiConnectionProfile[]; onClose: () => void; onFinalTranscript: (role: "user" | "assistant", text: string) => Promise<void> }) {
  const eligible = useMemo(() => connections.filter((item) => item.capabilities.includes("realtime") && ["openai", "google", "zhipu"].includes(item.provider)), [connections]);
  const [connectionId, setConnectionId] = useState(eligible[0]?.id ?? "");
  const connection = eligible.find((item) => item.id === connectionId);
  const models = connection ? getProviderModelCatalog(connection.provider, "realtime") : [];
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [voiceId, setVoiceId] = useState("alloy");
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [message, setMessage] = useState("选择连接后开始通话");
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const handleRef = useRef<Awaited<ReturnType<typeof startRealtimeVoiceSession>> | null>(null);

  useEffect(() => { if (state !== "connected") return; const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [state]);
  useEffect(() => () => { void handleRef.current?.stop(); }, []);

  async function start() {
    if (!connection || !model || !voiceId) return;
    setState("connecting"); setMessage("正在申请麦克风并建立加密连接…");
    try {
      handleRef.current = await startRealtimeVoiceSession({ connection, model, voiceId, onEvent: (event: RealtimeVoiceEvent) => {
        if (event.type === "connected") { setState("connected"); setMessage("实时通话中"); }
        if (event.type === "interrupted") setMessage("检测到你正在说话，已打断 AI");
        if (event.type === "error") { setState("error"); setMessage(event.message); }
        if (event.type === "transcript" && event.final && event.text.trim()) void onFinalTranscript(event.role, event.text.trim());
      } });
    } catch (reason) { setState("error"); setMessage(reason instanceof Error ? reason.message : "实时通话启动失败"); }
  }

  async function stop() { await handleRef.current?.stop(); handleRef.current = null; onClose(); }
  return <section className="conversation-realtime-panel" role="dialog" aria-modal="true" aria-label="实时语音通话">
    <header><div><span>REALTIME VOICE</span><h2>实时通话</h2></div><button type="button" aria-label="关闭" onClick={() => void stop()}><AppIcon name="close" size={18} /></button></header>
    {!eligible.length ? <p>没有声明实时语音能力的连接，请先到 AI 连接中启用 realtime。</p> : <>
      <label>厂商与连接<select value={connectionId} onChange={(event) => { const nextId = event.currentTarget.value; const next = eligible.find((item) => item.id === nextId); setConnectionId(nextId); setModel(next ? getProviderModelCatalog(next.provider, "realtime")[0]?.id ?? "" : ""); setVoiceId(next?.provider === "google" ? "Kore" : next?.provider === "zhipu" ? "tongtong" : "alloy"); }}>{eligible.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {connection ? <div className="conversation-realtime-provider"><ProviderIcon provider={connection.provider} size={20} /><strong>{connection.label}</strong></div> : null}
      <label>模型<select value={model} onChange={(event) => setModel(event.currentTarget.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>音色<input value={voiceId} onChange={(event) => setVoiceId(event.currentTarget.value)} /></label>
      <p aria-live="polite">{message} · {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</p>
      <div>{state === "idle" || state === "error" ? <button className="ui-button ui-button-primary" type="button" onClick={() => void start()}>开始通话</button> : <><button type="button" disabled={state === "connecting"} onClick={() => { const next = !muted; setMuted(next); handleRef.current?.mute(next); }}>{muted ? "取消静音" : "静音"}</button><button type="button" onClick={() => void stop()}>结束</button></>}</div>
    </>}
  </section>;
}
