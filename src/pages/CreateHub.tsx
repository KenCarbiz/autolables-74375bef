import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, ChevronRight, Lightbulb, ArrowRight, CheckCircle2,
} from "lucide-react";
import {
  ToolIconBadge, toolIcon,
  type AutoLabelsToolIconKey, type ToolCategory,
} from "@/components/icons/AutoLabelsToolIcons";
import { supabase } from "@/integrations/supabase/client";

// /create — the AutoLabels creation hub. One data-driven launchpad for the
// document/sticker/AI builders: search (⌘K), Quick Start, category sections,
// and a right rail with real recent activity and the recommended workflow.
// Routing to each builder is unchanged; this page only organizes entry.

type ChipLabel = "Most Used" | "FTC Required" | "Compliance" | "Template" | "AI Tool" | "Sticker";

interface CreateTool {
  id: string;
  title: string;
  description: string;
  category: "Compliance & Documents" | "Labels & Stickers" | "AI & Merchandising";
  iconKey: AutoLabelsToolIconKey;
  iconCategory: ToolCategory;
  route: string;
  tags: string[];
  chip?: ChipLabel;
  isQuickStart?: boolean;
  // Future tenant-level visibility hook: resolve per-dealer config here
  // rather than hardcoding — nothing else in the page assumes every tool
  // renders.
  hidden?: boolean;
}

const TOOLS: CreateTool[] = [
  { id: "new-addendum", title: "New Addendum", description: "Add-on products + disclosures for a deal.", category: "Compliance & Documents", iconKey: "new-addendum", iconCategory: "document", route: "/addendum", tags: ["addendum", "products", "disclosures", "deal", "compliance"], chip: "Most Used", isQuickStart: true },
  // The FTC Buyers Guide + CT K-208 are generated per-vehicle in the Vehicle
  // File's Deal Flow (off the vehicle's real data), so there are no standalone
  // hub tiles for them anymore — open the vehicle and use Deal Flow.
  { id: "cpo-sheet", title: "CPO Info Sheet", description: "Certified Pre-Owned program sheet.", category: "Compliance & Documents", iconKey: "cpo-info-sheet", iconCategory: "document", route: "/cpo-sheet", tags: ["cpo", "certified", "program", "warranty"], chip: "Template" },
  { id: "used-car-sticker", title: "Used Car Sticker", description: "Window sticker for a used vehicle.", category: "Labels & Stickers", iconKey: "used-car-sticker", iconCategory: "sticker", route: "/used-car-sticker", tags: ["sticker", "label", "used", "window"], chip: "Most Used", isQuickStart: true },
  { id: "new-car-sticker", title: "New Car Sticker", description: "Monroney-style new-car window label.", category: "Labels & Stickers", iconKey: "new-car-sticker", iconCategory: "sticker", route: "/new-car-sticker", tags: ["sticker", "label", "new", "monroney", "window"], chip: "Sticker" },
  { id: "trade-up-sticker", title: "Trade-Up Sticker", description: "Promotional trade-up sticker.", category: "Labels & Stickers", iconKey: "trade-up-sticker", iconCategory: "sticker", route: "/trade-up", tags: ["sticker", "trade", "trade-up", "promo"], chip: "Template" },
  { id: "sticker-studio", title: "Sticker Studio", description: "Choose a style & create a sticker template.", category: "Labels & Stickers", iconKey: "sticker-studio", iconCategory: "sticker", route: "/sticker-studio", tags: ["sticker", "studio", "template", "style", "label"], chip: "Template" },
  { id: "description-writer", title: "Description Writer", description: "AI listing copy per marketplace.", category: "AI & Merchandising", iconKey: "description-writer", iconCategory: "ai", route: "/description-writer", tags: ["ai", "description", "copy", "listing", "marketplace", "merchandising"], chip: "AI Tool", isQuickStart: true },
];

const CATEGORIES: { name: CreateTool["category"]; sub: string }[] = [
  { name: "Compliance & Documents", sub: "Required programs, disclosures, and vehicle documentation." },
  { name: "Labels & Stickers", sub: "Window labels, promotional stickers, and custom templates." },
  { name: "AI & Merchandising", sub: "Verified AI-assisted content for dealership listings." },
];

const badgeCls = (b: ChipLabel) =>
  b === "Most Used" ? "bg-blue-50 text-blue-700 border-blue-100"
  : b === "FTC Required" ? "bg-[#EEF6FF] text-[#0F5E8C] border-[#cfe4f5]"
  : b === "Compliance" ? "bg-[#EEF6FF] text-[#0F5E8C] border-[#cfe4f5]"
  : b === "AI Tool" ? "bg-violet-50 text-violet-700 border-violet-100"
  : b === "Sticker" ? "bg-[#EDF7FF] text-[#0077C8] border-[#cfe7f7]"
  : "bg-slate-100 text-slate-600 border-slate-200";

