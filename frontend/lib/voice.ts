// Spoken verdicts with the browser's built-in (offline, Windows) voices, in English or Kannada. No network.
import { useCallback, useEffect, useState } from "react";
import type { InspectionResult } from "@/lib/api";

const KEY = "netrix.voice";
const LANG_KEY = "netrix.lang";
const LANG_EVENT = "netrix-lang";
export type Lang = "en" | "kn";

/** Position words for a defect spot (x/y 0-1 from top-left), the same words shown under "Where". */
export const whereWords = (x: number, y: number) =>
  `${y < 0.34 ? "top" : y > 0.66 ? "bottom" : "middle"} ${x < 0.34 ? "left" : x > 0.66 ? "right" : "centre"}`;

const KN_WHERE: Record<string, string> = {
  "top left": "ಮೇಲೆ ಎಡಭಾಗ", "top centre": "ಮೇಲ್ಭಾಗ", "top right": "ಮೇಲೆ ಬಲಭಾಗ",
  "middle left": "ಮಧ್ಯ ಎಡಭಾಗ", "middle centre": "ಮಧ್ಯಭಾಗ", "middle right": "ಮಧ್ಯ ಬಲಭಾಗ",
  "bottom left": "ಕೆಳಗೆ ಎಡಭಾಗ", "bottom centre": "ಕೆಳಭಾಗ", "bottom right": "ಕೆಳಗೆ ಬಲಭಾಗ",
};
export const whereWordsKn = (x: number, y: number) => KN_WHERE[whereWords(x, y)];

/** The verdict word shown on the result when Kannada is on. */
export const VERDICT_KN: Record<string, string> = { Good: "ಸರಿ", Defective: "ದೋಷ", Unsure: "ಖಚಿತವಿಲ್ಲ", Retake: "ಮತ್ತೆ ತೆಗೆಯಿರಿ" };

type VerdictInfo = Pick<InspectionResult, "verdict" | "regions" | "reasons">;
export function verdictPhrase(r: VerdictInfo, lang: Lang = "en"): string {
  const first = r.regions[0];
  if (lang === "kn") {
    if (r.verdict === "Good") return "ಭಾಗ ಸರಿಯಾಗಿದೆ.";
    if (r.verdict === "Defective") return first ? `ದೋಷ ಕಂಡುಬಂದಿದೆ, ${whereWordsKn(first.x, first.y)}.` : "ದೋಷ ಕಂಡುಬಂದಿದೆ.";
    if (r.verdict === "Unsure") return "ಖಚಿತವಿಲ್ಲ, ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.";
    return "ದಯವಿಟ್ಟು ಮತ್ತೆ ಫೋಟೋ ತೆಗೆಯಿರಿ.";
  }
  if (r.verdict === "Good") return "Good.";
  if (r.verdict === "Defective") return first ? `Defective, ${whereWords(first.x, first.y)}.` : "Defective.";
  if (r.verdict === "Unsure") return "Unsure, please check.";
  return r.reasons.length ? `Retake the photo: ${r.reasons[0].replace(/\.$/, "")}.` : "Retake the photo.";
}

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Plain text for speaking: no markdown symbols, links or code marks. */
export const speakable = (text: string) => text
  .replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "").replace(/[*_~#>|]/g, "").replace(/\s+/g, " ").trim();

/** Speak `text` in `lang`, cutting off anything still playing. Kannada needs a Kannada voice: without one nothing
 *  is spoken (an English voice reading Kannada is worse than silence) and "no-voice" is returned. */
export function speak(text: string, lang: Lang = "en", onEnd?: () => void): "spoken" | "no-voice" | "unsupported" {
  if (!voiceSupported()) return "unsupported";
  const synth = window.speechSynthesis;
  synth.cancel();
  const all = synth.getVoices();
  const pool = all.filter((v) => v.lang.toLowerCase().startsWith(lang === "kn" ? "kn" : "en"));
  if (lang === "kn" && !pool.length) return "no-voice";
  const voice = pool.find((v) => v.localService) ?? pool[0];
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? (lang === "kn" ? "kn-IN" : "en-US");
  u.rate = 1.05;
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  synth.speak(u);
  return "spoken";
}

export function stopSpeaking() { if (voiceSupported()) window.speechSynthesis.cancel(); }

/** EN / ಕನ್ನಡ, remembered in localStorage "netrix.lang" (default English) and shared by every component on the page. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const read = () => { try { setLangState(window.localStorage.getItem(LANG_KEY) === "kn" ? "kn" : "en"); } catch { /* private mode */ } };
    read();
    window.addEventListener(LANG_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(LANG_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  const setLang = useCallback((l: Lang) => {
    try { window.localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
    setLangState(l);
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);
  return [lang, setLang];
}

let kannadaHintShown = false;  // "Kannada voice not installed" is shown once per page load

/** Voice on/off (localStorage "netrix.voice", default on) + language. `supported` is false until mounted. */
export function useVoice() {
  const [on, setOn] = useState(true);
  const [supported, setSupported] = useState(false);
  const [lang] = useLang();
  const [speaking, setSpeaking] = useState(false);
  const [kannadaHint, setKannadaHint] = useState(false);
  useEffect(() => {
    setSupported(voiceSupported());
    try { const saved = window.localStorage.getItem(KEY); if (saved !== null) setOn(saved !== "off"); } catch { /* private mode */ }
    if (voiceSupported()) window.speechSynthesis.getVoices();  // start loading the voice list early
  }, []);
  const toggle = useCallback(() => setOn((value) => {
    const next = !value;
    try { window.localStorage.setItem(KEY, next ? "on" : "off"); } catch { /* private mode */ }
    if (!next) { stopSpeaking(); setSpeaking(false); }
    return next;
  }), []);
  const say = useCallback((text: string) => {
    if (!on || !supported) return;
    const result = speak(text, lang, () => setSpeaking(false));
    setSpeaking(result === "spoken");
    if (result === "no-voice" && !kannadaHintShown) { kannadaHintShown = true; setKannadaHint(true); }
  }, [on, supported, lang]);
  const announce = useCallback((r: VerdictInfo) => say(verdictPhrase(r, lang)), [say, lang]);
  const stop = useCallback(() => { stopSpeaking(); setSpeaking(false); }, []);
  return { on, supported, toggle, announce, say, stop, speaking, lang, kannadaHint, dismissKannadaHint: () => setKannadaHint(false) };
}
