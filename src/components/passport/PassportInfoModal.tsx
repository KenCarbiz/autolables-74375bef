import { useEffect, useState } from "react";
import { ShieldCheck, Gauge, Database, ArrowRight } from "lucide-react";
import { InfoModal, Para, Bullets, Checklist, Callout, Glossary, Flow, ScoreScale, SourceGrid } from "./InfoModal";

// ──────────────────────────────────────────────────────────────
// PassportInfoModal — content dispatcher for the reusable InfoModal.
// Adding a new educational popup is just a new case here; the shell,
// animation, and close behaviour never change.
// ──────────────────────────────────────────────────────────────

export type InfoModalKey = "verification-process" | "score-meaning" | "warranty-terms" | "data-sources";

interface InfoDef { icon: React.ElementType; title: string; subtitle?: string; body: React.ReactNode; cta?: { label: string; onClick: () => void } }

function buildInfo(key: InfoModalKey, go: (s: string) => void, openPanel: ((k: string) => void) | undefined, onClose: () => void): InfoDef {
  switch (key) {
    case "verification-process":
      return {
        icon: ShieldCheck,
        title: "How AutoLabels Verifies Every Vehicle",
        subtitle: "Our verification process, explained",
        body: <>
          <Para>AutoLabels combines trusted automotive databases, manufacturer information, market intelligence, and a structured inspection to verify every vehicle — so you can shop with confidence.</Para>
          <Flow steps={["Vehicle", "OEM", "History", "Inspection", "Verified"]} />
          <Checklist items={[
            "Trusted automotive history databases",
            "Manufacturer (OEM) build and specification data",
            "Live market intelligence and comparable pricing",
            "A structured AutoLabels condition review",
          ]} />
          <Callout tone="green">We clearly separate verified data from items that still need dealer confirmation. We never present unconfirmed information as verified.</Callout>
        </>,
        cta: { label: "View Full Verification Report", onClick: () => { onClose(); go("verification"); } },
      };
    case "score-meaning":
      return {
        icon: Gauge,
        title: "What Does This Score Mean?",
        subtitle: "How AutoLabels confidence scores are calculated",
        body: <>
          <Para>The AutoLabels score blends verified vehicle data with live market signals into a single 0–100 figure. A higher score means fewer unknowns about the vehicle and its pricing.</Para>
          <ScoreScale />
          <Para>Scores are built from these inputs:</Para>
          <Bullets items={[
            "Title and ownership history",
            "Accident and recall records",
            "Service history and condition",
            "Market pricing versus comparable vehicles",
            "Equipment and warranty coverage",
          ]} />
          <Callout>Newer listings or rare models may score lower until enough comparable data is available — not because anything is wrong with the vehicle.</Callout>
        </>,
        cta: { label: "View Full Report", onClick: () => { onClose(); go("verification"); } },
      };
    case "warranty-terms":
      return {
        icon: ShieldCheck,
        title: "Warranty Terminology",
        subtitle: "Common warranty terms, in plain language",
        body: <>
          <Glossary items={[
            { term: "Basic Warranty", def: "Covers most components for a set time/mileage from the in-service date." },
            { term: "Bumper-to-Bumper", def: "Another name for basic coverage — nearly everything between the bumpers." },
            { term: "Powertrain", def: "Covers the engine, transmission, and drivetrain, usually for longer than basic." },
            { term: "Roadside Assistance", def: "Help with towing, lockouts, jump-starts, and flat tires during the coverage term." },
            { term: "Corrosion", def: "Covers rust-through (perforation) of body panels for an extended period." },
            { term: "Transferable", def: "Whether remaining coverage passes to the next owner — factory warranties typically do." },
            { term: "Deductible", def: "Any amount you pay per covered repair visit. Factory repairs are often $0." },
            { term: "Certified (CPO) Warranty", def: "Extra manufacturer-backed coverage added to qualifying pre-owned vehicles." },
          ]} />
          <Callout>Exact terms vary by manufacturer and model year. Confirm specifics with the dealer.</Callout>
        </>,
        cta: { label: "View Factory Warranty", onClick: () => { onClose(); openPanel ? openPanel("factory-warranty") : go("factory-warranty"); } },
      };
    case "data-sources":
      return {
        icon: Database,
        title: "Data Sources Explained",
        subtitle: "Where this vehicle's information comes from",
        body: <>
          <Para>AutoLabels draws on multiple independent sources. Each contributes a different piece of the picture, and availability varies by vehicle and region.</Para>
          <SourceGrid items={[
            { name: "CARFAX", contributes: "Vehicle history — accidents, title events, service records." },
            { name: "AutoCheck", contributes: "Alternative history report and an auction-based history score." },
            { name: "NMVTIS", contributes: "Federal title-brand and total-loss records." },
            { name: "OEM", contributes: "Manufacturer build data, equipment, and specifications." },
            { name: "MarketCheck", contributes: "Live market pricing and comparable listings." },
            { name: "NHTSA", contributes: "Open recall campaigns and safety data." },
            { name: "Kelley Blue Book", contributes: "Independent vehicle valuation guidance." },
          ]} />
          <Callout tone="green">Only sources that have data for this specific vehicle contribute to its report. We never present unconfirmed information as verified.</Callout>
        </>,
        cta: { label: "View Verification Report", onClick: () => { onClose(); go("verification"); } },
      };
  }
}

export interface PassportInfoModalProps {
  info: InfoModalKey | null;
  onClose: () => void;
  go: (section: string) => void;
  openPanel?: (key: string) => void;
}

export default function PassportInfoModal({ info, onClose, go, openPanel }: PassportInfoModalProps) {
  const [shown, setShown] = useState<InfoModalKey | null>(info);
  useEffect(() => { if (info) setShown(info); }, [info]);
  const key = info ?? shown;
  if (!key) return null;

  const def = buildInfo(key, go, openPanel, onClose);
  const footer = def.cta ? (
    <div className="flex items-center justify-end gap-2">
      <button onClick={onClose} className="h-10 px-4 rounded-xl border border-[#E6E8EC] bg-white text-[13px] font-semibold text-[#0F172A] hover:border-[#2563EB] transition-colors">Close</button>
      <button onClick={def.cta.onClick} className="h-10 px-5 rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13px] font-semibold inline-flex items-center gap-2 transition-colors">{def.cta.label}<ArrowRight className="w-4 h-4" /></button>
    </div>
  ) : undefined;

  return (
    <InfoModal open={info !== null} onClose={onClose} icon={def.icon} title={def.title} subtitle={def.subtitle} footer={footer}>
      {def.body}
    </InfoModal>
  );
}
