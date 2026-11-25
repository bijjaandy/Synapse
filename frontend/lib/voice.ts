// Spoken verdicts with the browser's built-in (offline, Windows) voices. No network.
import { useCallback, useEffect, useState } from "react";
import type { InspectionResult } from "@/lib/api";

const KEY = "netrix.voice";

/** Position words for a defect spot (x/y 0-1 from top-left), the same words shown under "Where". */
export const whereWords = (x: number, y: number) =>
  `${y < 0.34 ? "top" : y > 0.66 ? "bottom" : "middle"} ${x < 0.34 ? "left" : x > 0.66 ? "right" : "centre"}`;

export function verdictPhrase(r: Pick<InspectionResult, "verdict" | "regions" | "reasons">): string {
  if (r.verdict === "Good") return "Good.";
  if (r.verdict === "Defective") return r.regions.length ? `Defective, ${whereWords(r.regions[0].x, r.regions[0].y)}.` : "Defective.";
  if (r.verdict === "Unsure") return "Unsure, please check.";
  return r.reasons.length ? `Retake the photo: ${r.reasons[0].replace(/\.$/, "")}.` : "Retake the photo.";
}

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Speak `text`, cutting off anything still playing. Prefers an offline (local) English voice. */
export function speak(text: string) {
  if (!voiceSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const voice = voices.find((v) => v.localService) ?? voices[0];
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-US";
  u.rate = 1.05;
  synth.speak(u);
}

/** On/off switch remembered in localStorage "netrix.voice" (default on). `supported` is false until mounted. */
export function useVoice() {
  const [on, setOn] = useState(true);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(voiceSupported());
    try { const saved = window.localStorage.getItem(KEY); if (saved !== null) setOn(saved !== "off"); } catch { /* private mode */ }
  }, []);
  const toggle = useCallback(() => setOn((value) => {
    const next = !value;
    try { window.localStorage.setItem(KEY, next ? "on" : "off"); } catch { /* private mode */ }
    if (!next && voiceSupported()) window.speechSynthesis.cancel();
    return next;
  }), []);
  const announce = useCallback((r: Pick<InspectionResult, "verdict" | "regions" | "reasons">) => { if (on && supported) speak(verdictPhrase(r)); }, [on, supported]);
  return { on, supported, toggle, announce };
}
