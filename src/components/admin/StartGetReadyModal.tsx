import { useState } from "react";
import { X, Globe, Check, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useVehicleUrlScrape } from "@/hooks/useVehicleUrlScrape";
import { useProducts } from "@/hooks/useProducts";
import { useAuth } from "@/contexts/AuthContext";
import type { GetReadyRecord } from "@/hooks/useGetReady";

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
  inspectionRequired: boolean;
  createdBy: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateArgs) => Promise<GetReadyRecord | null>;
}

export const StartGetReadyModal = ({ open, onClose, onCreate }: Props) => {
  const { scrape, scraping } = useVehicleUrlScrape();
  const { data: products = [] } = useProducts();
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [vin, setVin] = useState("");
  const [ymm, setYmm] = useState("");
  const [stock, setStock] = useState("");
  const [condition, setCondition] = useState<"new" | "used">("used");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const reset = () => {
    setUrl(""); setVin(""); setYmm(""); setStock(""); setCondition("used"); setSelected({});
  };

  const doScrape = async () => {
    if (!url.trim()) return;
    const r = await scrape(url.trim());
    if (r) {
      setVin(r.vin || vin);
      setYmm(r.ymm || ymm);
      setStock(r.stock || stock);
      if (r.condition) setCondition(r.condition.toLowerCase().includes("new") ? "new" : "used");
      toast.success("Pulled vehicle details from the website link");
    }
  };

  const submit = async () => {
    if (!vin.trim() && !ymm.trim()) { toast.error("Enter a VIN or year/make/model first"); return; }
    setSaving(true);
    const accessoriesToInstall = products
      .filter((p) => selected[p.id])
      .map((p) => ({ productId: p.id, productName: p.name }));
    const rec = await onCreate({
      vin: vin.trim().toUpperCase(),
      stockNumber: stock.trim(),
      ymm: ymm.trim(),
      condition,
      acquiredDate: new Date().toISOString(),
      accessoriesToInstall,
      inspectionRequired: condition === "used",
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
            <select value={condition} onChange={(e) => setCondition(e.target.value as "new" | "used")} className={`${input} cursor-pointer`}>
              <option value="used">Used</option>
              <option value="new">New</option>
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
