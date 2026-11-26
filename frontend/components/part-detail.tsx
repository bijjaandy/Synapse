"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ImageOff, X } from "lucide-react";
import { API_URL } from "@/lib/api";

type Status = { state: string; backbone?: string | null; rotations?: number; strictness?: number; threshold?: number;
                unsure_band?: [number, number]; n_images?: number | null; trained_at?: number; needs_retrain?: boolean };
type Stats = { total: number; counts: Record<"good" | "defective" | "unsure" | "retake", number>; defect_rate: number;
               avg_ms: number; max_ms: number; last: number | null };

const when = (t?: number | null) => (t ? new Date(t * 1000).toLocaleString() : "—");
const photo = (id: string, i: number) => `${API_URL}/objects/${encodeURIComponent(id)}/good/${i}.jpg`;

/** Glass detail panel for one trained part: photos and every number we have about it. */
export function PartDetailPanel({ id, name, open, onClose }: { id: string; name: string; open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const [status, setStatus] = useState<Status | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [main, setMain] = useState(0);
  const [missing, setMissing] = useState<Record<number, boolean>>({});
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setMain(0); setMissing({}); setError(null); setStatus(null); setStats(null);
    Promise.all([fetch(`${API_URL}/objects/${encodeURIComponent(id)}/status`), fetch(`${API_URL}/objects/${encodeURIComponent(id)}/stats`)])
      .then(async ([a, b]) => { if (!a.ok || !b.ok) throw new Error(`server said ${a.status}/${b.status}`); setStatus(await a.json()); setStats(await b.json()); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [id, open]);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog.current) return;  // keep Tab inside the panel
      const items = [...dialog.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const c = stats?.counts;
  const total = stats?.total ?? 0;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  const rows: [string, string][] = status ? [
    ["Status", status.state === "ready" ? "Trained" : status.state],
    ["Model", status.backbone ?? "—"],
    ["Angles checked", String(status.rotations ?? 1)],
    ["Strictness", status.strictness != null ? status.strictness.toFixed(2) : "1.00"],
    ["Decision line", status.threshold != null ? status.threshold.toFixed(3) : "—"],
    ["Unsure band", status.unsure_band ? `${status.unsure_band[0].toFixed(3)} – ${status.unsure_band[1].toFixed(3)}` : "—"],
    ["Good photos", status.n_images != null ? String(status.n_images) : "—"],
    ["Trained", when(status.trained_at)],
    ["Needs retrain", status.needs_retrain ? "Yes: blur check is off" : "No"],
  ] : [];
  const statRows: [string, string][] = stats ? [
    ["Inspections", String(stats.total)],
    ["Defect rate", `${(stats.defect_rate * 100).toFixed(1)}%`],
    ["Average", `${Math.round(stats.avg_ms)} ms`],
    ["Slowest", `${Math.round(stats.max_ms)} ms`],
    ["Last inspected", when(stats.last)],
  ] : [];

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  // portal to <body>: a transformed parent would otherwise clip the fixed backdrop and its stacking
  return createPortal(<AnimatePresence>{open && <motion.div className="glass-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>
    <motion.div ref={dialog} className="glass-panel" role="dialog" aria-modal="true" aria-labelledby="glass-title"
      initial={reduced ? false : { opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 260, damping: 24, duration: reduced ? 0 : undefined }}>
      <button ref={closeBtn} type="button" className="glass-close" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      <h3 id="glass-title">{name}</h3>
      <div className="glass-body">
        <div className="glass-photos">
          <div className="glass-main">{missing[main] ? <div className="glass-placeholder"><ImageOff size={28} /><span>No training photo</span></div>
            : <motion.img layoutId={main === 0 ? `photo-${id}` : undefined} src={photo(id, main)} alt={`${name}: training photo ${main + 1}`} onError={() => setMissing((m) => ({ ...m, [main]: true }))} />}</div>
          <div className="glass-thumbs">{[0, 1, 2, 3].filter((i) => !missing[i]).map((i) => <button key={i} type="button" className={main === i ? "active" : ""} aria-label={`Show training photo ${i + 1}`} aria-pressed={main === i} onClick={() => setMain(i)}>
            <img src={photo(id, i)} alt="" onError={() => setMissing((m) => ({ ...m, [i]: true }))} /></button>)}</div>
        </div>
        <div className="glass-stats">
          {error ? <p className="cam-error" role="alert">Couldn't load the details: {error}</p> : !status || !stats ? <p className="glass-loading">Loading…</p> : <>
            <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <h4>Inspections</h4>
            <div className="glass-mix" role="img" aria-label={`${c?.good ?? 0} good, ${c?.defective ?? 0} defective, ${c?.unsure ?? 0} unsure, ${c?.retake ?? 0} retake`}>
              {total ? (["good", "defective", "unsure", "retake"] as const).map((k) => <span key={k} className={`mix-${k}`} style={{ width: pct(c?.[k] ?? 0) }} />) : <span className="mix-empty" />}
            </div>
            <p className="glass-counts">{(["good", "defective", "unsure", "retake"] as const).map((k) => <span key={k}><i className={`mix-${k}`} />{c?.[k] ?? 0} {k}</span>)}</p>
            <dl>{statRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </>}
        </div>
      </div>
    </motion.div>
  </motion.div>}</AnimatePresence>, document.body);
}
