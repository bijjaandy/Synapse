import InspectionLab from "@/components/inspection-lab";
import { AppShell, PageIntro } from "@/components/netrix-shell";

export default function ObjectsPage() {
  return <AppShell><PageIntro title="Object library" text="Every part this laptop has learned, with its model and when it was trained." /><InspectionLab view="objects" /></AppShell>;
}
