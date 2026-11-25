"use client";

import { whereWords } from "@/lib/voice";
import { PartDetailPanel } from "@/components/part-detail";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { AlertCircle, Check, Clock3, FolderOpen, LoaderCircle, RefreshCw, Trash2, Upload, Wifi, WifiOff, Gauge } from "lucide-react";
import { deleteObject, evaluateTestSet, loadSession, type EvaluationResult, type ObjectTrainingStatus, setStrictness, STRICTNESS_MIN, STRICTNESS_MAX, inspect } from "@/lib/api";
import { evaluationCopy, limitationCopy, limitationTitle, limitationsEyebrow, measuredLabel, objectCategories, objectViewCopy, projectTargets, projectTargetsLabel, runtimeIndicatorLabel, runtimeOfflineLabel, runtimeOnlineLabel, runtimeStatusCopy, runtimeTargetCopy, runtimeTargetLabel, sampleDataLabel } from "@/config/content";

const mono = "font-mono";

export function ProjectTargetsStrip() {
  return <div className="project-targets" aria-label="Project targets">
    <div className="project-targets-heading"><span className="eyebrow">{projectTargetsLabel}</span><span className="sample-badge">MEASURED ON MVTEC AD</span></div>
    <div className="project-target-grid">{projectTargets.map((item, index) => <div className="project-target" key={item.id}><span className={`${mono} project-target-index`}>0{index + 1}</span><strong>{item.target}</strong><span className={`${mono} measured-slot`}>{measuredLabel} <b>{item.measured}</b></span></div>)}</div>
  </div>;
}

