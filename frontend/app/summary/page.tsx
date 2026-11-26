import { AppShell, PageIntro } from "@/components/netrix-shell";
import { SummaryView } from "@/components/netrix-panels";

export default function SummaryPage() {
  return <AppShell><PageIntro title="Summary" text="Everything evaluated so far (all time): results, parts, people in the loop and speed." /><SummaryView /></AppShell>;
}
