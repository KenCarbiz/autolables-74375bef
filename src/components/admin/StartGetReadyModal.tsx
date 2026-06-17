import { useState } from "react";
import { X, Globe, Check, Wrench, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useVehicleUrlScrape } from "@/hooks/useVehicleUrlScrape";
import { useProducts } from "@/hooks/useProducts";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import type { GetReadyRecord } from "@/hooks/useGetReady";

// Dealer condition labels (e.g. "OEM CPO") map to the canonical new/used the
// get_ready_records table accepts. Anything that isn't "new" is treated as used.
const canonicalCondition = (label: string): "new" | "used" =>
  /new/i.test(label) && !/used|pre/i.test(label) ? "new" : "used";

// Start Get-Ready — the single entry point for the recon pipeline. Pick a
// vehicle by web link (scrape), manual entry, or a VIN you scanned, then
// check the products being pre-installed. Each becomes a "pending" install
// item that flips to installed when the installer completes the scan + photo.
interface CreateArgs {
  vin: string;
  stockNumber: string;
  ymm: string;
  condition: "new" | "used";
  acquiredDate: string;
  accessoriesToInstall: { productId: string; productName: string }[];
  serviceItems?: { label: string; cost?: number }[];
  inspectionRequired: boolean;
  createdBy: string;
}

interface InventoryHit { id: string; vin: string; ymm: string | null; condition: string | null }

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateArgs) => Promise<GetReadyRecord | null>;
}

