import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FilePlus2, Printer } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { resolveOperatingState } from "@/lib/dealerState";
import FactoryStickerCard from "@/components/vehicle/FactoryStickerCard";
import GeneratedDocumentsSection from "@/components/vehicle/GeneratedDocumentsSection";
import DealDocumentsPanel from "@/components/vehicle/DealDocumentsPanel";
import { Card, TabHeader, btnLarge } from "./primitives";
import { BrochureFinderRow, OwnersManualFinderRow } from "./OemDocFinders";
import StickerGenerators from "./StickerGenerators";
import AddendumSection from "./AddendumSection";
import DocumentUploads from "./DocumentUploads";
import PassportPacketSection from "./PassportPacketSection";
import type { VehicleRow } from "./types";

// Per-state used-car safety inspection form, by the dealer's operating state.
// Display only — the form is produced and certified under the store's own
// policy, never because a screen said a role could sign it.
const SAFETY_FORM: Record<string, string> = {
  CT: "Connecticut K-208 safety inspection",
  NY: "New York safety & emissions inspection",
  PA: "Pennsylvania safety inspection",
  NJ: "New Jersey inspection",
  TX: "Texas vehicle inspection",
  MA: "Massachusetts safety inspection",
  VA: "Virginia safety inspection",
  ME: "Maine safety inspection",
  RI: "Rhode Island safety & emissions inspection",
  MO: "Missouri safety inspection",
};

const SECTION_IDS = {
  oem: "vf-doc-oem",
  forms: "vf-doc-forms",
  stickers: "vf-doc-stickers",
  addendum: "vf-doc-addendum",
  uploads: "vf-doc-uploads",
  generated: "vf-doc-generated",
  packet: "vf-doc-packet",
} as const;

interface Producible {
  label: string;
  detail: string;
  target: string;
  where: "here" | "builder";
  to?: string;
}

export const DocumentsTab = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const navigate = useNavigate();
  const [picker, setPicker] = useState(false);
  const { settings } = useDealerSettings();
  const { currentStore } = useTenant();
  const opState = resolveOperatingState(settings, currentStore?.state);
  const safetyForm = SAFETY_FORM[opState] || "State safety inspection";
  const isUsed = vehicle.condition !== "new";

  const scrollTo = (id: string) => {
    setPicker(false);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  };

  const producible: Producible[] = [
    { label: "OEM window sticker (build record)", detail: "Generated from the stored factory build data for this VIN", target: SECTION_IDS.oem, where: "here" },
    ...(isUsed ? [
      { label: "FTC Buyers Guide", detail: "The official As-Is / Implied form, English or Spanish", target: SECTION_IDS.forms, where: "here" as const },
      { label: safetyForm, detail: "Filed with the deal record for this VIN", target: SECTION_IDS.forms, where: "here" as const },
    ] : []),
    { label: "Used vehicle sticker", detail: "Monroney-style sticker with the dealer addendum", target: SECTION_IDS.stickers, where: "builder", to: `/used-car-sticker?vehicleId=${vehicle.id}` },
    { label: "Addendum", detail: "Dealer-added equipment, priced and signable", target: SECTION_IDS.addendum, where: "here" },
    { label: "Addendum label", detail: "The printed strip that pairs with the window sticker", target: SECTION_IDS.stickers, where: "builder", to: `/addendum-label/${vehicle.id}` },
    ...(vehicle.condition === "cpo" ? [
      { label: "CPO sheet", detail: "Certified Pre-Owned disclosure", target: SECTION_IDS.stickers, where: "builder" as const, to: `/cpo-sheet?vehicleId=${vehicle.id}` },
    ] : []),
    { label: "Warranty documents", detail: "Attach the limited warranty, VSC or GAP paperwork", target: SECTION_IDS.uploads, where: "here" },
    { label: "Title documents", detail: "Title and MCO images are filed on the Compliance tab", target: SECTION_IDS.uploads, where: "builder", to: `/vehicle-file/${vehicle.id}?tab=compliance` },
  ];

  return (
    <div className="space-y-6">
      <TabHeader
        title="Documents"
        description="Every document this vehicle needs — produced, versioned, printed and filed against its VIN."
        action={
          <button onClick={() => setPicker((v) => !v)} aria-expanded={picker} className={btnLarge}>
            <FilePlus2 className="w-4 h-4" /> Generate document
          </button>
        }
      />

      {picker && (
        <Card title="What do you need to produce?">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {producible.map((p) => (
              <button
                key={p.label}
                onClick={() => (p.where === "builder" && p.to ? navigate(p.to) : scrollTo(p.target))}
                className="text-left rounded-xl border border-border bg-card hover:bg-muted transition-colors px-4 py-3 flex items-center gap-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-al-body font-semibold text-foreground truncate">{p.label}</span>
                  <span className="block text-al-meta text-muted-foreground truncate">{p.detail}</span>
                </span>
                <span className="text-al-meta font-semibold text-muted-foreground shrink-0 inline-flex items-center gap-1">
                  {p.where === "here" ? "On this tab" : "Opens builder"} <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div id={SECTION_IDS.oem} className="scroll-mt-24">
        <FactoryStickerCard
          vehicleId={vehicle.id}
          tenantId={vehicle.tenant_id}
          condition={vehicle.condition}
          oemStickerUrl={(vehicle as unknown as { oem_sticker_url?: string | null }).oem_sticker_url ?? null}
          vin={vehicle.vin}
          vehicleLabel={vehicle.ymm}
        />
      </div>

      <div id={SECTION_IDS.forms} className="scroll-mt-24">
        <DealDocumentsPanel vehicle={vehicle} />
      </div>

      <div id={SECTION_IDS.stickers} className="scroll-mt-24">
        <StickerGenerators vehicle={vehicle} />
      </div>

      <div id={SECTION_IDS.addendum} className="scroll-mt-24">
        <AddendumSection vehicle={vehicle} />
      </div>

      <BrochureFinderRow vehicle={vehicle} />
      <OwnersManualFinderRow vehicle={vehicle} />

      <div id={SECTION_IDS.uploads} className="scroll-mt-24">
        <DocumentUploads vehicle={vehicle} onReload={onReload} />
      </div>

      <div id={SECTION_IDS.generated} className="scroll-mt-24">
        <Card title="Generated documents, versions & print history" action={
          <span className="text-al-meta text-muted-foreground inline-flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Reprints come off the frozen snapshot
          </span>
        }>
          <GeneratedDocumentsSection vehicleId={vehicle.id} />
        </Card>
      </div>

      <div id={SECTION_IDS.packet} className="scroll-mt-24">
        <PassportPacketSection vehicle={vehicle} onReload={onReload} />
      </div>
    </div>
  );
};

export default DocumentsTab;
