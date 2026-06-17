import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Search, FileText, ArrowLeft, Eye, Plus, Printer, ShieldCheck, Mail, Pencil } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { toast } from "sonner";

const SavedAddendums = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

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

  const filtered = addendums?.filter((a) => {
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
        <button onClick={() => navigate("/login")} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-85">
          🔑 Login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/addendum")} className="p-2 rounded-md hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold font-barlow-condensed text-foreground">Saved Addendums</h1>
          </div>
          <button onClick={() => navigate("/addendum")} className="font-semibold text-[13px] px-5 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-85">
            + New Addendum
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
            title={search ? "No addendums match your search" : "No saved addendums yet"}
            description={
              search
                ? "Try a different stock number, VIN, or customer name."
                : "Every addendum you sign is archived here with its hash, consent record, and customer signature. Start one to fill this list."
            }
            actions={
              search
                ? undefined
                : [{ label: "New Addendum", icon: Plus, onClick: () => navigate("/addendum") }]
            }
          />
        ) : (
          <div className="bg-card rounded-lg shadow-sm overflow-hidden">
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
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">{format(new Date(a.created_at), "MMM d, yyyy")}</td>
                      <td className="px-4 py-3">{a.vehicle_ymm || "—"}</td>
                      <td className="px-4 py-3">{a.vehicle_stock || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{a.vehicle_vin || "—"}</td>
                      <td className="px-4 py-3">{a.customer_name || "—"}</td>
                      <td className="px-4 py-3">{a.total_with_optional != null ? `$${Number(a.total_with_optional).toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3">
                        {/* Wave 15.5 — next-action exits. The
                            "View" only path was a dead end; an
                            archived signed addendum needs Email,
                            Print, and Defend exits so dealers
                            can act on the row without leaving
                            the page. */}
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => navigate(`/addendum?id=${a.id}`)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
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
                              )}&body=${encodeURIComponent(
                                `${window.location.origin}/addendum?id=${a.id}`
                              )}`;
                              window.location.href = mailto;
                            }}
                            disabled={!a.customer_email}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title={a.customer_email ? `Email to ${a.customer_email}` : "No customer email on file"}
                          >
                            <Mail className="w-3.5 h-3.5" /> Email
                          </button>
                          <button
                            onClick={() => {
                              const w = window.open(`/addendum?id=${a.id}&print=1`, "_blank");
                              if (!w) toast.error("Pop-up blocked — allow pop-ups to print");
                            }}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Open in a new tab for printing / save-as-PDF"
                          >
                            <Printer className="w-3.5 h-3.5" /> Print
                          </button>
                          {a.vehicle_vin && (
                            <button
                              onClick={() => navigate(`/compliance?vin=${encodeURIComponent(a.vehicle_vin)}`)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md text-emerald-700 hover:bg-emerald-50 transition-colors"
                              title="Generate the SB 766 / FTC audit-defense packet for this VIN"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" /> Defend
                            </button>
                          )}
                        </div>
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
        )}
      </div>
    </div>
  );
};

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

export default SavedAddendums;
