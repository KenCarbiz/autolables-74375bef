import { useNavigate } from "react-router-dom";
import { FileText, Car, Sparkles, Award, TrendingUp, ScrollText, Plus } from "lucide-react";

// /create — one launcher for the document/sticker creators that used to be 9
// separate sidebar rows. Keeps the sidebar to a single "Create" entry; each
// card routes to the existing builder. Most are also reachable from a vehicle.

const ITEMS: { label: string; sub: string; path: string; icon: typeof FileText }[] = [
  { label: "New Addendum", sub: "Add-on products + disclosures for a deal", path: "/addendum", icon: FileText },
  { label: "Used Car Sticker", sub: "Window sticker for a used vehicle", path: "/used-car-sticker", icon: Car },
  { label: "New Car Sticker", sub: "Monroney-style new-car window label", path: "/new-car-sticker", icon: FileText },
  { label: "CPO Info Sheet", sub: "Certified Pre-Owned program sheet", path: "/cpo-sheet", icon: Award },
  { label: "Trade-Up Sticker", sub: "Promotional trade-up sticker", path: "/trade-up", icon: TrendingUp },
  { label: "Buyers Guide", sub: "FTC Used Car Buyers Guide", path: "/buyers-guide", icon: ScrollText },
  { label: "Used Vehicle Docs", sub: "Buyers Guide + K-208 packet", path: "/used-vehicle-documents", icon: ScrollText },
  { label: "Sticker Studio", sub: "Choose & style a sticker template", path: "/sticker-studio", icon: Sparkles },
  { label: "Description Writer", sub: "AI listing copy per marketplace", path: "/description-writer", icon: Sparkles },
];

export default function CreateHub() {
  const navigate = useNavigate();
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <Plus className="w-6 h-6 text-primary" />
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Create</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">Pick what you need to make. Most can also be started from a vehicle in Inventory.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ITEMS.map((it) => (
          <button key={it.path} onClick={() => navigate(it.path)}
            className="text-left rounded-2xl border border-border bg-card p-4 hover:border-primary hover:bg-muted/30 transition-colors flex items-start gap-3">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0"><it.icon className="w-5 h-5" /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-foreground leading-tight">{it.label}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{it.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
