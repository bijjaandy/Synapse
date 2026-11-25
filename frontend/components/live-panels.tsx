"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { Camera, CameraOff, Check, LoaderCircle, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { aboveLineUrl, blendUrl, distanceMapUrl, heatGradientCss, legendPos, loadImg } from "@/lib/heatmaps";
import { whereWords } from "@/lib/voice";
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
    <span className="stage3d-hint">Drag to rotate · scroll to zoom · height = how different</span>
    <div className="stage3d-legend"><HeatLegend compact /></div>
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
  const where = whereWords;
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

/** Colour key shared by the 3D view, the 2D heatmap and the layer map. */
export function HeatLegend({ compact = false }: { compact?: boolean }) {
  return <div className={`heat-legend ${compact ? "compact" : ""}`} aria-label="Colour key: from like the good parts to very different">
    <div className="heat-legend-top"><span style={{ left: `${legendPos(1)}%` }}>Line (1×)</span><span style={{ left: `${legendPos(2)}%` }}>2×</span></div>
    <div className="heat-legend-bar" style={{ background: heatGradientCss() }}>
      <span className="heat-legend-line" style={{ left: `${legendPos(1)}%` }} />
      <span className="heat-legend-line minor" style={{ left: `${legendPos(2)}%` }} />
    </div>
    <div className="heat-legend-labels"><span>Like good parts</span><span>Very different</span></div>
  </div>;
}

type Layer = { key: string; title: string; text: string; src: string | null; pins?: boolean };

/** The layer map: the steps from photo to decision as an exploded 3D stack. Pick a layer to read what it shows. */
export function LayerMap({ result, photoUrl }: { result: InspectionResult; photoUrl: string | null }) {
  const reducedMotion = useReducedMotion() ?? false;
  const [imgs, setImgs] = useState<{ blend: string; above: string; dist: string } | null>(null);
  const [active, setActive] = useState(4);
  const [stacked, setStacked] = useState(true);

  useEffect(() => {
    let live = true;
    if (!photoUrl || !result.grid?.length) { setImgs(null); return; }
    loadImg(photoUrl).then((photo) => {
      if (!live) return;
      setImgs({ dist: distanceMapUrl(result.grid, result.gridSize), blend: blendUrl(photo, result.grid, result.gridSize),
                above: aboveLineUrl(photo, result.grid, result.gridSize) });
    }).catch(() => setImgs(null));
    return () => { live = false; };
  }, [result, photoUrl]);

  const over = result.grid ? result.grid.filter((v) => v >= 1).length : 0;
  const pct = result.grid?.length ? (100 * over / result.grid.length) : 0;
  const max = result.grid?.length ? Math.max(...result.grid) : 0;
  const layers: Layer[] = [
    { key: "photo", title: "1 · Photo", text: "What the camera saw, resized for the model. Nothing is judged yet.", src: photoUrl },
    { key: "dist", title: "2 · Patch distances", text: `The photo is cut into ${result.gridSize}×${result.gridSize} cells. Each cell's colour is how far it is from the closest good patch in memory. Highest here: ${max.toFixed(2)}× the line.`, src: imgs?.dist ?? null },
    { key: "heat", title: "3 · Heatmap", text: "The distances laid over the photo. Clear means it looks like the good parts; amber is the line; red is far beyond it.", src: imgs?.blend ?? null },
    { key: "above", title: "4 · Above the line", text: over ? `${over} cells (${pct.toFixed(1)}% of the photo) are past the line set from good photos only. They are outlined.` : "No cell is past the line set from good photos only.", src: imgs?.above ?? null },
    { key: "decide", title: "5 · Decision", text: `${result.verdict}: the worst cell decides. Score ${result.score.toFixed(2)} against a line of ${result.threshold.toFixed(2)}${result.regions.length ? `; ${result.regions.length} spot${result.regions.length > 1 ? "s" : ""} pinned` : ""}.`, src: imgs?.blend ?? photoUrl, pins: true },
  ];
  const n = layers.length;

  return <div className="layer-map">
    <div className="layer-map-head">
      <span>Layer map · from photo to decision</span>
      <button type="button" className="layers-toggle" onClick={() => setStacked((s) => !s)} aria-pressed={stacked}>{stacked ? "Show side by side" : "Show as 3D stack"}</button>
    </div>
    <div className={`layer-map-body ${stacked ? "stacked" : "flat"}`}>
      <div className="layer-stack" role="listbox" aria-label="Layers">
        {layers.map((l, i) => {
          const isActive = i === active;
          const y = stacked ? -(i - (n - 1) / 2) * 52 : 0;
          return <motion.button key={l.key} type="button" role="option" aria-selected={isActive}
            className={`layer-sheet ${isActive ? "active" : ""} ${l.key === "decide" ? `verdict-${result.verdict.toLowerCase()}` : ""}`}
            onClick={() => setActive(i)} onMouseEnter={() => stacked && setActive(i)}
            initial={reducedMotion ? false : { opacity: 0, y: y + 40 }}
            animate={{ opacity: 1, y: y - (isActive && stacked ? 14 : 0) }}
            transition={{ duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            style={stacked ? { zIndex: i + 1, rotateX: 58, rotateZ: -40 } : { zIndex: i + 1 }}>
            <span className="layer-sheet-img">
              {l.src ? <img src={l.src} alt={l.title} /> : <span className="layer-sheet-wait" />}
              {l.pins && result.regions.map((r, k) => <span key={k} className="layer-pin" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}>{k + 1}</span>)}
            </span>
            <span className="layer-sheet-tag">{l.title}</span>
          </motion.button>;
        })}
      </div>
      <div className="layer-detail" aria-live="polite">
        <strong>{layers[active].title}</strong>
        <p>{layers[active].text}</p>
        {(active === 1 || active === 2) && <HeatLegend compact />}
        <div className="layer-chips">{layers.map((l, i) => <button key={l.key} type="button" className={i === active ? "on" : ""} onClick={() => setActive(i)}>{l.title.replace(" · ", " ")}</button>)}</div>
      </div>
    </div>
  </div>;
}
