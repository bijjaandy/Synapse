import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";
import { SummaryView } from "@/components/netrix-panels";

export default function SummaryPage() {
  return <AppShell><PageIntro title="Summary" text="Everything evaluated so far: results, parts, people in the loop and speed." /><SummaryView /><InspectionLab view="summary" /></AppShell>;
}
