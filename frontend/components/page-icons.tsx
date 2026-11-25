// Small line-art icons for the page headers (pure SVG, currentColor, no library).
const common = { viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const PAGE_ICONS: Record<string, React.ReactNode> = {
  Train: <svg {...common}><rect x="5" y="14" width="24" height="18" rx="4" /><path d="M12 14l2.5-4h5l2.5 4" /><circle cx="17" cy="23" r="5" /><circle cx="36" cy="27" r="7" strokeDasharray="3 3" /><circle cx="36" cy="27" r="2.5" /><path d="M38 9v5M35.5 11.5h5" /></svg>,
  Inspect: <svg {...common}><path d="M6 14V8a2 2 0 0 1 2-2h6M34 6h6a2 2 0 0 1 2 2v6M42 34v6a2 2 0 0 1-2 2h-6M14 42H8a2 2 0 0 1-2-2v-6" /><circle cx="24" cy="24" r="9" /><circle cx="24" cy="24" r="3" /><path d="M6 24h7M35 24h7" /></svg>,
  Evaluation: <svg {...common}><rect x="6" y="6" width="22" height="30" rx="3" /><path d="M11 14l2 2 4-4M11 22l2 2 4-4M20 14h4M20 22h4M11 30h13" /><path d="M30 26h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4h-3a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" /></svg>,
  "Object library": <svg {...common}><rect x="14" y="6" width="26" height="20" rx="3" /><path d="M10 12v16a3 3 0 0 0 3 3h22" /><path d="M6 18v15a3 3 0 0 0 3 3h22" /><circle cx="22" cy="14" r="3" /><path d="M14 24l8-6 6 4 4-3 8 6" /></svg>,
  History: <svg {...common}><path d="M10 8v32" /><circle cx="10" cy="12" r="3" /><circle cx="10" cy="24" r="3" /><circle cx="10" cy="36" r="3" /><path d="M18 12h22M18 24h16M18 36h20" /></svg>,
  Summary: <svg {...common}><path d="M6 40h36" /><rect x="9" y="26" width="6" height="14" rx="1" /><rect x="20" y="18" width="6" height="22" rx="1" /><rect x="31" y="10" width="6" height="30" rx="1" /><path d="M8 20l11-8 9 5 12-11" /></svg>,
};

export function PageIcon({ name }: { name: string }) {
  const icon = PAGE_ICONS[name];
  return icon ? <span className="page-icon">{icon}</span> : null;
}
