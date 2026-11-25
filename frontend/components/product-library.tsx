"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronDown, Download, ImageOff, Pencil, Plus, Upload, X } from "lucide-react";
import { createProduct, exportProduct, importProduct, loadSession, productPhotoUrl, updateProduct, type ObjectTrainingStatus } from "@/lib/api";
import { objectCategories } from "@/config/content";
import { PartDetailPanel } from "@/components/part-detail";
import { RemovePart, StrictnessControl } from "@/components/inspection-panels";

const mono = "font-mono";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const STATUS_CHIP: Record<string, string> = { Trained: "trained", Training: "training", Failed: "failed", "Not trained": "new" };

/** "+ Add new product": name required, SKU and description optional; then on to /train with it selected. */
export function AddProductCard({ onCreated, startOpen = false }: { onCreated?: (id: string) => void; startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) nameInput.current?.focus(); }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const p = await createProduct(name.trim(), sku.trim(), description.trim());
      try { window.localStorage.setItem("netrix.part", p.id); } catch { /* private mode */ }
      onCreated?.(p.id);
      router.push("/train");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="object-status-card add-product-card" onClick={() => setOpen(true)}>
    <span className="add-product-plus"><Plus size={22} /></span><strong>Add new product</strong><small>Name it, then train it from about 20 photos of good parts.</small></button>;
  return <form className="object-status-card add-product-form" onSubmit={submit} aria-label="Add new product">
    <div className="add-product-head"><h4>New product</h4><button type="button" className="icon-close" aria-label="Cancel" onClick={() => { setOpen(false); setError(null); }}><X size={15} /></button></div>
    <label>Product name <span aria-hidden="true">*</span><input ref={nameInput} id="new-product-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bottle cap 500 ml" /></label>
    <label>SKU <small>(optional)</small><input id="new-product-sku" maxLength={60} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. BC-500" /></label>
    <label>Description <small>(optional)</small><textarea id="new-product-description" maxLength={500} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    {error && <p className="form-error" role="alert"><AlertCircle size={13} /> {error}</p>}
    <button type="submit" className="button-primary add-product-submit" disabled={!name.trim() || busy}>{busy ? "Adding…" : "Add and train"}</button>
  </form>;
}

