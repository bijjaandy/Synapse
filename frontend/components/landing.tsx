"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, Camera, ClipboardCheck, Cpu, Factory, LineChart, ScanLine, ShieldCheck, Timer, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/netrix-shell";

const STAGE_TEXT = [
  { kicker: "Netrix IQ", title: "Learn from perfection. Detect the rest.",
    text: "A camera inspector that learns only from good parts, and points at anything different. Scroll to see how it thinks." },
  { kicker: "Layer 1 · The photo", title: "A part arrives under the camera.",
    text: "Any camera, any part. A webcam is enough. Keep the same position and lighting you trained with." },
  { kicker: "Layer 2 · Seeing in patches", title: "It sees 784 small patches, not one picture.",
    text: "A pretrained network describes every small square of the photo: edges, texture, shape. On an ordinary laptop CPU." },
  { kicker: "Layer 3 · Good-part memory", title: "It remembers what good looks like.",
    text: "From 20 or more good photos it keeps the most varied patches as its memory. No defect photo is ever needed." },
  { kicker: "Layer 4 · Comparison", title: "Every patch is checked against the memory.",
    text: "A patch that matches nothing good stands out. The scan turns those differences into a heatmap." },
  { kicker: "Layer 5 · The decision", title: "Good, defective, unsure or retake.",
    text: "The line is set from good photos only. Close calls go to a person, bad photos get a retake, and a pin marks the spot." },
  { kicker: "All on the laptop", title: "Under a second per part. No internet.",
    text: "Learns a new part in about a minute, inspects in under a quarter of a second, and keeps every result for the shift." },
];

const WORKFLOW = [
  { icon: <Camera size={20} />, title: "Show it good parts", text: "Upload 20+ photos of correctly made parts, or capture them with the webcam until the meter says enough." },
  { icon: <Cpu size={20} />, title: "It learns in about a minute", text: "It picks the best model this laptop can run within the limits, and builds its memory of good." },
  { icon: <ScanLine size={20} />, title: "Inspect every new part", text: "A photo or the webcam. The answer comes in under a second, with the defect raised in 3D." },
  { icon: <ClipboardCheck size={20} />, title: "People make the close calls", text: "Unsure parts go to a QC inspector. Every “actually good” teaches the model instantly." },
];

const ROLES = [
  { icon: <Factory size={18} />, title: "Line Operator", text: "Teaches parts, inspects on the line, fixes false alarms in one click." },
  { icon: <ClipboardCheck size={18} />, title: "QC Inspector", text: "Verifies flagged parts, tests models, asks the local AI about results." },
  { icon: <LineChart size={18} />, title: "Shift Supervisor", text: "Sees the whole picture: totals, defect rates, speed and the shift report." },
];

const NUMBERS = [
  { icon: <Timer size={18} />, big: "68 s", label: "longest training of 15 parts", limit: "limit 10 min" },
  { icon: <ScanLine size={18} />, big: "249 ms", label: "slowest single photo", limit: "limit 1 s" },
  { icon: <ShieldCheck size={18} />, big: "0.960", label: "mean image AUROC, MVTec AD", limit: "15 objects" },
  { icon: <WifiOff size={18} />, big: "0", label: "internet needed, GPUs needed", limit: "laptop CPU" },
];

export default function Landing() {
  const section = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ setProgress: (p: number) => void; dispose: () => void } | null>(null);
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [noWebgl, setNoWebgl] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
      if (!ok) { setNoWebgl(true); return; }
      const mod = await import("@/lib/pipeline3d");
      if (cancelled || !host.current) return;
      scene.current = new mod.PipelineScene(host.current, "/images/sample-metal-part.png");
    })();
    return () => { cancelled = true; scene.current?.dispose(); scene.current = null; };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const el = section.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - window.innerHeight)));
      setProgress(p);
      setStage(Math.min(STAGE_TEXT.length - 1, Math.floor(p * STAGE_TEXT.length)));
      scene.current?.setProgress(p);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);

  const st = STAGE_TEXT[stage];
  return <main className="netrix-landing">
    <header className="landing-top">
      <BrandMark />
      <nav aria-label="Landing"><a href="#workflow">How it works</a><a href="#who">Who it’s for</a><a href="#numbers">Results</a></nav>
      <Link href="/login" className="landing-cta">Sign in <ArrowRight size={14} /></Link>
    </header>

    <section ref={section} className="pipeline" aria-label="How Netrix IQ inspects a part, layer by layer">
      <div className="pipeline-sticky">
        <div ref={host} className="pipeline-canvas" aria-hidden="true" />
        {noWebgl && <img src="/brand/netrix-logo.jpg" alt="Netrix IQ" className="pipeline-fallback" />}
        {stage === 0 && <motion.img src="/brand/netrix-logo.jpg" alt="Netrix IQ logo" className="pipeline-logo" initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }} />}
        <div className={`pipeline-text ${stage === 0 ? "intro" : ""}`} aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div key={stage} initial={reducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -14 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              <span className="pipeline-kicker">{st.kicker}</span>
              {stage === 0 ? <h1>{st.title}</h1> : <h2>{st.title}</h2>}
              <p>{st.text}</p>
              {stage === STAGE_TEXT.length - 1 && <Link href="/login" className="button-primary pipeline-go">Start inspecting <ArrowRight size={15} /></Link>}
            </motion.div>
          </AnimatePresence>
        </div>
        <ol className="pipeline-rail" aria-label="Pipeline steps">{STAGE_TEXT.slice(1, 6).map((s, i) =>
          <li key={s.kicker} className={stage === i + 1 ? "active" : stage > i + 1 ? "done" : ""}><span>{i + 1}</span>{s.kicker.split(" · ")[1]}</li>)}</ol>
        <div className="pipeline-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
        {stage === 0 && <span className="pipeline-scroll"><ArrowDown size={14} /> Scroll</span>}
      </div>
    </section>

    <section id="workflow" className="landing-section">
      <h2>How it works</h2>
      <p className="landing-lede">From a box of good parts to a working inspector in minutes. No defect photos, no GPU, no internet.</p>
      <ol className="workflow">{WORKFLOW.map((w, i) =>
        <motion.li key={w.title} initial={reducedMotion ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ delay: reducedMotion ? 0 : i * 0.1 }}>
          <span className="workflow-step">{i + 1}</span><span className="workflow-icon">{w.icon}</span><h3>{w.title}</h3><p>{w.text}</p>
        </motion.li>)}</ol>
    </section>

    <section id="who" className="landing-section landing-who">
      <h2>Built for the people on the line</h2>
      <div className="who-grid">{ROLES.map((r) => <article key={r.title}><span>{r.icon}</span><h3>{r.title}</h3><p>{r.text}</p></article>)}</div>
    </section>

    <section id="numbers" className="landing-section landing-numbers">
      <h2>Measured, not promised</h2>
      <div className="numbers-grid">{NUMBERS.map((n) => <div key={n.label}>{n.icon}<strong>{n.big}</strong><span>{n.label}</span><small>{n.limit}</small></div>)}</div>
      <p className="landing-note">MVTec AD, all 15 objects, resnet18 on a Colab CPU. Mean accuracy 0.881; weakest objects are screw, grid and pill.</p>
      <Link href="/login" className="button-primary landing-final">Sign in to Netrix IQ <ArrowRight size={15} /></Link>
    </section>

    <footer className="landing-footer"><BrandMark small /><span>SYNAPSE 2.0 · Problem statement 12</span></footer>
  </main>;
}