export const StartGetReadyModal = ({ open, onClose, onCreate }: Props) => {
  const { scrape, scraping } = useVehicleUrlScrape();
  const { data: products = [] } = useProducts();
  const { user } = useAuth();
  const { settings } = useDealerSettings();
  const conditions = (settings.vehicle_conditions || "New, Demo, Used, CPO")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const defaultCondition = conditions.find((c) => /used/i.test(c)) || conditions[0] || "Used";
  const pickByCanonical = (canon: "new" | "used") =>
    conditions.find((c) => canonicalCondition(c) === canon) || defaultCondition;

  const [url, setUrl] = useState("");
  const [vin, setVin] = useState("");
  const [ymm, setYmm] = useState("");
  const [stock, setStock] = useState("");
  const [condition, setCondition] = useState<string>(defaultCondition);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [services, setServices] = useState<{ label: string; cost: string }[]>([]);
  const [invQuery, setInvQuery] = useState("");
  const [invHits, setInvHits] = useState<InventoryHit[]>([]);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const reset = () => {
    setUrl(""); setVin(""); setYmm(""); setStock(""); setCondition(defaultCondition);
    setSelected({}); setServices([]); setInvQuery(""); setInvHits([]);
  };

  // Search current inventory (RLS-scoped) by VIN / stock / vehicle.
  const searchInventory = async (q: string) => {
    setInvQuery(q);
    if (q.trim().length < 2) { setInvHits([]); return; }
    const { data } = await (supabase as any)
      .from("vehicle_listings")
      .select("id, vin, ymm, condition")
      .or(`vin.ilike.%${q}%,ymm.ilike.%${q}%`)
      .limit(8);
    setInvHits((data || []) as InventoryHit[]);
  };

  const pickInventory = (h: InventoryHit) => {
    setVin((h.vin || "").toUpperCase());
    setYmm(h.ymm || "");
    if (h.condition) setCondition(pickByCanonical(h.condition.toLowerCase().includes("new") ? "new" : "used"));
    setInvQuery(h.ymm || h.vin || "");
    setInvHits([]);
  };

  const doScrape = async () => {
    const u = url.trim();
    if (!u) return;
    let filled = false;
    const r = await scrape(u);
    if (r) {
      if (r.vin) { setVin(r.vin.toUpperCase()); filled = true; }
      if (r.ymm) { setYmm(r.ymm); filled = true; }
      if (r.stock) { setStock(r.stock); filled = true; }
      if (r.condition) setCondition(pickByCanonical(r.condition.toLowerCase().includes("new") ? "new" : "used"));
    }
    // Fallback for JS-walled sites (Team Velocity/Apollo, etc.) where the page
    // can't be scraped: many dealer VDP URLs carry the VIN + condition in the
    // path itself. Pull what we can so the form still fills.
    if (!r?.vin) {
      const m = u.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/);
      if (m) { setVin(m[0]); filled = true; }
    }
    // YMM often lives in the VDP slug after the VIN, e.g.
    // /viewdetails/new/<vin>/2026-infiniti-qx80-sport-utility
    if (!r?.ymm) {
      const slug = u.split("?")[0].split("/").find((seg) => /^(19|20)\d{2}-[a-z]/i.test(seg));
      if (slug) {
        const ymmText = slug.split("-").map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
        setYmm(ymmText); filled = true;
      }
    }
    if (/\/new\//i.test(u)) setCondition(pickByCanonical("new"));
    else if (/\/(used|pre-owned|preowned|cpo|certified)\//i.test(u)) setCondition(pickByCanonical("used"));
    toast[filled ? "success" : "error"](
      filled ? "Pulled what we could from the link — confirm the details below." : "Couldn't read that page automatically. Enter the VIN / vehicle below.",
    );
  };

  const submit = async () => {
    if (!vin.trim() && !ymm.trim()) { toast.error("Enter a VIN or year/make/model first"); return; }
    setSaving(true);
    const accessoriesToInstall = products
      .filter((p) => selected[p.id])
      .map((p) => ({ productId: p.id, productName: p.name }));
    const serviceItems = services
      .filter((s) => s.label.trim())
      .map((s) => ({ label: s.label.trim(), cost: s.cost.trim() ? Number(s.cost.replace(/[^0-9.]/g, "")) : undefined }));
    const rec = await onCreate({
      vin: vin.trim().toUpperCase(),
      stockNumber: stock.trim(),
      ymm: ymm.trim(),
      condition: canonicalCondition(condition),
      acquiredDate: new Date().toISOString(),
      accessoriesToInstall,
      serviceItems,
      inspectionRequired: canonicalCondition(condition) === "used",
      createdBy: user?.id || "",
    });
    setSaving(false);
    if (rec) {
      toast.success("Get-Ready started — print the QR sheet for the installer.");
      reset();
      onClose();
    } else {
      toast.error("Could not start Get-Ready (this VIN may already be in the pipeline).");
    }
  };

  const input = "w-full h-10 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary";
  const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full my-10 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Wrench className="w-5 h-5 text-primary" /> Start Get-Ready</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        {/* Pull from current inventory */}
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <label className={label}>Pull from current inventory</label>
          <div className="relative mt-1">
            <input value={invQuery} onChange={(e) => searchInventory(e.target.value)} placeholder="Search by VIN, stock #, or vehicle…" className={input} />
            {invHits.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                {invHits.map((h) => (
                  <button key={h.id} type="button" onClick={() => pickInventory(h)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2">
                    <span className="truncate">{h.ymm || "Vehicle"}</span>
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0">{h.vin ? h.vin.slice(-8) : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Web link import */}
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <label className={label}>Pull from a website link</label>
          <div className="flex gap-2 mt-1">
            <div className="flex-1 relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doScrape()} placeholder="Paste a vehicle listing URL (your site, AutoTrader, Cars.com…)" className={`${input} pl-9`} />
            </div>
            <button onClick={doScrape} disabled={scraping || !url.trim()} className="h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
              {scraping ? "Pulling…" : "Pull"}
            </button>
          </div>
        </div>

        {/* Vehicle fields (scrape fills them, or enter manually) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="md:col-span-2"><label className={label}>Year / Make / Model</label><input value={ymm} onChange={(e) => setYmm(e.target.value)} placeholder="2026 Honda CR-V EX-L" className={input} /></div>
          <div><label className={label}>Stock #</label><input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="H12345" className={input} /></div>
          <div><label className={label}>Condition</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)} className={`${input} cursor-pointer`}>
              {conditions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-4"><label className={label}>VIN</label><input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="1HGCV1F3XRA000000" maxLength={17} className={`${input} font-mono tracking-wide`} /></div>
        </div>

        {/* Products to pre-install */}
        <div>
          <label className={label}>Products being pre-installed</label>
          <p className="text-[11px] text-muted-foreground mb-2">Each flips to installed automatically when the installer completes the scan + photo proof.</p>
          {products.length === 0 ? (
            <p className="text-xs text-muted-foreground">No products in your catalog yet. Add them under Products.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
              {products.map((p) => {
                const on = !!selected[p.id];
                return (
                  <button key={p.id} type="button" onClick={() => setSelected((s) => ({ ...s, [p.id]: !on }))}
                    className={`flex items-center gap-2 px-3 h-10 rounded-lg border text-left text-sm transition-colors ${on ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-foreground" : "border-border hover:bg-muted"}`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? "bg-blue-600 text-white" : "border border-border"}`}>{on && <Check className="w-3 h-3" />}</span>
                    <span className="truncate">{p.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Internal (non-customer-cost) service items */}
        <div>
          <div className="flex items-center justify-between">
            <label className={label}>Internal service / recon (dealer cost — not billed to customer)</label>
            <button type="button" onClick={() => setServices((s) => [...s, { label: "", cost: "" }])} className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted"><Plus className="w-3 h-3" /> Add</button>
          </div>
          {services.length > 0 && (
            <div className="space-y-2 mt-2">
              {services.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input value={s.label} onChange={(e) => setServices((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="e.g. Brake rotors, alignment, key cut" className={`${input} flex-1`} />
                  <input value={s.cost} onChange={(e) => setServices((p) => p.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} placeholder="$ cost" className={`${input} w-24`} />
                  <button type="button" onClick={() => setServices((p) => p.filter((_, j) => j !== i))} className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 disabled:opacity-50">
            {saving ? "Starting…" : "Start Get-Ready"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StartGetReadyModal;
