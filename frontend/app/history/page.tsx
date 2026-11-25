import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";

export default function HistoryPage() {
  return <AppShell><PageIntro title="History" text="Every inspection, stored on this laptop with its heatmap. Export it or print a shift report." /><InspectionLab view="history" /></AppShell>;
}
