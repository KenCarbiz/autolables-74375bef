import PacketDefaultsPanel from "@/components/admin/PacketDefaultsPanel";
import OemDistributionPanel from "@/components/admin/OemDistributionPanel";
import PassportPublishingCard from "@/components/admin/PassportPublishingCard";
import { InlineNote, SectionTitle } from "@/components/admin/v2/primitives";

export default function PassportModulesView() {
  return (
    <div className="space-y-4 max-w-4xl">
      <SectionTitle
        title="Passport modules"
        description="Which modules a new passport shows by default, which manufacturer documents this store may serve, and when a passport goes live."
      />
      <InlineNote tone="info" title="Module defaults save as you change them.">
        Per-vehicle overrides on the Vehicle File always win. Auto-publish asks for confirmation before it turns on.
      </InlineNote>
      <PacketDefaultsPanel />
      <OemDistributionPanel />
      <PassportPublishingCard />
    </div>
  );
}
