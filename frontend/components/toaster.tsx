"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Check, Info, X } from "lucide-react";
import { dismiss, subscribe, type Toast } from "@/lib/toast";

/** Glass toasts, bottom-right. Polite live region, so screen readers hear them too. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  const reduced = useReducedMotion() ?? false;
  useEffect(() => { setMounted(true); return subscribe(setItems); }, []);
  if (!mounted) return null;
  return createPortal(<div className="toaster" role="status" aria-live="polite">
    <AnimatePresence initial={false}>{items.map((t) => <motion.div key={t.id} layout={!reduced} className={`toast toast-${t.kind}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }} transition={{ duration: reduced ? 0.15 : 0.25, ease: [0.22, 1, 0.36, 1] }}>
      <span className="toast-icon">{t.kind === "ok" ? <Check size={14} /> : t.kind === "error" ? <AlertCircle size={14} /> : <Info size={14} />}</span>
      <span className="toast-text">{t.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={13} /></button>
    </motion.div>)}</AnimatePresence>
  </div>, document.body);
}