function EditProduct({ product, onSaved, onCancel }: { product: ObjectTrainingStatus; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(product.objectName);
  const [sku, setSku] = useState(product.sku ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <form className="edit-product" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await updateProduct(product.objectId, { display_name: name.trim(), sku: sku.trim(), description: description.trim() }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }}>
    <label>Name<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>SKU<input maxLength={60} value={sku} onChange={(e) => setSku(e.target.value)} /></label>
    <label>Description<textarea maxLength={500} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="edit-actions"><button type="submit" className="remove-part-yes" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button><button type="button" className="remove-part-no" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function Thumb({ id, name }: { id: string; name: string }) {
  const [missing, setMissing] = useState(false);
  return <div className="product-thumb">{missing ? <ImageOff size={22} aria-label="No photo yet" /> : <img src={productPhotoUrl(id, 0)} alt={`${name}: first training photo`} loading="lazy" onError={() => setMissing(true)} />}</div>;
}

/** Object library: your products as cards, an add card first, and the MVTec benchmark parts tucked away below. */
export function ProductLibrary({ statuses, loading, error, active, onChanged }: { statuses: ObjectTrainingStatus[]; loading: boolean; error?: Error; active: boolean; onChanged?: () => void }) {
  const [canManage, setCanManage] = useState(false);
  useEffect(() => { const s = loadSession(); setCanManage(!!s && (s.role === "inspector" || s.role === "supervisor")); }, []);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [importConflict, setImportConflict] = useState<File | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // glass detail panel: hover (desktop, after a short pause), click / tap, or Enter on a focused trained card
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const openDetail = (el: HTMLElement, id: string, name: string) => { opener.current = el; setDetail({ id, name }); };
  const closeDetail = () => { setDetail(null); const el = opener.current; window.setTimeout(() => el?.focus(), 0); };
  const fromControl = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, button, a, select, label, textarea, form");
  const cardProps = (p: ObjectTrainingStatus) => p.status !== "Trained" || editing === p.objectId ? {} : {
    tabIndex: 0, "aria-haspopup": "dialog" as const, "aria-label": `${p.objectName}: open details`, "data-detail": "1",
    onClick: (event: React.MouseEvent<HTMLElement>) => { if (!fromControl(event.target)) openDetail(event.currentTarget, p.objectId, p.objectName); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); openDetail(event.currentTarget, p.objectId, p.objectName); } },
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => { if (!canHover() || detail) return; const el = event.currentTarget; hoverTimer.current = window.setTimeout(() => openDetail(el, p.objectId, p.objectName), 700); },
    onMouseLeave: () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); hoverTimer.current = null; },
  };

  async function doImport(file: File, overwrite = false) {
    setNote(null); setImportConflict(null);
    try {
      const r = await importProduct(file, overwrite);
      setNote(`Imported ${r.display_name} (${r.photos} photos).`);
      onChanged?.();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (/already exists/.test(msg) && !overwrite) setImportConflict(file);
      setNote(msg);
    }
  }

  const products = statuses.filter((p) => p.status !== "Not trained");  // real products: trained, training or failed
  return <div className="object-library-panel product-library" role="tabpanel" id="objects-panel" aria-labelledby="objects-tab" hidden={!active}>
    <div className="panel-intro"><div><h3>Your products</h3><p>Every product this laptop has learned. Click a trained one for its photos and numbers.</p></div>
      {canManage && <><input ref={importInput} type="file" accept=".zip,application/zip" className="sr-only" aria-label="Import product zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
        <button type="button" className="export-button import-product" onClick={() => importInput.current?.click()}><Upload size={14} /> Import product</button></>}</div>
    {note && <p className="library-note" role="status">{note}{importConflict && <> <button type="button" className="remove-part-yes" onClick={() => doImport(importConflict, true)}>Replace it</button></>}</p>}
    {loading ? <div className="object-status-grid" aria-label="Loading products">{[0, 1, 2].map((i) => <div className="object-status-card status-skeleton" key={i}><span /><span /><span /></div>)}</div>
      : error ? <div className="evaluation-state error-state" role="alert"><AlertCircle size={17} /><p>Couldn&apos;t load the products. Is the inspection server running?</p></div>
      : <div className="object-status-grid">
        <AddProductCard onCreated={() => onChanged?.()} />
        {products.map((p) => <article key={p.objectId} className={`object-status-card product-card ${p.status === "Trained" ? "has-detail" : ""}`} {...cardProps(p)}>
          <Thumb id={p.objectId} name={p.objectName} />
          <div className="product-head"><h4>{p.objectName}</h4><span className={`status-chip ${STATUS_CHIP[p.status]}`}>{p.status}</span></div>
          {p.sku ? <span className={`${mono} product-sku`}>SKU {p.sku}</span> : null}
          <p className="product-meta">{p.goodImageCount ?? 0} good photos{p.backbone ? ` · ${p.backbone}` : ""}</p>
          <small className={`${mono} product-trained`}>Last trained · {when(p.lastTrainedAt)}</small>
          {p.needsRetrain && <span className="retrain-badge">Retrain recommended: blur check is off</span>}
          {p.status === "Trained" && <StrictnessControl id={p.objectId} value={p.strictness ?? 1} canEdit={canManage} onSaved={onChanged} />}
          {canManage && editing === p.objectId && <EditProduct product={p} onSaved={() => { setEditing(null); onChanged?.(); }} onCancel={() => setEditing(null)} />}
          {canManage && editing !== p.objectId && <div className="product-actions">
            <button type="button" className="remove-part-btn edit-product-btn" onClick={() => setEditing(p.objectId)}><Pencil size={12} /> Edit details</button>
            {p.status === "Trained" && <button type="button" className="remove-part-btn export-product-btn" onClick={() => exportProduct(p.objectId).catch((e) => setNote(e instanceof Error ? e.message : String(e)))}><Download size={12} /> Export</button>}
            {p.status !== "Training" && <RemovePart id={p.objectId} name={p.objectName} onRemoved={onChanged} />}
          </div>}
        </article>)}
      </div>}
    {!loading && !error && products.length === 0 && <p className="library-empty">No products yet. Add your first product and train it from about 20 photos of good parts.</p>}
    <details className="benchmark-parts">
      <summary><ChevronDown size={14} /> Benchmark parts (MVTec AD), used to measure accuracy</summary>
      <p>The 15 public MVTec AD objects the system was measured on (mean image AUROC 0.960). They are a test set, not your products.</p>
      <ul>{objectCategories.map((c) => <li key={c.id}><span className={mono}>{c.code}</span> {c.name}</li>)}</ul>
    </details>
    <PartDetailPanel id={detail?.id ?? ""} name={detail?.name ?? ""} open={!!detail} onClose={closeDetail} />
  </div>;
}
