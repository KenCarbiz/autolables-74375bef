import { FileText, MessageSquare, RefreshCw, Share2 } from "lucide-react";

// Quick action bar under the hero/pricing: bold, tappable consumer actions.

// deno-lint-ignore no-explicit-any
export default function QuickActionBar({ dealer, onShare, tradeUrl }: { dealer: any; onShare: () => void; tradeUrl?: string }) {
  const phone = (dealer?.phone as string | undefined)?.replace(/[^\d+]/g, "");
  const actions = [
    { icon: FileText, label: "Documents", onClick: () => document.getElementById("passport-documents")?.scrollIntoView({ behavior: "smooth" }) },
    { icon: MessageSquare, label: "Contact Dealer", onClick: () => { if (phone) window.location.href = `tel:${phone}`; else document.getElementById("passport-footer")?.scrollIntoView({ behavior: "smooth" }); } },
    { icon: RefreshCw, label: "Value My Trade", onClick: () => { if (tradeUrl) window.open(tradeUrl, "_blank", "noopener"); else document.getElementById("passport-trade")?.scrollIntoView({ behavior: "smooth" }); } },
    { icon: Share2, label: "Share Vehicle", onClick: onShare },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="h-14 rounded-2xl border border-border bg-card hover:bg-muted hover:border-foreground/15 shadow-sm inline-flex items-center justify-center gap-2 text-sm font-semibold text-foreground transition-colors"
        >
          <a.icon className="w-4 h-4 text-blue-600" /> {a.label}
        </button>
      ))}
    </div>
  );
}
