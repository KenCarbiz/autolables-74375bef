import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildConfig,
  templateFromConfig,
  TemplateRenderer,
  type StickerBranding,
  type StickerData,
  type StickerType,
  type StudioTemplate,
} from "@/lib/stickerStudio/templates";
import { saturdayTemplateFromConfig } from "@/lib/stickerStudio/saturdayTemplates";
import {
  USED_ADDENDUM_CATALOG_50,
  type UsedAddendumTemplateDefinition,
} from "@/components/saturday/UsedAddendumCatalog";
import {
  NEW_ADDENDUM_CATALOG_50,
  NEW_MONRONEY_CATALOG_50,
  type NewVehicleTemplateDefinition,
} from "@/components/saturday/NewVehicleCatalog";
import type { SaturdaySticker } from "@/components/saturday/types";
import { Check, History, LayoutTemplate, Search, Star, X } from "lucide-react";
import { toast } from "sonner";

interface Row {
  id: string;
  template_key: string;
  name: string;
  type: string;
  size: string;
  style_tags: string[];
  config: Record<string, unknown>;
  is_active: boolean;
  is_featured: boolean;
  current_version: number;
}

type SectionId =
  | "all"
  | "featured"
  | "saturday"
  | "used-addendums"
  | "new-stickers"
  | "new-addendums"
  | "oem-match"
  | "luxury"
  | "cpo"
  | "one-price"
  | "passport-first"
  | "archived";

type LibraryItem =
  | {
      source: "database";
      id: string;
      name: string;
      format: string;
      section: SectionId;
      tags: string[];
      description: string;
      row: Row;
      template: StudioTemplate;
      isSaturday: boolean;
    }
  | {
      source: "used-catalog";
      id: string;
      name: string;
      format: "addendum";
      section: SectionId;
      tags: string[];
      description: string;
      template: UsedAddendumTemplateDefinition;
    }
  | {
      source: "new-catalog";
      id: string;
      name: string;
      format: "window" | "addendum";
      section: SectionId;
      tags: string[];
      description: string;
      template: NewVehicleTemplateDefinition;
    };

const SECTIONS: { id: SectionId; label: string; helper: string }[] = [
  { id: "all", label: "All", helper: "Every active library item" },
  { id: "featured", label: "Featured", helper: "Promoted dealer choices" },
  { id: "saturday", label: "Saturday Premium", helper: "Hero windows and matching addendums" },
  { id: "used-addendums", label: "Used Addendums", helper: "Used vehicle addendum library" },
  { id: "new-stickers", label: "New Vehicle Stickers", helper: "Monroney companion labels" },
  { id: "new-addendums", label: "New Vehicle Addendums", helper: "Dealer installed and market addendums" },
  { id: "oem-match", label: "OEM Match", helper: "Brand-aligned franchise collections" },
  { id: "luxury", label: "Luxury", helper: "High-line presentation" },
  { id: "cpo", label: "CPO", helper: "Certification-first templates" },
  { id: "one-price", label: "One Price", helper: "No-haggle pricing layouts" },
  { id: "passport-first", label: "Passport First", helper: "QR and live-price focused" },
  { id: "archived", label: "Archived", helper: "Inactive database rows" },
];

const SAMPLE: StickerData = {
  vehicleTitle: "2027 INFINITI QX60 LUXE",
  vin: "5N1AL1F87VC331335",
  stock: "I21567",
  mileage: "17",
  msrp: "62335",
  price: "58835",
  installed: [{ name: "Ceramic Protection", price: "1495" }, { name: "VIN Etch", price: "349" }],
  upgrades: [{ name: "Extended Warranty" }],
  benefits: [{ name: "Lifetime Car Washes" }],
  qrUrl: "https://autolabels.io/v/demo",
};

const BRAND: StickerBranding = {
  dealerName: "Harte Infiniti",
  address: "Hartford, CT",
  phone: "(860) 555-0100",
  website: "harteinfiniti.com",
  logoUrl: "",
  showLogo: true,
  valueProp: "Lifetime powertrain",
  disclaimer: "See dealer for details.",
  accentColor: "#2563EB",
};

