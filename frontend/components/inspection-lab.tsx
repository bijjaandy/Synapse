"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, animate as animateMotion, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import useSWR from "swr";
import { EvaluationPanel, LimitationsPanel, ObjectLibraryPanel, ProjectTargetsStrip, RuntimeStatusPanel } from "@/components/inspection-panels";
import { Activity, ArrowDown, ArrowRight, Box, Check, ChevronDown, CircleHelp, Clock3, Download, FileImage, Gauge, Layers3, LoaderCircle, Menu, Moon, Plus, ScanLine, ShieldCheck, Sun, TriangleAlert, Upload, Wifi, WifiOff, X } from "lucide-react";
import { API_URL, checkHealth, getHistory, getLoggedParts, getObjectStatuses, getShiftReport, getTrainStatus, inspect, logCsvUrl, markGood, reportPageUrl, trainObject, type AutoEstimate, type Backbone, type InspectionRecord, type InspectionResult, type ObjectTrainingStatus, type ShiftReport, type TrainState } from "@/lib/api";
import { FeedbackButton, InspectionStage3D, VerdictReasons, WebcamCapture } from "@/components/live-panels";
import { hackathonName, historyErrorCopy, historyLoadingCopy, layerCopy, layerLegendHeading, collapseLabel, demoModeLabel, explodeLabel, sampleDataLabel, limitationCopy, limitationTitle, maxTrainingFiles, minimumGoodImages, navigationItems, objectCategories, pageCopy, projectName, projectTargets, runtimeStatusCopy, runtimeTargetCopy, systemSectionDescription, systemSectionTitle, toolsSectionDescription, toolsSectionTitle, sampleImagePaths, steps, teamNamePlaceholder, trainingBudgetSeconds, trainingErrorCopy, trainingInstruction, trainingMinimumCopy } from "@/config/content";

const mono = "font-mono";
const navItems = navigationItems;

function Eyebrow({ children }: { children: React.ReactNode }) { return <div className={`${mono} eyebrow text-[10px] uppercase tracking-[.16em]`}>{children}</div>; }
function CornerFrame({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <div className={`corner-frame ${className}`}>{children}</div>; }

function useSectionProgress(sectionRef: React.RefObject<HTMLElement | null>) {
  const { scrollY } = useScroll();
  const sectionTop = useMotionValue(0);
  const scrollLength = useMotionValue(1);
  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;
    const measure = () => {
      sectionTop.set(element.getBoundingClientRect().top + window.scrollY);
      scrollLength.set(Math.max(1, element.offsetHeight - window.innerHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [scrollLength, sectionRef, sectionTop]);
  return useTransform([scrollY, sectionTop, scrollLength], ([scroll, top, length]) => Math.max(0, Math.min(1, (Number(scroll) - Number(top)) / Math.max(1, Number(length)))));
}

function MagneticLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  const reducedMotion = useReducedMotion() ?? false;
  const x = useSpring(0, { stiffness: 140, damping: 18 });
  const y = useSpring(0, { stiffness: 140, damping: 18 });
  function followPointer(event: React.MouseEvent<HTMLAnchorElement>) {
    if (reducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - bounds.left - bounds.width / 2) * 0.11);
    y.set((event.clientY - bounds.top - bounds.height / 2) * 0.12);
  }
  return <motion.a href={href} className={className} style={{ x, y }} onMouseMove={followPointer} onMouseLeave={() => { x.set(0); y.set(0); }} whileHover={reducedMotion ? undefined : { scale: 1.025 }} transition={{ type: "spring", stiffness: 180, damping: 17 }}>{children}</motion.a>;
}

function ExplodedLayer({
  layer, index, scrollProgress, pointerX, pointerY, active, hovered, reducedMotion, onHover, onLeave,
}: {
  layer: { type: string };
  index: number;
  scrollProgress: ReturnType<typeof useScroll>["scrollYProgress"];
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  active: number;
  hovered: number | null;
  reducedMotion: boolean;
  onHover: (index: number) => void;
  onLeave: () => void;
}) {
  const baseY = [-68, -34, 0, 34, 68][index];
  const expandedY = [-132, -66, 0, 66, 132][index];
  const baseZ = [80, 40, 0, -40, -80][index];
  const expandedZ = [150, 75, 0, -75, -150][index];
  const scrollY = useTransform(scrollProgress, [0, 1], [baseY, expandedY]);
  const scrollZ = useTransform(scrollProgress, [0, 1], [baseZ, expandedZ]);
  const hoverLift = useSpring(hovered === index ? 42 : 0, { stiffness: 92, damping: 22 });
  const layerParallaxY = useTransform(pointerY, [-0.5, 0.5], [-(index + 1) * 1.2, (index + 1) * 1.2]);
  const layerParallaxZ = useTransform(pointerX, [-0.5, 0.5], [-(index + 1) * 1.5, (index + 1) * 1.5]);
  const y = useTransform([scrollY, layerParallaxY], ([scroll, parallax]) => Number(scroll) + Number(parallax));
  const z = useTransform([scrollZ, hoverLift, layerParallaxZ], ([depth, lift, parallax]) => Number(depth) + Number(lift) + Number(parallax));
  const dimmed = hovered !== null && hovered !== index;

  return <motion.button
    type="button"
    className={`stack-layer ${layer.type} ${active === index ? "selected" : ""} ${hovered === index ? "is-hovered" : ""}`}
    style={{ y: reducedMotion ? baseY : y, z: reducedMotion ? baseZ : z, rotateX: reducedMotion ? 0 : 54, rotateZ: -24 }}
    animate={{ opacity: dimmed ? 0.4 : 1, scale: hovered === index && !reducedMotion ? 1.025 : 1 }}
    transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
    onMouseEnter={() => onHover(index)}
    onMouseLeave={onLeave}
    onFocus={() => onHover(index)}
    onBlur={onLeave}
    aria-label={`Layer ${index + 1}: ${layerCopy[index].title}`}
    aria-pressed={active === index}
  >
    <span className="layer-number">0{index + 1}</span>
    {layer.type === "photo" ? <Image src={sampleImagePaths[0]} alt="Original sample image of a precision metal fastener" fill sizes="300px" className="stack-photo" /> : <div className={`layer-art art-${layer.type}`}>{layer.type === "normal" && <Image src={sampleImagePaths[0]} alt="Normalised sample part image" fill sizes="300px" className="stack-photo muted-photo" />}{layer.type === "feature" && <div className="feature-lines" aria-label="Feature map visualisation of edges and texture" />}{layer.type === "memory" && <div className="memory-grid" aria-label="Good-parts memory reference thumbnails">{sampleImagePaths.slice(0, 4).map((path, thumbnailIndex) => <span key={path} className="memory-thumbnail"><Image src={path} alt={`Good reference thumbnail ${thumbnailIndex + 1}`} fill sizes="75px" /></span>)}</div>}{layer.type === "anomaly" && <><Image src={sampleImagePaths[0]} alt="Sample part with illustrative heatmap and defect outline" fill sizes="300px" className="stack-photo" /><span className="heat-spot" /><span className="stack-defect-outline" /></>}</div>}
    <span className="layer-label">{layerCopy[index].title.toUpperCase()}</span>
  </motion.button>;
}

function HeroStack({ scrollProgress }: { scrollProgress: MotionValue<number> }) {
  const [active, setActive] = useState(4);
  const [hovered, setHovered] = useState<number | null>(null);
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);
  const [scrollExpanded, setScrollExpanded] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 80, damping: 18 });
  const springY = useSpring(pointerY, { stiffness: 80, damping: 18 });
  const scrollTilt = useTransform(scrollProgress, [0, 0.44, 0.82, 1], [0, 3.5, 3.5, 0]);
  const scrollExpansion = useTransform(scrollProgress, [0, 0.12, 0.46, 0.8, 1], [0, 0, 1, 1, 0]);
  const manualExpansion = useMotionValue(0);
  const reducedExpansion = useMotionValue(0);
  const expansion = manualOverride === null ? scrollExpansion : manualExpansion;
  const expanded = manualOverride ?? scrollExpanded;
  const mouseTiltX = useTransform(springY, [-0.5, 0.5], [4, -4]);
  const mouseTiltY = useTransform(springX, [-0.5, 0.5], [-6, 6]);
  const rotateX = useTransform([mouseTiltX, scrollTilt], ([mouse, scroll]) => Number(mouse) + Number(scroll));
  const connectorProgress = useTransform(expansion, [0, 1], [0.2, 1]);
  const layers = [
    { type: "photo" }, { type: "normal" }, { type: "feature" }, { type: "memory" }, { type: "anomaly" },
  ];

  useMotionValueEvent(scrollExpansion, "change", (progress) => {
    if (manualOverride === null) setScrollExpanded(progress > 0.5);
  });

  useEffect(() => {
    if (manualOverride === null) return;
    const animation = animateMotion(manualExpansion, manualOverride ? 1 : 0, { duration: reducedMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] });
    return () => animation.stop();
  }, [manualExpansion, manualOverride, reducedMotion]);

  function trackPointer(event: React.MouseEvent<HTMLDivElement>) {
    if (reducedMotion) return;
    const box = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - box.left) / box.width - 0.5);
    pointerY.set((event.clientY - box.top) / box.height - 0.5);
  }

  function selectLayer(index: number) {
    setActive(index);
    setHovered(index);
  }

  return <div className="hero-visual" onMouseMove={trackPointer} onMouseLeave={() => { pointerX.set(0); pointerY.set(0); setHovered(null); }}>
    <div className="visual-grid" aria-hidden="true" />
    <div className="visual-coordinate">X 024.8 <span>Y 013.2</span> <span>FOV 12MM</span></div>
    <div className="stack-stage">
      <motion.div className="stack-assembly" style={{ rotateX: reducedMotion ? 0 : rotateX, rotateY: reducedMotion ? 0 : mouseTiltY }}>
        {layers.map((layer, index) => <ExplodedLayer key={layer.type} layer={layer} index={index} scrollProgress={reducedMotion ? reducedExpansion : expansion} pointerX={springX} pointerY={springY} active={active} hovered={hovered} reducedMotion={reducedMotion} onHover={selectLayer} onLeave={() => setHovered(null)} />)}
        <svg className="connectors" viewBox="0 0 440 380" aria-hidden="true"><motion.path d="M74 58 L74 315 M366 58 L366 315" pathLength={1} style={{ pathLength: reducedMotion ? 1 : connectorProgress }} /></svg>
      </motion.div>
      <div className="ruler ruler-left"><span>0</span><i /><i /><i /><i /><span>10 mm</span></div>
    </div>
    <aside className="layer-legend" aria-label="Inspection layer legend">
      <div className="layer-legend-head"><Eyebrow>{layerLegendHeading}</Eyebrow><button type="button" className="stack-toggle" aria-pressed={expanded} onClick={() => setManualOverride(!(manualOverride ?? scrollExpanded))}>{expanded ? collapseLabel : explodeLabel}<ArrowRight size={13} /></button></div>
      {layers.map((layer, index) => <button type="button" key={layer.type} className={`layer-legend-row ${active === index ? "active" : ""}`} onMouseEnter={() => selectLayer(index)} onMouseLeave={() => setHovered(null)} onFocus={() => selectLayer(index)} onBlur={() => setHovered(null)} onClick={() => selectLayer(index)} aria-pressed={active === index}>
        <span className="layer-legend-number">0{index + 1}</span><span className="layer-legend-copy"><strong>{layerCopy[index].title}</strong><small>{layerCopy[index].detail}</small></span>
      </button>)}
    </aside>
    <div className="visual-footer"><span className={mono}>VISION PIPELINE / DEMO</span><span className={mono}>01—05</span></div>
  </div>;
}

