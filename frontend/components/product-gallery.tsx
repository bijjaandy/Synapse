"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight, ImageOff, Plus } from "lucide-react";
import { productPhotoUrl, type ObjectTrainingStatus } from "@/lib/api";

const STEP = 230;          // px between card centres
const CHIP: Record<string, string> = { Trained: "trained", Training: "training", Failed: "failed", "Not trained": "new" };

/** One card in the curved row. Everything is derived from its distance to the centre (a spring), so the row moves as one. */
function GalleryCard({ index, pos, tilt, active, onOpen, onFocusCard, children, reduced, label, isAdd }: {
  index: number; pos: MotionValue<number>; tilt: MotionValue<number>; active: boolean; onOpen: () => void; onFocusCard: () => void;
  children: React.ReactNode; reduced: boolean; label: string; isAdd?: boolean;
}) {
  const d = useTransform(pos, (p) => index - p);                       // signed distance from the centre, in cards
  const x = useTransform(d, (v) => v * STEP);
  const rotateY = useTransform([d, tilt], ([v, t]) => Math.max(-50, Math.min(50, -(v as number) * 24)) + (t as number));
  const z = useTransform(d, (v) => -Math.min(Math.abs(v), 4) * 120);
  const scale = useTransform(d, (v) => 1 - Math.min(Math.abs(v), 3) * 0.06);
  const opacity = useTransform(d, (v) => Math.max(0, 1 - Math.max(0, Math.abs(v) - 0.4) * 0.28));
  const filter = useTransform(d, (v) => `brightness(${1 - Math.min(Math.abs(v), 3) * 0.12}) blur(${reduced ? 0 : Math.min(Math.max(Math.abs(v) - 0.6, 0), 3) * 1.2}px)`);
  const zIndex = useTransform(d, (v) => 100 - Math.round(Math.abs(v) * 10));
  return <motion.div className={`gallery-card ${active ? "active" : ""} ${isAdd ? "gallery-add" : ""}`} role="option" aria-selected={active} aria-label={label}
    tabIndex={active ? 0 : -1} data-index={index}
    style={reduced ? { zIndex } : { x, rotateY, z, scale, opacity, filter, zIndex }}
    whileHover={reduced ? undefined : { z: 60, scale: 1.04 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
    onClick={onOpen} onFocus={onFocusCard} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
    {children}
  </motion.div>;
}

function CardPhoto({ id, name }: { id: string; name: string }) {
  const [missing, setMissing] = useState(false);
  return missing ? <div className="gallery-photo gallery-photo-missing"><ImageOff size={30} /></div>
    : <motion.img layoutId={`photo-${id}`} className="gallery-photo" src={productPhotoUrl(id, 0)} alt={`${name}: first training photo`} draggable={false} onError={() => setMissing(true)} />;
}

/** The Object library's "backstage" gallery: a 3D curved row of tall product cards. Drag, wheel, arrow keys or buttons move it. */
export function ProductGallery({ products, onOpen, onAdd, dimmed }: { products: ObjectTrainingStatus[]; onOpen: (p: ObjectTrainingStatus, el: HTMLElement) => void; onAdd: () => void; dimmed: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const count = products.length + 1;                                   // + the "add new product" card first
  const target = useMotionValue(Math.min(1, count - 1));               // start on the first product
  const pos = useSpring(target, reduced ? { stiffness: 1000, damping: 100 } : { stiffness: 170, damping: 26, mass: 0.9 });
  const tilt = useSpring(0, { stiffness: 200, damping: 20 });          // cards lean with drag speed, then settle
  const [active, setActive] = useState(Math.min(1, count - 1));
  const drag = useRef<{ x: number; start: number; t: number; last: number } | null>(null);
  const row = useRef<HTMLDivElement>(null);

  const go = useCallback((i: number, focus = false) => {
    const n = Math.max(0, Math.min(count - 1, Math.round(i)));
    target.set(n); setActive(n);
    if (focus) window.setTimeout(() => row.current?.querySelector<HTMLElement>(`[data-index="${n}"]`)?.focus(), 0);
  }, [count, target]);
  useEffect(() => { if (active > count - 1) go(count - 1); }, [count, active, go]);

  useEffect(() => {  // mouse wheel / trackpad moves the row
    const el = row.current; if (!el) return;
    let acc = 0, timer = 0;
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      acc += delta;
      target.set(Math.max(0, Math.min(count - 1, target.get() + delta / 320)));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { go(target.get()); acc = 0; }, 140);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [count, target, go]);

  const onPointerDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, start: target.get(), t: performance.now(), last: e.clientX }; };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientX - d.x) > 4) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const now = performance.now(), v = (e.clientX - d.last) / Math.max(1, now - d.t);  // px per ms
    d.t = now; d.last = e.clientX;
    target.set(Math.max(-0.4, Math.min(count - 0.6, d.start - (e.clientX - d.x) / STEP)));
    if (!reduced) tilt.set(Math.max(-12, Math.min(12, v * 14)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; tilt.set(0);
    if (!d) return;
    const moved = Math.abs(e.clientX - d.x) > 6;
    go(target.get());
    if (moved) { e.preventDefault(); suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
  };
  const suppressClick = useRef(false);
  const open = (i: number, el: HTMLElement) => {
    if (suppressClick.current) return;
    if (i !== active) { go(i); return; }               // first click brings a side card to the centre
    if (i === 0) onAdd(); else onOpen(products[i - 1], el);
  };

  return <div className={`gallery ${dimmed ? "dimmed" : ""}`}>
    <div className="gallery-stage" ref={row} role="listbox" aria-label="Products, gallery" aria-activedescendant={undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(active + 1, true); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(active - 1, true); }
        else if (e.key === "Home") { e.preventDefault(); go(0, true); } else if (e.key === "End") { e.preventDefault(); go(count - 1, true); }
      }}>
      <div className="gallery-row">
        <GalleryCard index={0} pos={pos} tilt={tilt} active={active === 0} reduced={reduced} isAdd label="Add new product"
          onOpen={() => open(0, row.current as HTMLElement)} onFocusCard={() => { if (active !== 0) go(0); }}>
          <div className="gallery-add-inner"><span className="add-product-plus"><Plus size={24} /></span><strong>Add new product</strong><small>Name it, then train it from about 20 photos of good parts.</small></div>
        </GalleryCard>
        {products.map((p, k) => {
          const i = k + 1;
          return <GalleryCard key={p.objectId} index={i} pos={pos} tilt={tilt} active={active === i} reduced={reduced} label={`${p.objectName}${p.sku ? `, SKU ${p.sku}` : ""}, ${p.status}`}
            onOpen={() => open(i, row.current?.querySelector<HTMLElement>(`[data-index="${i}"]`) as HTMLElement)} onFocusCard={() => { if (active !== i) go(i); }}>
            <CardPhoto id={p.objectId} name={p.objectName} />
            <div className="gallery-info"><strong>{p.objectName}</strong>{p.sku ? <small>SKU {p.sku}</small> : <small>&nbsp;</small>}
              <span className={`status-chip ${CHIP[p.status]}`}>{p.status}</span></div>
          </GalleryCard>;
        })}
      </div>
    </div>
    <div className="gallery-controls">
      <button type="button" className="gallery-nav prev" aria-label="Previous product" onClick={() => go(active - 1)} disabled={active === 0}><ChevronLeft size={18} /></button>
      <span className="gallery-count" aria-live="polite">{active === 0 ? "Add new product" : `${active} / ${count - 1} · ${products[active - 1]?.objectName ?? ""}`}</span>
      <button type="button" className="gallery-nav next" aria-label="Next product" onClick={() => go(active + 1)} disabled={active === count - 1}><ChevronRight size={18} /></button>
    </div>
  </div>;
}

/** Empty state art: camera + part outline + sparkle (pure SVG). */
export function EmptyLibraryArt() {
  return <svg className="library-empty-art" viewBox="0 0 160 110" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="18" y="30" width="70" height="50" rx="8" /><path d="M38 30l6-10h16l6 10" /><circle cx="53" cy="55" r="14" /><circle cx="53" cy="55" r="5" />
    <circle cx="120" cy="62" r="24" strokeDasharray="5 5" /><circle cx="120" cy="62" r="9" strokeDasharray="4 4" /><path d="M128 18v10M123 23h10M146 40v6M143 43h6" />
  </svg>;
}
