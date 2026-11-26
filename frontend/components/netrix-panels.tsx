"use client";
import { toast } from "@/lib/toast";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, Check, CircleAlert, LoaderCircle, Send, ShieldCheck, Square, X } from "lucide-react";
import { askAssistant, assistantStatus, loadSession, getSummary, getVerifyQueue, gridUrl, heatmapUrl, photoUrl, verifyInspection,
         type ChatMessage, type QueueItem, type Summary, getInspectionTimes } from "@/lib/api";
import { objectCategories } from "@/config/content";
import { useLang, useVoice } from "@/lib/voice";
import { heatOverlayUrl } from "@/lib/heatmaps";

const partName = (id: string) => objectCategories.find((c) => c.id === id)?.name ?? id;

// ---------- human verification ----------

/** An image that shows a quiet placeholder when the file isn't there (older checks were logged without the photo). */
function SafeImg({ src, alt }: { src: string; alt: string }) {
  const [missing, setMissing] = useState(false);
  return missing ? <div className="img-missing" role="img" aria-label={`${alt}: not saved`}><span>Not saved for this check</span></div>
    : <img src={src} alt={alt} onError={() => setMissing(true)} />;
}

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

/** Photo + "where it differs" drawn with the same overlay as Inspect (clear where the part looks good).
 *  Older checks without a stored photo show their saved heatmap full width; without a grid, the saved heatmap image. */
function VerifyImages({ item }: { item: QueueItem }) {
  const [overlay, setOverlay] = useState<string | null>(null);
  useEffect(() => {
    if (!item.has_photo || !item.has_grid) return;
    let live = true;
    fetch(gridUrl(item.id)).then((r) => (r.ok ? r.json() : null)).then((g: { grid: number[]; n: number } | null) => {
      if (live && g?.grid?.length) setOverlay(heatOverlayUrl(g.grid, g.n, { size: 384 }));
    }).catch(() => { /* keep the saved heatmap */ });
    return () => { live = false; };
  }, [item.id, item.has_photo, item.has_grid]);
  if (item.has_photo === false)
    return <div className="verify-images single"><figure><SafeImg src={heatmapUrl(item.id)} alt={`Heatmap of check #${item.id}`} /><figcaption>Where it differs · photo not stored for this older check</figcaption></figure></div>;
  return <div className="verify-images">
    <figure><SafeImg src={photoUrl(item.id)} alt={`Photo of check #${item.id}`} /><figcaption>Photo</figcaption></figure>
    <figure>{overlay ? <div className="verify-overlay"><img src={photoUrl(item.id)} alt={`Check #${item.id} with the areas that differ highlighted`} /><img src={overlay} alt="" aria-hidden="true" className="verify-heat" /></div>
      : <SafeImg src={heatmapUrl(item.id)} alt={`Heatmap of check #${item.id}`} />}<figcaption>Where it differs</figcaption></figure>
  </div>;
}

function VerifyItem({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"good" | "defective" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "good" | "defective") {
    setBusy(decision);
    setError(null);
    try { await verifyInspection(item.id, decision, note); toast(decision === "defective" ? `#${item.id} confirmed defective` : `#${item.id} verified as good`); onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(null); }
  }
  return <article className="verify-item">
    <VerifyImages item={item} />
    <div className="verify-info">
      <h3>#{String(item.id).padStart(4, "0")} · {item.display_name ?? partName(item.object)}</h3>
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
export function AskAiButton({ inspectionId, compact = false }: { inspectionId: number; compact?: boolean }) {
  const [lang] = useLang();
  const voice = useVoice();
  const [role, setRole] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRole(loadSession()?.role ?? null); setAnswer(null); }, [inspectionId]);
  if (role === "inspector" || role === "supervisor")
    return <a className={compact ? "tool-button ask-ai" : "layers-toggle ask-ai"} href={`/evaluation?ask=${inspectionId}`} title="Ask AI why (opens Evaluation)" aria-label="Ask AI why"><Bot size={compact ? 15 : 13} />{compact ? null : " Ask AI why"}</a>;
  return <div className={`ask-ai-inline ${compact ? "compact" : ""}`}>
    <button type="button" className={compact ? "tool-button ask-ai" : "layers-toggle ask-ai"} title="Ask AI why" aria-label="Ask AI why" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const a = (await askAssistant(askPrompt(inspectionId), [], lang)).answer; setAnswer(a); voice.sayAnswer(a); }
      catch (cause) { setAnswer(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }}>{busy ? <LoaderCircle size={13} className="spin" /> : <Bot size={compact ? 15 : 13} />}{compact ? null : " Ask AI why"}</button>
    {answer && <div className="ask-ai-popover"><p className="ask-ai-answer">{answer}</p><button type="button" className="ask-ai-close" aria-label="Close the answer" onClick={() => { setAnswer(null); voice.stop(); }}>×</button></div>}
    {!compact && voice.speaking && <button type="button" className="layers-toggle stop-speaking" onClick={voice.stop}><Square size={11} /> Stop</button>}
  </div>;
}

