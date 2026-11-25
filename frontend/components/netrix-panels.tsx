"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, Check, CircleAlert, LoaderCircle, Send, ShieldCheck, X } from "lucide-react";
import { askAssistant, assistantStatus, loadSession, getSummary, getVerifyQueue, heatmapUrl, photoUrl, verifyInspection,
         type ChatMessage, type QueueItem, type Summary } from "@/lib/api";
import { objectCategories } from "@/config/content";

const partName = (id: string) => objectCategories.find((c) => c.id === id)?.name ?? id;

// ---------- human verification ----------

export function VerificationQueue() {
  const { data: queue = [], error, isLoading, mutate } = useSWR<QueueItem[]>("verify-queue", getVerifyQueue, { refreshInterval: 10000 });
  const reducedMotion = useReducedMotion() ?? false;
  return <section className="netrix-card verify-card" aria-labelledby="verify-title">
    <div className="netrix-card-head"><div><h2 id="verify-title">Human verification</h2><p>Unsure and defective results wait here for a QC inspector’s final call. Marking a part good also teaches the model, instantly.</p></div><span className="netrix-count">{queue.length} waiting</span></div>
    {isLoading ? <p className="netrix-muted" role="status">Loading the queue…</p>
      : error ? <p className="netrix-error" role="alert"><CircleAlert size={15} /> {error.message}</p>
      : !queue.length ? <div className="netrix-empty"><ShieldCheck size={20} /><p>Nothing to verify. Unsure or defective results from the dashboard will appear here.</p></div>
      : <div className="verify-list"><AnimatePresence initial={false}>{queue.map((item) =>
        <motion.div key={item.id} layout initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, x: 40 }} transition={{ duration: reducedMotion ? 0 : 0.3 }}>
          <VerifyItem item={item} onDone={() => mutate(queue.filter((q) => q.id !== item.id), { revalidate: true })} />
        </motion.div>)}</AnimatePresence></div>}
  </section>;
}

function VerifyItem({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"good" | "defective" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "good" | "defective") {
    setBusy(decision);
    setError(null);
    try { await verifyInspection(item.id, decision, note); onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(null); }
  }
  return <article className="verify-item">
    <div className="verify-images">
      <figure><img src={photoUrl(item.id)} alt={`Photo of check #${item.id}`} /><figcaption>Photo</figcaption></figure>
      <figure><img src={heatmapUrl(item.id)} alt={`Heatmap of check #${item.id}`} /><figcaption>Where it differs</figcaption></figure>
    </div>
    <div className="verify-info">
      <h3>#{String(item.id).padStart(4, "0")} · {partName(item.object)}</h3>
      <p>Model said <b className={`tag-${item.label}`}>{item.label === "unsure" ? "Unsure" : "Defective"}</b> · score {item.score.toFixed(2)} against a line of {item.threshold.toFixed(2)} · {new Date(item.ts * 1000).toLocaleTimeString([], { hour12: false })}</p>
      <label htmlFor={`note-${item.id}`} className="sr-only">Note</label>
      <input id={`note-${item.id}`} type="text" placeholder="Note (optional), e.g. crack on the rim" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <div className="verify-actions">
        <button type="button" className="verify-defect" disabled={!!busy} onClick={() => decide("defective")}>{busy === "defective" ? <LoaderCircle size={14} /> : <X size={14} />} Confirm defective</button>
        <button type="button" className="verify-good" disabled={!!busy} onClick={() => decide("good")}>{busy === "good" ? <LoaderCircle size={14} /> : <Check size={14} />} Actually good</button>
      </div>
      {error && <p className="netrix-error" role="alert">{error}</p>}
    </div>
  </article>;
}

// ---------- local AI assistant (Ollama) ----------

const SUGGESTIONS = ["How many parts were inspected and how many were defective?", "Which part has the most defects?",
                     "How does Netrix IQ decide a part is defective?", "What are the system's weak spots?"];

export const askPrompt = (id: number) => `Explain inspection #${id}: why did it get this result and what should I check?`;

/** "Ask AI why" for a logged inspection. QC inspectors / supervisors go to Evaluation (?ask=id); operators can't open
 *  Evaluation, but /assistant doesn't need a role, so they get the answer right here. */