export function EvaluationPanel({ objectId, objectName, active }: { objectId: string; objectName: string; active: boolean }) {
  const [goodFiles, setGoodFiles] = useState<File[]>([]);
  const [defectiveFiles, setDefectiveFiles] = useState<File[]>([]);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const goodFolder = useRef<HTMLInputElement>(null);
  const defectiveFolder = useRef<HTMLInputElement>(null);

  async function runEvaluation() {
    if (!goodFiles.length || !defectiveFiles.length || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await evaluateTestSet(objectId, goodFiles, defectiveFiles, (done, total) => setProgress([done, total])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : evaluationCopy.error);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return <div className="evaluation-panel" role="tabpanel" id="evaluation-panel" aria-labelledby="evaluation-tab" hidden={!active}>
    <div className="panel-intro"><div><h3>{evaluationCopy.title}</h3><p>{evaluationCopy.description}</p></div><span className="sample-badge">{evaluationCopy.backendBadge}</span></div>
    <p className="evaluation-instruction">Testing the trained <b>{objectName}</b> model. {evaluationCopy.instruction}</p>
    <div className="evaluation-folders">
      <input ref={goodFolder} className="sr-only" type="file" aria-label={evaluationCopy.goodFolder} accept="image/*" multiple {...({ webkitdirectory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { setGoodFiles(Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"))); setResult(null); setError(null); }} />
      <input ref={defectiveFolder} className="sr-only" type="file" aria-label={evaluationCopy.defectiveFolder} accept="image/*" multiple {...({ webkitdirectory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { setDefectiveFiles(Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"))); setResult(null); setError(null); }} />
      <button type="button" className="folder-picker" onClick={() => goodFolder.current?.click()}><FolderOpen size={18} /><span><strong>{evaluationCopy.goodFolder}</strong><small>{goodFiles.length ? evaluationCopy.selectedImages(goodFiles.length) : evaluationCopy.chooseGoodFolder}</small></span><Upload size={15} /></button>
      <button type="button" className="folder-picker" onClick={() => defectiveFolder.current?.click()}><FolderOpen size={18} /><span><strong>{evaluationCopy.defectiveFolder}</strong><small>{defectiveFiles.length ? evaluationCopy.selectedImages(defectiveFiles.length) : evaluationCopy.chooseDefectiveFolder}</small></span><Upload size={15} /></button>
    </div>
    <button type="button" className="run-inspection evaluation-run" onClick={runEvaluation} disabled={!goodFiles.length || !defectiveFiles.length || loading}>{loading ? <><LoaderCircle size={16} /> {evaluationCopy.runningButton}{progress ? ` ${progress[0]} / ${progress[1]}` : ""}</> : <>{evaluationCopy.runButton} <Check size={15} /></>}</button>
    {loading ? <div className="evaluation-state" role="status"><span className="state-skeleton" /><span className="state-skeleton short" /></div> : error ? <div className="evaluation-state error-state" role="alert"><AlertCircle size={17} /><p>{error}</p></div> : result ? <div className="confusion-summary"><h4>{evaluationCopy.summaryTitle}</h4><table><thead><tr><th>{evaluationCopy.outcomeColumn}</th><th>{evaluationCopy.countColumn}</th></tr></thead><tbody><tr><td>{evaluationCopy.correct}</td><td>{result.correct}</td></tr><tr><td>{evaluationCopy.missedDefects}</td><td>{result.missedDefects}</td></tr><tr><td>{evaluationCopy.falseAlarms}</td><td>{result.falseAlarms}</td></tr><tr><td>Accuracy</td><td>{result.total ? `${((result.correct / result.total) * 100).toFixed(1)}%` : "—"}</td></tr><tr><td>Sent to a person (unsure)</td><td>{result.sentToPerson}</td></tr><tr><td>Photo retakes</td><td>{result.retakes}</td></tr></tbody></table><p className={`${mono} run-time`}>RUN {result.runId} · {result.ranAt}</p></div> : <div className="evaluation-empty"><Clock3 size={19} /><p>{evaluationCopy.empty}</p></div>}
  </div>;
}

/** Two-step remove (no browser dialog): first click asks, second click removes. */
function RemovePart({ id, name, onRemoved }: { id: string; name: string; onRemoved?: () => void }) {
  const [step, setStep] = useState<"idle" | "ask" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setStep("busy"); setErr(null);
    try { await deleteObject(id); onRemoved?.(); setStep("idle"); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStep("ask"); }
  };
  return <div className="remove-part">
    {step === "idle" ? <button type="button" className="remove-part-btn" onClick={() => setStep("ask")}><Trash2 size={12} /> Remove part</button>
      : <span className="remove-part-ask">Remove {name}? History stays.
          <button type="button" className="remove-part-yes" disabled={step === "busy"} onClick={go}>{step === "busy" ? "Removing…" : "Remove"}</button>
          <button type="button" className="remove-part-no" disabled={step === "busy"} onClick={() => setStep("idle")}>Keep</button></span>}
    {err && <small className="remove-part-err">{err}</small>}
  </div>;
}

export function ObjectLibraryPanel({ statuses, loading, error, active, onChanged }: { statuses: ObjectTrainingStatus[]; loading: boolean; error?: Error; active: boolean; onChanged?: () => void }) {
  const [canRemove, setCanRemove] = useState(false);
  useEffect(() => { const s = loadSession(); setCanRemove(!!s && (s.role === "inspector" || s.role === "supervisor")); }, []);
  // glass detail panel: hover (desktop, after a short pause), click / tap, or Enter on a focused trained card
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const openDetail = (el: HTMLElement, id: string, name: string) => { opener.current = el; setDetail({ id, name }); };
  const closeDetail = () => { setDetail(null); const el = opener.current; window.setTimeout(() => el?.focus(), 0); };
  const fromControl = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, button, a, select, label, textarea");
  const cardProps = (status: ObjectTrainingStatus) => status.status !== "Trained" ? {} : {
    tabIndex: 0, "aria-haspopup": "dialog" as const, "aria-label": `${status.objectName}: open details`, "data-detail": "1",
    onClick: (event: React.MouseEvent<HTMLElement>) => { if (!fromControl(event.target)) openDetail(event.currentTarget, status.objectId, status.objectName); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); openDetail(event.currentTarget, status.objectId, status.objectName); } },
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => { if (!canHover() || detail) return; const el = event.currentTarget; hoverTimer.current = window.setTimeout(() => openDetail(el, status.objectId, status.objectName), 700); },
    onMouseLeave: () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); hoverTimer.current = null; },
  };
  return <div className="object-library-panel" role="tabpanel" id="objects-panel" aria-labelledby="objects-tab" hidden={!active}>
    <div className="panel-intro"><div><h3>{objectViewCopy.title}</h3><p>{objectViewCopy.description}</p></div><span className="sample-badge">{objectViewCopy.sampleBadge}</span></div>
    {loading ? <div className="object-status-grid" aria-label="Loading object status">{objectCategories.map((item) => <div className="object-status-card status-skeleton" key={item.id}><span /><span /><span /></div>)}</div> : error ? <div className="evaluation-state error-state" role="alert"><AlertCircle size={17} /><p>{objectViewCopy.error}</p></div> : statuses.length === 0 ? <div className="evaluation-empty"><p>{objectViewCopy.empty}</p></div> : <div className="object-status-grid">{statuses.map((status) => {
      const category = objectCategories.find((item) => item.id === status.objectId);
      return <article className={`object-status-card ${status.status === "Trained" ? "has-detail" : ""}`} key={status.objectId} {...cardProps(status)}><div className="object-status-head"><span className={`${mono} object-code`}>{category?.code ?? "CUS"}</span>{status.backbone && <span className={`${mono} object-code`}>{status.backbone}</span>}</div><h4>{status.objectName}</h4><span className={`object-status-badge ${status.status === "Trained" ? "trained" : "not-trained"}`}>{status.status}</span><p>{status.status === "Trained" ? (status.goodImageCount != null ? objectViewCopy.trainedImages(status.goodImageCount) : objectViewCopy.imageCountUnavailable) : status.status === "Not trained" ? objectViewCopy.untrainedImages : status.status}</p><small className={mono}>{objectViewCopy.lastTrained} · {status.lastTrainedAt ? new Date(status.lastTrainedAt).toLocaleString() : "—"}</small>{status.needsRetrain && <span className="retrain-badge" title="Trained before the current blur check. Retrain with the same photos to turn it back on."><RefreshCw size={11} /> Retrain recommended: blur check is off</span>}{status.status === "Trained" && <StrictnessControl id={status.objectId} value={status.strictness ?? 1} canEdit={canRemove} onSaved={onChanged} />}{canRemove && status.status !== "Not trained" && status.status !== "Training" && <RemovePart id={status.objectId} name={status.objectName} onRemoved={onChanged} />}</article>;
    })}</div>}
    <p className="object-state-note">{objectViewCopy.demoNote}</p>
    <PartDetailPanel id={detail?.id ?? ""} name={detail?.name ?? ""} open={!!detail} onClose={closeDetail} />
  </div>;
}

/** Per-part strictness. Inspectors/supervisors drag (saved on release); operators see the value. */
function StrictnessControl({ id, value, canEdit, onSaved }: { id: string; value: number; canEdit: boolean; onSaved?: () => void }) {
  const [v, setV] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setV(value); }, [value]);
  const word = (x: number) => (x < 0.97 ? "Lenient" : x > 1.03 ? "Strict" : "Normal");
  const pct = (x: number) => `${((x - STRICTNESS_MIN) / (STRICTNESS_MAX - STRICTNESS_MIN)) * 100}%`;
  async function save() {
    if (Math.abs(v - value) < 1e-6) return;
    setState("saving"); setError(null);
    try { await setStrictness(id, v); setState("saved"); onSaved?.(); }
    catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : String(cause)); setV(value); }
  }
  if (!canEdit) return <p className="strictness-readonly"><Gauge size={13} /> Strictness <b>{word(value)} {value.toFixed(2)}</b> <small>(set by QC)</small></p>;
  return <div className="strictness">
    <label htmlFor={`strict-${id}`}><Gauge size={13} /> Strictness <b>{word(v)} {v.toFixed(2)}</b>{state === "saving" ? <small> saving…</small> : state === "saved" ? <small> saved</small> : null}</label>
    <input id={`strict-${id}`} type="range" min={STRICTNESS_MIN} max={STRICTNESS_MAX} step={0.05} value={v}
      onChange={(event) => { setV(Number(event.target.value)); setState("idle"); }}
      onPointerUp={save} onKeyUp={save} onBlur={save} />
    <div className="strictness-scale" aria-hidden="true"><span style={{ left: 0 }}>Lenient 0.8</span><span style={{ left: pct(1) }}>Normal 1.0</span><span style={{ right: 0 }}>Strict 1.25</span></div>
    <small className="strictness-note">Lenient = fewer false alarms. Strict = fewer missed defects.</small>
    {error && <small className="cam-error" role="alert">{error}</small>}
  </div>;
}

type JudgeRow = { file: string; url: string; verdict: string; label: string; score: number; threshold: number; ratio: number; ms: number; where: string; reasons: string };
const JUDGE_COLUMNS = ["file", "label", "score", "threshold", "ratio", "ms", "where", "reasons"] as const;
const VERDICT_ORDER: Record<string, number> = { Defective: 0, Unsure: 1, Retake: 2, Good: 3 };

/** Judge test mode: a folder of unlabelled photos -> verdict per photo (not logged), sortable, CSV like judge.py. */
export function JudgePanel({ objectId, objectName }: { objectId: string; objectName: string }) {
  const folder = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<JudgeRow[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortByVerdict, setSortByVerdict] = useState(false);
  const urls = useRef<string[]>([]);
  const running = progress !== null && progress[0] < progress[1];
  const clearUrls = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; };
  useEffect(() => clearUrls, []);

  async function run() {
    clearUrls();
    setError(null); setRows([]); setProgress([0, files.length]);
    const out: JudgeRow[] = [];
    try {
      for (const f of files) {
        const r = await inspect(objectId, f, { log: false });
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        out.push({ file: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, url,
                   verdict: r.verdict, label: r.verdict.toLowerCase(), score: r.score, threshold: r.threshold,
                   ratio: Math.round((r.score / r.threshold) * 1000) / 1000, ms: r.latencyMs,
                   where: r.regions.map((g) => whereWords(g.x, g.y)).join("; "), reasons: r.reasons.join("; ") });
        setRows([...out]);
        setProgress([out.length, files.length]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProgress(null);
    }
  }

  function downloadCsv() {
    const cell = (v: string | number) => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const text = [JUDGE_COLUMNS.join(","), ...rows.map((r) => JUDGE_COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `judge_${objectId}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const shown = sortByVerdict ? [...rows].sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9) || b.ratio - a.ratio) : rows;
  const counts = ["Good", "Defective", "Unsure", "Retake"].map((v) => [v, rows.filter((r) => r.verdict === v).length] as const);
  const avg = rows.length ? Math.round(rows.reduce((t, r) => t + r.ms, 0) / rows.length) : 0;
  const slowest = rows.length ? Math.max(...rows.map((r) => r.ms)) : 0;

  return <div className="evaluation-panel judge-panel" id="judge-panel">
    <div className="panel-intro"><div><h3>Judge test mode</h3><p>Pick a folder of unlabelled photos. Each one runs through the trained <b>{objectName}</b> model (not added to the history), and you get a verdict per photo and a CSV, the same as <code>python judge.py</code>.</p></div><span className="sample-badge">NOT LOGGED</span></div>
    <input ref={folder} className="sr-only" type="file" aria-label="Folder of photos to judge" accept="image/*" multiple {...({ webkitdirectory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => { setFiles(Array.from(event.target.files ?? []).filter((f) => f.type.startsWith("image/"))); setRows([]); setProgress(null); setError(null); }} />
    <div className="evaluation-folders"><button type="button" className="folder-picker" onClick={() => folder.current?.click()} disabled={running}><FolderOpen size={18} /><span><strong>Folder of photos</strong><small>{files.length ? `${files.length} images selected` : "Choose a folder (sub-folders included)"}</small></span><Upload size={15} /></button></div>
    <button type="button" className="run-inspection judge-run" onClick={run} disabled={!files.length || running}>{running ? <><LoaderCircle size={16} /> Judging {progress?.[0]} / {progress?.[1]}</> : <>Judge {files.length || ""} photos <Check size={15} /></>}</button>
    {progress && <div className="judge-progress" role="progressbar" aria-label="Judging progress" aria-valuemin={0} aria-valuemax={progress[1]} aria-valuenow={progress[0]}><span style={{ width: `${progress[1] ? (progress[0] / progress[1]) * 100 : 0}%` }} /></div>}
    {error && <div className="evaluation-state error-state" role="alert"><AlertCircle size={17} /><p>{error}</p></div>}
    {rows.length > 0 && <div className="judge-results">
      <div className="judge-summary"><span>{counts.map(([v, n]) => `${n} ${v.toLowerCase()}`).join(" · ")}</span><span>avg {avg} ms · slowest {slowest} ms</span>
        <button type="button" className="export-button judge-sort" aria-pressed={sortByVerdict} onClick={() => setSortByVerdict((v) => !v)}>{sortByVerdict ? "File order" : "Sort by verdict"}</button>
        <button type="button" className="export-button judge-csv" onClick={downloadCsv} disabled={running}>Download CSV</button></div>
      <div className="judge-table-wrap"><table className="judge-table"><thead><tr><th>Photo</th><th>File</th><th>Verdict</th><th>Score / line</th><th>ms</th></tr></thead>
        <tbody>{shown.map((r) => <tr key={r.url}><td><img src={r.url} alt="" className="judge-thumb" /></td><td className="judge-file">{r.file}</td><td><span className={`table-verdict ${r.verdict === "Good" ? "pass" : r.verdict.toLowerCase()}`}><i />{r.verdict}</span></td><td className={mono}>{r.score.toFixed(2)} <small>/ {r.threshold.toFixed(2)}</small></td><td className={mono}>{r.ms}</td></tr>)}</tbody></table></div>
    </div>}
  </div>;
}

export function RuntimeStatusPanel({ online, backendOk }: { online: boolean; backendOk: boolean | null }) {
  return <div className="runtime-panel"><div className="runtime-connectivity">{backendOk === false ? <AlertCircle size={16} /> : <Check size={16} />}<span><strong>{backendOk === null ? "Checking the inspection server" : backendOk ? "Inspection server running on this laptop" : "Inspection server not reachable"}</strong><small>{online ? runtimeOnlineLabel : runtimeOfflineLabel} · {runtimeIndicatorLabel}</small></span></div><div className="runtime-target"><span className={`${mono} runtime-state`}>{runtimeTargetLabel}</span><p>{runtimeTargetCopy}</p></div><p className="runtime-note">{runtimeStatusCopy}</p></div>;
}

export function LimitationsPanel() {
  return <section className="limitations-section" id="limitations"><div className="limitations-title"><span className={`${mono} section-index`}>07</span><div><span className="eyebrow">{limitationsEyebrow}</span><h2>{limitationTitle}</h2></div></div><ul>{limitationCopy.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}
