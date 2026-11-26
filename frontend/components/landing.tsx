"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, Camera, Check, CircleSlash, Cpu, Droplets, ExternalLink, ImageOff, Languages, Palette, ScanLine, ShieldCheck, Timer, Users, WifiOff, Zap } from "lucide-react";
import { BrandMark } from "@/components/netrix-shell";
import { checkSession } from "@/lib/api";
import { hackathonName, teamNamePlaceholder } from "@/config/content";

const STAGE_TEXT = [
  { kicker: "Inside one inspection", title: "Five layers, one decision.",
    text: "Scroll to follow one part through the model, from the photo to the pin on the defect." },
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

const CHECKS = [
  { icon: <ScanLine size={20} />, title: "Scratches", text: "Thin marks the good parts never had, down to a few pixels wide." },
  { icon: <Zap size={20} />, title: "Cracks", text: "Breaks and splits in the surface, pinned where they start." },
  { icon: <CircleSlash size={20} />, title: "Missing parts", text: "A screw, a pin or a print that should be there and isn't." },
  { icon: <Droplets size={20} />, title: "Contamination", text: "Dirt, oil, residue or stray material on the part." },
  { icon: <Palette size={20} />, title: "Wrong colour", text: "A shade or a tint that doesn't match the good batch." },
  { icon: <ImageOff size={20} />, title: "Bad photos → retake", text: "Too dark, blurry or the wrong part: it asks for a new photo instead of guessing." },
];

const CHIPS = [
  { icon: <WifiOff size={14} />, text: "Offline" }, { icon: <Cpu size={14} />, text: "No GPU" }, { icon: <Timer size={14} />, text: "Under 1 s" },
  { icon: <Camera size={14} />, text: "20 photos" }, { icon: <Languages size={14} />, text: "Kannada" }, { icon: <Users size={14} />, text: "Human verification" },
];

const STEPS = [
  { title: "Add good photos", text: "About 20 photos of correctly made parts, from files or the webcam." },
  { title: "Train in about a minute", text: "It picks the best model this laptop can run and builds its memory of good." },
  { title: "Inspect every part", text: "A photo, the webcam or conveyor mode. The answer comes in under a second." },
  { title: "People verify close calls", text: "Unsure parts go to a QC inspector, and every correction teaches the model." },
];

const STATS = [
  { big: "0.96", unit: "AUROC", title: "Real accuracy", text: "Mean image AUROC on all 15 MVTec AD objects." },
  { big: "249", unit: "ms", title: "Fast", text: "The slowest single photo, on a laptop CPU." },
  { big: "68", unit: "s", title: "Light", text: "The longest training of all 15 objects." },
];

// AUROC per MVTec AD object (resnet18, CPU), for the results chart
const CHART = [0.99, 0.98, 0.97, 0.95, 0.99, 0.94, 0.86, 1.0, 0.96, 0.99, 0.88, 0.97, 0.95, 0.99, 0.93];

/** Soft letter reveal for headings: the heading watches the viewport, its words slide up one after another, once.
 *  (The words themselves can't watch: they start below their clipping box, so they would never count as visible.) */
function Reveal({ text, as = "h2", className = "" }: { text: string; as?: "h1" | "h2" | "h3"; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const words = text.split(" ");
  const Tag = as === "h1" ? motion.h1 : as === "h3" ? motion.h3 : motion.h2;
  return <Tag className={`lx-reveal ${className}`} aria-label={text} initial={reduced ? false : "hidden"} whileInView="show" viewport={{ once: true, amount: 0.3 }}
    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
    {words.map((w, i) => <span key={i} className="lx-word" aria-hidden="true">
      <motion.span variants={{ hidden: { y: "105%", opacity: 0 }, show: { y: 0, opacity: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } }}>{w}</motion.span>{i < words.length - 1 ? " " : ""}</span>)}
  </Tag>;
}

/** A section that fades and slides in once. */
function Fade({ children, className = "", id, delay = 0 }: { children: React.ReactNode; className?: string; id?: string; delay?: number }) {
  const reduced = useReducedMotion() ?? false;
  return <motion.section id={id} className={className} initial={reduced ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.section>;
}

/** Typed hero headline, two lines, with a caret; reduced motion shows it at once. */
function TypedHeadline({ lines }: { lines: string[] }) {
  const reduced = useReducedMotion() ?? false;
  const full = lines.join("\n");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) { setN(full.length); return; }
    const start = performance.now();   // characters follow the clock, so a busy main thread can't make it fall behind
    const timer = window.setInterval(() => { const k = Math.min(full.length, Math.floor((performance.now() - start) / 42)); setN(k); if (k >= full.length) window.clearInterval(timer); }, 30);
    return () => window.clearInterval(timer);
  }, [full, reduced]);
  const shown = full.slice(0, n).split("\n");
  return <h1 className="lx-hero-title" aria-label={lines.join(" ")}>
    {lines.map((_, i) => <span key={i} className="lx-hero-line" aria-hidden="true">{shown[i] ?? ""}{(shown.length - 1 === i && n < full.length) || (i === lines.length - 1 && n >= full.length) ? <span className="lx-caret" /> : null}</span>)}
  </h1>;
}

