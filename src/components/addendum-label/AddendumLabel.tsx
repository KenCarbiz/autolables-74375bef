import { QRCodeSVG } from "qrcode.react";
import AddendumIcon from "@/components/addendum-icons/AddendumIcon";
import { getAddendumIconComponent } from "@/components/addendum-icons/iconRegistry";
import Logo from "@/components/brand/Logo";
import { resolveIconId } from "./iconResolver";
import {
  type AddendumLabelData, type LabelProductLine, type LabelBenefitLine,
  fmtCurrency, displayPrice, sumLines,
} from "./labelData";

// ──────────────────────────────────────────────────────────────
// AddendumLabel — the 4.5in x 11in printed addendum. One component,
// one vehicle, fully data-driven: tenant identity, vehicle identity,
// passport QR, installed equipment (included), included benefits,
// available upgrades (not installed), pricing summary, trust badges,
// compliance footer. Empty sections don't render; compact mode keeps
// long catalogs inside the page. Print CSS pins the exact page size.
// ──────────────────────────────────────────────────────────────

const NAVY = "#0D1B2A";
const BLUE = "#1E5AA8";
const GREEN = "#16A34A";
const PURPLE = "#6D28D9";

const SectionHead = ({ iconKey, title, tone }: { iconKey: string; title: string; tone: string }) => (
  <div className="flex items-center gap-1.5 rounded-md px-2 py-1" style={{ background: `${tone}14` }}>
    <AddendumIcon iconId={resolveIconId(iconKey)} color={tone === GREEN ? "green" : tone === PURPLE ? "purple" : "blue"} size={13} />
    <p className="font-extrabold tracking-wide" style={{ color: tone, fontSize: "9px" }}>{title}</p>
  </div>
);

const ProductLine = ({ line, tone, compact }: { line: LabelProductLine; tone: "green" | "purple"; compact: boolean }) => (
  <div className="flex items-center gap-1.5 border-b border-slate-100" style={{ padding: compact ? "2px 2px" : "3.5px 2px" }}>
    <AddendumIcon iconId={resolveIconId(line.iconKey)} color={tone} size={compact ? 11 : 13} />
    <div className="min-w-0 flex-1 leading-none">
      <p className="font-bold truncate" style={{ fontSize: compact ? "8px" : "9px", color: NAVY }}>
        {line.name}{line.disclosureRequired ? "*" : ""}
      </p>
      {!compact && line.subtitle && <p className="truncate text-slate-500" style={{ fontSize: "7px", marginTop: "1px" }}>{line.subtitle}</p>}
    </div>
    {line.price != null && line.price > 0 && (
      <p className="font-extrabold shrink-0" style={{ fontSize: compact ? "8px" : "9px", color: NAVY }}>{fmtCurrency(line.price)}</p>
    )}
  </div>
);

const BenefitLine = ({ line, compact }: { line: LabelBenefitLine; compact: boolean }) => (
  <div className="flex items-center gap-1.5" style={{ padding: compact ? "1.5px 2px" : "2.5px 2px" }}>
    <AddendumIcon iconId={resolveIconId(line.iconKey)} color="blue" size={compact ? 10 : 12} />
    <p className="font-semibold leading-tight" style={{ fontSize: compact ? "7.5px" : "8.5px", color: NAVY }}>
      {line.name}{line.disclosureRequired ? "*" : ""}
    </p>
  </div>
);

const TRUST_BADGES = [
  { iconKey: "quality_products", title: "Quality Products", sub: "Professionally installed for long-lasting protection" },
  { iconKey: "expert_installation", title: "Expert Installation", sub: "Factory-trained technicians you can trust" },
  { iconKey: "added_value", title: "Added Value", sub: "Enhances your driving experience and vehicle value" },
  { iconKey: "peace_of_mind", title: "Peace of Mind", sub: "Backed by our warranty and support" },
];

const COMPLIANCE_BADGES = [
  { iconKey: "ai_powered", label: "AI Powered" },
  { iconKey: "ftc_compliant", label: "FTC Compliant" },
  { iconKey: "realtime_updates", label: "Real-Time Updates" },
  { iconKey: "print_ready", label: "Print Ready" },
];

