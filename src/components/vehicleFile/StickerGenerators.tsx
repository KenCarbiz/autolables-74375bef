import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useStickerPrefs } from "@/lib/stickerStudio/useStickerPrefs";
import {
  LABEL_BUILDERS, conditionOf, labelRefPath, resolveLabelDefault, slotFor, type LabelKind,
} from "@/lib/labelDefaults";
import { Card, btn, btnPrimary } from "./primitives";
import type { VehicleRow } from "./types";

// Per-vehicle template chooser: shows the template in effect for this
// vehicle's condition (window or addendum slot), lets the dealer pick any
// builder / Sticker Studio template for this one vehicle, and optionally
// promote the pick to the store default.
const TemplateSlotRow = ({ kind, vehicle }: { kind: LabelKind; vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const { settings, updateSettings } = useDealerSettings();
  const { templates } = useStickerCatalog();
  const { defaults: legacy } = useStickerPrefs();

  const condition = conditionOf(vehicle.condition);
  const slot = slotFor(kind, condition);
  const storeRef = resolveLabelDefault(settings.label_defaults, slot, legacy);
  const [ref, setRef] = useState<string>(storeRef || "");

  const options = [
    ...Object.values(LABEL_BUILDERS)
      .filter((b) => b.kind === kind && b.conditions.includes(condition))
      .map((b) => ({ value: `builder:${b.key}`, label: b.label })),
    ...templates
      .filter((t) => t.config.type === kind)
      .map((t) => ({ value: `studio:${t.config.id}`, label: `${t.config.name} (${t.config.size})` })),
  ];
  const selected = ref || storeRef || "";
  const path = selected ? labelRefPath(selected, vehicle.id) : null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="sm:w-44 shrink-0">
        <p className="text-al-body font-semibold text-foreground">{kind === "window" ? "Window sticker" : "Addendum"}</p>
        <p className="text-al-meta text-muted-foreground capitalize">{condition} vehicle</p>
      </div>
      <select
        value={options.some((o) => o.value === selected) ? selected : ""}
        onChange={(e) => setRef(e.target.value)}
        className="flex-1 h-9 rounded-lg border border-border bg-background px-2.5 text-al-body text-foreground min-w-0"
        aria-label={`${kind === "window" ? "Window sticker" : "Addendum"} template`}
      >
        {!options.some((o) => o.value === selected) && <option value="">Choose a template…</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="flex items-center gap-1.5 shrink-0">
        {selected && selected !== storeRef && (
          <button
            type="button"
            onClick={() => {
              updateSettings({ label_defaults: { ...(settings.label_defaults || {}), [slot]: selected } });
              toast.success(`Saved as your store default for ${condition} vehicles`);
            }}
            className={btn}
          >
            Set store default
          </button>
        )}
        <button type="button" disabled={!path} onClick={() => path && navigate(path)} className={btnPrimary}>
          <Printer className="w-3.5 h-3.5" /> Generate
        </button>
      </div>
    </div>
  );
};

interface BuilderLink {
  key: string;
  label: string;
  desc: string;
  ready: boolean;
  note: string;
  disabled?: boolean;
  to: string;
}

export const StickerGenerators = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const hasCore = !!vehicle.vin && !!vehicle.ymm;
  const hasPrice = vehicle.price != null && vehicle.price > 0;
  const isCpo = vehicle.condition === "cpo";
  // Carry the vehicle identity into every generator so the destination form
  // prefills from this file (see useVehiclePrefill).
  const withVehicle = (path: string) => `${path}?vehicleId=${vehicle.id}`;

  const links: BuilderLink[] = vehicle.condition === "new"
    ? [
        { key: "new-legacy", label: "New-car Monroney + addendum (classic builder)", desc: "Legacy combined sticker. The OEM build record above produces the manufacturer document; this produces dealer-added equipment.", ready: hasCore, note: hasCore ? "Ready to generate" : "Decode the VIN first", to: withVehicle("/new-car-sticker-legacy") },
      ]
    : [
        { key: "used", label: "Used-car Monroney + addendum", desc: "Three layouts: full, equipment-only, accessories-only.", ready: hasCore && hasPrice, note: hasCore && hasPrice ? "Ready to generate" : !hasPrice ? "Price missing" : "Decode the VIN first", to: withVehicle("/used-car-sticker") },
        { key: "cpo", label: "CPO sheet", desc: "Certified Pre-Owned disclosure template.", ready: isCpo, note: isCpo ? "Ready to generate" : "Available for CPO vehicles only", disabled: !isCpo, to: withVehicle("/cpo-sheet") },
        { key: "trade-up", label: "Trade-up sticker", desc: "For demo, courtesy and trade-in display units.", ready: hasCore, note: hasCore ? "Ready to generate" : "Decode the VIN first", to: withVehicle("/trade-up") },
      ];

  return (
    <Card title="Stickers & labels">
      <p className="text-al-body text-muted-foreground">
        Every sticker opens with this vehicle's VIN, year/make/model, trim, equipment and price already loaded.
        When the vehicle is published, the printed QR resolves to <span className="font-mono text-foreground">/v/{(vehicle.vin || vehicle.slug || "").toUpperCase()}</span>.
      </p>

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div>
          <p className="text-al-card text-foreground">Template for this vehicle</p>
          <p className="text-al-meta text-muted-foreground">
            Defaults to your store setting (Admin, Templates); pick a different template here to use it for this vehicle only.
          </p>
        </div>
        <TemplateSlotRow kind="window" vehicle={vehicle} />
        <TemplateSlotRow kind="addendum" vehicle={vehicle} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {links.map((l) => (
          <button
            key={l.key}
            onClick={() => { if (!l.disabled) navigate(l.to); }}
            disabled={l.disabled}
            className={`text-left rounded-xl border bg-card p-4 transition-colors ${
              l.disabled ? "border-border opacity-60 cursor-not-allowed" : "border-border hover:bg-muted"
            }`}
          >
            <span className="text-al-card text-foreground inline-flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> {l.label}
            </span>
            <span className="block text-al-meta text-muted-foreground mt-1">{l.desc}</span>
            <span className={`mt-2 inline-flex items-center gap-1.5 text-al-meta font-semibold ${
              l.disabled ? "text-muted-foreground" : l.ready ? "text-emerald-600" : "text-amber-600"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${l.disabled ? "bg-muted-foreground" : l.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
              {l.note}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
};

export default StickerGenerators;