export default function Landing() {
  const reducedMotion = useReducedMotion() ?? false;
  const section = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const heroHost = useRef<HTMLDivElement>(null);
  const howRef = useRef<HTMLElement>(null);
  const scene = useRef<{ setProgress: (p: number) => void; dispose: () => void } | null>(null);
  const [stage, setStage] = useState(0);
  const [signedIn, setSignedIn] = useState(false);  // "Open app" instead of "Sign in" when a session exists
  const [progress, setProgress] = useState(0);
  const [noWebgl, setNoWebgl] = useState(false);
  const [tag, setTag] = useState<{ i: number; x: number; y: number } | null>(null);
  const [intro, setIntro] = useState(true);
  const [howStep, setHowStep] = useState(0);
  const [howP, setHowP] = useState(0);
  useEffect(() => { checkSession().then((s) => setSignedIn(!!s)); }, []);
  const appHref = signedIn ? "/inspect" : "/login";

  // intro: the logo fades in and out (~1.2 s); skipped with reduced motion or as soon as the page scrolls
  useEffect(() => {
    if (reducedMotion) { setIntro(false); return; }
    const t = window.setTimeout(() => setIntro(false), 1200);
    const skip = () => setIntro(false);
    window.addEventListener("scroll", skip, { once: true, passive: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });
    return () => { window.clearTimeout(t); window.removeEventListener("scroll", skip); window.removeEventListener("wheel", skip); };
  }, [reducedMotion]);

  const scrollToStage = (k: number) => {
    const el = section.current; if (!el) return;
    const p = (k + 0.5) / STAGE_TEXT.length;
    const top = el.getBoundingClientRect().top + window.scrollY + p * (el.offsetHeight - window.innerHeight);
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  };
  const scrollRef = useRef(scrollToStage); scrollRef.current = scrollToStage;

  // 3D scenes: the hero (isometric) and the scroll pipeline; both pause off-screen and clean up on unmount
  useEffect(() => {
    let cancelled = false;
    let hero: { dispose: () => void } | null = null;
    (async () => {
      const ok = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
      if (!ok) { setNoWebgl(true); return; }
      const [pipe, heroMod] = await Promise.all([import("@/lib/pipeline3d"), import("@/lib/hero3d")]);
      if (cancelled) return;
      if (heroHost.current) hero = new heroMod.HeroScene(heroHost.current);
      if (host.current) scene.current = new pipe.PipelineScene(host.current, "/images/sample-metal-part.png", {
        onHover: (i: number | null, x: number, y: number) => setTag(i === null ? null : { i, x, y }),
        onPick: (i: number) => scrollRef.current(i + 1),
      });
    })();
    return () => { cancelled = true; scene.current?.dispose(); scene.current = null; hero?.dispose(); };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const el = section.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - window.innerHeight)));
        setProgress(p);
        setStage(Math.min(STAGE_TEXT.length - 1, Math.floor(p * STAGE_TEXT.length)));
        scene.current?.setProgress(p);
      }
      const how = howRef.current;
      if (how) {
        const r = how.getBoundingClientRect();
        const q = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
        setHowP(q); setHowStep(Math.min(STEPS.length - 1, Math.floor(q * STEPS.length)));
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);

  const st = STAGE_TEXT[stage];
  // isometric circuit for "How it works": 4 nodes on a zig-zag path (SVG, lights up with scroll)
  const ISO = [[80, 250], [290, 140], [500, 250], [710, 140]];
  const pathD = `M20,282 L${ISO[0][0]},250 L${ISO[0][0] + 60},218 L${ISO[1][0] - 60},172 L${ISO[1][0]},140 L${ISO[1][0] + 60},172 L${ISO[2][0] - 60},218 L${ISO[2][0]},250 L${ISO[2][0] + 60},218 L${ISO[3][0] - 60},172 L${ISO[3][0]},140 L780,110`;
  const chartPts = CHART.map((v, i) => [20 + (i / (CHART.length - 1)) * 560, 210 - (v - 0.8) / 0.2 * 170] as const);
  const chartD = chartPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return <main className="netrix-landing lx">
    <AnimatePresence>{intro && <motion.div className="lx-intro" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} aria-hidden="true">
      <motion.img src="/brand/netrix-logo.jpg" alt="" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
    </motion.div>}</AnimatePresence>

    <header className="landing-top">
      <BrandMark />
      <nav aria-label="Landing"><a href="#how">How it works</a><a href="#checks">What it checks</a><a href="#results">Results</a></nav>
      <Link href={appHref} className="landing-cta">{signedIn ? "Open app" : "Sign in"} <ArrowRight size={14} /></Link>
    </header>

    <section className="lx-hero" id="top">
      <div className="lx-hero-copy">
        <span className="lx-kicker">Offline visual inspection · {hackathonName}</span>
        <TypedHeadline lines={["Learn from perfection,", "detect the rest."]} />
        <p className="lx-sub">Show it about 20 good parts. It flags anything different, on a laptop, in under a second.</p>
        <div className="lx-buttons">
          <Link href={appHref} className="lx-btn lx-btn-amber">Start inspecting <ArrowRight size={16} /></Link>
          <a href="#pipeline" className="lx-btn lx-btn-outline">See how it works</a>
        </div>
      </div>
      <div ref={heroHost} className="lx-hero-3d" aria-hidden="true">{noWebgl && <img src="/brand/netrix-logo.jpg" alt="" className="lx-hero-fallback" />}</div>
    </section>

    <section ref={section} id="pipeline" className="pipeline" aria-label="How Netrix IQ inspects a part, layer by layer">
      <div className="pipeline-sticky">
        <div ref={host} className="pipeline-canvas" aria-hidden="true" />
        {noWebgl && <img src="/brand/netrix-logo.jpg" alt="Netrix IQ" className="pipeline-fallback" />}
        <div className={`pipeline-text ${stage === 0 ? "intro" : ""}`} aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div key={stage} initial={reducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -14 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              <span className="pipeline-kicker">{st.kicker}</span>
              <h2>{st.title}</h2>
              <p>{st.text}</p>
              {stage === STAGE_TEXT.length - 1 && <motion.div initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : 0.55, duration: 0.4 }}>
                <Link href={appHref} className="lx-btn lx-btn-amber pipeline-go">Start inspecting <ArrowRight size={15} /></Link></motion.div>}
            </motion.div>
          </AnimatePresence>
        </div>
        <ol className={`pipeline-rail ${stage === 0 ? "intro-hidden" : ""}`} aria-label="Pipeline steps">{STAGE_TEXT.slice(1, 6).map((s, i) =>
          <li key={s.kicker} className={stage === i + 1 ? "active" : stage > i + 1 ? "done" : ""}>
            <button type="button" onClick={() => scrollToStage(i + 1)} aria-current={stage === i + 1 ? "step" : undefined} aria-label={`Go to step ${i + 1}: ${s.kicker.split(" · ")[1]}`}>
              <span className="rail-dot">{stage === i + 1 && <motion.i layoutId="rail-active" className="rail-active" transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }} />}<b>{i + 1}</b></span>{s.kicker.split(" · ")[1]}
            </button></li>)}</ol>
        {tag && <span className="layer-tag" style={{ left: tag.x, top: tag.y }} aria-hidden="true">{["1 · The photo", "2 · Seeing in patches", "3 · Good-part memory", "4 · Comparison", "5 · The decision"][tag.i]}</span>}
        <div className="pipeline-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
        {stage === 0 && <span className="pipeline-scroll"><ArrowDown size={14} /> Scroll</span>}
      </div>
    </section>

    <Fade id="checks" className="lx-section">
      <span className="lx-kicker">What it checks</span>
      <Reveal text="Anything a good part doesn't have." />
      <p className="lx-lede">It never needs a defect photo: whatever doesn't match the good parts stands out.</p>
      <div className="lx-checks">{CHECKS.map((c, i) => <motion.article key={c.title} className="lx-card lx-check"
        initial={reducedMotion ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, delay: reducedMotion ? 0 : i * 0.08 }} whileHover={reducedMotion ? undefined : { y: -6 }}>
        <span className="lx-icon">{c.icon}</span><h3>{c.title}</h3><p>{c.text}</p></motion.article>)}</div>
    </Fade>

    <Fade className="lx-section lx-trust">
      <span className="lx-kicker">One result you can act on</span>
      <Reveal text="Inspect once, trust every result." />
      <div className="lx-trust-grid">
        <div className="lx-card lx-glass lx-result">
          <div className="lx-result-head"><span className="lx-mono">Bottle · ID #0142 · wide_resnet50</span><span className="lx-pill lx-pill-pass">PASS &lt; 1 s</span></div>
          <div className="lx-verdict"><span className="lx-verdict-icon">!</span><div><small className="lx-mono">CLASSIFICATION</small><strong>Defective</strong></div></div>
          <div className="lx-metrics"><div><small className="lx-mono">SCORE</small><b>3.40</b><span>line 1.79</span></div><div><small className="lx-mono">LATENCY</small><b>124</b><span>ms</span></div></div>
          <div className="lx-gauge"><span style={{ width: "100%" }} /><i style={{ left: "52%" }} /></div>
          <p className="lx-where"><b>Where</b> top right, about 6% of the photo · a pin marks the spot</p>
          <div className="lx-result-actions"><span className="lx-pill">This was actually good</span><span className="lx-pill">Ask AI why</span></div>
        </div>
        <div className="lx-card lx-radar" aria-hidden="true">
          <div className="lx-radar-rings"><i /><i /><i /></div>
          <div className="lx-radar-sweep" />
          {[0, 1, 2, 3].map((k) => <div key={k} className={`lx-orbit lx-orbit-${k}`}><span /></div>)}
          <img src="/images/sample-metal-part.png" alt="" className="lx-radar-part" />
          <span className="lx-radar-label lx-mono">memory of good · 2 000 patches</span>
        </div>
      </div>
      <div className="lx-chips" aria-label="Highlights">{CHIPS.map((c, i) => <span key={c.text} className="lx-chip" style={{ ["--tilt" as string]: `${[-6, 4, -3, 6, -5, 3][i]}deg`, ["--delay" as string]: `${i * 0.7}s` }}>{c.icon}{c.text}</span>)}</div>
    </Fade>

    <section id="how" ref={howRef} className="lx-how" aria-label="How it works">
      <div className="lx-how-sticky">
        <span className="lx-kicker">How it works</span>
        <Reveal text="From a box of good parts to a working inspector." />
        <div className="lx-circuit">
          <svg viewBox="0 0 800 320" aria-hidden="true">
            <defs><filter id="lx-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
            <path d={pathD} className="lx-circuit-base" />
            <path d={pathD} className="lx-circuit-lit" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 - Math.min(1, howP * 1.15) }} filter="url(#lx-glow)" />
            {ISO.map(([x, y], i) => <g key={i} className={`lx-node ${i <= howStep ? "on" : ""} ${i === howStep ? "active" : ""}`}>
              <ellipse cx={x} cy={y} rx="34" ry="18" /><ellipse cx={x} cy={y - 8} rx="34" ry="18" className="lx-node-top" />
              <text x={x} y={y - 4} textAnchor="middle">{`0${i + 1}`}</text></g>)}
          </svg>
          <motion.span key={howStep} className="lx-step-label lx-mono" style={{ left: `${(ISO[howStep][0] / 800) * 100}%`, top: `${(ISO[howStep][1] / 320) * 100 - 26}%` }}
            initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>step 0{howStep + 1} / {STEPS[howStep].title}</motion.span>
        </div>
        <ol className="lx-steps">{STEPS.map((s, i) => <li key={s.title} className={i === howStep ? "active" : i < howStep ? "done" : ""}>
          <span className="lx-mono">0{i + 1}</span><h3>{s.title}</h3><p>{s.text}</p></li>)}</ol>
      </div>
    </section>

    <Fade id="results" className="lx-section lx-results">
      <span className="lx-kicker">Results</span>
      <Reveal text="Measured, not promised." />
      <div className="lx-stats">{STATS.map((s, i) => <motion.div key={s.title} className="lx-card lx-stat" initial={reducedMotion ? false : { opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }} transition={{ delay: reducedMotion ? 0 : i * 0.1 }}><small className="lx-mono">{s.title}</small><strong>{s.big}<span>{s.unit}</span></strong><p>{s.text}</p></motion.div>)}</div>
      <div className="lx-card lx-chart">
        <div className="lx-chart-head"><h3>AUROC per object, MVTec AD</h3><span className="lx-mono">15 objects · resnet18 · CPU</span></div>
        <svg viewBox="0 0 600 230" preserveAspectRatio="none" role="img" aria-label="AUROC per object between 0.86 and 1.0, mean 0.96">
          <defs>
            <linearGradient id="lx-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6B8E7B" stopOpacity=".35" /><stop offset="100%" stopColor="#6B8E7B" stopOpacity="0" /></linearGradient>
            <filter id="lx-line-glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {[0.85, 0.9, 0.95, 1].map((v) => <g key={v}><line x1="20" x2="580" y1={210 - (v - 0.8) / 0.2 * 170} y2={210 - (v - 0.8) / 0.2 * 170} className="lx-chart-grid" /><text x="0" y={214 - (v - 0.8) / 0.2 * 170} className="lx-chart-axis">{v.toFixed(2)}</text></g>)}
          <motion.path d={`${chartD} L580,210 L20,210 Z`} fill="url(#lx-area)" initial={reducedMotion ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.6, duration: 0.6 }} />
          <motion.path d={chartD} className="lx-chart-line" filter="url(#lx-line-glow)" initial={reducedMotion ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }} />
          {chartPts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" className="lx-chart-dot" />)}
        </svg>
        <div className="lx-callout lx-glass"><ShieldCheck size={16} /><div><strong>No defect photos needed</strong><span>learns from good parts only</span></div></div>
      </div>
    </Fade>

    <section className="lx-cta">
      <div className="lx-cta-copy">
        <Reveal text="Start inspecting with Netrix IQ" />
        <Link href={appHref} className="lx-btn lx-btn-amber">{signedIn ? "Open the app" : "Start inspecting"} <ArrowRight size={16} /></Link>
      </div>
      <div className="lx-planet" aria-hidden="true" />
    </section>

    <footer className="lx-footer">
      <div className="lx-footer-brand"><BrandMark small /><p>Learn from perfection. Detect the rest.</p></div>
      <nav aria-label="Footer"><Link href="/train">Train</Link><Link href="/inspect">Inspect</Link><Link href="/objects">Object library</Link><Link href="/summary">Summary</Link>
        <a href="https://github.com/bijjaandy/Synapse" target="_blank" rel="noreferrer"><ExternalLink size={14} /> GitHub</a></nav>
      <div className="lx-footer-meta"><span>Team {teamNamePlaceholder}</span><span>SYNAPSE 2.0 · PS 12</span><span><Check size={12} /> Runs offline on this laptop</span></div>
    </footer>
  </main>;
}
