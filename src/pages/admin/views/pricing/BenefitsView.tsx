import DealerProgramsPanel from "@/components/admin/DealerProgramsPanel";

// Benefits: the dealer programs panel, rendered on its own so the page no
// longer mounts the whole legacy Administration component to show it.
export default function BenefitsView() {
  return <DealerProgramsPanel />;
}
