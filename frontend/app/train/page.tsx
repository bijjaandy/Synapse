import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";

export default function TrainPage() {
  return <AppShell><PageIntro title="Train" text="Teach a new part from good photos only." /><InspectionLab view="train" /></AppShell>;
}
