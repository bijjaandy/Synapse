"use client";
import { PageIcon } from "@/components/page-icons";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, Camera, Check, ChevronDown, FolderOpen, ImageOff, Plus, Search, Settings2, Upload, X } from "lucide-react";
import { createProduct, getObjectStatuses, getTrainStatus, productPhotoUrl, trainObject, type Backbone, type ObjectTrainingStatus } from "@/lib/api";
import { objectCategories } from "@/config/content";
import { FLAG_TEXT, flagOutliers, photoStats, type PhotoFlag, type PhotoStats } from "@/lib/photo-quality";
import { WebcamCapture } from "@/components/live-panels";
import { toast } from "@/lib/toast";

const ENOUGH = 20;           // photos we ask for (the server's hard minimum is lower)
const LIMIT_S = 600;         // PS #12: learn in at most 10 minutes
type Pending = { key: string; file: File; url: string | null; stats: PhotoStats | null | undefined };
type Word = "Ready" | "Training…" | "Needs photos" | "Retrain recommended" | "Failed";

const statusWord = (p?: ObjectTrainingStatus): Word => !p || p.status === "Not trained" ? "Needs photos" : p.status === "Training" ? "Training…"
  : p.status === "Failed" ? "Failed" : p.needsRetrain ? "Retrain recommended" : "Ready";
const WORD_CLASS: Record<Word, string> = { Ready: "ready", "Training…": "training", "Needs photos": "needs", "Retrain recommended": "retrain", Failed: "failed" };

function relative(iso: string | null) {
  if (!iso) return null;
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, sec] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]] as const)
    if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  return "just now";
}
const estimate = (n: number) => { const sec = 15 + n * 0.5; return sec < 60 ? "under a minute" : `about ${Math.round(sec / 60)} min`; };

function EmptyArt() {
  return <svg className="train-empty-art" viewBox="0 0 160 110" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="18" y="30" width="70" height="50" rx="8" /><path d="M38 30l6-10h16l6 10" /><circle cx="53" cy="55" r="14" /><circle cx="53" cy="55" r="5" />
    <circle cx="120" cy="62" r="24" strokeDasharray="5 5" /><circle cx="120" cy="62" r="9" strokeDasharray="4 4" />
    <path d="M128 18v10M123 23h10M146 40v6M143 43h6" />
  </svg>;
}

