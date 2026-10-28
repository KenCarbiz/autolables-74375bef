import { useTenant } from "@/contexts/TenantContext";
import { IncentivesSettingsPanel } from "@/components/admin/IncentivesSettingsPanel";
import { AddonElectionsPanel } from "@/components/admin/AddonElectionsPanel";
import { SectionTitle } from "@/components/admin/v2/primitives";

// Incentive programs and add-on elections, rehomed from the legacy
// Pricing & Incentives tab. Document fee and price presentation live on
// Price rules.
export default function IncentivesView() {
  const { currentStore } = useTenant();
  return (
    <div className="space-y-6">
      <section id="incentive-programs" aria-labelledby="incentive-programs-title" className="space-y-3">
        <SectionTitle title={<span id="incentive-programs-title">Incentive programs</span>} description="Manufacturer and dealer incentives shown to shoppers." />
        <IncentivesSettingsPanel />
      </section>
      <section id="addon-elections" aria-labelledby="addon-elections-title" className="space-y-3">
        <SectionTitle title={<span id="addon-elections-title">Add-on elections</span>} description="How optional products are offered at signing." />
        <AddonElectionsPanel storeId={currentStore?.id || ""} />
      </section>
    </div>
  );
}
