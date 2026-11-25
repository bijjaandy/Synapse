import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";
import { AssistantChat, VerificationQueue } from "@/components/netrix-panels";

export default function EvaluationPage() {
  return <AppShell>
    <PageIntro title="Evaluation" text="Verify flagged parts, test a trained part on labelled folders, and ask the local AI about the results." />
    <div className="netrix-two-col"><VerificationQueue /><AssistantChat /></div>
    <InspectionLab view="evaluation" />
  </AppShell>;
}