// Creation-shaped audit actions → recent list rows. The tool keeps its own
// category-tinted icon; a separate status badge (never category color) is
// layered on top. `status` drives that badge — completions read green.
type RecentStatus = "complete" | "processing" | "attention" | "failed";
const RECENT_ACTIONS: Record<string, { label: string; iconKey: AutoLabelsToolIconKey; category: ToolCategory; status: RecentStatus }> = {
  listing_published: { label: "Published to shopper portal", iconKey: "used-car-sticker", category: "sticker", status: "complete" },
  addendum_signed: { label: "Addendum signed", iconKey: "new-addendum", category: "document", status: "complete" },
  deal_signed: { label: "Deal jacket signed", iconKey: "deals", category: "document", status: "complete" },
  document_archived: { label: "Signed document archived", iconKey: "used-vehicle-docs", category: "compliance", status: "complete" },
  prep_sign_off_signed: { label: "Prep sign-off completed", iconKey: "prep-install", category: "service", status: "complete" },
};

// Small status badge layered onto a recent-creation icon. Non-color cue via
// the icon glyph itself so status is not conveyed by color alone.
const STATUS_BADGE: Record<RecentStatus, { ring: string; dot: string }> = {
  complete: { ring: "text-emerald-500", dot: "bg-emerald-500" },
  processing: { ring: "text-blue-500", dot: "bg-blue-500" },
  attention: { ring: "text-amber-500", dot: "bg-amber-500" },
  failed: { ring: "text-red-500", dot: "bg-red-500" },
};

const timeAgo = (iso: string): string => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString();
};

interface RecentRow { id: string; action: string; created_at: string; details: Record<string, unknown> | null }

const WORKFLOW: { title: string; sub: string }[] = [
  { title: "Build the Deal", sub: "Add vehicle, pricing, and key details." },
  { title: "Add Compliance", sub: "Generate required documents and disclosures." },
  { title: "Create Labels", sub: "Produce stickers and tags for the vehicle." },
  { title: "Market & Sell", sub: "Use AI tools to create listings that convert." },
];

const InventoryGlyph = toolIcon("inventory");