export function AssistantChat() {
  const [lang] = useLang();
  const voice = useVoice();
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
    send(askPrompt(Number(id)), true);  // this answer is read aloud; typed chat is not
    window.history.replaceState(null, "", window.location.pathname);  // a reload doesn't ask again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string, readAloud = false) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages;
    setMessages([...history, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const r = await askAssistant(message, history, lang);
      setMessages((m) => [...m, { role: "assistant", content: r.answer, source: r.source, model: r.model, ms: r.ms }]);
      if (readAloud) voice.sayAnswer(r.answer);
    } catch (cause) {
      setMessages((m) => [...m, { role: "assistant", content: cause instanceof Error ? cause.message : String(cause), source: "error" }]);
    } finally { setBusy(false); }
  }

  const state = !status ? "Checking the local AI…" : !status.ollama ? "Local AI not running: basic offline answers only. Start Ollama for full answers."
    : !status.model_installed ? `Ollama is running but ${status.model} isn’t installed: run “ollama pull ${status.model}”.` : `Local AI: ${status.model}, running on this laptop`;
  return <section className="netrix-card chat-card" aria-labelledby="chat-title">
    <div className="netrix-card-head"><div><h2 id="chat-title"><Bot size={18} /> Ask Netrix</h2><p>Questions about today’s inspections, a check by number (e.g. “why was #12 flagged?”), or how the system works. Answers come only from this laptop’s data.</p></div></div>
    <p className={`chat-status ${status?.ollama && status.model_installed ? "ok" : "warn"}`}>{state}</p>
    {voice.speaking && <button type="button" className="layers-toggle stop-speaking" onClick={voice.stop}><Square size={11} /> Stop reading</button>}
    <div className="chat-list" ref={list} aria-live="polite">
      {!messages.length && <div className="chat-suggestions">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>}
      {messages.map((m, i) => <motion.div key={i} layout className={`chat-msg ${m.role}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}><p>{m.content}</p>{m.role === "assistant" && m.source && m.source !== "error" && <small>{m.source === "ollama" ? `${m.model} · ${(m.ms ?? 0) / 1000}s` : "offline answer"}</small>}</motion.div>)}
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

/** Number that counts up from 0 (or from its last value) when it changes; reduced motion shows it at once. */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) { setShown(value); from.current = value; return; }
    const start = from.current, t0 = performance.now(), dur = 600;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * e));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <>{shown}</>;
}

/** Inspections per hour over the last 24 hours: a tiny SVG line, no chart library. */
function Sparkline() {
  const { data: times = [] } = useSWR("inspection-times-24h", () => getInspectionTimes(24), { refreshInterval: 30000 });
  const reduced = useReducedMotion() ?? false;
  const now = Date.now() / 1000;
  const buckets = Array.from({ length: 24 }, (_, i) => times.filter((t) => t > now - (24 - i) * 3600 && t <= now - (23 - i) * 3600).length);
  const max = Math.max(1, ...buckets);
  const pts = buckets.map((n, i) => [(i / 23) * 300, 54 - (n / max) * 46] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const peak = buckets.indexOf(max);
  return <section className="netrix-card sparkline-card" aria-label="Inspections per hour, last 24 hours">
    <div className="sparkline-head"><h2>Inspections per hour</h2><span>last 24 h · {times.length} total · busiest {max}/h</span></div>
    <svg viewBox="0 0 300 60" className="sparkline" preserveAspectRatio="none" role="img" aria-label={`Per hour, oldest first: ${buckets.join(", ")}`}>
      <defs><linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6B8E7B" stopOpacity=".35" /><stop offset="100%" stopColor="#6B8E7B" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L300,60 L0,60 Z`} fill="url(#spark-fill)" />
      <motion.path d={line} fill="none" stroke="#243B35" strokeWidth="2" vectorEffect="non-scaling-stroke" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : 0.45 }} />
      {times.length > 0 && <circle cx={pts[peak][0]} cy={pts[peak][1]} r="3" fill="#E0B341" />}
    </svg>
    <div className="sparkline-axis"><span>24 h ago</span><span>now</span></div>
  </section>;
}

export function SummaryView() {
  const { data: s, error, isLoading } = useSWR<Summary>("summary", getSummary, { refreshInterval: 10000 });
  const reducedMotion = useReducedMotion() ?? false;
  if (isLoading) return <p className="netrix-muted" role="status">Loading the summary…</p>;
  if (error || !s) return <p className="netrix-error" role="alert"><CircleAlert size={15} /> {error?.message ?? "No summary available."}</p>;
  const pct = (n: number) => (s.total ? `${((n / s.total) * 100).toFixed(1)}%` : "0%");
  const kpis: [number | string, string, string][] = [
    [s.total, "parts evaluated (all time)", ""], [s.counts.good, "good", pct(s.counts.good)], [s.counts.defective, "defective", pct(s.counts.defective)],
    [s.counts.unsure, "marked unsure", pct(s.counts.unsure)], [s.counts.retake, "photo retakes", pct(s.counts.retake)],
    [s.verification.pending, "waiting for verification", "unsure + defective, not yet checked"],
  ];
  return <div className="summary-view">
    <div className="summary-kpis">{kpis.map(([n, label, sub], i) => <motion.div key={label} className="netrix-card kpi" initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : i * 0.06 }}><strong>{typeof n === "number" ? <CountUp value={n} /> : n}</strong><span>{label}</span>{sub && <small>{sub}</small>}</motion.div>)}</div>
    <Sparkline />
    <div className="summary-grid">
      <section className="netrix-card"><h2>By part</h2>
        {!s.by_object.length ? <p className="netrix-muted">No inspections yet.</p> : <table className="summary-table"><thead><tr><th>Part</th><th>Total</th><th>Result mix</th><th>Defective</th></tr></thead><tbody>
          {s.by_object.map((o) => <tr key={o.object}><td>{o.display_name ?? partName(o.object)}</td><td>{o.total}</td><td><div className="mix-bar" role="img" aria-label={`${o.good} good, ${o.defective} defective, ${o.unsure} unsure, ${o.retake} retakes`}>{(["good", "defective", "unsure", "retake"] as const).map((k) => o[k] ? <motion.span key={k} className={`mix-${k}`} style={{ width: `${(o[k] / o.total) * 100}%`, originX: 0 }} initial={reducedMotion ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }} /> : null)}</div></td><td>{o.defective} ({((o.defective / o.total) * 100).toFixed(0)}%)</td></tr>)}
        </tbody></table>}
        <p className="mix-legend">{(["good", "defective", "unsure", "retake"] as const).map((k) => <span key={k}><i className={`mix-${k}`} aria-hidden="true" />{k}</span>)}</p>
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
          <div><dt>Average per photo</dt><dd>{Math.round(s.avg_ms)} ms</dd></div>
          <div><dt>Slowest photo</dt><dd>{Math.round(s.max_ms)} ms <small className={s.max_ms < 1000 ? "ok" : "bad"}>{s.max_ms < 1000 ? "within the 1 s limit" : "over the 1 s limit"}</small></dd></div>
          <div><dt>Period</dt><dd>{s.first ? `${new Date(s.first * 1000).toLocaleString()} to ${new Date((s.last ?? s.first) * 1000).toLocaleString()}` : "—"}</dd></div>
        </dl>
      </section>
    </div>
  </div>;
}