function FloatingSample({ path, index, pointerX, pointerY, reducedMotion }: { path: string; index: number; pointerX: MotionValue<number>; pointerY: MotionValue<number>; reducedMotion: boolean }) {
  const parallaxX = useTransform(pointerX, [-0.5, 0.5], [-(index + 1) * 1.5, (index + 1) * 1.5]);
  const parallaxY = useTransform(pointerY, [-0.5, 0.5], [-(index + 1), (index + 1)]);
  const drift = [8, -10, 12, -9][index];
  return <motion.div className={`sample-float sample-float-${index + 1}`} style={{ x: reducedMotion ? 0 : parallaxX, y: reducedMotion ? 0 : parallaxY }}>
    <motion.div className="sample-float-drift" animate={reducedMotion ? undefined : { x: [0, drift], y: [0, index % 2 ? -8 : 8] }} transition={{ duration: 12 + index, repeat: Infinity, repeatType: "reverse", ease: [0.22, 1, 0.36, 1] }}>
      <CornerFrame><Image src={path} alt="" fill sizes="120px" className="sample-photo" /><span className={`sample-caption ${mono}`}>SAMPLE / {String(index + 1).padStart(2, "0")}</span>{(index === 1 || index === 2) && <span className="sample-marker" />}</CornerFrame>
    </motion.div>
  </motion.div>;
}

