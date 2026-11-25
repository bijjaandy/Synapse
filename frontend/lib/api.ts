// Talks to the FastAPI backend (app.py). Start it with:  uvicorn app:app --port 8000
// Override the address with NEXT_PUBLIC_API_URL if the backend runs elsewhere.
import { objectCategories } from "@/config/content";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type TrainState = "idle" | "learning" | "done" | "error";
export type Verdict = "Good" | "Defective" | "Unsure" | "Retake";
export type Backbone = "auto" | "resnet18" | "wide_resnet50";

export type Region = { x: number; y: number; area: number; peak: number };

export type InspectionResult = {
  verdict: Verdict;
  score: number;
  threshold: number;
  unsureBand: [number, number];
  heatmapUrl: string;      // photo with the heatmap blended in (PNG data URL)
  maskUrl: string;         // white where the score is above the line
  featureMapUrl: string;   // raw score map, darker = more like the good parts
  latencyMs: number;
  inspectionId: number | null;
  reasons: string[];       // why a photo needs a retake
  regions: Region[];       // defect spots, worst first (x/y 0-1 from top-left)
  grid: number[];          // score grid for the 3D view, 1.0 = the line
  gridSize: number;
  backbone: string;
  rotations: number;
  closestGood: number | null;   // index of the most similar training photo (null for older models)
};

export type InspectionRecord = {
  id: string;
  inspectionId: number;
  objectId: string;
  objectName: string;
  verdict: Verdict;
  score: number;
  threshold: number;
  latencyMs: number;
  inspectedAt: string;
  imageUrl: string;        // heatmap stored by the backend
  reasons: string;
  corrected: boolean;
};

export type ObjectTrainingStatus = {
  objectId: string;
  objectName: string;
  status: "Not trained" | "Training" | "Trained" | "Failed";
  goodImageCount: number | null;
  lastTrainedAt: string | null;
  backbone: string | null;
  needsRetrain?: boolean;   // saved before the current blur check: retrain to turn it back on
  strictness?: number;      // 1.0 = as trained; >1 flags more, <1 fewer false alarms (set by QC)
};

export type EvaluationResult = {
  runId: string;
  correct: number;
  missedDefects: number;
  falseAlarms: number;
  sentToPerson: number;
  retakes: number;
  total: number;
  ranAt: string;
};

export type TrainStatus = {
  state: TrainState;
  elapsedSec: number;
  progress: number;
  log: string[];
  backbone: string | null;
  trainSeconds: number | null;
  error: string | null;
  autoReport: AutoEstimate[] | null;   // only when the backbone was "auto": the timing of each model tried
};

export type AutoEstimate = { backbone: string; est_train_s: number; est_ms: number; fits: boolean };

export type MeterStatus = { session?: string; photos: number; percent: number; ready: boolean; hint: string; novelty: number[] };
export type ShiftReport = {
  total: number; counts: { good: number; defective: number; unsure: number; retake: number };
  defect_rate: number; operator_corrections: number; avg_ms: number; max_ms: number;
};

const VERDICT: Record<string, Verdict> = { good: "Good", defective: "Defective", unsure: "Unsure", retake: "Retake" };
const nameOf = (id: string) => objectCategories.find((c) => c.id === id)?.name ?? id;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error(`Cannot reach the inspection server at ${API_URL}. Start it with: uvicorn app:app --port 8000`);
  }
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") throw new Error(detail);
    if (Array.isArray(detail)) throw new Error(detail.map((d: { msg?: string }) => d.msg).join("; "));
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return body as T;
}

export async function checkHealth(): Promise<boolean> {
  try { await call("/health"); return true; } catch { return false; }
}

// ---------- training ----------

const trainStarted = new Map<string, number>();

export async function trainObject(objectId: string, files: File[], options: { backbone?: Backbone; rotations?: number } = {}): Promise<{ jobId: string }> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  form.append("backbone", options.backbone ?? "auto");
  form.append("rotations", String(options.rotations ?? 1));
  await call(`/objects/${objectId}/train`, { method: "POST", body: form });
  trainStarted.set(objectId, Date.now());
  return { jobId: objectId };
}

