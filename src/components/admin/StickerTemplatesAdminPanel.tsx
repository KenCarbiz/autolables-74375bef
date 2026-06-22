import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildConfig, templateFromConfig, TemplateRenderer,
  type StickerData, type StickerBranding, type StickerType, type StudioTemplate,
} from "@/lib/stickerStudio/templates";
import { saturdayTemplateFromConfig } from "@/lib/stickerStudio/saturdayTemplates";
import { toast } from "sonner";
import { LayoutTemplate, Star, Check, History, Search, X } from "lucide-react";

interface Row {
  id: string; template_key: string; name: string; type: string; size: string;
  style_tags: string[]; config: Record<string, unknown>;
  is_active: boolean; is_featured: boolean; current_version: number;
}

type PreviewSelection = { row: Row; template: StudioTemplate; isSaturday: boolean };

const SAMPLE: StickerData = {
  vehicleTitle: "2027 INFINITI QX60 LUXE", vin: "5N1AL1F87VC331335", stock: "I21567",
  mileage: "17", msrp: "62335", price: "58835",
  installed: [{ name: "Ceramic Protection", price: "1495" }, { name: "VIN Etch", price: "349" }],
  upgrades: [{ name: "Extended Warranty" }], benefits: [{ name: "Lifetime Car Washes" }],
  qrUrl: "https://autolabels.io/v/demo",
};
const BRAND: StickerBranding = {
  dealerName: "Harte Infiniti", address: "Hartford, CT", phone: "(860) 555-0100", website: "harteinfiniti.com",
  logoUrl: "", showLogo: true, valueProp: "Lifetime powertrain", disclaimer: "See dealer for details.", accentColor: "#2563EB",
};

const buildTemplateForRow = (r: Row) => {
  const cfg = buildConfig(r.type as StickerType, { ...(r.config || {}), id: r.template_key, name: r.name });
  return saturdayTemplateFromConfig(cfg) || templateFromConfig(cfg);
};

// Super-admin catalog management for the Sticker Studio template archive:
// activate/deactivate, feature, snapshot a new immutable version, and inspect
// full-size previews before exposing templates to dealers.
export default function StickerTemplatesAdminPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewSelection | null>(null);

  const load = async () => {
    setLoading(true);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any)
      .from("sticker_templates")
      .select("id, template_key, name, type, size, style_tags, config, is_active, is_featured, current_version")
      .order("type").order("name");
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setErr(null);
    setRows((data || []) as Row[]);
  };
  useEffect(() => { load(); }, []);

  const patch = async (id: string, p: Partial<Row>) => {
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("sticker_templates").update(p).eq("id", id);
    if (error) { toast.error("Update failed — admin access required"); return; }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    setPreview((current) => current?.row.id === id ? { ...current, row: { ...current.row, ...p } } : current);
  };

  const snapshot = async (r: Row) => {
    const next = r.current_version + 1;
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("sticker_template_versions")
      .insert({ template_id: r.id, version: next, config: r.config, changelog: "Snapshot" });
    if (error) { toast.error(error.message); return; }
    await patch(r.id, { current_version: next });
    toast.success(`Frozen as version ${next}`);
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading templates…</p>;
  if (err || rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <LayoutTemplate className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm font-semibold text-foreground">Template catalog not populated yet</p>
        <p className="text-xs text-muted-foreground mt-1">Apply migration <span className="font-mono">20260620050000_sticker_template_archive.sql</span> to load the archive. The Sticker Studio runs on the built-in fallback until then.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-foreground">Sticker template library</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Click any sticker or addendum to inspect it larger, then activate, feature, or version the templates dealers can choose in Sticker Studio.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r) => {
          const template = buildTemplateForRow(r);
          const isSaturday = r.template_key.includes("saturday");
          return (
            <div key={r.id} className={`rounded-2xl border bg-card p-3 ${r.is_active ? "border-border" : "border-border opacity-60"}`}>
              <button
                type="button"
                onClick={() => setPreview({ row: r, template, isSaturday })}
                className="group relative w-full rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ height: isSaturday ? 260 : 180 }}
                title={`Open larger preview of ${r.name}`}
              >
                <TemplateRenderer template={template} data={SAMPLE} branding={BRAND} scale={isSaturday ? (r.type === "addendum" ? 0.32 : 0.24) : (r.type === "addendum" ? 0.36 : 0.2)} />
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2.5 py-1 text-[10px] font-black text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                  <Search className="h-3 w-3" /> View larger
                </span>
              </button>
              <div className="mt-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">{r.size} · {r.type} · v{r.current_version}</p>
                </div>
                <button onClick={() => patch(r.id, { is_featured: !r.is_featured })} title="Feature" className={`p-1 rounded ${r.is_featured ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`}>
                  <Star className="w-4 h-4" fill={r.is_featured ? "currentColor" : "none"} />
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(r.style_tags || []).map((g) => <span key={g} className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{g}</span>)}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={() => patch(r.id, { is_active: !r.is_active })} className={`flex-1 h-8 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 ${r.is_active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground border border-border"}`}>
                  {r.is_active ? <><Check className="w-3.5 h-3.5" /> Active</> : "Inactive"}
                </button>
                <button onClick={() => snapshot(r)} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted inline-flex items-center gap-1"><History className="w-3.5 h-3.5" /> New version</button>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Template Preview</div>
                <h3 className="text-lg font-black text-foreground">{preview.row.name}</h3>
                <p className="text-xs text-muted-foreground">{preview.row.size} · {preview.row.type} · {preview.row.template_key} · v{preview.row.current_version}</p>
              </div>
              <button onClick={() => setPreview(null)} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close preview">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-6">
              <div className="mx-auto flex min-h-[70vh] items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-inner">
                <TemplateRenderer
                  template={preview.template}
                  data={SAMPLE}
                  branding={BRAND}
                  scale={preview.row.type === "addendum" ? 0.72 : 0.58}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <div className="flex flex-wrap gap-1">
                {(preview.row.style_tags || []).map((g) => <span key={g} className="rounded bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{g}</span>)}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => patch(preview.row.id, { is_featured: !preview.row.is_featured })} className={`h-9 rounded-lg border px-3 text-xs font-bold ${preview.row.is_featured ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border text-foreground hover:bg-muted"}`}>
                  {preview.row.is_featured ? "Featured" : "Feature"}
                </button>
                <button onClick={() => patch(preview.row.id, { is_active: !preview.row.is_active })} className={`h-9 rounded-lg border px-3 text-xs font-bold ${preview.row.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border text-foreground hover:bg-muted"}`}>
                  {preview.row.is_active ? "Active" : "Inactive"}
                </button>
                <button onClick={() => snapshot(preview.row)} className="h-9 rounded-lg border border-border px-3 text-xs font-bold text-foreground hover:bg-muted">New version</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