function FloatingSamples() {
  const reducedMotion = useReducedMotion() ?? false;
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  useEffect(() => {
    if (reducedMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const move = (event: PointerEvent) => {
      pointerX.set((event.clientX / window.innerWidth - 0.5) * 2);
      pointerY.set((event.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [pointerX, pointerY, reducedMotion]);
  return <div className="float-samples" aria-hidden="true">{sampleImagePaths.slice(0, 4).map((path, index) => <FloatingSample key={path + index} path={path} index={index} pointerX={pointerX} pointerY={pointerY} reducedMotion={reducedMotion} />)}</div>;
}

function AnimatedScore({ value }: { value: number | null }) {
  const reducedMotion = useReducedMotion() ?? false;
  const count = useMotionValue(0);
  const display = useTransform(count, (latest) => latest.toFixed(2));
  useEffect(() => {
    const animation = animateMotion(count, value ?? 0, { duration: reducedMotion ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => animation.stop();
  }, [count, reducedMotion, value]);
  return <motion.strong>{value === null ? "—" : display}</motion.strong>;
}

function RollingTimer({ elapsedText }: { elapsedText: string }) {
  const reducedMotion = useReducedMotion() ?? false;
  return <span className="rolling-timer" role="timer" aria-label={`Elapsed time ${elapsedText}`}><span aria-hidden="true">{elapsedText.split("").map((digit, index) => <span className="timer-digit" key={index}><AnimatePresence initial={false} mode="popLayout"><motion.span key={`${index}-${digit}`} initial={reducedMotion ? false : { y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reducedMotion ? undefined : { y: -12, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>{digit}</motion.span></AnimatePresence></span>)}</span></span>;
}

function OfflineIndicator({ online }: { online: boolean }) {
  return <span className={`offline-indicator ${online ? "is-online" : "is-offline"}`} aria-live="polite">{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? pageCopy.onlineStatus : pageCopy.offlineStatus}</span>;
}

function SectionHeading({ index, title, description, dark = false }: { index: string; title: string; description: string; dark?: boolean }) {
  const reducedMotion = useReducedMotion() ?? false;
  const words = title.split(" ");
  const breakAt = title.length > 28 ? Math.ceil(words.length / 2) : words.length;
  const headingLines = [words.slice(0, breakAt).join(" "), words.slice(breakAt).join(" ")].filter(Boolean);
  return <div className={`section-heading ${dark ? "on-dark" : ""}`}>
    <Eyebrow>{pageCopy.sectionLabel} {index} <span className="heading-line" /></Eyebrow>
    <h2 className="heading-mask" aria-label={title}>{headingLines.map((line, lineIndex) => <motion.span className="heading-mask-line" key={line} aria-hidden="true" initial={reducedMotion ? false : "hidden"} whileInView={reducedMotion ? undefined : "visible"} viewport={{ once: true, amount: 0.6 }} variants={{ hidden: { opacity: 1 }, visible: { opacity: 1 } }}><motion.span variants={reducedMotion ? undefined : { hidden: { y: "100%", opacity: 0 }, visible: { y: 0, opacity: 1 } }} transition={{ duration: reducedMotion ? 0 : 0.8, delay: reducedMotion ? 0 : lineIndex * 0.08, ease: [0.22, 1, 0.36, 1] }}>{line}</motion.span></motion.span>)}</h2>
    <p>{description}</p>
  </div>;
}

export type LabView = "dashboard" | "evaluation" | "objects" | "history" | "summary";
const VIEW_SECTIONS: Record<LabView, string[]> = {
  dashboard: ["train", "inspect"], evaluation: ["tools"], objects: ["tools"], history: ["history"], summary: ["spec"],
};

/** Without `view`: the original single long page. With `view`: only that page's sections, inside the Netrix IQ app shell. */
export default function InspectionLab({ view: page }: { view?: LabView } = {}) {
  const show = (section: string) => !page || VIEW_SECTIONS[page].includes(section);
  const [dark, setDark] = useState(false);
  const [online, setOnline] = useState(true);
  const [activeSection, setActiveSection] = useState("top");
  const [toolsTab, setToolsTab] = useState<"evaluation" | "objects">(page === "objects" ? "objects" : "evaluation");
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => {
    const sectionIds = [...new Set(navItems.map((item) => item.section))];
    const sections = sectionIds.map((id) => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver((entries) => {
      const active = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (active) setActiveSection((active.target as HTMLElement).id);
    }, { rootMargin: "-22% 0px -66% 0px", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const activeNav = activeSection === "tools" ? toolsTab : activeSection;
  const heroRef = useRef<HTMLElement | null>(null);
  const methodRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const heroProgress = useSectionProgress(heroRef);
  const methodProgress = useSectionProgress(methodRef);
  const [activeStep, setActiveStep] = useState(0);
  useMotionValueEvent(methodProgress, "change", (progress) => setActiveStep(Math.min(3, Math.floor(progress * 4))));
  const [selectedObject, setSelectedObjectState] = useState<string>("bottle");
  useEffect(() => { try { const saved = window.localStorage.getItem("netrix.part"); if (saved) setSelectedObjectState(saved); } catch { /* ignore */ } }, []);
  const setSelectedObject = (id: string) => { setSelectedObjectState(id); try { window.localStorage.setItem("netrix.part", id); } catch { /* ignore */ } };
  const [trainingFiles, setTrainingFiles] = useState<File[]>([]);
  const [trainState, setTrainState] = useState<TrainState>("idle");
  const [trainProgress, setTrainProgress] = useState(0);
  const progressScale = useSpring(0, { stiffness: 74, damping: 19 });
  useEffect(() => { progressScale.set(trainProgress / 100); }, [progressScale, trainProgress]);
  const [elapsed, setElapsed] = useState(0);
  const [trainLog, setTrainLog] = useState<string[]>([]);
  const [trainedBackbone, setTrainedBackbone] = useState<string | null>(null);
  const [autoReport, setAutoReport] = useState<AutoEstimate[] | null>(null);
  const [backbone, setBackbone] = useState<Backbone>("auto");
  const [rotates, setRotates] = useState(false);
  const [inspectionFile, setInspectionFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [inspectedObject, setInspectedObject] = useState<string | null>(null);
  const gaugeFraction = inspection ? Math.min(1, inspection.score / (2 * inspection.threshold)) : 0;
  const scoreProgress = useSpring(gaugeFraction, reducedMotion ? { stiffness: 900, damping: 90 } : { stiffness: 80, damping: 18 });
  useEffect(() => { scoreProgress.set(gaugeFraction); }, [gaugeFraction, scoreProgress]);
  const scoreNeedle = useTransform(scoreProgress, [0, 1], ["0%", "100%"]);
  const [inspecting, setInspecting] = useState(false);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [heatOpacity, setHeatOpacity] = useState(85);
  const [showOutline, setShowOutline] = useState(true);
  const [showLayers, setShowLayers] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<string>(pageCopy.historyAll);
  const [historyPart, setHistoryPart] = useState<string>("");          // "" = all parts
  const [reportRange, setReportRange] = useState<string>("12");        // hours, or "all"
  const logFilter = { object: historyPart || null, hours: reportRange === "all" ? null : Number(reportRange) };
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [untrainedPart, setUntrainedPart] = useState<string | null>(null);   // /predict said this part has no model
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const trainInput = useRef<HTMLInputElement>(null);
  const inspectInput = useRef<HTMLInputElement>(null);
  const currentObject = objectCategories.find((item) => item.id === selectedObject) ?? { id: selectedObject, name: selectedObject, code: "CUS" };
  const { data: backendOk } = useSWR("backend-health", checkHealth, { refreshInterval: 5000 });
  const { data: history = [], error: historyError, isLoading: historyLoading, mutate: mutateHistory } = useSWR<InspectionRecord[]>(["inspection-history", historyPart], () => getHistory(historyPart || null));
  const { data: loggedParts = [], mutate: mutateLoggedParts } = useSWR<string[]>("logged-parts", getLoggedParts);
  const { data: objectStatuses = [], error: objectStatusError, isLoading: objectStatusesLoading, mutate: mutateObjectStatuses } = useSWR<ObjectTrainingStatus[]>("object-statuses", getObjectStatuses);
  const { data: shift, mutate: mutateShift } = useSWR<ShiftReport>(["shift-report", historyPart, reportRange], () => getShiftReport(logFilter));
  const visibleHistory = useMemo(() => historyFilter === pageCopy.historyAll ? history : history.filter((item) => item.verdict === historyFilter), [history, historyFilter]);
  const elapsedText = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const photoUrl = useMemo(() => inspectionFile ? URL.createObjectURL(inspectionFile) : null, [inspectionFile]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const thumbUrls = useMemo(() => trainingFiles.slice(0, 24).map((file) => file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [trainingFiles]);
  useEffect(() => () => thumbUrls.forEach((url) => url && URL.revokeObjectURL(url)), [thumbUrls]);
  const imageCount = trainingFiles.filter((file) => file.type.startsWith("image/")).length;
  const hasZip = trainingFiles.some((file) => file.name.toLowerCase().endsWith(".zip"));
  const canTrain = (hasZip || imageCount >= minimumGoodImages) && trainState !== "learning";
  const verdictClass = inspection ? inspection.verdict.toLowerCase() : "waiting";

  function addTrainingFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".zip"));
    setTrainingFiles((existing) => [...existing, ...accepted].slice(0, maxTrainingFiles));
    setTrainState("idle");
  }

  async function startTraining() {
    if (!canTrain) return;
    const objectId = selectedObject;
    const goodFiles = [...trainingFiles];
    setTrainState("learning");
    setTrainingError(null);
    setTrainProgress(0);
    setElapsed(0);
    setTrainLog([`Uploading ${goodFiles.length} file(s)…`]);
    setTrainedBackbone(null);
    setAutoReport(null);
    try {
      const { jobId } = await trainObject(objectId, goodFiles, { backbone, rotations: rotates ? 8 : 1 });
      let status = await getTrainStatus(jobId);
      while (status.state === "learning") {
        setElapsed(status.elapsedSec);
        setTrainProgress(status.progress);
        setTrainLog(status.log);
        setTrainedBackbone(status.backbone);
        setAutoReport(status.autoReport);
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        status = await getTrainStatus(jobId);
      }
      setTrainLog(status.log);
      setTrainedBackbone(status.backbone);
      setAutoReport(status.autoReport);
      if (status.state === "error") throw new Error(status.error ?? trainingErrorCopy);
      setElapsed(Math.round(status.trainSeconds ?? status.elapsedSec));
      setTrainProgress(100);
      await mutateObjectStatuses();
      setTrainState("done");
    } catch (cause) {
      setTrainingError(cause instanceof Error ? cause.message : trainingErrorCopy);
      setTrainState("error");
    }
  }

  async function runInspection(file: File) {
    setInspecting(true);
    setInspection(null);
    setInspectionError(null);
    setUntrainedPart(null);
    setFeedbackDone(null);
    setInspectionFile(file);
    try {
      // known to have no model: say so without a request that can only 404 (the 404 path below still covers a stale list)
      if (objectStatuses.find((s) => s.objectId === selectedObject)?.status === "Not trained") throw new Error(`no trained model for '${selectedObject}'`);
      const result = await inspect(selectedObject, file);
      setInspection(result);
      setInspectedObject(selectedObject);
      mutateHistory();
      mutateShift();
      mutateLoggedParts();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Inspection could not run. Try another photo.";
      if (message.startsWith("no trained model for")) setUntrainedPart(selectedObject);
      setInspectionError(message);
    } finally {
      setInspecting(false);
    }
  }

  function goTrain(part: string) {
    setSelectedObject(part);
    setUntrainedPart(null);
    setInspectionError(null);
    document.getElementById("train")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  async function confirmGood() {
    if (!inspection || !inspectionFile || !inspectedObject) return;
    const now = await markGood(inspectedObject, inspectionFile, inspection.inspectionId);
    setFeedbackDone(`Learned as good, with no retraining. This photo now reads: ${now}.`);
    mutateHistory();
    mutateShift();
  }

  const header = <header className="topbar"><a href="#top" className="brand" aria-label="Sightline home"><span className="brand-mark"><ScanLine size={18} /></span><span>{projectName}<small>{pageCopy.brandDescriptor}</small></span></a><nav className={menuOpen ? "nav-open" : ""} aria-label="Main navigation">{navItems.map((item) => { const tab = "tab" in item ? item.tab : undefined; const key = tab ?? item.section; return <a key={item.label} className={activeNav === key ? "active" : ""} aria-current={activeNav === key ? "location" : undefined} href={item.href} onClick={() => { setMenuOpen(false); if (tab) setToolsTab(tab); }}>{item.label}</a>; })}</nav><div className="top-actions"><span className={`sample-badge topbar-demo ${backendOk === false ? "is-down" : "is-live"}`}>{backendOk === undefined ? "CHECKING SERVER" : backendOk ? demoModeLabel : "SERVER OFFLINE"}</span><OfflineIndicator online={online} /><button className="icon-button theme-button" onClick={() => setDark((value) => !value)} aria-label={dark ? "Use light appearance" : "Use dark appearance"}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button><button className="mobile-menu icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle navigation">{menuOpen ? <X size={18} /> : <Menu size={18} />}</button><MagneticLink className="nav-cta" href="#inspect">{pageCopy.openInspector} <ArrowRight size={14} /></MagneticLink></div></header>;
  const Shell = page ? "div" : "main";
  return <Shell className={`${dark ? "lab-shell dark-mode" : "lab-shell"}${page ? ` lab-view lab-view-${page}` : ""}`}>
    {!page && header}
    {!page && <>
    <section ref={heroRef} className="hero" id="top"><FloatingSamples /><div className="hero-copy"><Eyebrow><span className="live-pip" /> {pageCopy.heroEyebrow}</Eyebrow><motion.h1 className="hero-title" initial={reducedMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}>{pageCopy.heroHeadline}<motion.em initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.8, delay: reducedMotion ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}>{pageCopy.heroEmphasis}</motion.em></motion.h1><p className="hero-subtitle">{pageCopy.heroSubtitle}</p><div className="hero-buttons"><MagneticLink className="button-primary" href="#inspect">{pageCopy.tryInspector} <ArrowDown size={15} /></MagneticLink><MagneticLink className="button-secondary" href="#train">{pageCopy.trainNewPart} <ArrowRight size={15} /></MagneticLink></div><div className="hero-footnote"><span className="sample-badge">{sampleDataLabel}</span><span>{pageCopy.previewNote}</span></div><ProjectTargetsStrip /></div><HeroStack scrollProgress={heroProgress} /><div className="hero-bottom"><span className={mono}>{pageCopy.heroFigure}</span><span className={mono}>{pageCopy.scrollPrompt} <ArrowDown size={12} /></span></div></section>
    </>}
    {!page && <>
    <section ref={methodRef} className="method-section" id="method"><div className="method-intro"><SectionHeading index="01" title={pageCopy.methodTitle} description={pageCopy.methodDescription} /><div className="method-meta"><span className="sample-badge">{sampleDataLabel}</span><span className={mono}>{pageCopy.processTag}</span></div></div><div className="method-layout"><div className="method-steps"><div className="method-progress-track" aria-hidden="true"><motion.span className="method-progress-fill" style={{ scaleY: reducedMotion ? 1 : methodProgress }} /></div>{steps.map((step, index) => <motion.article key={step.number} layout className={`method-step ${activeStep === index ? "active" : ""}`} initial={reducedMotion ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: reducedMotion ? 0 : 0.8, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}><span className={`${mono} step-number`}>{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><span className="step-indicator">{index === 3 ? <Check size={15} /> : <ArrowRight size={15} />}</span></motion.article>)}</div><div className={`method-figure stage-${activeStep}`}><div className="figure-head"><Eyebrow>{pageCopy.referenceObject}</Eyebrow><span className={`${mono} figure-dim`}>{pageCopy.referenceDiameter}</span></div><CornerFrame className="method-photo"><Image src={sampleImagePaths[0]} alt="Sample precision metal fastener" fill sizes="(max-width: 800px) 90vw, 460px" className="part-image" /><span className="figure-cross cross-a">+</span><span className="figure-cross cross-b">+</span><motion.span className="heat-spot method-spot" animate={{ opacity: activeStep < 1 ? 0 : activeStep === 1 ? 0.18 : activeStep === 2 ? 0.52 : 1, scale: activeStep === 3 ? 1.2 : 0.86 }} transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 105, damping: 20 }} /></CornerFrame><div className="figure-footer"><span className={mono}>{pageCopy.referenceImageNumber}</span><span className="figure-line" /><span className={mono}>GOOD REFERENCE</span></div></div></div></section>
    </>}
    {show("train") && <>
    <section className="console-section" id="train"><div className="console-top"><SectionHeading index="02" title={pageCopy.trainingTitle} description={pageCopy.trainingDescription} dark /><div className="console-code"><span className="live-pip" /> {pageCopy.localConsole} <span className="console-sep">/</span> TRAIN</div></div>
      <div className="console-panel">
        <div className="panel-title"><div><span className="panel-index">A</span><div><h3>{pageCopy.trainingSetup}</h3><p>{pageCopy.trainingSetupDescription}</p></div></div><span className="sample-badge dark-badge">{sampleDataLabel}</span></div>
        <div className="training-instruction"><ShieldCheck size={18} /><p>{trainingInstruction}</p></div>
        <div className="object-picker"><div className="picker-label"><Eyebrow>{pageCopy.objectCategory}</Eyebrow><span className={`${mono} muted-small`}>{pageCopy.selectedObjectCount}</span></div>
          <div className="object-grid">{objectCategories.map((object) => <button key={object.id} type="button" disabled={trainState === "learning"} className={`object-tile ${selectedObject === object.id ? "active" : ""}`} onClick={() => setSelectedObject(object.id)} aria-pressed={selectedObject === object.id}><span className="object-icon">{object.code.slice(0, 1)}</span><span>{object.name}</span><span className={`${mono} object-code`}>{object.code}</span></button>)}</div>
          <CustomPartInput current={selectedObject} disabled={trainState === "learning"} onUse={setSelectedObject} />
        </div>
        <div className="upload-row"><div className="upload-label"><Eyebrow>{pageCopy.goodPhotos}</Eyebrow><span className={`${mono} muted-small`}>{imageCount} {pageCopy.imageCountLabel}{hasZip ? " + ZIP" : ""}</span></div>
          <input ref={trainInput} className="sr-only" type="file" accept="image/*,.zip" multiple onChange={(event) => { if (event.target.files) addTrainingFiles(event.target.files); event.target.value = ""; }} />
          <button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={() => trainInput.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addTrainingFiles(event.dataTransfer.files); }}><span className="upload-icon"><Upload size={17} /></span><span><strong>{pageCopy.dropGoodPhotos}</strong><small>{pageCopy.browseGoodPhotos}</small></span><span className="upload-add"><Plus size={17} /></span></button>
          <WebcamCapture mode="train" disabled={trainState === "learning"} onCaptured={(files) => addTrainingFiles(files)} />
          {trainingFiles.length > 0 && <div className="uploaded-grid"><AnimatePresence initial={false}>{trainingFiles.slice(0, 24).map((file, index) => <motion.div layout className="uploaded-thumb" key={`${file.name}-${index}`} initial={reducedMotion ? false : { opacity: 0, scale: 0.84, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, scale: 0.8 }} transition={{ type: "spring", stiffness: 170, damping: 18 }}>{thumbUrls[index] ? <img src={thumbUrls[index]!} alt={`Good reference ${index + 1}`} className="thumb-img" /> : <span className={`${mono} thumb-zip`}>ZIP</span>}<button onClick={() => setTrainingFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={13} /></button></motion.div>)}</AnimatePresence>{trainingFiles.length > 24 && <span className={`${mono} more-files`}>+{trainingFiles.length - 24} more</span>}<button type="button" className="clear-files" onClick={() => setTrainingFiles([])}>Clear all</button></div>}
          <p className="training-minimum-note" role="status">{hasZip || imageCount >= minimumGoodImages ? trainingMinimumCopy.ready : `${minimumGoodImages - imageCount} ${trainingMinimumCopy.insufficient}`}</p>
        </div>
        <div className="train-options">
          <label><span className={mono}>MODEL</span><select value={backbone} onChange={(event) => setBackbone(event.target.value as Backbone)} disabled={trainState === "learning"}><option value="auto">Best for this laptop (auto)</option><option value="resnet18">Fast (resnet18)</option><option value="wide_resnet50">Most accurate (wide_resnet50)</option></select></label>
          <label className="train-check"><input type="checkbox" checked={rotates} onChange={(event) => setRotates(event.target.checked)} disabled={trainState === "learning"} /><span>Part can lie at any angle (checks 8 angles, slower)</span></label>
        </div>
        <div className="train-footer"><div className="train-status"><span className={`status-icon ${trainState}`} aria-hidden="true">{trainState === "learning" ? <LoaderCircle size={15} /> : trainState === "done" ? <Check size={15} /> : trainState === "error" ? <X size={15} /> : <Activity size={15} />}</span><div><strong>{trainState === "learning" ? pageCopy.trainingLearning : trainState === "done" ? pageCopy.trainingComplete : trainState === "error" ? pageCopy.trainingErrorTitle : pageCopy.trainingReady}</strong><span>{trainState === "learning" ? pageCopy.trainingLearningDetail(imageCount) : trainState === "done" ? `${pageCopy.trainingCompleteDetail(elapsed <= trainingBudgetSeconds ? "Within 10:00 budget" : "Over 10:00 budget")}${trainedBackbone ? ` · ${trainedBackbone}` : ""}` : trainState === "error" ? trainingError ?? trainingErrorCopy : pageCopy.trainingReadyDetail(minimumGoodImages)}</span>{autoReport?.length && trainState !== "idle" ? <span className="train-auto">{autoSummary(autoReport, trainedBackbone)}</span> : null}</div></div>
          <div className="progress-block"><div className="progress-top"><RollingTimer elapsedText={elapsedText} /><span className="budget-label"><motion.i animate={elapsed === trainingBudgetSeconds && !reducedMotion ? { scaleY: [1, 1.35, 1] } : { scaleY: 1 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} />10:00 <small>{pageCopy.timeLimit}</small></span></div><div className="progress-track"><motion.div className="progress-fill" style={{ scaleX: progressScale }} /></div></div>
          <button className="button-orange" onClick={startTraining} disabled={!canTrain}>{trainState === "learning" ? <><LoaderCircle size={15} /> {pageCopy.learningButton}</> : trainState === "done" ? <>{pageCopy.runAgain} <ArrowRight size={14} /></> : <>{pageCopy.startLearning} <ArrowRight size={14} /></>}</button>
        </div>
        {trainLog.length > 0 && <pre className="train-log" aria-live="polite">{trainLog.join("\n")}</pre>}
      </div>
      <div className="console-note"><CircleHelp size={14} /><span>{pageCopy.trainingConsoleNote}</span><span className={`${mono} console-note-right`}>{pageCopy.noGpuFootnote}</span></div>
    </section>
    </>}
    {show("inspect") && <>
    <section className="inspect-section" id="inspect"><div className="inspect-heading"><SectionHeading index="03" title={pageCopy.inspectTitle} description={pageCopy.inspectDescription} /><span className="sample-badge">{sampleDataLabel}</span></div>
      <div className={`demo-banner ${backendOk === false ? "is-down" : "is-live"}`}><span className="demo-banner-icon">{backendOk === false ? <TriangleAlert size={15} /> : <ShieldCheck size={15} />}</span><div><strong>{backendOk === false ? "Inspection server not reachable" : pageCopy.demoBannerTitle}</strong><span>{backendOk === false ? `Start it on this laptop: uvicorn app:app --port 8000 (looking at ${API_URL})` : pageCopy.demoBannerDescription}</span></div><span className={`${mono} demo-ref`}>{backendOk === false ? "API / OFFLINE" : pageCopy.apiStatus}</span></div>
      <div className="inspect-workspace">
        <div className="inspect-controls">
          <div className="control-heading"><span className="panel-index">B</span><div><h3>{pageCopy.inspectionInput}</h3><p>{pageCopy.inspectionInputDescription}</p></div></div>
          <label className="select-label" htmlFor="object-select"><Eyebrow>{pageCopy.objectSelectLabel}</Eyebrow><div className="select-wrap"><select id="object-select" value={selectedObject} onChange={(event) => setSelectedObject(event.target.value)}>{[...objectCategories.map((o) => ({ id: o.id as string, name: o.name as string })), ...objectStatuses.filter((s) => !objectCategories.some((o) => o.id === s.objectId)).map((s) => ({ id: s.objectId, name: s.objectName })), ...(objectCategories.some((o) => o.id === selectedObject) || objectStatuses.some((s) => s.objectId === selectedObject) ? [] : [{ id: selectedObject, name: selectedObject }])].map((object) => { const st = objectStatuses.find((s) => s.objectId === object.id); return <option key={object.id} value={object.id}>{object.name}{!objectStatuses.length ? "" : st?.status === "Trained" ? " (trained)" : st?.status === "Training" ? " (training)" : " (not trained)"}</option>; })}</select><ChevronDown size={15} /></div></label>
          <input ref={inspectInput} className="sr-only" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) runInspection(file); event.target.value = ""; }} />
          <button className="inspect-upload" onClick={() => inspectInput.current?.click()} disabled={inspecting}><FileImage size={16} /><span><strong>{inspectionFile ? inspectionFile.name : pageCopy.uploadPhoto}</strong><small>{pageCopy.imageFormats}</small></span><Plus size={16} /></button>
          <div className="sample-choice"><Eyebrow>{pageCopy.sampleImageEyebrow}</Eyebrow><WebcamCapture mode="inspect" disabled={inspecting} onInspect={(file) => runInspection(file)} /></div>
          <button className="run-inspection" disabled={inspecting || !inspectionFile} onClick={() => inspectionFile && runInspection(inspectionFile)}>{inspecting ? <><LoaderCircle size={16} /> {pageCopy.runningInspection}</> : <><ScanLine size={16} /> {inspectionFile ? "Inspect again" : pageCopy.runInspection} <ArrowRight size={15} /></>}</button>
          <p className="offline-note"><ShieldCheck size={13} /> {runtimeTargetCopy}</p>
        </div>
        <div className="result-panel">
          <div className="result-header"><div><Eyebrow>{pageCopy.inspectionResult}</Eyebrow><span className={`${mono} result-id`}>{inspection?.inspectionId ? `ID #${String(inspection.inspectionId).padStart(4, "0")} · ${inspection.backbone}${inspection.rotations > 1 ? ` · ${inspection.rotations} angles` : ""}` : pageCopy.resultIdPending}</span></div><span className="result-demo-tag">{pageCopy.demoOutput}</span></div>
          {inspecting ? <div className="result-loading" role="status"><LoaderCircle size={26} /><span>{pageCopy.resultComparing}</span></div> : untrainedPart ? <div className="result-error result-loading" role="alert"><CircleHelp size={26} /><p className="result-explanation">{partName(untrainedPart)} isn't trained yet. Train it first with good photos.</p><button type="button" className="layers-toggle" onClick={() => goTrain(untrainedPart)}>Go to Train <ArrowRight size={14} /></button></div> : inspectionError ? <div className="result-error" role="alert"><CircleHelp size={18} /><p>{inspectionError}</p></div> : <>
            <div className="result-summary"><motion.div key={inspection?.inspectionId ?? "waiting"} className={`verdict ${verdictClass}`} initial={reducedMotion ? false : { opacity: 0, scale: 1.25, rotate: -3 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={reducedMotion ? { duration: 0 } : { type: "spring", bounce: 0.4, duration: 0.6, delay: view === "3d" && inspection ? 1.6 : 0 }}><span className="verdict-icon">{inspection?.verdict === "Good" ? <Check size={20} /> : inspection ? <TriangleAlert size={20} /> : <Activity size={20} />}</span><div><Eyebrow>{inspection ? pageCopy.classification : pageCopy.currentStatus}</Eyebrow><strong>{inspection ? VERDICT_TEXT[inspection.verdict] : pageCopy.resultWaiting}</strong></div></motion.div>
              <div className="result-metrics"><div><Eyebrow>{pageCopy.anomalyScore}</Eyebrow><AnimatedScore value={inspection?.score ?? null} /></div><div><Eyebrow>{pageCopy.latency}</Eyebrow><strong>{inspection ? `${inspection.latencyMs}` : "—"}<small> ms</small></strong></div>{inspection && <span className={`latency-target-badge ${inspection.latencyMs < 1000 ? "pass" : "fail"}`}>{inspection.latencyMs < 1000 ? <><Check size={13} /> {pageCopy.latencyPass}</> : <><X size={13} /> {pageCopy.latencyFail}</>}</span>}</div></div>
            <div className="score-gauge" role="img" aria-label={inspection ? `Anomaly score ${inspection.score.toFixed(2)}, line at ${inspection.threshold.toFixed(2)}` : "Anomaly score not available, awaiting image"}><div className="gauge-labels"><span>0.00</span><span>{pageCopy.decisionThreshold} <b>{inspection?.threshold.toFixed(2) ?? "—"}</b></span><span>{inspection ? (2 * inspection.threshold).toFixed(2) : "2× LINE"}</span></div><div className="gauge-track live-gauge">{inspection && <span className="gauge-band" style={{ left: `${(inspection.unsureBand[0] / (2 * inspection.threshold)) * 100}%`, width: `${((inspection.unsureBand[1] - inspection.unsureBand[0]) / (2 * inspection.threshold)) * 100}%` }} />}<span className="gauge-threshold" style={{ left: "50%" }} /><motion.span className={`gauge-value ${inspection?.verdict === "Good" ? "pass" : ""}`} style={{ scaleX: scoreProgress }} /><motion.span className="gauge-needle" style={{ left: scoreNeedle }} aria-hidden="true" /></div></div>
            {inspection && <VerdictReasons result={inspection} />}
            {inspection && (inspection.verdict === "Defective" || inspection.verdict === "Unsure") && <FeedbackButton onConfirm={confirmGood} done={feedbackDone} />}
            {inspection && feedbackDone && inspection.verdict === "Good" && <p className="feedback-done"><Check size={13} /> {feedbackDone}</p>}
            <div className="comparison-title"><Eyebrow>{pageCopy.heatmapHeading}</Eyebrow><div className="view-switch" role="group" aria-label="Result view"><button type="button" className={`layers-toggle ${view === "3d" ? "active" : ""}`} aria-pressed={view === "3d"} onClick={() => setView("3d")}><Box size={14} /> 3D view</button><button type="button" className={`layers-toggle ${view === "2d" ? "active" : ""}`} aria-pressed={view === "2d"} onClick={() => setView("2d")}><ScanLine size={14} /> 2D heatmap</button>{view === "2d" && <button className={`layers-toggle ${showLayers ? "active" : ""}`} onClick={() => setShowLayers((value) => !value)} aria-pressed={showLayers}><Layers3 size={14} /> {showLayers ? pageCopy.layersOn : pageCopy.layersOff}</button>}</div></div>
            {!inspection || !inspectionFile ? <div className="comparison-image comparison-empty"><p>Upload a photo or use the webcam. The result appears here in 3D: defects rise out of the part and a pin lands on each one.</p></div> : view === "3d" ? <div className="comparison-image comparison-3d"><InspectionStage3D result={inspection} photo={inspectionFile} /></div> : <>
              <div className={`comparison-image ${showLayers ? "layer-view" : ""}`}><CornerFrame><div className="live-square">{photoUrl && <img src={photoUrl} alt="Inspected photo" className="live-fill comparison-base" />}{inspection.heatmapUrl && <img src={inspection.heatmapUrl} alt="Heatmap of areas that differ from the good parts" className="live-fill" style={{ opacity: heatOpacity / 100 }} />}{showOutline && inspection.regions.map((r, i) => <span key={i} className="region-ring" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}><b>{i + 1}</b></span>)}</div><span className="image-tag">{pageCopy.originalHeatmapLabel}</span></CornerFrame></div>
              <div className="image-controls"><label className="opacity-control" htmlFor="heat-opacity"><span>{pageCopy.heatmapOpacity}</span><input id="heat-opacity" type="range" min="0" max="100" value={heatOpacity} onChange={(event) => setHeatOpacity(Number(event.target.value))} aria-label="Heatmap opacity" /><span className={mono}>{heatOpacity}%</span></label><label className="outline-control"><input type="checkbox" checked={showOutline} onChange={(event) => setShowOutline(event.target.checked)} /><span className="check-box"><Check size={11} /></span><span>Defect pins</span></label></div>
              <AnimatePresence initial={false}>{showLayers && <motion.div className="layer-strip" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}>{[[photoUrl, "01 ORIGINAL"], [inspection.featureMapUrl, "02 SCORE MAP"], [inspection.heatmapUrl, "03 HEATMAP"], [inspection.maskUrl, "04 ABOVE THE LINE"]].map(([src, label], i) => <motion.div key={label as string} className="live-layer" initial={reducedMotion ? false : { opacity: 0, y: i % 2 ? -10 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.2, delay: i * 0.06 }}>{src && <img src={src as string} alt={label as string} />}<small>{label}</small></motion.div>)}</motion.div>}</AnimatePresence>
            </>}
            <p className="result-explanation">{inspection ? RESULT_TEXT[inspection.verdict] : pageCopy.resultExplanation}</p>
          </>}
        </div>
      </div>
    </section>
    </>}
    {show("tools") && <>
    <section className="tools-section" id="tools"><SectionHeading index="04" title={toolsSectionTitle} description={toolsSectionDescription} />
      {!page && <div className="tools-tabs" role="tablist" aria-label={pageCopy.toolsTablistLabel}><button id="evaluation-tab" type="button" role="tab" aria-selected={toolsTab === "evaluation"} aria-controls="evaluation-panel" tabIndex={toolsTab === "evaluation" ? 0 : -1} onClick={() => setToolsTab("evaluation")} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setToolsTab("objects"); document.getElementById("objects-tab")?.focus(); } }}>{pageCopy.evaluationTab}</button><button id="objects-tab" type="button" role="tab" aria-selected={toolsTab === "objects"} aria-controls="objects-panel" tabIndex={toolsTab === "objects" ? 0 : -1} onClick={() => setToolsTab("objects")} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setToolsTab("evaluation"); document.getElementById("evaluation-tab")?.focus(); } }}>{pageCopy.objectsTab}</button></div>}
      {page === "evaluation" && <label className="select-label eval-object" htmlFor="eval-object"><Eyebrow>{pageCopy.objectSelectLabel}</Eyebrow><div className="select-wrap"><select id="eval-object" value={selectedObject} onChange={(event) => setSelectedObject(event.target.value)}>{objectStatuses.filter((s) => s.status === "Trained").map((s) => <option key={s.objectId} value={s.objectId}>{s.objectName}</option>)}{!objectStatuses.some((s) => s.objectId === selectedObject && s.status === "Trained") && <option value={selectedObject}>{currentObject.name} (not trained)</option>}</select><ChevronDown size={15} /></div></label>}
      <EvaluationPanel objectId={selectedObject} objectName={currentObject.name} active={toolsTab === "evaluation"} />
      <ObjectLibraryPanel statuses={objectStatuses} loading={objectStatusesLoading} error={objectStatusError} active={toolsTab === "objects"} />
    </section>
    </>}
    {show("history") && <>
    <section className="history-section" id="history"><div className="history-head"><SectionHeading index="05" title={pageCopy.historyTitle} description={pageCopy.historyDescription} /><div className="history-actions"><label htmlFor="history-filter" className="sr-only">{pageCopy.historyFilter}</label><select id="history-filter" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}><option>{pageCopy.historyAll}</option><option>Good</option><option>Defective</option><option>Unsure</option><option>Retake</option></select><label htmlFor="history-part" className="sr-only">Part</label><select id="history-part" value={historyPart} onChange={(event) => setHistoryPart(event.target.value)}><option value="">All parts</option>{[...new Set([...loggedParts, ...(historyPart ? [historyPart] : [])])].map((id) => <option key={id} value={id}>{objectCategories.find((o) => o.id === id)?.name ?? id}</option>)}</select><label htmlFor="report-range" className="sr-only">Shift report time range</label><select id="report-range" value={reportRange} onChange={(event) => setReportRange(event.target.value)}><option value="1">Last 1 h</option><option value="12">Last 12 h</option><option value="24">Last 24 h</option><option value="all">All time</option></select><a className="export-button" href={logCsvUrl(logFilter)} download><Download size={14} /> {pageCopy.historyExport}</a><a className="export-button" href={reportPageUrl(logFilter)} target="_blank" rel="noopener noreferrer"><FileImage size={14} /> Shift report</a></div></div>
      {shift && <div className="shift-strip">{[[shift.total, "inspected"], [shift.counts.good, "good"], [shift.counts.defective, "defective"], [shift.counts.unsure, "sent to a person"], [shift.counts.retake, "retakes"], [shift.operator_corrections, "corrected"]].map(([n, label]) => <div key={label as string}><strong>{n}</strong><span>{label}</span></div>)}</div>}
      <div className="history-table-wrap"><table className="history-table"><thead><tr>{pageCopy.historyColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{historyLoading ? <tr aria-busy="true"><td colSpan={6} className="history-loading"><span className="history-skeleton" aria-hidden="true" />{historyLoadingCopy}</td></tr> : historyError ? <tr><td colSpan={6} className="history-error" role="alert">{historyErrorCopy}</td></tr> : visibleHistory.length ? <AnimatePresence initial={false} mode="popLayout">{visibleHistory.map((record, index) => <motion.tr layout key={record.id} initial={reducedMotion ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={reducedMotion ? undefined : { opacity: 0, x: 12 }} transition={{ duration: reducedMotion ? 0 : 0.4, delay: Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}><td><span className="history-image"><img src={record.imageUrl} alt={`${record.objectName} heatmap`} className="thumb-img" /></span><span className={`${mono} history-id`}>{record.id}</span></td><td>{record.objectName}</td><td><span className={`table-verdict ${record.verdict === "Good" ? "pass" : record.verdict.toLowerCase()}`}><i />{record.verdict}{record.corrected ? " (corrected)" : ""}</span></td><td className={mono}>{record.score.toFixed(2)} <span className="threshold-note">/ {record.threshold.toFixed(2)}</span></td><td className={mono}>{record.latencyMs} ms</td><td className={mono}>{record.inspectedAt}</td></motion.tr>)}</AnimatePresence> : <tr><td colSpan={6} className="empty-history"><FileImage size={18} /><span>{history.length ? pageCopy.historyNoMatch : "No inspections yet. Inspect a photo and it appears here."}</span></td></tr>}</tbody></table></div>
      <div className="history-foot"><span className={`${mono} muted-small`}>{pageCopy.historyRecordCount(visibleHistory.length)}</span><span className={`${mono} muted-small`}>{pageCopy.historySession}</span></div>
    </section>
    </>}
    {show("spec") && <>
    <section className="spec-section"><div className="spec-heading"><SectionHeading index="06" title={systemSectionTitle} description={systemSectionDescription} dark /><span className="targets-tag">{pageCopy.systemTargetsLabel}</span></div>
      <div className="spec-grid">{projectTargets.map((spec, index) => { const Icon = spec.id === "objects" ? Activity : spec.id === "learning" ? Clock3 : spec.id === "latency" ? Gauge : WifiOff; return <motion.div className="spec-card" key={spec.id} initial={reducedMotion ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: reducedMotion ? 0 : 0.8, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}><div className="spec-card-top"><span className="spec-icon"><Icon size={17} /></span><span className={`${mono} spec-number`}>0{index + 1}</span></div><div><h3>{spec.target}</h3><p>{spec.detail}</p></div><div className="measured"><span className={mono}>MEASURED</span><strong>{spec.measured}</strong></div></motion.div>; })}</div>
      <p className="spec-disclaimer">{pageCopy.targetDisclaimer}</p>
      <RuntimeStatusPanel online={online} backendOk={backendOk ?? null} />
    </section>
    </>}
    {!page && <>
    <LimitationsPanel />
    <footer className="footer"><a href="#top" className="brand footer-brand"><span className="brand-mark"><ScanLine size={17} /></span><span>{projectName}<small>{pageCopy.brandDescriptor}</small></span></a><div className="footer-project-meta"><span className={mono}>{pageCopy.teamPrefix} · {teamNamePlaceholder}</span><span className={mono}>{hackathonName}</span></div><span className={`${mono} footer-version`}>{pageCopy.demoVersion}</span></footer>
    </>}
  </Shell>;
}

const partName = (id: string) => objectCategories.find((o) => o.id === id)?.name ?? id;

/** "Auto: wide_resnet50 ~240 s / 180 ms, too slow. resnet18 ~40 s / 60 ms, chosen." */
function autoSummary(report: AutoEstimate[], chosen: string | null) {
  return "Auto: " + report.map((r) => `${r.backbone} ~${Math.round(r.est_train_s)} s / ${r.est_ms} ms, ${r.backbone === chosen ? (r.fits ? "chosen" : "chosen as the fastest") : r.fits ? "fits" : "too slow"}.`).join(" ");
}

const VERDICT_TEXT: Record<string, string> = { Good: "Good", Defective: "Defective", Unsure: "Unsure: send to a person", Retake: "Retake photo" };
const RESULT_TEXT: Record<string, string> = {
  Good: "Matches the good parts. Nothing stands out above the line.",
  Defective: "The raised, glowing areas differ most from every good part it learned. Pins mark the worst spots.",
  Unsure: "Close to the line, so it doesn't guess: a person should check this part.",
  Retake: "The photo itself is the problem, so it isn't judged. Fix the photo and inspect again.",
};

function CustomPartInput({ current, disabled, onUse }: { current: string; disabled: boolean; onUse: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isCustom = !objectCategories.some((o) => o.id === current);
  function use() {
    const clean = name.trim().toLowerCase().replace(/\s+/g, "_");
    if (!/^[a-z0-9_-]{1,40}$/.test(clean)) { setError("Use 1–40 letters, digits, _ or -."); return; }
    setError(null);
    onUse(clean);
  }
  return <div className="custom-part"><label htmlFor="custom-part">Or name your own part (for webcam demos)</label><div><input id="custom-part" type="text" value={name} maxLength={40} placeholder="e.g. bottle_cap" disabled={disabled} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") use(); }} /><button type="button" onClick={use} disabled={disabled || !name.trim()}>Use name</button></div>{isCustom && <small>Selected: <b>{current}</b></small>}{error && <small className="cam-error">{error}</small>}</div>;
}
