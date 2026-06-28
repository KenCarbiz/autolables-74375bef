import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Search, FileText, ArrowLeft, Eye, Plus, Printer, ShieldCheck, Mail, Pencil, Truck } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import PageTabs, { DEALS_TABS } from "@/components/layout/PageTabs";
import { toast } from "sonner";

export type DealStage = "saved" | "signed" | "delivered";

const STAGE_META: Record<DealStage, { title: string; subtitle: string; empty: string }> = {
  saved: { title: "Saved Addendums", subtitle: "Drafts you're still building, with live price-integrity checks.", empty: "Drafts you're still building live here. Start one to fill this list." },
  signed: { title: "Signed — Awaiting Delivery", subtitle: "Signed deals waiting to be marked delivered.", empty: "Signed deals appear here until you mark them delivered." },
  delivered: { title: "Delivered", subtitle: "Completed, audit-defense-ready deals.", empty: "Delivered deals are archived here." },
};

const SavedAddendums = ({ stage = "saved" }: { stage?: DealStage }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const meta = STAGE_META[stage];

  const { data: addendums, isLoading } = useQuery({
    queryKey: ["addendums"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("addendums")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Mark an executed (signed) addendum as delivered: stamp the addendum and
  // flip its vehicle file out of inventory.
  const deliver = useMutation({
    mutationFn: async (a: any) => {
      const now = new Date().toISOString();
      const { error } = await (supabase as any)
        .from("addendums")
        .update({ delivered_at: now, delivered_by: user?.id || "" })
        .eq("id", a.id);
      if (error) throw error;
      if (a.vehicle_vin) {
        // RLS scopes this to the caller's own tenant row.
        await (supabase as any)
          .from("vehicle_files")
          .update({ deal_status: "delivered", sold_at: now })
          .eq("vin", a.vehicle_vin);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["addendums"] });
      toast.success("Marked delivered — removed from inventory.");
    },
    onError: (e: any) => toast.error(e?.message?.includes("delivered_at") ? "Apply the delivered_at migration first." : "Could not mark delivered."),
  });

  // Stage split: delivered rows only in Delivered; signed-not-delivered in
  // Signed; everything else (drafts) in Saved.
  const inStage = (a: any) => {
    const delivered = !!a.delivered_at;
    if (stage === "delivered") return delivered;
    if (delivered) return false;
    if (stage === "signed") return a.status === "signed";
    return a.status !== "signed";
  };

  const filtered = addendums?.filter(inStage).filter((a: any) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (a.vehicle_ymm || "").toLowerCase().includes(q) ||
      (a.vehicle_vin || "").toLowerCase().includes(q) ||
      (a.vehicle_stock || "").toLowerCase().includes(q) ||
      (a.customer_name || "").toLowerCase().includes(q) ||
      a.status.toLowerCase().includes(q)
    );
  });

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <p className="text-muted-foreground mb-4">Sign in to view saved addendums.</p>
        <button onClick={() => navigate("/login")} className="font-semibold text-[13px] px-5 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors">
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <PageTabs tabs={DEALS_TABS} className="mb-5" />
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold font-barlow-condensed text-foreground">{meta.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{meta.subtitle}</p>
          </div>
          <button onClick={() => navigate("/addendum")} className="inline-flex items-center gap-2 font-semibold text-[13px] px-4 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors shrink-0">
            <Plus className="w-4 h-4" /> New Addendum
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by vehicle, VIN, stock #, customer name, or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading addendums…</p>
          </div>
        ) : !filtered?.length ? (
          <EmptyState
            icon={FileText}
            title={search ? "No addendums match your search" : `Nothing in ${meta.title}`}
            description={search ? "Try a different stock number, VIN, or customer name." : meta.empty}
            actions={
              search
                ? undefined
                : [{ label: "New Addendum", icon: Plus, onClick: () => navigate("/addendum") }]
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards so status, total, and every action stay on
                screen instead of being scrolled off a wide table. */}
            <div className="md:hidden space-y-3">
              {filtered.map((a: any) => (
                <div key={a.id} className="bg-card rounded-xl border border-border shadow-sm p-4">
                  <button onClick={() => navigate(`/addendum?id=${a.id}`)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{a.vehicle_ymm || "Vehicle"}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {a.vehicle_stock ? `Stock ${a.vehicle_stock}` : "No stock #"}
                          {a.vehicle_vin ? ` · …${String(a.vehicle_vin).slice(-8)}` : ""}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                        {format(new Date(a.created_at), "MMM d")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <span className="text-sm text-foreground truncate">{a.customer_name || "No customer yet"}</span>
                      <span className="text-sm font-semibold tabular-nums shrink-0">
                        {a.total_with_optional != null ? `$${Number(a.total_with_optional).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <StatusBadge status={a.status} />
                      {a.status !== "signed" && <PriceVerifyChip status={(a as any).price_verification_status} delta={(a as any).price_verification_delta} />}
                    </div>
                  </button>
                  <div className="mt-3 pt-3 border-t border-border">
                    <RowActions a={a} stage={stage} navigate={navigate} deliver={deliver} />
                  </div>
                </div>
              ))}
              <p className="px-1 pt-1 text-xs text-muted-foreground">
                {filtered.length} addendum{filtered.length !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Desktop: full table. */}
            <div className="hidden md:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Date</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Vehicle</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Stock #</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">VIN</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Customer</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Total</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a: any) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 whitespace-nowrap">{format(new Date(a.created_at), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3">{a.vehicle_ymm || "—"}</td>
                        <td className="px-4 py-3">{a.vehicle_stock || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs">{a.vehicle_vin || "—"}</td>
                        <td className="px-4 py-3">{a.customer_name || "—"}</td>
                        <td className="px-4 py-3">{a.total_with_optional != null ? `$${Number(a.total_with_optional).toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={a.status} />
                            {a.status !== "signed" && <PriceVerifyChip status={(a as any).price_verification_status} delta={(a as any).price_verification_delta} />}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <RowActions a={a} stage={stage} navigate={navigate} deliver={deliver} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                {filtered.length} addendum{filtered.length !== 1 ? "s" : ""}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Shared row actions, used by both the desktop table and the mobile cards so
// the phone layout exposes the same exits (View/Edit/Email/Print/Deliver/Defend)
// instead of hiding them off the right edge of a wide table.
const RowActions = ({ a, stage, navigate, deliver }: { a: any; stage: DealStage; navigate: (p: string) => void; deliver: any }) => (
  <div className="inline-flex items-center gap-1 flex-wrap">
    <button
      onClick={() => navigate(`/addendum?id=${a.id}`)}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
      title="Open in read-only mode"
    >
      <Eye className="w-3.5 h-3.5" /> View
    </button>
    <button
      onClick={() => navigate(`/addendum?id=${a.id}&edit=1`)}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Continue editing this addendum"
    >
      <Pencil className="w-3.5 h-3.5" /> Edit
    </button>
    <button
      onClick={() => {
        const mailto = `mailto:${a.customer_email || ""}?subject=${encodeURIComponent(
          `Your addendum from us — ${a.vehicle_ymm || "vehicle"}`
        )}&body=${encodeURIComponent(`${window.location.origin}/addendum?id=${a.id}`)}`;
        window.location.href = mailto;
      }}
      disabled={!a.customer_email}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      title={a.customer_email ? `Email to ${a.customer_email}` : "No customer email on file"}
    >
      <Mail className="w-4 h-4" />
    </button>
    <button
      onClick={() => {
        const w = window.open(`/addendum?id=${a.id}&print=1`, "_blank");
        if (!w) toast.error("Pop-up blocked — allow pop-ups to print");
      }}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Open in a new tab for printing / save-as-PDF"
    >
      <Printer className="w-4 h-4" />
    </button>
    {stage === "signed" && (
      <button
        onClick={() => deliver.mutate(a)}
        disabled={deliver.isPending}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-8 rounded-lg whitespace-nowrap text-white bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 shadow-sm shadow-emerald-600/30 ring-1 ring-inset ring-white/15 transition-all disabled:opacity-50"
        title="Mark the vehicle delivered — stamps the record and removes it from inventory"
      >
        <Truck className="w-3.5 h-3.5 stroke-2" /> {deliver.isPending ? "Delivering…" : "Mark Delivered"}
      </button>
    )}
    {a.vehicle_vin && (
      <button
        onClick={() => navigate(`/compliance?vin=${encodeURIComponent(a.vehicle_vin)}`)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-emerald-700 hover:bg-emerald-50 transition-colors"
        title="Generate the SB 766 / FTC audit-defense packet for this VIN"
      >
        <ShieldCheck className="w-4 h-4" />
      </button>
    )}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    signed: "bg-teal/15 text-teal",
    completed: "bg-teal/15 text-teal",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${styles[status] || styles.draft}`}>
      {status}
    </span>
  );
};

// Per-deal price-integrity state in the queue. A draft cannot be signed until
// this reads "verified" — pending/mismatch rows need a dealer fix.
const PriceVerifyChip = ({ status, delta }: { status?: string | null; delta?: number | null }) => {
  if (!status || status === "pending" || status === "untracked") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Price unverified
      </span>
    );
  }
  if (status === "mismatch") {
    const d = typeof delta === "number" ? `${delta > 0 ? "+" : "−"}$${Math.abs(Math.round(delta)).toLocaleString()}` : "";
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-red-50 text-red-700 ring-1 ring-inset ring-red-200" title="Fix the selling price or reclassify a pre-installed item">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Price mismatch {d}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <ShieldCheck className="w-3 h-3" /> Price verified
    </span>
  );
};

export default SavedAddendums;