export default function AddendumLabel({ data }: { data: AddendumLabelData }) {
  const { tenant, vehicle, installed, benefits, upgrades, compact } = data;
  const price = displayPrice(vehicle);
  const installedValue = sumLines(installed);
  const upgradeValue = sumLines(upgrades);
  const anyDisclosure = [...installed, ...benefits, ...upgrades].some((l) => l.disclosureRequired);

  return (
    <div
      className="addendum-label bg-white flex flex-col"
      style={{ width: "4.5in", height: "11in", boxSizing: "border-box", padding: "0.2in", color: NAVY, fontFamily: "Inter, Arial, sans-serif", overflow: "hidden" }}
    >
      {/* Header: platform mark left, tenant identity right */}
      <div className="flex items-start justify-between gap-2 pb-1.5 border-b-2" style={{ borderColor: NAVY }}>
        <Logo variant="full" size={16} />
        <div className="text-right leading-tight min-w-0">
          {tenant.logoUrl
            ? <img src={tenant.logoUrl} alt={tenant.name} style={{ maxHeight: "0.32in", maxWidth: "1.9in", objectFit: "contain", marginLeft: "auto" }} />
            : <p className="font-extrabold" style={{ fontSize: "12px" }}>{tenant.name}</p>}
          {tenant.addressLine && <p className="text-slate-600" style={{ fontSize: "7px" }}>{tenant.addressLine}</p>}
          <p className="text-slate-600" style={{ fontSize: "7px" }}>
            {[tenant.phone, tenant.website].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {/* Vehicle title */}
      <div className="pt-2 pb-1.5">
        <p className="font-extrabold leading-none tracking-tight" style={{ fontSize: "17px" }}>
          {vehicle.year} {vehicle.make.toUpperCase()}
        </p>
        <p className="font-extrabold leading-none tracking-tight" style={{ fontSize: "17px", color: BLUE }}>
          {vehicle.model.toUpperCase()}{vehicle.trim ? ` ${vehicle.trim.toUpperCase()}` : ""}
        </p>
      </div>

      {/* Info grid + QR */}
      <div className="flex gap-2 pb-2 border-b border-slate-200">
        <div className="flex-1 grid grid-cols-2 gap-x-2 gap-y-1 content-start">
          {[
            { k: "stock_number", label: "STOCK", value: vehicle.stockNumber },
            { k: "vin", label: "VIN", value: vehicle.vin },
            { k: "calendar", label: "DATE", value: data.generatedDate },
            { k: "price_tag", label: price.label.replace("TOTAL ", ""), value: fmtCurrency(price.value) },
          ].filter((c) => c.value).map((c) => (
            <div key={c.label} className="flex items-center gap-1.5 min-w-0">
              <AddendumIcon iconId={resolveIconId(c.k)} color="navy" size={11} />
              <div className="leading-none min-w-0">
                <p className="text-slate-500 font-bold" style={{ fontSize: "6px", letterSpacing: "0.04em" }}>{c.label}</p>
                <p className="font-bold truncate" style={{ fontSize: c.label === "VIN" ? "7.5px" : "9px" }}>{c.value}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="shrink-0 text-center" style={{ width: "1.15in" }}>
          <div className="border-2 rounded-md p-1 inline-block" style={{ borderColor: BLUE }}>
            <QRCodeSVG value={data.passportUrl} size={86} level="Q" />
          </div>
          <p className="font-extrabold leading-tight" style={{ fontSize: "6.5px", color: BLUE, marginTop: "2px" }}>SCAN TO VIEW<br />VEHICLE PASSPORT</p>
          {data.passportModules.length > 0 && (
            <p className="text-slate-500 leading-tight" style={{ fontSize: "5.5px", marginTop: "1px" }}>{data.passportModules.join(" · ")}</p>
          )}
        </div>
      </div>

      {/* Dynamic sections — empty ones don't render, the rest move up */}
      <div className="flex-1 min-h-0 pt-1.5 space-y-1.5">
        {installed.length > 0 && (
          <div>
            <SectionHead iconKey="installed_equipment" title="INSTALLED EQUIPMENT (INCLUDED)" tone={GREEN} />
            <div className="px-0.5">
              {installed.map((l) => <ProductLine key={l.id} line={l} tone="green" compact={compact} />)}
            </div>
            <p className="text-slate-500" style={{ fontSize: "6px", padding: "1.5px 2px 0" }}>
              Items above are installed on this vehicle and included in the displayed price.
            </p>
          </div>
        )}

        {benefits.length > 0 && (
          <div>
            <SectionHead iconKey="included_benefits" title="INCLUDED BENEFITS" tone={BLUE} />
            <div className="px-0.5">
              {benefits.map((l) => <BenefitLine key={l.id} line={l} compact={compact} />)}
            </div>
          </div>
        )}

        {upgrades.length > 0 && (
          <div>
            <SectionHead iconKey="available_upgrades" title="AVAILABLE UPGRADES (NOT INSTALLED)" tone={PURPLE} />
            <div className="px-0.5">
              {upgrades.map((l) => <ProductLine key={l.id} line={l} tone="purple" compact={compact} />)}
            </div>
            <p className="text-slate-500" style={{ fontSize: "6px", padding: "1.5px 2px 0" }}>
              Optional upgrades are not installed and not included in the displayed price unless selected by the customer.
            </p>
          </div>
        )}
      </div>

      {/* Pricing summary */}
      <div className="rounded-lg border-2 flex items-stretch mt-1.5" style={{ borderColor: NAVY }}>
        <div className="px-2 py-1.5 flex-1">
          <p className="font-bold text-slate-500" style={{ fontSize: "6.5px", letterSpacing: "0.05em" }}>{price.label}</p>
          <p className="font-extrabold leading-none" style={{ fontSize: "18px" }}>{fmtCurrency(price.value) || "See Dealer"}</p>
        </div>
        <div className="px-2 py-1.5 border-l border-slate-200 text-right leading-tight" style={{ fontSize: "7px" }}>
          {installedValue > 0 && <p><span className="text-slate-500">Total Installed Value</span> <span className="font-extrabold">{fmtCurrency(installedValue)}</span></p>}
          {upgradeValue > 0 && <p><span className="text-slate-500">Total Available Upgrades</span> <span className="font-extrabold">{fmtCurrency(upgradeValue)}</span></p>}
          {upgradeValue > 0 && <p className="text-slate-400" style={{ fontSize: "5.5px" }}>Available upgrades not included in total.</p>}
        </div>
      </div>

      {/* Disclosure marker */}
      {anyDisclosure && (
        <p className="text-slate-500" style={{ fontSize: "6px", marginTop: "3px" }}>
          *See dealer or Vehicle Passport for complete details. Scan the QR code above for full disclosures.
        </p>
      )}

      {/* Trust badges */}
      <div className="grid grid-cols-4 gap-1 mt-1.5">
        {TRUST_BADGES.map((b) => (
          <div key={b.title} className="rounded-md border border-slate-200 px-1 py-1 text-center leading-tight">
            <span className="inline-flex"><AddendumIcon iconId={resolveIconId(b.iconKey)} color="blue" size={11} /></span>
            <p className="font-bold" style={{ fontSize: "6px" }}>{b.title}</p>
            {!compact && <p className="text-slate-500" style={{ fontSize: "5px" }}>{b.sub}</p>}
          </div>
        ))}
      </div>

      {/* Compliance footer */}
      <div className="rounded-md mt-1.5 px-2 py-1.5 flex items-center justify-between" style={{ background: NAVY, color: "white" }}>
        <p className="font-semibold" style={{ fontSize: "7px" }}>Powered by <span className="font-extrabold">autolabels.io</span></p>
        <div className="flex items-center gap-2">
          {COMPLIANCE_BADGES.map((b) => {
            // Footer icons sit on navy, so render the registry component
            // directly with a light currentColor instead of a dark token.
            const Icon = getAddendumIconComponent(resolveIconId(b.iconKey));
            return (
              <span key={b.label} className="inline-flex items-center gap-0.5" style={{ fontSize: "5.5px" }}>
                <span style={{ color: "#93C5FD", display: "inline-flex", lineHeight: 0 }}><Icon size={8} /></span>
                {b.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