type RawStatus = { state: string; started?: number; train_s?: number; log?: string[]; backbone?: string; error?: string;
                   auto_report?: AutoEstimate[]; n_images?: number | null; trained_at?: number; needs_retrain?: boolean; strictness?: number };

export async function getTrainStatus(jobId: string): Promise<TrainStatus> {
  const s = await call<RawStatus>(`/objects/${jobId}/status`);
  const startedMs = s.started ? s.started * 1000 : trainStarted.get(jobId) ?? Date.now();
  const elapsedSec = s.train_s ?? Math.max(0, Math.round((Date.now() - startedMs) / 1000));
  const state: TrainState = s.state === "ready" ? "done" : s.state === "failed" ? "error" : "learning";
  // the backend doesn't report a percentage: estimate from auto-selection's timing, else assume about a minute
  const estimate = s.auto_report?.find((r) => r.backbone === s.backbone)?.est_train_s;
  const expected = Math.max(20, (estimate ?? 30) * 2);
  const progress = state === "done" ? 100 : Math.min(95, Math.round((elapsedSec / expected) * 100));
  return { state, elapsedSec, progress, log: s.log ?? [], backbone: s.backbone && s.backbone !== "auto" ? s.backbone : null,
           trainSeconds: s.train_s ?? null, error: s.error ?? null, autoReport: s.auto_report ?? null };
}

// ---------- inspection ----------

type RawPredict = { label: string; score: number; threshold: number; unsure_band: [number, number]; ms: number;
                    reasons: string[]; regions: Region[]; grid: number[]; grid_size: number; backbone: string;
                    rotations: number; closest_good?: number | null; inspection_id: number | null; heatmap_png_base64?: string };

function gridImage(grid: number[], size: number, paint: (v: number) => [number, number, number]): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(size, size);
  grid.forEach((v, i) => { const [r, g, b] = paint(v); img.data.set([r, g, b, 255], i * 4); });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export async function inspect(objectId: string, file: File, options: { log?: boolean } = {}): Promise<InspectionResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  const r = await call<RawPredict>(`/objects/${objectId}/predict?log=${options.log === false ? "false" : "true"}`, { method: "POST", body: form });
  const max = Math.max(2, ...r.grid);
  return {
    verdict: VERDICT[r.label] ?? "Unsure",
    score: r.score,
    threshold: r.threshold,
    unsureBand: r.unsure_band,
    heatmapUrl: r.heatmap_png_base64 ? `data:image/png;base64,${r.heatmap_png_base64}` : "",
    maskUrl: gridImage(r.grid, r.grid_size, (v) => (v >= 1 ? [255, 255, 255] : [20, 20, 20])),
    featureMapUrl: gridImage(r.grid, r.grid_size, (v) => { const t = Math.round(255 * Math.min(1, v / max)); return [t, t, t]; }),
    latencyMs: Math.round(r.ms),
    inspectionId: r.inspection_id,
    reasons: r.reasons,
    regions: r.regions,
    grid: r.grid,
    gridSize: r.grid_size,
    backbone: r.backbone,
    rotations: r.rotations,
    closestGood: r.closest_good ?? null,
  };
}

export async function markGood(objectId: string, file: File, inspectionId: number | null): Promise<Verdict> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (inspectionId !== null) form.append("inspection_id", String(inspectionId));
  const r = await call<{ new_label: string }>(`/objects/${objectId}/feedback`, { method: "POST", body: form });
  return VERDICT[r.new_label] ?? "Unsure";
}

// ---------- history, report ----------

type RawLogRow = { id: number; ts: number; object: string; label: string; score: number; threshold: number; ms: number; reasons: string; corrected: number };

// filters shared by the history table, shift strip, CSV and report links. hours null = all time.
export type LogFilter = { object?: string | null; hours?: number | null };
const ALL_TIME_HOURS = 0;  // the backend reads hours=0 as all time (/report.html falls back to 12 h when hours is left out)

