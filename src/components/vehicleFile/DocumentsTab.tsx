import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, FilePlus2, MoreHorizontal, Printer } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { resolveOperatingState } from "@/lib/dealerState";
import FactoryStickerCard from "@/components/vehicle/FactoryStickerCard";
import GeneratedDocumentsSection from "@/components/vehicle/GeneratedDocumentsSection";
import DealDocumentsPanel from "@/components/vehicle/DealDocumentsPanel";
import { Card } from "./primitives";
import { VehicleSubHeader } from "./SubPageHeader";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { Button, WorkTable, Th, Td, StatusText, type Tone } from "@/components/product";
import { useDealRecord, dealDocStatus } from "@/hooks/useDealRecord";
import { useVehicleDocuments } from "@/lib/stickerStudio/useVehicleDocuments";
import { STATUS_META } from "@/lib/stickerStudio/documentWorkflow";
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

// Group names for the register, from the real document type. Private
// documents are only grouped here; their contents are never rendered.
const GROUP_ORDER = ["Sales & Disclosure", "Title & Registration", "Stickers & Build Record", "Other"] as const;
const groupForType = (type: string | undefined, name: string | undefined): (typeof GROUP_ORDER)[number] => {
  const t = `${type || ""} ${name || ""}`.toLowerCase();
  if (/title|registration|mco|odometer|lien|plate/.test(t)) return "Title & Registration";
  if (/buyer|guide|k-?208|inspection|addendum|disclosure|warranty|contract|window|sticker|monroney/.test(t)) return "Sales & Disclosure";
  return "Other";
};

interface RegisterRow {
  key: string;
  group: string;
  name: string;
  status: string;
  tone: Tone;
  packet: string;
  version?: string;
  updated?: string | null;
  href?: string;
  to?: string;
}

// One grouped register of what is on file for this VIN, read from the listing
// row and the deal record. Condition rules decide which forms apply: the FTC
// Buyers Guide and the safety inspection are used and CPO documents only.
// Nothing here generates or publishes anything.
const DocumentRegister = ({ vehicle }: { vehicle: VehicleRow }) => {
  const { record, loading } = useDealRecord(vehicle.vin, vehicle.id, vehicle.tenant_id);
  const { documents: generated } = useVehicleDocuments(vehicle.id);
  const isUsed = vehicle.condition !== "new";
  const modules = vehicle.packet_modules || {};
  const packetFor = (key: string) => (key in modules ? (modules[key] ? "Public" : "Internal only") : "Unknown");
  const oem = (vehicle as unknown as { oem_sticker_url?: string | null }).oem_sticker_url ?? null;

  const rows: RegisterRow[] = [
    { key: "oem", group: "Stickers & Build Record", name: "OEM window sticker", status: oem ? "On file" : "Not on file", tone: oem ? "success" : "neutral", packet: packetFor("oem_sticker"), href: oem ?? undefined },
  ];
  if (isUsed) {
    const docs = record ? dealDocStatus(record) : null;
    rows.push(
      { key: "bg", group: "Sales & Disclosure", name: "FTC Buyers Guide", status: loading ? "Reading" : docs?.buyersGuide ? `Filed${record?.buyersGuide?.version != null ? ` (v${record.buyersGuide.version})` : ""}` : "Not filed", tone: docs?.buyersGuide ? "success" : "warning", packet: "Internal only" },
      { key: "k208", group: "Sales & Disclosure", name: "Safety inspection", status: loading ? "Reading" : docs?.k208 ? "Executed" : "Not executed", tone: docs?.k208 ? "success" : "warning", packet: "Internal only" },
    );
  }
  (vehicle.documents || []).forEach((d, i) => {
    rows.push({ key: `up-${i}`, group: groupForType(d.type, d.name), name: d.name || d.type || "Document", status: "On file", tone: "success", packet: packetFor(d.type), href: d.url });
  });

  const GENERATED_LABEL: Record<string, string> = { window: "Window sticker", addendum: "Addendum", passport: "Vehicle passport", cpo_sheet: "CPO sheet", buyers_guide: "Buyers Guide", factory_sticker: "Factory build record" };
  const GENERATED_TONE: Record<string, Tone> = { approved: "success", printed: "success", published: "success", pending_approval: "warning", rejected: "danger" };
  generated.forEach((d) => {
    rows.push({
      key: `gen-${d.id}`,
      group: d.document_type === "buyers_guide" ? "Sales & Disclosure" : "Stickers & Build Record",
      name: GENERATED_LABEL[d.document_type] || d.document_type,
      version: `v${d.version}`,
      updated: d.created_at ?? null,
      status: STATUS_META[d.document_status]?.label || d.document_status,
      tone: GENERATED_TONE[d.document_status] || "neutral",
      packet: d.document_status === "published" ? "Public" : "Internal only",
      to: `/vehicle-file/${vehicle.id}/documents/${d.id}`,
    });
  });

  const grouped = GROUP_ORDER.map((g) => ({ g, items: rows.filter((r) => r.group === g) })).filter((x) => x.items.length > 0);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
        <WorkTable caption="Documents on file for this vehicle" minWidth={760}>
          <thead>
            <tr><Th>Type</Th><Th>Version</Th><Th>State</Th><Th>Visibility</Th><Th>Updated</Th><Th align="right">Action</Th></tr>
          </thead>
          <tbody>
            {grouped.flatMap(({ g, items }) => [
              <tr key={`g-${g}`}><td colSpan={6} className="bg-adm-workspace px-3 py-2.5 text-[14px] leading-[20px] font-bold text-adm-ink border-b border-adm-border">{g}</td></tr>,
              ...items.map((r) => (
              <tr key={r.key}>
                <Td>{r.name}</Td>
                <Td className="text-adm-muted">{r.version ?? "-"}</Td>
                <Td><StatusText tone={r.tone}>{r.status}</StatusText></Td>
                <Td className="text-adm-muted">{r.packet}</Td>
                <Td className="text-adm-muted">{r.updated ? new Date(r.updated).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-"}</Td>
                <Td align="right">
                  {r.to ? <Link className="text-adm-primary hover:underline" to={r.to}>Review</Link> : r.href ? <a className="text-adm-primary hover:underline" href={r.href} target="_blank" rel="noreferrer">Open</a> : <span className="text-adm-muted">-</span>}
                </Td>
              </tr>
              )),
            ])}
          </tbody>
        </WorkTable>
      </div>
    </div>
  );
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

export const DocumentsTab = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void; strip?: ReactNode }) => {
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
      <VehicleSubHeader
        vehicle={vehicle}
        section="Documents"
        crumbs={false}
        title="Vehicle documents"
        description={`Manage documents for ${vehicle.ymm || vehicle.vin}${vehicleStockNumber(vehicle) ? ` (Stock # ${vehicleStockNumber(vehicle)})` : ""}`}
        actions={
          <>
            <Button variant="primary" onClick={() => setPicker((v) => !v)} aria-expanded={picker}>
              <FilePlus2 className="w-5 h-5" /> Generate document
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-10 w-10 items-center justify-center rounded-[6px] border border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace transition-colors"
                aria-label="More document actions"
              >
                <MoreHorizontal className="w-5 h-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onSelect={() => scrollTo(SECTION_IDS.oem)}>Factory build record</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => scrollTo(SECTION_IDS.forms)}>Deal forms</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => scrollTo(SECTION_IDS.uploads)}>Uploaded documents</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => scrollTo(SECTION_IDS.generated)}>Versions and print history</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <DocumentRegister vehicle={vehicle} />

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
