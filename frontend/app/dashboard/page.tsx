import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";

export default function DashboardPage() {
  return <AppShell><PageIntro title="Dashboard" text="Teach a part from good photos, then inspect new parts from a photo or the webcam." /><InspectionLab view="dashboard" /></AppShell>;
}