export function AskAiButton({ inspectionId }: { inspectionId: number }) {
  const [role, setRole] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRole(loadSession()?.role ?? null); setAnswer(null); }, [inspectionId]);
  if (role === "inspector" || role === "supervisor")
    return <a className="layers-toggle ask-ai" href={`/evaluation?ask=${inspectionId}`}><Bot size={13} /> Ask AI why</a>;
  return <div className="ask-ai-inline">
    <button type="button" className="layers-toggle ask-ai" disabled={busy} onClick={async () => {
      setBusy(true);
      try { setAnswer((await askAssistant(askPrompt(inspectionId), [])).answer); }
      catch (cause) { setAnswer(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }}>{busy ? <LoaderCircle size={13} className="spin" /> : <Bot size={13} />} Ask AI why</button>
    {answer && <p className="ask-ai-answer">{answer}</p>}
  </div>;
}

export function AssistantChat() {
  const { data: status } = useSWR("assistant-status", assistantStatus, { refreshInterval: 15000 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);
  const asked = useRef(false);
  useEffect(() => {  // /evaluation?ask=<id> (from "Ask AI why" on the dashboard): ask about that inspection once
    const id = new URLSearchParams(window.location.search).get("ask");
    if (asked.current || !id || !/^\d+$/.test(id)) return;
    asked.current = true;
    setInput(askPrompt(Number(id)));
    send(askPrompt(Number(id)));
    window.history.replaceState(null, "", window.location.pathname);  // a reload doesn't ask again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages;
    setMessages([...history, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const r = await askAssistant(message, history);
      setMessages((m) => [...m, { role: "assistant", content: r.answer, source: r.source, model: r.model, ms: r.ms }]);
    } catch (cause) {
      setMessages((m) => [...m, { role: "assistant", content: cause instanceof Error ? cause.message : String(cause), source: "error" }]);
    } finally { setBusy(false); }
  }

  const state = !status ? "Checking the local AI…" : !status.ollama ? "Local AI not running: basic offline answers only. Start Ollama for full answers."
    : !status.model_installed ? `Ollama is running but ${status.model} isn’t installed: run “ollama pull ${status.model}”.` : `Local AI: ${status.model}, running on this laptop`;
  return <section className="netrix-card chat-card" aria-labelledby="chat-title">
    <div className="netrix-card-head"><div><h2 id="chat-title"><Bot size={18} /> Ask Netrix</h2><p>Questions about today’s inspections, a check by number (e.g. “why was #12 flagged?”), or how the system works. Answers come only from this laptop’s data.</p></div></div>
    <p className={`chat-status ${status?.ollama && status.model_installed ? "ok" : "warn"}`}>{state}</p>
    <div className="chat-list" ref={list} aria-live="polite">
      {!messages.length && <div className="chat-suggestions">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>}
      {messages.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}><p>{m.content}</p>{m.role === "assistant" && m.source && m.source !== "error" && <small>{m.source === "ollama" ? `${m.model} · ${(m.ms ?? 0) / 1000}s` : "offline answer"}</small>}</div>)}
      {busy && <div className="chat-msg assistant"><p><LoaderCircle size={14} className="spin" /> Thinking on this laptop…</p></div>}
    </div>
    <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
      <label htmlFor="chat-q" className="sr-only">Your question</label>
      <input id="chat-q" type="text" value={input} placeholder="Ask about inspections…" maxLength={500} onChange={(e) => setInput(e.target.value)} disabled={busy} />
      <button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send size={15} /></button>
    </form>
  </section>;
}

// ---------- summary ----------

export function SummaryView() {
  const { data: s, error, isLoading } = useSWR<Summary>("summary", getSummary, { refreshInterval: 10000 });
  const reducedMotion = useReducedMotion() ?? false;
  if (isLoading) return <p className="netrix-muted" role="status">Loading the summary…</p>;
  if (error || !s) return <p className="netrix-error" role="alert"><CircleAlert size={15} /> {error?.message ?? "No summary available."}</p>;
  const pct = (n: number) => (s.total ? `${((n / s.total) * 100).toFixed(1)}%` : "0%");
  const kpis: [number | string, string, string][] = [
    [s.total, "parts evaluated", ""], [s.counts.good, "good", pct(s.counts.good)], [s.counts.defective, "defective", pct(s.counts.defective)],
    [s.counts.unsure, "sent to a person", pct(s.counts.unsure)], [s.counts.retake, "photo retakes", pct(s.counts.retake)],
    [s.verification.pending, "waiting for verification", ""],
  ];
  return <div className="summary-view">
    <div className="summary-kpis">{kpis.map(([n, label, sub], i) => <motion.div key={label} className="netrix-card kpi" initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : i * 0.06 }}><strong>{n}</strong><span>{label}</span>{sub && <small>{sub}</small>}</motion.div>)}</div>
    <div className="summary-grid">
      <section className="netrix-card"><h2>By part</h2>
        {!s.by_object.length ? <p className="netrix-muted">No inspections yet.</p> : <table className="summary-table"><thead><tr><th>Part</th><th>Total</th><th>Result mix</th><th>Defective</th></tr></thead><tbody>
          {s.by_object.map((o) => <tr key={o.object}><td>{partName(o.object)}</td><td>{o.total}</td><td><div className="mix-bar" role="img" aria-label={`${o.good} good, ${o.defective} defective, ${o.unsure} unsure, ${o.retake} retakes`}>{(["good", "defective", "unsure", "retake"] as const).map((k) => o[k] ? <span key={k} className={`mix-${k}`} style={{ width: `${(o[k] / o.total) * 100}%` }} /> : null)}</div></td><td>{o.defective} ({((o.defective / o.total) * 100).toFixed(0)}%)</td></tr>)}
        </tbody></table>}
        <p className="mix-legend"><span className="mix-good" /> good <span className="mix-defective" /> defective <span className="mix-unsure" /> unsure <span className="mix-retake" /> retake</p>
      </section>
      <section className="netrix-card"><h2>People in the loop</h2>
        <dl className="summary-dl">
          <div><dt>Verified by a QC inspector</dt><dd>{s.verification.verified}</dd></div>
          <div><dt>Confirmed defective</dt><dd>{s.verification.confirmed_defective}</dd></div>
          <div><dt>Overturned to good (model learned)</dt><dd>{s.verification.overturned_to_good}</dd></div>
          <div><dt>Operator “actually good” clicks</dt><dd>{s.operator_corrections}</dd></div>
        </dl>
        <h2 style={{ marginTop: 22 }}>Speed</h2>
        <dl className="summary-dl">
          <div><dt>Average per photo</dt><dd>{s.avg_ms} ms</dd></div>
          <div><dt>Slowest photo</dt><dd>{s.max_ms} ms <small className={s.max_ms < 1000 ? "ok" : "bad"}>{s.max_ms < 1000 ? "within the 1 s limit" : "over the 1 s limit"}</small></dd></div>
          <div><dt>Period</dt><dd>{s.first ? `${new Date(s.first * 1000).toLocaleString()} to ${new Date((s.last ?? s.first) * 1000).toLocaleString()}` : "—"}</dd></div>
        </dl>
      </section>
    </div>
  </div>;
}