function query(filter: LogFilter, extra: Record<string, string> = {}) {
  const q = new URLSearchParams(extra);
  if (filter.object) q.set("object", filter.object);
  if (filter.hours != null) q.set("hours", String(filter.hours));
  const text = q.toString();
  return text ? `?${text}` : "";
}

export async function getHistory(object?: string | null): Promise<InspectionRecord[]> {
  const rows = await call<RawLogRow[]>(`/log${query({ object }, { limit: "100" })}`);
  return rows.map((r) => ({
    id: `#${String(r.id).padStart(4, "0")}`,
    inspectionId: r.id,
    objectId: r.object,
    objectName: nameOf(r.object),
    verdict: VERDICT[r.label] ?? "Unsure",
    score: r.score,
    threshold: r.threshold,
    latencyMs: Math.round(r.ms),
    inspectedAt: new Date(r.ts * 1000).toLocaleTimeString([], { hour12: false }),
    imageUrl: `${API_URL}/log/${r.id}/heatmap.png`,
    reasons: r.reasons,
    corrected: Boolean(r.corrected),
  }));
}

/** Parts that appear anywhere in the log, for the history part filter. */
export async function getLoggedParts(): Promise<string[]> {
  const rows = await call<RawLogRow[]>("/log?limit=1000");
  return [...new Set(rows.map((r) => r.object))].sort();
}

export async function getShiftReport(filter: LogFilter = { hours: 12 }): Promise<ShiftReport> {
  return call<ShiftReport>(`/report${query(filter)}`);
}
export const reportPageUrl = (filter: LogFilter = { hours: 12 }) =>
  `${API_URL}/report.html${query({ ...filter, hours: filter.hours ?? ALL_TIME_HOURS })}`;
export const logCsvUrl = (filter: LogFilter = {}) => `${API_URL}/log.csv${query(filter)}`;

// ---------- objects ----------

export async function getObjectStatuses(): Promise<ObjectTrainingStatus[]> {
  const list = await call<{ name: string; state: string }[]>("/objects");
  const known = new Set(list.map((o) => o.name));
  const ids = [...objectCategories.map((c) => c.id as string), ...list.map((o) => o.name).filter((n) => !objectCategories.some((c) => c.id === n))];
  return Promise.all(ids.map(async (id) => {
    const base = { objectId: id, objectName: nameOf(id), goodImageCount: null, lastTrainedAt: null, backbone: null };
    if (!known.has(id)) return { ...base, status: "Not trained" as const, goodImageCount: 0 };
    try {
      const s = await call<RawStatus>(`/objects/${id}/status`);
      const status = s.state === "ready" ? "Trained" : s.state === "failed" ? "Failed" : "Training";
      return { ...base, status: status as ObjectTrainingStatus["status"], goodImageCount: s.n_images ?? null,
               lastTrainedAt: s.trained_at ? new Date(s.trained_at * 1000).toISOString() : null,
               backbone: s.backbone && s.backbone !== "auto" ? s.backbone : null, needsRetrain: !!s.needs_retrain, strictness: s.strictness ?? 1 };
    } catch {
      return { ...base, status: "Trained" as const };
    }
  }));
}

// ---------- evaluation: labelled folders, run through the model without logging ----------

export async function evaluateTestSet(objectId: string, goodFiles: File[], defectiveFiles: File[],
                                      onProgress?: (done: number, total: number) => void): Promise<EvaluationResult> {
  const items = [...goodFiles.map((f) => ({ f, bad: false })), ...defectiveFiles.map((f) => ({ f, bad: true }))];
  let correct = 0, missedDefects = 0, falseAlarms = 0, sentToPerson = 0, retakes = 0, done = 0;
  for (const { f, bad } of items) {
    const r = await inspect(objectId, f, { log: false });
    const flagged = r.score >= r.threshold;   // plain yes/no at the line, same as the benchmark
    if (flagged === bad) correct++;
    else if (bad) missedDefects++;
    else falseAlarms++;
    if (r.verdict === "Unsure") sentToPerson++;
    if (r.verdict === "Retake") retakes++;
    onProgress?.(++done, items.length);
  }
  return { runId: `EV-${Date.now().toString(36).toUpperCase()}`, correct, missedDefects, falseAlarms, sentToPerson, retakes,
           total: items.length, ranAt: new Date().toLocaleString() };
}

