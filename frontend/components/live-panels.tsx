"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { Camera, CameraOff, Check, LoaderCircle, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { meterAdd, meterEnd, meterStart, type InspectionResult, type MeterStatus } from "@/lib/api";

type StageApi = { show: (r: unknown, photo: Blob, onDone?: () => void) => Promise<void>; resetView: () => void; dispose: () => void };

const LABEL: Record<string, string> = { Good: "good", Defective: "defective", Unsure: "unsure", Retake: "retake" };

/** 3D relief of one inspection: scan sweep, defects rise, pins drop on the worst spots (three.js + anime.js). */
export function InspectionStage3D({ result, photo, onSequenceDone }: { result: InspectionResult; photo: Blob; onSequenceDone?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const stage = useRef<StageApi | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@/lib/stage3d");
        if (cancelled || !host.current || !labels.current) return;
        if (!mod.webglAvailable()) { setFailed("3D view needs WebGL, which this browser has turned off. Use the 2D heatmap."); return; }
        stage.current = new mod.InspectionStage(host.current, labels.current) as StageApi;
      } catch (cause) {
        setFailed(cause instanceof Error ? cause.message : "3D view could not start.");
      }
    })();
    return () => { cancelled = true; stage.current?.dispose(); stage.current = null; };
  }, []);

  useEffect(() => {
    let tries = 0;
    const run = () => {
      if (!stage.current) { if (tries++ < 40) window.setTimeout(run, 50); return; }
      stage.current.show({ label: LABEL[result.verdict], grid: result.grid, grid_size: result.gridSize, regions: result.regions },
                         photo, onSequenceDone).catch((cause: unknown) => setFailed(cause instanceof Error ? cause.message : String(cause)));
    };
    run();
  }, [result, photo, onSequenceDone]);

  return <div className="stage3d" aria-label="3D inspection view. Drag to rotate, scroll to zoom.">
    <div ref={host} className="stage3d-canvas" />
    <div ref={labels} className="stage3d-labels" />
    {failed && <p className="stage3d-error" role="alert">{failed}</p>}
    <button type="button" className="stage3d-reset" onClick={() => stage.current?.resetView()}><RotateCcw size={12} /> Reset view</button>
    <span className="stage3d-hint">Drag to rotate · scroll to zoom</span>
  </div>;
}