function NewProductRow({ onCreated, startOpen = false }: { onCreated: (id: string) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  if (!open) return <button type="button" className="new-product-row" onClick={() => setOpen(true)}><Plus size={15} /> New product</button>;
  return <form className="new-product-form" aria-label="New product" onSubmit={async (e) => {
    e.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try { const p = await createProduct(name.trim(), sku.trim(), description.trim()); toast(`Product added: ${p.display_name}`); setOpen(false); setName(""); setSku(""); setDescription(""); onCreated(p.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }}>
    <label>Product name<input ref={input} id="train-new-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bottle cap 500 ml" /></label>
    <label>SKU <small>optional</small><input id="train-new-sku" maxLength={60} value={sku} onChange={(e) => setSku(e.target.value)} /></label>
    <label>Description <small>optional</small><textarea id="train-new-description" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="new-product-actions"><button type="submit" className="button-primary" disabled={!name.trim() || busy}>{busy ? "Creating…" : "Create"}</button><button type="button" className="remove-part-no" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}

function ProductRow({ p, id, name, sku, selected, onSelect, onKey, reduced }: { p?: ObjectTrainingStatus; id: string; name: string; sku?: string; selected: boolean; onSelect: () => void; onKey: (e: React.KeyboardEvent<HTMLButtonElement>) => void; reduced: boolean }) {
  const [noPhoto, setNoPhoto] = useState(false);
  const word = statusWord(p);
  const trained = p && p.status !== "Not trained";
  return <button type="button" role="option" aria-selected={selected} data-id={id} className={`train-row ${selected ? "selected" : ""}`} tabIndex={selected ? 0 : -1} onClick={onSelect} onKeyDown={onKey}>
    {selected && <motion.span layoutId="train-row-bg" className="train-row-bg" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }} />}
    <span className="train-row-thumb">{trained && !noPhoto ? <img src={productPhotoUrl(id, 0)} alt="" loading="lazy" onError={() => setNoPhoto(true)} /> : <ImageOff size={14} />}</span>
    <span className="train-row-text"><strong>{name}</strong>{sku ? <small>{sku}</small> : null}</span>
    <span className={`train-row-status ${WORD_CLASS[word]}`}><i />{word}</span>
  </button>;
}

/** /train: pick or create a product, add photos (files, folder, zip or webcam), check them, train. */
export default function TrainWorkspace() {
  const reduced = useReducedMotion() ?? false;
  const { data: products = [], isLoading, isValidating, mutate } = useSWR<ObjectTrainingStatus[]>("object-statuses", getObjectStatuses, { refreshInterval: 10000, revalidateOnMount: true });
  const [fresh, setFresh] = useState(false);  // the list may be cached from another page: fetch it once before trusting it
  useEffect(() => { mutate().finally(() => setFresh(true)); }, [mutate]);
  const [selected, setSelectedState] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [zips, setZips] = useState<File[]>([]);
  const [webcam, setWebcam] = useState(false);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [backbone, setBackbone] = useState<Backbone>("auto");
  const [rotates, setRotates] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [train, setTrain] = useState<{ phase: "running" | "done" | "error"; elapsed: number; progress: number; log: string[]; error?: string; backbone?: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setSelected = useCallback((id: string) => {
    setSelectedState(id);
    try { window.localStorage.setItem("netrix.part", id); } catch { /* private mode */ }
  }, []);
  useEffect(() => { try { const saved = window.localStorage.getItem("netrix.part"); if (saved) setSelectedState(saved); } catch { /* ignore */ } }, []);
  useEffect(() => {  // nothing picked yet, or a remembered product that no longer exists: take the first one
    if (!fresh || isLoading || isValidating || !products.length) return;
    if (!selected || (!products.some((p) => p.objectId === selected) && !objectCategories.some((c) => c.id === selected))) setSelected(products[0].objectId);
  }, [products, selected, setSelected, isLoading, isValidating, fresh]);

  const product = products.find((p) => p.objectId === selected);
  const bench = objectCategories.find((c) => c.id === selected);
  const name = product?.objectName ?? bench?.name ?? selected ?? "";
  const trained = !!product && product.status === "Trained";

  // a new product, or a different one: start clean
  useEffect(() => { setPending((old) => { old.forEach((p) => p.url && URL.revokeObjectURL(p.url)); return []; }); setZips([]); setWebcam(false); setTrain(null); }, [selected]);
  useEffect(() => { setMode(trained ? "add" : "replace"); }, [trained, selected]);
  useEffect(() => () => pending.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []);  // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = useCallback((list: FileList | File[]) => {
    const files = Array.from(list);
    const images = files.filter((f) => f.type.startsWith("image/"));
    const zipFiles = files.filter((f) => f.name.toLowerCase().endsWith(".zip"));
    if (zipFiles.length) setZips((z) => [...z, ...zipFiles]);
    const items: Pending[] = images.map((file, i) => ({ key: `${file.name}-${file.size}-${Date.now()}-${i}`, file, url: URL.createObjectURL(file), stats: undefined }));
    setPending((p) => [...p, ...items].slice(0, 1000));
    items.forEach(async (item) => {  // quality, in the browser, one by one as they come in
      const stats = await photoStats(item.file);
      setPending((p) => p.map((x) => (x.key === item.key ? { ...x, stats } : x)));
    });
  }, []);

  const flags = useMemo(() => flagOutliers(pending.map((p) => p.stats ?? null)), [pending]);
  const checked = pending.filter((p) => p.stats !== undefined).length;
  const flagged = flags.filter(Boolean).length;
  const flagCounts = flags.reduce<Record<string, number>>((m, f) => (f ? { ...m, [f]: (m[f] ?? 0) + 1 } : m), {});
  const existing = trained && mode === "add" ? product?.goodImageCount ?? 0 : 0;
  const total = existing + pending.length;
  const enough = total >= ENOUGH || zips.length > 0;
  const step = train ? 3 : !pending.length && !zips.length ? 1 : !enough || checked < pending.length ? 2 : 3;

  function removeAt(key: string) { setPending((p) => { const x = p.find((y) => y.key === key); if (x?.url) URL.revokeObjectURL(x.url); return p.filter((y) => y.key !== key); }); }
  function removeFlagged() { setPending((p) => p.filter((x, i) => { const bad = !!flags[i]; if (bad && x.url) URL.revokeObjectURL(x.url); return !bad; })); }

  async function startTraining() {
    if (!selected) return;
    const files = [...pending.map((p) => p.file), ...zips];
    setTrain({ phase: "running", elapsed: 0, progress: 0, log: [`Uploading ${files.length} file(s)…`] });
    try {
      const { jobId } = await trainObject(selected, files, { backbone, rotations: rotates ? 8 : 1, mode });
      mutate();
      let s = await getTrainStatus(jobId);
      while (s.state === "learning") {
        setTrain({ phase: "running", elapsed: s.elapsedSec, progress: s.progress, log: s.log, backbone: s.backbone });
        await new Promise((r) => window.setTimeout(r, 1000));
        s = await getTrainStatus(jobId);
      }
      if (s.state === "error") throw new Error(s.error ?? "Training failed.");
      setTrain({ phase: "done", elapsed: Math.round(s.trainSeconds ?? s.elapsedSec), progress: 100, log: s.log, backbone: s.backbone });
      toast(`${name} is trained · ${Math.round(s.trainSeconds ?? s.elapsedSec)} s`);
      setPending([]); setZips([]);
      mutate();
    } catch (cause) {
      toast("Training failed", "error");
      setTrain((t) => ({ phase: "error", elapsed: t?.elapsed ?? 0, progress: t?.progress ?? 0, log: t?.log ?? [], error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  // product list: arrow keys move, Enter / click selects (rows are buttons in a listbox)
  const q = search.trim().toLowerCase();
  const shown = products.filter((p) => !q || p.objectName.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || p.objectId.includes(q));
  function onRowKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".train-row") ?? [])];
    const i = rows.indexOf(e.currentTarget);
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
  const fade = reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };
  const ring = 2 * Math.PI * 34;

  if (!isLoading && products.length === 0 && !bench) return <div className="train-page train-empty">
    <EmptyArt />
    <h2>Train your first product</h2>
    <p>Show it about 20 photos of good parts. No defect photos needed.</p>
    <NewProductRow startOpen onCreated={(id) => { setSelected(id); mutate(); }} />
  </div>;

  return <div className="train-page">
    <aside className="train-side" aria-label="Your products">
      <h2>Your products</h2>
      <label className="train-search"><Search size={14} /><input type="search" placeholder="Search products" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <NewProductRow onCreated={(id) => { setSelected(id); mutate(); }} />
      <label className="train-select-phone">Product<select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>{products.map((p) => <option key={p.objectId} value={p.objectId}>{p.objectName}{p.sku ? ` (${p.sku})` : ""}</option>)}{objectCategories.filter((c) => !products.some((p) => p.objectId === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name} (benchmark)</option>)}</select></label>
      <div className="train-list" role="listbox" aria-label="Your products" ref={listRef}>
        {isLoading ? [0, 1, 2].map((i) => <div key={i} className="train-row skeleton" />) : shown.map((p) => <ProductRow key={p.objectId} p={p} id={p.objectId} name={p.objectName} sku={p.sku} selected={selected === p.objectId} onSelect={() => setSelected(p.objectId)} onKey={onRowKey} reduced={reduced} />)}
        {!isLoading && q && !shown.length && <p className="train-none">No product matches “{search}”.</p>}
      </div>
      <details className="benchmark-parts train-bench">
        <summary><ChevronDown size={14} /> Benchmark parts (MVTec AD)</summary>
        <div className="train-list" role="listbox" aria-label="Benchmark parts">{objectCategories.filter((c) => !products.some((p) => p.objectId === c.id)).map((c) => <ProductRow key={c.id} id={c.id} name={c.name} sku={c.code} selected={selected === c.id} onSelect={() => setSelected(c.id)} onKey={onRowKey} reduced={reduced} />)}</div>
      </details>
    </aside>

    <AnimatePresence mode="wait">
      <motion.section key={selected ?? "none"} className="train-main" aria-label={`Train ${name}`} {...fade} transition={{ duration: reduced ? 0.15 : 0.25 }}>
        {!selected ? <p className="train-none">Pick a product on the left, or create one.</p> : <>
          <header className="train-head">
            <div className="train-head-title"><PageIcon name="Train" /><div><h1 id="train-product-name">{name}</h1>
              <p>{product?.sku ? <span className="train-sku">SKU {product.sku}</span> : null}{trained ? <span>last trained {relative(product?.lastTrainedAt ?? null)} · {product?.backbone ?? "model"}</span> : <span>not trained yet</span>}</p></div></div>
            <div className="train-head-right"><span className={`status-chip ${WORD_CLASS[statusWord(product)]}`}>{statusWord(product)}</span><Link href="/objects" className="train-edit">Edit</Link></div>
          </header>

          <ol className="train-steps" aria-label="Steps">
            {["Add photos", "Check quality", "Train"].map((label, i) => {
              const n = i + 1, done = n < step || (n === 3 && train?.phase === "done");
              return <li key={label} className={`${n === step ? "current" : ""} ${done ? "done" : ""}`} aria-current={n === step ? "step" : undefined}>
                <span className="train-step-dot">{done ? <Check size={13} /> : n}</span>{label}
                {i < 2 && <span className="train-step-line"><motion.i initial={false} animate={{ scaleX: n < step ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.35 }} /></span>}</li>;
            })}
          </ol>

          {train ? <motion.div className={`train-live ${train.phase}`} {...fade} role="status" aria-live="polite">
            <div className="train-ring">
              <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" className="ring-bg" />
                <motion.circle cx="40" cy="40" r="34" className="ring-fg" strokeDasharray={ring} initial={false} animate={{ strokeDashoffset: ring * (1 - train.progress / 100) }} transition={{ duration: reduced ? 0 : 0.45 }} /></svg>
              <span>{train.phase === "done" ? <motion.span initial={reduced ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}><Check size={26} /></motion.span> : `${train.progress}%`}</span>
            </div>
            <div className="train-live-text">
              <h3>{train.phase === "done" ? `${name} is trained` : train.phase === "error" ? "Training failed" : `Training ${name}…`}</h3>
              <p className="train-time">{String(Math.floor(train.elapsed / 60)).padStart(2, "0")}:{String(train.elapsed % 60).padStart(2, "0")} <small>of the 10:00 limit{train.backbone ? ` · ${train.backbone}` : ""}</small></p>
              {train.error && <p className="form-error" role="alert">{train.error}</p>}
              <ul className="train-log-lines">{train.log.slice(-6).map((line, i) => <motion.li key={`${train.log.length - 6 + i}-${line}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.3 }}>{line}</motion.li>)}</ul>
              {train.phase === "done" && <div className="train-done-actions"><Link href="/inspect" className="button-primary go-inspect">Go to Inspect <ArrowRight size={14} /></Link><button type="button" className="remove-part-no" onClick={() => setTrain(null)}>Add more photos</button></div>}
              {train.phase === "error" && <button type="button" className="remove-part-no" onClick={() => setTrain(null)}>Back</button>}
            </div>
          </motion.div> : <>
            <section className="train-step-card" aria-labelledby="step1">
              <h2 id="step1"><span>1</span> Add photos</h2>
              <input ref={fileInput} className="sr-only" type="file" accept="image/*,.zip" multiple aria-label="Choose photos or a zip" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={folderInput} className="sr-only" type="file" multiple aria-label="Choose a folder of photos" {...({ webkitdirectory: "" } as unknown as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
              {webcam ? <div className="train-webcam"><WebcamCapture mode="train" onCaptured={(files) => addFiles(files)} /><button type="button" className="remove-part-no" onClick={() => setWebcam(false)}>Close the webcam</button></div>
                : <div className={`train-drop ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
                  <button type="button" className="train-drop-main" onClick={() => fileInput.current?.click()}><Upload size={22} /><strong>Drop good photos here</strong><small>or click to choose photos or a .zip · JPG, PNG, WEBP</small></button>
                  <div className="train-drop-more"><button type="button" onClick={() => folderInput.current?.click()}><FolderOpen size={14} /> A folder</button><button type="button" className="train-webcam-btn" onClick={() => setWebcam(true)}><Camera size={14} /> Webcam</button></div>
                </div>}
              {(pending.length > 0 || zips.length > 0) && <div className="train-thumbs">
                <AnimatePresence initial={false}>{pending.slice(0, 15).map((p, i) => <motion.figure key={p.key} layout={!reduced} className={`train-thumb ${flags[i] ? `flag-${flags[i]}` : ""}`} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: reduced ? 0.15 : 0.2, delay: reduced ? 0 : Math.min(i, 10) * 0.02 }}>
                  {p.url && <img src={p.url} alt={`Photo ${i + 1}`} />}
                  {flags[i] && <span className="thumb-flag" title={FLAG_TEXT[flags[i] as PhotoFlag]} aria-label={FLAG_TEXT[flags[i] as PhotoFlag]}><AlertTriangle size={10} /></span>}
                  <button type="button" className="thumb-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => removeAt(p.key)}><X size={11} /></button>
                </motion.figure>)}</AnimatePresence>
                {pending.length > 15 && <div className="train-thumb more">+{pending.length - 15}</div>}
                {zips.map((z) => <div key={z.name} className="train-thumb zip" title={z.name}>ZIP</div>)}
              </div>}
            </section>

            <section className="train-step-card" aria-labelledby="step2">
              <h2 id="step2"><span>2</span> Check quality</h2>
              <p className="train-quality-summary">{total} photo{total === 1 ? "" : "s"}{zips.length ? ` + ${zips.length} zip` : ""}{existing ? ` (${existing} already learned)` : ""} · {enough ? "enough to train" : `${ENOUGH - total} more to reach ${ENOUGH}`}{checked < pending.length ? ` · checking ${pending.length - checked}…` : ""}{Object.entries(flagCounts).map(([f, n]) => ` · ${n} ${FLAG_TEXT[f as PhotoFlag]}`).join("")}</p>
              <div className={`train-meter ${enough ? "enough" : ""}`} role="progressbar" aria-label="Photos towards the minimum" aria-valuemin={0} aria-valuemax={ENOUGH} aria-valuenow={Math.min(total, ENOUGH)}><motion.span initial={false} animate={{ width: `${Math.min(100, (total / ENOUGH) * 100)}%` }} transition={{ duration: reduced ? 0 : 0.35 }} /></div>
              {flagged > 0 && <button type="button" className="remove-part-btn remove-flagged" onClick={removeFlagged}>Remove flagged photos ({flagged})</button>}
            </section>

            <section className="train-step-card" aria-labelledby="step3">
              <h2 id="step3"><span>3</span> Train</h2>
              {trained && <div className="train-mode" role="radiogroup" aria-label="What to do with the photos it already learned">
                <label className={mode === "add" ? "active" : ""}><input type="radio" name="train-mode" checked={mode === "add"} onChange={() => setMode("add")} />{mode === "add" && <motion.span layoutId="mode-pill" className="seg-pill" />}<span>Add to existing</span></label>
                <label className={mode === "replace" ? "active" : ""}><input type="radio" name="train-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />{mode === "replace" && <motion.span layoutId="mode-pill" className="seg-pill" />}<span>Replace all photos</span></label>
              </div>}
              {trained && mode === "replace" && <p className="train-warning"><AlertTriangle size={13} /> Replacing drops the {product?.goodImageCount ?? 0} photos it learned from now.</p>}
              <details className="train-settings"><summary><Settings2 size={13} /> Model: {backbone === "auto" ? "auto" : backbone} · rotation {rotates ? "on" : "off"}</summary>
                <div className="train-options"><label><span>Model</span><select value={backbone} onChange={(e) => setBackbone(e.target.value as Backbone)}><option value="auto">Best for this laptop (auto)</option><option value="resnet18">Fast (resnet18)</option><option value="wide_resnet50">Most accurate (wide_resnet50)</option></select></label>
                  <label className="train-check"><input type="checkbox" checked={rotates} onChange={(e) => setRotates(e.target.checked)} /> Part can lie at any angle (checks 8 angles, slower)</label></div>
              </details>
              <button type="button" className="button-primary train-start" disabled={!enough || checked < pending.length} onClick={startTraining}>Train · {estimate(total)} <ArrowRight size={15} /></button>
              {!enough && <p className="train-hint">Add at least {ENOUGH} good photos{existing ? " in total" : ""} to train.</p>}
            </section>
          </>}
        </>}
      </motion.section>
    </AnimatePresence>
  </div>;
}