// ---------- "enough photos?" meter for webcam capture ----------

export async function meterStart(): Promise<MeterStatus> {
  return call<MeterStatus>("/meter", { method: "POST" });
}
export async function meterAdd(session: string, file: File): Promise<MeterStatus> {
  const form = new FormData();
  form.append("file", file, file.name);
  return call<MeterStatus>(`/meter/${session}`, { method: "POST", body: form });
}
export function meterEnd(session: string) {
  return call(`/meter/${session}`, { method: "DELETE" }).catch(() => undefined);
}

// ---------- Netrix IQ: logins, human verification, summary, assistant ----------

export type Role = "operator" | "inspector" | "supervisor";
export type Session = { token: string; username: string; role: Role; role_name: string; display: string };

const SESSION_KEY = "netrix.session";

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}
function saveSession(s: Session | null) {
  try { if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else window.localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}
const authHeaders = (): Record<string, string> => { const s = loadSession(); return s ? { Authorization: `Bearer ${s.token}` } : {}; };

export async function login(username: string, password: string): Promise<Session> {
  const s = await call<Session>("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  saveSession(s);
  return s;
}
/** Confirms the saved session is still valid on the server (it forgets logins when restarted). */
export async function checkSession(): Promise<Session | null> {
  const s = loadSession();
  if (!s) return null;
  try { await call("/auth/me", { headers: authHeaders() }); return s; } catch { saveSession(null); return null; }
}
export async function logout() {
  await call("/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => undefined);
  saveSession(null);
}

export type QueueItem = { id: number; ts: number; object: string; label: string; score: number; threshold: number; ms: number; reasons: string };
export const photoUrl = (id: number) => `${API_URL}/log/${id}/photo.jpg`;
export const heatmapUrl = (id: number) => `${API_URL}/log/${id}/heatmap.png`;

export async function getVerifyQueue(): Promise<QueueItem[]> {
  return call<QueueItem[]>("/verify/queue?limit=100", { headers: authHeaders() });
}
export async function verifyInspection(id: number, decision: "good" | "defective", note = ""): Promise<{ model_learned: boolean }> {
  return call(`/verify/${id}`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }) });
}

export type Summary = {
  total: number;
  counts: { good: number; defective: number; unsure: number; retake: number };
  by_object: { object: string; total: number; good: number; defective: number; unsure: number; retake: number }[];
  verification: { pending: number; verified: number; confirmed_defective: number; overturned_to_good: number };
  operator_corrections: number; avg_ms: number; max_ms: number; first: number | null; last: number | null;
};
export async function getSummary(): Promise<Summary> { return call<Summary>("/summary"); }

export type ChatMessage = { role: "user" | "assistant"; content: string; source?: string; model?: string | null; ms?: number };
export async function assistantStatus(): Promise<{ ollama: boolean; model: string; model_installed: boolean }> {
  return call("/assistant/status");
}
export async function askAssistant(message: string, history: ChatMessage[]): Promise<{ answer: string; source: string; model: string | null; ms: number }> {
  return call("/assistant", { method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ message, history: history.map(({ role, content }) => ({ role, content })) }) });
}

export const STRICTNESS_MIN = 0.8, STRICTNESS_MAX = 1.25;
/** How strict a part's line is (QC inspectors and supervisors). */
export async function setStrictness(name: string, factor: number) {
  return call<{ name: string; strictness: number; threshold: number }>(`/objects/${encodeURIComponent(name)}/strictness`,
    { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ factor }) });
}

/** Remove a part (model + training photos). QC inspectors and supervisors only. purgeLog also deletes its history. */
export async function deleteObject(name: string, purgeLog = false) {
  return call<{ deleted: string; log_rows_removed: number }>(`/objects/${encodeURIComponent(name)}?purge_log=${purgeLog}`,
    { method: "DELETE", headers: authHeaders() });
}

export const goodPhotoUrl = (objectId: string, index: number) => `${API_URL}/objects/${encodeURIComponent(objectId)}/good/${index}.jpg`;
