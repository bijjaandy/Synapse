import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";

export default function InspectPage() {
  return <AppShell><PageIntro title="Inspect" text="Inspect a part from a photo, the webcam or conveyor mode." /><InspectionLab view="inspect" /></AppShell>;
}