const SATURDAY_SAMPLE: SaturdaySticker & { installed: { name: string; price: string }[]; upgrades: { name: string; price: string }[] } = {
  dealer: {
    name: "Harte Infiniti",
    address: "150 Weston Road, Hartford, CT",
    phone: "(860) 555-0100",
    website: "harteinfiniti.com",
    slogan: "Transparency from the window to the Passport.",
    pricingLabel: "Best Price",
    valueProps: ["Lifetime car washes", "Dealer reconditioning", "Digital Passport included"],
    theme: { primaryColor: "#071f3f", secondaryColor: "#2563EB", accentColor: "#22c55e", softColor: "#eff6ff", borderColor: "#dbe4f0" },
  },
  vehicle: {
    title: "2027 INFINITI QX60 LUXE",
    vin: "5N1AL1F87VC331335",
    stock: "I21567",
    price: "$58,835",
    msrp: "$62,335",
    mileage: "17",
    condition: "used",
    priceLabel: "Best Price",
  },
  specs: [
    { label: "Engine", value: "3.5L V6" },
    { label: "Drivetrain", value: "AWD" },
    { label: "Exterior", value: "Graphite Shadow" },
    { label: "Interior", value: "Graphite Leather" },
  ],
  highlights: ["Navigation", "Panoramic Moonroof", "Heated Leather", "360 Camera", "ProPILOT Assist"],
  fuel: { city: 20, highway: 25, combined: 22 },
  benefits: ["Dealer inspected", "Vehicle Passport", "Warranty disclosure available"],
  qrUrl: "https://autolabels.io/v/demo",
  disclaimer: "Information deemed reliable but not guaranteed. See dealer for complete details.",
  installed: [{ name: "Ceramic Protection", price: "$1,495" }, { name: "VIN Etch", price: "$349" }],
  upgrades: [{ name: "Extended Warranty", price: "Optional" }],
};

const buildTemplateForRow = (r: Row) => {
  const cfg = buildConfig(r.type as StickerType, { ...(r.config || {}), id: r.template_key, name: r.name });
  return saturdayTemplateFromConfig(cfg) || templateFromConfig(cfg);
};

const hasAny = (tags: string[], needles: string[]) => needles.some((n) => tags.some((t) => t.toLowerCase().includes(n)));

const sectionForUsed = (template: UsedAddendumTemplateDefinition): SectionId => {
  const tags = template.tags.map((t) => t.toLowerCase());
  if (template.category === "oem" || template.suggestedOEMs?.length) return "oem-match";
  if (template.category === "luxury" || hasAny(tags, ["luxury", "premium"])) return "luxury";
  if (template.category === "certification" || template.supportsCPO) return "cpo";
  if (hasAny(tags, ["one-price", "no-haggle", "best-price"])) return "one-price";
  if (template.defaultPricingMode === "passport_live_price_only" || hasAny(tags, ["passport", "live-price", "qr"])) return "passport-first";
  return "used-addendums";
};

const sectionForNew = (template: NewVehicleTemplateDefinition): SectionId => {
  const tags = template.tags.map((t) => t.toLowerCase());
  if (template.category === "oem" || template.suggestedOEMs.length) return "oem-match";
  if (template.category === "luxury" || hasAny(tags, ["luxury", "premium"])) return "luxury";
  if (hasAny(tags, ["one-price", "no-haggle"])) return "one-price";
  if (template.defaultPricingMode === "passport_live_price_only" || hasAny(tags, ["passport", "live-price", "qr"])) return "passport-first";
  return template.kind === "new_monroney" ? "new-stickers" : "new-addendums";
};

const sectionForDb = (row: Row): SectionId => {
  const key = row.template_key.toLowerCase();
  const tags = (row.style_tags || []).map((t) => t.toLowerCase());
  if (!row.is_active) return "archived";
  if (row.is_featured) return "featured";
  if (key.includes("saturday")) return "saturday";
  if (row.type === "addendum") return "used-addendums";
  if (hasAny(tags, ["passport"])) return "passport-first";
  return "new-stickers";
};

