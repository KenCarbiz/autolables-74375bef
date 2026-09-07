import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Package, Plus, Save, ShieldAlert, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { PACKET_MODULES, packetVisible } from "@/lib/packetModules";
import { programMatchesCondition, programMode, termLabel as programTermLabel, type DealerProgram } from "@/lib/dealerPrograms";
import { Card, EmptyNote, btnPrimary } from "./primitives";
import type { AvailableAccessory, ServiceRecord, VehicleRow, WarrantyInfo } from "./types";

// The digital packet a shopper scans into at /v/{VIN}: which modules appear,
// which store-wide programs apply to this unit, and the three vehicle content
// blocks the packet renders. Saved straight onto vehicle_listings, which the
// public RPC returns, so a change shows on the shopper page immediately.

const INPUT = "w-full h-9 px-2.5 rounded-lg border border-border bg-background text-al-body text-foreground outline-none focus:border-primary";
const LABEL = "text-al-meta font-bold uppercase tracking-wider text-muted-foreground";

export const PassportPacketSection = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [records, setRecords] = useState<ServiceRecord[]>(vehicle.service_records || []);
  const [warranty, setWarranty] = useState<WarrantyInfo>(vehicle.warranty_info || {});
  const [accessories, setAccessories] = useState<AvailableAccessory[]>(vehicle.available_accessories || []);
  const [packetModules, setPacketModules] = useState<Record<string, boolean>>(vehicle.packet_modules || {});
  const [suppressedPrograms, setSuppressedPrograms] = useState<string[]>(vehicle.suppressed_programs || []);
  const [passportVersion, setPassportVersion] = useState<"inherit" | "current" | "v3" | "experiment">(vehicle.passport_version || "inherit");
  const [saving, setSaving] = useState(false);
  const { settings: dealerSettings } = useDealerSettings();
  const storeDefaults = dealerSettings.packet_module_defaults || {};

  // Three states per module: explicit show, explicit hide, or inherit the
  // store-wide template. Click cycles inherit -> on -> off -> inherit.
  const cycleModule = (id: string) =>
    setPacketModules((prev) => {
      const next = { ...prev };
      if (prev[id] === undefined) next[id] = true;
      else if (prev[id] === true) next[id] = false;
      else delete next[id];
      return next;
    });

  const save = async () => {
    setSaving(true);
    // packet_modules may not be migrated everywhere yet; retry without it on a
    // schema error so saving packet content never breaks.
    const base = {
      service_records: records.filter((r) => r.date || r.type || r.notes || r.mileage),
      warranty_info: warranty,
      available_accessories: accessories.filter((a) => a.name.trim()),
    };
    let { error } = await (supabase as any)
      .from("vehicle_listings")
      .update({ ...base, packet_modules: packetModules, suppressed_programs: suppressedPrograms, passport_version: passportVersion })
      .eq("id", vehicle.id);
    if (error && /passport_version/i.test(error.message || "")) {
      ({ error } = await (supabase as any).from("vehicle_listings").update({ ...base, packet_modules: packetModules, suppressed_programs: suppressedPrograms }).eq("id", vehicle.id));
    }
    if (error && /suppressed_programs/i.test(error.message || "")) {
      ({ error } = await (supabase as any).from("vehicle_listings").update({ ...base, packet_modules: packetModules }).eq("id", vehicle.id));
    }
    if (error && /column|schema cache|packet_modules/i.test(error.message || "")) {
      ({ error } = await (supabase as any).from("vehicle_listings").update(base).eq("id", vehicle.id));
    }
    setSaving(false);
    if (error) { toast.error("Could not save the packet"); return; }
    toast.success("Packet saved");
    onReload();
  };

  const remainingCoverage = (() => {
    if (!warranty.in_service_date || !warranty.factory_months) return null;
    const end = new Date(warranty.in_service_date);
    end.setMonth(end.getMonth() + warranty.factory_months);
    const ms = end.getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    if (ms <= 0) return "Factory coverage has expired.";
    const mo = Math.round(ms / (1000 * 60 * 60 * 24 * 30.44));
    return mo >= 12
      ? `~${Math.floor(mo / 12)} yr ${mo % 12} mo of factory coverage remaining`
      : `~${mo} mo of factory coverage remaining`;
  })();

  const applicablePrograms = ((dealerSettings.dealer_programs || []) as DealerProgram[]).filter(
    (p) => p.enabled && (p.title.trim() || p.offer.trim()) && programMatchesCondition(p.appliesTo, vehicle.condition || ""),
  );

  return (
    <div className="space-y-4">
      <Card title="Shopper packet" action={
        <button onClick={save} disabled={saving} className={btnPrimary}>
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save packet"}
        </button>
      }>
        <p className="text-al-body text-muted-foreground">
          What appears on the public vehicle passport, scanned at <span className="font-mono text-foreground">/v/{(vehicle.vin || vehicle.slug || "").toUpperCase()}</span>.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
          <div className="min-w-0">
            <p className="text-al-card text-foreground">Passport version</p>
            <p className="text-al-meta text-muted-foreground">Which shopper experience this vehicle serves. Leave on the store default unless this specific vehicle should be pinned.</p>
          </div>
          <select
            value={passportVersion}
            onChange={(e) => setPassportVersion(e.target.value as "inherit" | "current" | "v3" | "experiment")}
            aria-label="Passport version"
            className="h-9 px-3 rounded-lg border border-border bg-background text-al-body text-foreground shrink-0"
          >
            <option value="inherit">Inherit store default</option>
            <option value="current">Current passport</option>
            <option value="v3">Passport V3</option>
            <option value="experiment">Controlled experiment</option>
          </select>
        </div>

        <div>
          <p className="text-al-card text-foreground">Packet modules</p>
          <p className="text-al-meta text-muted-foreground">Toggle the sections shoppers see. Recall, price and verified installs always show.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            {PACKET_MODULES.map((m) => {
              const override = packetModules[m.id];
              const inherited = override === undefined;
              const on = packetVisible({ packet_modules: packetModules, packet_defaults: storeDefaults }, m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => cycleModule(m.id)}
                  aria-pressed={on}
                  title="Click to cycle: inherit store default, always show, always hide"
                  className={`text-left rounded-xl border border-border bg-card p-4 flex flex-col gap-2 transition-colors hover:bg-muted ${on ? "" : "opacity-70"}`}
                >
                  <span className="text-al-card text-foreground">{m.label}</span>
                  <span className="text-al-meta text-muted-foreground leading-relaxed flex-1">{m.desc}</span>
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-al-meta font-semibold ${
                      on ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground border border-border"
                    }`}>
                      {on ? "Enabled" : "Disabled"}
                    </span>
                    <span className="inline-flex items-center h-6 px-2.5 rounded-full text-al-meta font-semibold bg-muted text-muted-foreground border border-border">
                      {inherited ? "Store default" : "This vehicle"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {applicablePrograms.length > 0 && (
          <div>
            <p className="text-al-card text-foreground">Dealer programs on this vehicle</p>
            <p className="text-al-meta text-muted-foreground">
              Store-wide programs that match this vehicle. Turn one off here if this exact unit does not qualify (mileage cap, branded title) — it disappears from this vehicle's sticker, packet and warranty panel only.
            </p>
            <div className="space-y-2 mt-3">
              {applicablePrograms.map((p) => {
                const off = suppressedPrograms.includes(p.id);
                const term = programTermLabel(p);
                return (
                  <div key={p.id} className={`flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 ${off ? "opacity-70 bg-muted/30" : "bg-card"}`}>
                    <div className="min-w-0">
                      <p className="text-al-body font-semibold text-foreground truncate">{p.title || p.offer}{term ? ` — ${term}` : ""}</p>
                      <p className="text-al-meta text-muted-foreground">
                        {programMode(p) === "included" ? "Included with the sale" : "Available upgrade"}{p.isWarranty ? " · Dealer warranty" : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => setSuppressedPrograms((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                      className={`shrink-0 h-8 px-3 rounded-lg border text-al-meta font-bold ${
                        off ? "border-border text-muted-foreground hover:bg-muted" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {off ? "Off for this vehicle" : "Showing"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card title="Service history" action={
        <button onClick={() => setRecords((r) => [...r, { date: "", mileage: "", type: "", notes: "" }])} className="h-9 px-3.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-al-meta font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add record
        </button>
      }>
        <p className="text-al-body text-muted-foreground inline-flex items-center gap-2">
          <Wrench className="w-4 h-4 shrink-0" /> Service visits, maintenance and repair history shown on the packet.
        </p>
        {records.length === 0 ? (
          <EmptyNote
            title="No service records on file"
            detail="Log oil changes, inspections and repairs so the packet can show them. Nothing is shown to a shopper until a record exists."
          />
        ) : (
          <div className="space-y-2">
            {records.map((r, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.4fr_2fr_auto] gap-2 items-end">
                <div><label className={LABEL}>Date</label><input type="date" value={r.date} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className={INPUT} /></div>
                <div><label className={LABEL}>Mileage</label><input value={r.mileage} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, mileage: e.target.value } : x))} placeholder="42,000" className={INPUT} /></div>
                <div><label className={LABEL}>Type</label><input value={r.type} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} placeholder="Oil & filter" className={INPUT} /></div>
                <div><label className={LABEL}>Notes</label><input value={r.notes} onChange={(e) => setRecords((p) => p.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} placeholder="Multi-point inspection passed" className={INPUT} /></div>
                <button onClick={() => setRecords((p) => p.filter((_, j) => j !== i))} aria-label="Remove service record" className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Remaining factory warranty">
        <p className="text-al-body text-muted-foreground inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" /> In-service date and coverage terms — shoppers see an estimated balance.
        </p>
        {remainingCoverage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-al-body font-semibold text-emerald-800">{remainingCoverage}</p>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><label className={LABEL}>In-service date</label><input type="date" value={warranty.in_service_date || ""} onChange={(e) => setWarranty((w) => ({ ...w, in_service_date: e.target.value }))} className={INPUT} /></div>
          <div><label className={LABEL}>Factory (months)</label><input type="number" value={warranty.factory_months ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, factory_months: e.target.value ? Number(e.target.value) : undefined }))} placeholder="36" className={INPUT} /></div>
          <div><label className={LABEL}>Factory (miles)</label><input type="number" value={warranty.factory_miles ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, factory_miles: e.target.value ? Number(e.target.value) : undefined }))} placeholder="36000" className={INPUT} /></div>
          <div><label className={LABEL}>Powertrain (months)</label><input type="number" value={warranty.powertrain_months ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, powertrain_months: e.target.value ? Number(e.target.value) : undefined }))} placeholder="60" className={INPUT} /></div>
          <div><label className={LABEL}>Powertrain (miles)</label><input type="number" value={warranty.powertrain_miles ?? ""} onChange={(e) => setWarranty((w) => ({ ...w, powertrain_miles: e.target.value ? Number(e.target.value) : undefined }))} placeholder="60000" className={INPUT} /></div>
        </div>
        <div><label className={LABEL}>Notes</label><input value={warranty.notes || ""} onChange={(e) => setWarranty((w) => ({ ...w, notes: e.target.value }))} placeholder="Balance of factory coverage transfers to the new owner." className={INPUT} /></div>
        <p className="text-al-meta text-muted-foreground inline-flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> Remaining time and miles are estimated from the in-service date and shown to shoppers as an estimate — confirm terms with the manufacturer.
        </p>
      </Card>

      <Card title="Available accessories" action={
        <button onClick={() => setAccessories((a) => [...a, { name: "", price: "", note: "" }])} className="h-9 px-3.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-al-meta font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add accessory
        </button>
      }>
        <p className="text-al-body text-muted-foreground inline-flex items-center gap-2">
          <Package className="w-4 h-4 shrink-0" /> Dealer-installed accessories and upgrades the shopper can add.
        </p>
        {accessories.length === 0 ? (
          <EmptyNote
            title="No accessories offered on this vehicle"
            detail="Examples: wheel packages, cargo systems, protection packages. The packet's accessories module stays hidden until one is listed."
          />
        ) : (
          <div className="space-y-2">
            {accessories.map((a, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr_auto] gap-2 items-end">
                <div><label className={LABEL}>Accessory</label><input value={a.name} onChange={(e) => setAccessories((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="All-weather floor liners" className={INPUT} /></div>
                <div><label className={LABEL}>Price</label><input value={a.price} onChange={(e) => setAccessories((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="$249" className={INPUT} /></div>
                <div><label className={LABEL}>Note</label><input value={a.note} onChange={(e) => setAccessories((p) => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} placeholder="Custom-fit, installed same day" className={INPUT} /></div>
                <button onClick={() => setAccessories((p) => p.filter((_, j) => j !== i))} aria-label="Remove accessory" className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default PassportPacketSection;