/** Webcam. mode "train": capture good samples with the "enough photos?" meter. mode "inspect": inspect the current frame. */
export function WebcamCapture({ mode, onCaptured, onInspect, disabled }: {
  mode: "train" | "inspect";
  onCaptured?: (files: File[]) => void;
  onInspect?: (file: File) => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meter, setMeter] = useState<MeterStatus | null>(null);
  const session = useRef<string | null>(null);
  const count = useRef(0);
  const fill = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);
  // the <video> only exists once a stream is set, so attach the stream after that render
  useEffect(() => { if (video.current && stream && video.current.srcObject !== stream) video.current.srcObject = stream; }, [stream]);
  useEffect(() => () => { if (session.current) meterEnd(session.current); }, []);
  useEffect(() => {
    if (fill.current && meter) animate(fill.current, { width: `${meter.percent}%` }, { type: "spring", bounce: 0.3, duration: reducedMotion ? 0 : 0.6 });
  }, [meter, reducedMotion]);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError("The webcam only works when this page is opened on http://localhost."); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      setStream(s);
      if (mode === "train") await newSession();
    } catch (cause) {
      setError(`Could not open the webcam: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  function stop() { stream?.getTracks().forEach((t) => t.stop()); setStream(null); }

  async function newSession() {
    if (session.current) meterEnd(session.current);
    session.current = null;
    try { const s = await meterStart(); session.current = s.session ?? null; setMeter(s); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function grab(): Promise<File> {
    const v = video.current;
    if (!v || !v.videoWidth) return Promise.reject(new Error("The webcam is not ready yet."));
    const scale = Math.min(1, 640 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((ok, fail) => c.toBlob((b) => b ? ok(new File([b], `webcam-${Date.now()}-${count.current++}.jpg`, { type: "image/jpeg" }))
                                                    : fail(new Error("Could not capture a frame.")), "image/jpeg", 0.92));
  }

  async function capture(n: number) {
    setBusy(true);
    setError(null);
    try {
      const files: File[] = [];
      for (let i = 0; i < n; i++) {
        const file = await grab();
        files.push(file);
        if (session.current) setMeter(await meterAdd(session.current, file));
        if (i < n - 1) await new Promise((r) => setTimeout(r, 250));
      }
      onCaptured?.(files);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function inspectFrame() {
    try { onInspect?.(await grab()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const spark = meter && meter.novelty.length > 1 ? (() => {
    const max = Math.max(...meter.novelty) || 1;
    return meter.novelty.map((y, i) => `${(i / (meter.novelty.length - 1)) * 100},${30 - (y / max) * 26}`).join(" ");
  })() : null;

  return <div className={`live-cam live-cam-${mode}`}>
    {!stream ? <button type="button" className="cam-start" onClick={start} disabled={disabled}><Camera size={15} /> {mode === "train" ? "Capture good parts with the webcam" : "Use the webcam"}</button> : <>
      <video ref={video} autoPlay playsInline muted className="cam-video" />
      {mode === "train" && meter && <div className={`cam-meter ${meter.ready ? "ready" : ""}`} aria-live="polite">
        <div className="cam-meter-head"><span>{meter.photos} good sample{meter.photos === 1 ? "" : "s"}</span><span>{meter.ready ? "Enough" : `${meter.percent}%`}</span></div>
        <div className="cam-meter-track" role="progressbar" aria-label="Enough good samples" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.percent}><span ref={fill} className="cam-meter-fill" /></div>
        <p>{meter.hint}</p>
        {spark && <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="cam-spark" aria-hidden="true"><polyline points={spark} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
      </div>}
      <div className="cam-actions">
        {mode === "train" ? <>
          <button type="button" onClick={() => capture(1)} disabled={busy || disabled}>{busy ? <LoaderCircle size={14} /> : <Camera size={14} />} Capture sample</button>
          <button type="button" onClick={() => capture(10)} disabled={busy || disabled}>Capture 10</button>
          <button type="button" onClick={newSession} disabled={busy} aria-label="Reset the meter"><Trash2 size={14} /> Reset meter</button>
        </> : <button type="button" onClick={inspectFrame} disabled={disabled}><ScanLine size={14} /> Inspect this frame</button>}
        <button type="button" onClick={stop} aria-label="Stop the webcam"><CameraOff size={14} /> Stop</button>
      </div>
    </>}
    {error && <p className="cam-error" role="alert">{error}</p>}
  </div>;
}

export function VerdictReasons({ result }: { result: InspectionResult }) {
  const where = (x: number, y: number) => `${y < 0.34 ? "top" : y > 0.66 ? "bottom" : "middle"} ${x < 0.34 ? "left" : x > 0.66 ? "right" : "centre"}`;
  if (result.verdict === "Retake") return <div className="verdict-detail retake"><strong>Retake the photo</strong><ul>{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>;
  if (!result.regions.length) return null;
  return <div className="verdict-detail"><strong>Where</strong><ol>{result.regions.map((g, i) => <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i }}>{where(g.x, g.y)}, about {Math.max(1, Math.round(g.area * 100))}% of the photo</motion.li>)}</ol></div>;
}

export function FeedbackButton({ onConfirm, done }: { onConfirm: () => Promise<void>; done: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p className="feedback-done"><Check size={13} /> {done}</p>;
  return <div className="feedback-row">
    <button type="button" className="feedback-button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await onConfirm(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }}>
      {busy ? <LoaderCircle size={13} /> : <Check size={13} />} This was actually good
    </button>
    {error && <span className="cam-error" role="alert">{error}</span>}
  </div>;
}