export default function StickerTemplatesAdminPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase as any)
      .from("sticker_templates")
      .select("id, template_key, name, type, size, style_tags, config, is_active, is_featured, current_version")
      .order("type")
      .order("name");
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

  const items = useMemo<LibraryItem[]>(() => {
    const dbItems: LibraryItem[] = rows.map((row) => ({
      source: "database",
      id: row.template_key,
      name: row.name,
      format: row.type,
      section: sectionForDb(row),
      tags: row.style_tags || [],
      description: "Database-backed template available to Sticker Studio.",
      row,
      template: buildTemplateForRow(row),
      isSaturday: row.template_key.toLowerCase().includes("saturday"),
    }));

    const usedItems: LibraryItem[] = USED_ADDENDUM_CATALOG_50.map((template) => ({
      source: "used-catalog",
      id: template.id,
      name: template.name,
      format: "addendum",
      section: sectionForUsed(template),
      tags: [template.category, template.family, ...template.tags, ...(template.suggestedOEMs || [])],
      description: template.description,
      template,
    }));

    const newItems: LibraryItem[] = [...NEW_MONRONEY_CATALOG_50, ...NEW_ADDENDUM_CATALOG_50].map((template) => ({
      source: "new-catalog",
      id: template.id,
      name: template.name,
      format: template.kind === "new_monroney" ? "window" : "addendum",
      section: sectionForNew(template),
      tags: [template.category, template.family, ...template.tags, ...template.suggestedOEMs],
      description: template.description,
      template,
    }));

    return [...dbItems, ...usedItems, ...newItems];
  }, [rows]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const sectionMatch = activeSection === "all" || item.section === activeSection || (activeSection === "featured" && item.source === "database" && item.row.is_featured);
      if (!sectionMatch) return false;
      if (!needle) return true;
      return [item.name, item.id, item.description, item.format, ...item.tags].join(" ").toLowerCase().includes(needle);
    });
  }, [items, activeSection, query]);

  const countFor = (section: SectionId) => items.filter((item) => section === "all" || item.section === section || (section === "featured" && item.source === "database" && item.row.is_featured)).length;

  const renderMiniPreview = (item: LibraryItem) => {
    if (item.source === "database") {
      return <TemplateRenderer template={item.template} data={SAMPLE} branding={BRAND} scale={item.isSaturday ? (item.row.type === "addendum" ? 0.3 : 0.22) : (item.row.type === "addendum" ? 0.34 : 0.18)} />;
    }
    if (item.source === "used-catalog") {
      const UsedComponent = item.template.component;
      return <div className="scale-[0.34]"><UsedComponent data={SATURDAY_SAMPLE} /></div>;
    }
    return (
      <div className="flex h-full w-full flex-col justify-between bg-white p-4 text-left">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">{item.template.defaultBadge}</p>
          <h4 className="mt-2 text-lg font-black leading-tight text-slate-950">{item.name}</h4>
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-500">{item.description}</p>
        </div>
        <div className="mt-4 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">{item.format === "window" ? "New Vehicle Sticker" : "New Vehicle Addendum"}</div>
      </div>
    );
  };

  const renderLargePreview = (item: LibraryItem) => {
    if (item.source === "database") return <TemplateRenderer template={item.template} data={SAMPLE} branding={BRAND} scale={item.row.type === "addendum" ? 0.72 : 0.58} />;
    if (item.source === "used-catalog") {
      const UsedComponent = item.template.component;
      return <UsedComponent data={SATURDAY_SAMPLE} />;
    }
    return (
      <div className="mx-auto max-w-2xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">{item.template.defaultBadge}</p>
        <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-950">{item.name}</h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.description}</p>
        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs font-bold uppercase text-slate-400">Renderer</span><p className="font-black text-slate-900">{item.template.rendererKey}</p></div>
          <div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs font-bold uppercase text-slate-400">Family</span><p className="font-black text-slate-900">{item.template.family}</p></div>
          <div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs font-bold uppercase text-slate-400">Placement</span><p className="font-black text-slate-900">{item.template.recommendedPlacement}</p></div>
          <div className="rounded-2xl bg-slate-50 p-4"><span className="text-xs font-bold uppercase text-slate-400">Passport</span><p className="font-black text-slate-900">{item.template.supportsPassport ? "Supported" : "Disabled"}</p></div>
        </div>
        {item.template.suggestedOEMs.length ? <p className="mt-5 text-xs font-semibold text-slate-500">OEM fit: {item.template.suggestedOEMs.join(", ")}</p> : null}
      </div>
    );
  };

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading templates…</p>;
  if (err && rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <LayoutTemplate className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-foreground">Database template catalog unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">Recovered code catalogs are still available below once the admin panel loads.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">Template Library</div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground">Sticker & Addendum Library</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Browse the restored 100+ catalog by purpose, OEM fit, pricing strategy, and customer Passport flow. Click any card for a larger preview.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            <div className="rounded-2xl bg-muted p-3"><p className="text-xl font-black text-foreground">{items.length}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">Total</p></div>
            <div className="rounded-2xl bg-muted p-3"><p className="text-xl font-black text-foreground">{USED_ADDENDUM_CATALOG_50.length}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">Used</p></div>
            <div className="rounded-2xl bg-muted p-3"><p className="text-xl font-black text-foreground">{NEW_MONRONEY_CATALOG_50.length}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">New Stickers</p></div>
            <div className="rounded-2xl bg-muted p-3"><p className="text-xl font-black text-foreground">{NEW_ADDENDUM_CATALOG_50.length}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">New Add.</p></div>
            <div className="rounded-2xl bg-muted p-3"><p className="text-xl font-black text-foreground">{rows.length}</p><p className="text-[10px] font-bold uppercase text-muted-foreground">DB</p></div>
          </div>
        </div>
        <div className="relative mt-5">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by OEM, template, pricing style, CPO, Passport, luxury…" className="h-11 w-full rounded-2xl border border-border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      </div>

      <div className="flex gap-5">
        <aside className="hidden w-64 shrink-0 space-y-2 lg:block">
          {SECTIONS.map((section) => (
            <button key={section.id} onClick={() => setActiveSection(section.id)} className={`w-full rounded-2xl border p-3 text-left transition ${activeSection === section.id ? "border-blue-300 bg-blue-50 text-blue-950" : "border-border bg-card hover:bg-muted"}`}>
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-black">{section.label}</span><span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-black">{countFor(section.id)}</span></div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{section.helper}</p>
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {SECTIONS.map((section) => <button key={section.id} onClick={() => setActiveSection(section.id)} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-bold ${activeSection === section.id ? "border-blue-300 bg-blue-50 text-blue-950" : "border-border bg-card"}`}>{section.label} ({countFor(section.id)})</button>)}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <div key={`${item.source}-${item.id}`} className="rounded-2xl border border-border bg-card p-3">
                <button type="button" onClick={() => setPreview(item)} className="group relative flex h-56 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  {renderMiniPreview(item)}
                  <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2.5 py-1 text-[10px] font-black text-white opacity-0 shadow-lg transition group-hover:opacity-100"><Search className="h-3 w-3" /> View larger</span>
                </button>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-foreground">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{item.format} · {item.source.replace("-", " ")}</p>
                  </div>
                  {item.source === "database" ? <button onClick={() => patch(item.row.id, { is_featured: !item.row.is_featured })} className={`rounded p-1 ${item.row.is_featured ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`}><Star className="h-4 w-4" fill={item.row.is_featured ? "currentColor" : "none"} /></button> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">{item.tags.slice(0, 5).map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{tag}</span>)}</div>
                {item.source === "database" ? <div className="mt-3 flex gap-2"><button onClick={() => patch(item.row.id, { is_active: !item.row.is_active })} className={`h-8 flex-1 rounded-lg border text-xs font-bold ${item.row.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted text-muted-foreground"}`}>{item.row.is_active ? "Active" : "Inactive"}</button><button onClick={() => snapshot(item.row)} className="h-8 rounded-lg border border-border px-3 text-xs font-bold"><History className="inline h-3.5 w-3.5" /> Version</button></div> : null}
              </div>
            ))}
          </div>
          {!filteredItems.length ? <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No templates match this section/search.</div> : null}
        </main>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Template Preview</div>
                <h3 className="text-lg font-black text-foreground">{preview.name}</h3>
                <p className="text-xs text-muted-foreground">{preview.format} · {preview.source} · {preview.id}</p>
              </div>
              <button onClick={() => setPreview(null)} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close preview"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-6"><div className="mx-auto flex min-h-[70vh] items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-inner">{renderLargePreview(preview)}</div></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <div className="flex flex-wrap gap-1">{preview.tags.slice(0, 12).map((tag) => <span key={tag} className="rounded bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{tag}</span>)}</div>
              {preview.source === "database" ? <div className="flex gap-2"><button onClick={() => patch(preview.row.id, { is_featured: !preview.row.is_featured })} className="h-9 rounded-lg border border-border px-3 text-xs font-bold">{preview.row.is_featured ? "Featured" : "Feature"}</button><button onClick={() => patch(preview.row.id, { is_active: !preview.row.is_active })} className="h-9 rounded-lg border border-border px-3 text-xs font-bold">{preview.row.is_active ? "Active" : "Inactive"}</button><button onClick={() => snapshot(preview.row)} className="h-9 rounded-lg border border-border px-3 text-xs font-bold">New version</button></div> : <p className="text-xs font-semibold text-muted-foreground">Recovered catalog item · seed/activation wiring comes next.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
