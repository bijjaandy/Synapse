"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import { AlertCircle, Check, Clock3, FolderOpen, LoaderCircle, Upload, Wifi, WifiOff } from "lucide-react";
import { evaluateTestSet, type EvaluationResult, type ObjectTrainingStatus } from "@/lib/api";
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

export function ObjectLibraryPanel({ statuses, loading, error, active }: { statuses: ObjectTrainingStatus[]; loading: boolean; error?: Error; active: boolean }) {
  return <div className="object-library-panel" role="tabpanel" id="objects-panel" aria-labelledby="objects-tab" hidden={!active}>
    <div className="panel-intro"><div><h3>{objectViewCopy.title}</h3><p>{objectViewCopy.description}</p></div><span className="sample-badge">{objectViewCopy.sampleBadge}</span></div>
    {loading ? <div className="object-status-grid" aria-label="Loading object status">{objectCategories.map((item) => <div className="object-status-card status-skeleton" key={item.id}><span /><span /><span /></div>)}</div> : error ? <div className="evaluation-state error-state" role="alert"><AlertCircle size={17} /><p>{objectViewCopy.error}</p></div> : statuses.length === 0 ? <div className="evaluation-empty"><p>{objectViewCopy.empty}</p></div> : <div className="object-status-grid">{statuses.map((status) => {
      const category = objectCategories.find((item) => item.id === status.objectId);
      return <article className="object-status-card" key={status.objectId}><div className="object-status-head"><span className={`${mono} object-code`}>{category?.code ?? "CUS"}</span>{status.backbone && <span className={`${mono} object-code`}>{status.backbone}</span>}</div><h4>{status.objectName}</h4><span className={`object-status-badge ${status.status === "Trained" ? "trained" : "not-trained"}`}>{status.status}</span><p>{status.status === "Trained" ? (status.goodImageCount != null ? objectViewCopy.trainedImages(status.goodImageCount) : objectViewCopy.imageCountUnavailable) : status.status === "Not trained" ? objectViewCopy.untrainedImages : status.status}</p><small className={mono}>{objectViewCopy.lastTrained} · {status.lastTrainedAt ? new Date(status.lastTrainedAt).toLocaleString() : "—"}</small></article>;
    })}</div>}
    <p className="object-state-note">{objectViewCopy.demoNote}</p>
  </div>;
}

export function RuntimeStatusPanel({ online, backendOk }: { online: boolean; backendOk: boolean | null }) {
  return <div className="runtime-panel"><div className="runtime-connectivity">{backendOk === false ? <AlertCircle size={16} /> : <Check size={16} />}<span><strong>{backendOk === null ? "Checking the inspection server" : backendOk ? "Inspection server running on this laptop" : "Inspection server not reachable"}</strong><small>{online ? runtimeOnlineLabel : runtimeOfflineLabel} · {runtimeIndicatorLabel}</small></span></div><div className="runtime-target"><span className={`${mono} runtime-state`}>{runtimeTargetLabel}</span><p>{runtimeTargetCopy}</p></div><p className="runtime-note">{runtimeStatusCopy}</p></div>;
}

export function LimitationsPanel() {
  return <section className="limitations-section" id="limitations"><div className="limitations-title"><span className={`${mono} section-index`}>07</span><div><span className="eyebrow">{limitationsEyebrow}</span><h2>{limitationTitle}</h2></div></div><ul>{limitationCopy.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}
