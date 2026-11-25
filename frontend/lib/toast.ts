// Tiny toast store: toast("Product added") from anywhere; <Toaster /> in the app shell shows them.
export type Toast = { id: number; text: string; kind: "ok" | "info" | "error" };
type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(toasts));

export function toast(text: string, kind: Toast["kind"] = "ok", ms = 4000) {
  const t = { id: nextId++, text, kind };
  toasts = [...toasts, t].slice(-4);
  emit();
  if (typeof window !== "undefined") {
    ((window as unknown as { __netrixToasts?: string[] }).__netrixToasts ??= []).push(text);  // read by the UI test
    window.setTimeout(() => dismiss(t.id), ms);
  }
}
export function dismiss(id: number) { toasts = toasts.filter((t) => t.id !== id); emit(); }
export function subscribe(l: Listener) { listeners.add(l); l(toasts); return () => { listeners.delete(l); }; }