export default function CreateHub() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<RecentRow[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const { data } = await (supabase as any)
          .from("audit_log")
          .select("id, action, created_at, details")
          .in("action", Object.keys(RECENT_ACTIONS))
          .order("created_at", { ascending: false })
          .limit(6);
        if (!cancelled) setRecent((data || []) as RecentRow[]);
      } catch { if (!cancelled) setRecent([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  const visible = TOOLS.filter((t) => !t.hidden);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => !q ? visible : visible.filter((t) =>
    t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) ||
    t.category.toLowerCase().includes(q) || t.tags.some((tag) => tag.includes(q))
  ), [q, visible]);

  const open = (t: CreateTool) => navigate(t.route);

  const quickCard = (t: CreateTool) => (
    <button key={t.id} onClick={() => open(t)}
      className="group text-left rounded-2xl border border-border bg-card p-4 hover:border-primary hover:shadow-[0_8px_24px_-12px_rgba(37,99,235,0.25)] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <div className="flex items-start justify-between gap-2">
        <ToolIconBadge iconKey={t.iconKey} category={t.iconCategory} variant="quick" />
        {t.chip && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeCls(t.chip)}`}>{t.chip}</span>}
      </div>
      <p className="font-semibold text-foreground leading-tight mt-3">{t.title}</p>
      <p className="text-xs text-muted-foreground mt-1 leading-snug">{t.description}</p>
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary mt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">Open <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" /></span>
    </button>
  );

  const rowCard = (t: CreateTool) => (
    <button key={t.id} onClick={() => open(t)}
      className="group w-full text-left rounded-2xl border border-border bg-card px-4 py-3.5 hover:border-primary/50 hover:bg-primary/[0.035] transition-colors flex items-center gap-3.5 min-h-[76px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <ToolIconBadge iconKey={t.iconKey} category={t.iconCategory} variant="row" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground leading-tight">{t.title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">{t.description}</span>
      </span>
      {t.chip && <span className={`hidden sm:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${badgeCls(t.chip)}`}>{t.chip}</span>}
      <ChevronRight className="w-4 h-4 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
    </button>
  );

  return (
    <div className="max-w-[1280px] mx-auto p-4 sm:p-6">
      {/* Header + search */}
      <h1 className="font-display text-[28px] sm:text-[30px] font-bold tracking-tight text-foreground leading-none">Create</h1>
      <p className="text-sm text-muted-foreground mt-2 mb-4">Generate documents, vehicle labels, and merchandising assets.</p>
      <div className="relative max-w-[720px]">
        <Search className="w-4 h-4 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && q && matches.length) open(matches[0]); }}
          placeholder="Search documents, labels, stickers, and AI tools…"
          className="w-full h-[46px] pl-11 pr-16 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground border border-border rounded-md px-1.5 py-0.5 bg-muted/40">{isMac ? "⌘ K" : "Ctrl K"}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-7 mt-6 items-start">
        {/* Main column */}
        <div className="space-y-8 min-w-0">
          {q ? (
            <section>
              <h2 className="text-[17px] font-bold text-foreground">Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{matches.length} tool{matches.length === 1 ? "" : "s"} matching "{query.trim()}".</p>
              <div className="space-y-2.5 mt-3">
                {matches.map(rowCard)}
                {matches.length === 0 && <p className="text-sm text-muted-foreground rounded-2xl border border-dashed border-border p-5 text-center">Nothing matches — try "sticker", "addendum", "buyers guide", or "description".</p>}
              </div>
            </section>
          ) : (
            <>
              <section>
                <h2 className="text-[17px] font-bold text-foreground">Quick Start</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Jump into your most-used tools.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
                  {visible.filter((t) => t.isQuickStart).map(quickCard)}
                </div>
              </section>
              {CATEGORIES.map((cat) => {
                const items = visible.filter((t) => t.category === cat.name);
                if (!items.length) return null;
                return (
                  <section key={cat.name}>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <h2 className="text-[17px] font-bold text-foreground">{cat.name}</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">{cat.sub}</p>
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{items.length} tool{items.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-3">
                      {items.map(rowCard)}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-sm font-bold text-foreground">Recent creations</h3>
              <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-primary hover:underline">View all</button>
            </div>
            {recent === null ? (
              <p className="text-xs text-muted-foreground py-2">Loading…</p>
            ) : recent.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs font-semibold text-foreground">No recent creations yet.</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Start with a Quick Start template.</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {recent.map((r) => {
                  const meta = RECENT_ACTIONS[r.action];
                  const detail = (r.details?.ymm as string) || (r.details?.vin as string) || null;
                  const badge = STATUS_BADGE[meta.status];
                  return (
                    <li key={r.id} className="flex items-center gap-2.5 py-1.5">
                      <span className="relative shrink-0">
                        <ToolIconBadge iconKey={meta.iconKey} category={meta.category} variant="mini" />
                        <span className="absolute -right-1 -bottom-1 grid place-items-center w-[15px] h-[15px] rounded-full bg-card">
                          {meta.status === "complete"
                            ? <CheckCircle2 className={`w-[15px] h-[15px] ${badge.ring}`} strokeWidth={2.25} />
                            : <span className={`w-2 h-2 rounded-full ${badge.dot}`} />}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-semibold text-foreground leading-tight truncate">{meta.label}</span>
                        {detail && <span className="block text-[10.5px] text-muted-foreground truncate">{detail}</span>}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo(r.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold text-foreground mb-3">Recommended workflow</h3>
            <ol className="space-y-3.5 relative">
              {/* subtle connector spine linking the numbered steps */}
              <span aria-hidden className="absolute left-3 top-3 bottom-3 w-px bg-border -translate-x-1/2" />
              {WORKFLOW.map((w, i) => (
                <li key={w.title} className="flex items-start gap-3 relative">
                  <span className="grid place-items-center w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0 mt-0.5 ring-2 ring-card z-10">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-foreground leading-tight">{w.title}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{w.sub}</span>
                  </span>
                </li>
              ))}
            </ol>
            <button onClick={() => navigate("/inventory")} className="mt-3.5 w-full h-9 rounded-xl border border-border text-[12px] font-semibold text-foreground hover:border-primary hover:bg-primary/[0.035] inline-flex items-center justify-center gap-1.5 transition-colors">
              <InventoryGlyph width={15} height={15} className="text-primary" /> Start with your inventory
            </button>
          </div>

          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4">
            <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-2">
              <span className="grid place-items-center w-6 h-6 rounded-lg bg-amber-100 text-amber-600 shrink-0"><Lightbulb className="w-3.5 h-3.5" /></span>
              Pro tip
            </h3>
            <p className="text-[11.5px] text-muted-foreground mt-2 leading-relaxed">Use Quick Start or press {isMac ? "⌘ K" : "Ctrl K"} to open any creation tool faster.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
