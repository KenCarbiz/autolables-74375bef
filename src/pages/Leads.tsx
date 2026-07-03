import { format } from "date-fns";
import { Download, Users } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useLeads } from "@/hooks/useLeads";

// /leads — standalone lead workspace (moved from /admin?tab=leads).
// Gated by can_view_leads in RouteCapabilityGuard.
const Leads = () => {
  const { currentStore } = useTenant();
  const { leads, exportCsv: exportLeadsCsv, updateLead } = useLeads(currentStore?.id || "");

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">Leads</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Leads captured from QR scans and signing links.</p>
        </div>
        <button
          onClick={() => {
            const csv = exportLeadsCsv();
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `leads-${currentStore?.name || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Leads exported as CSV");
          }}
          disabled={leads.length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
        {leads.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No leads captured yet</p>
            <p className="text-xs text-muted-foreground mt-1">Send addendums to customers via QR codes to start capturing leads.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left py-2.5">Name</th>
                  <th className="text-left py-2.5">Phone</th>
                  <th className="text-left py-2.5">Email</th>
                  <th className="text-left py-2.5">Vehicle</th>
                  <th className="text-left py-2.5">Source</th>
                  <th className="text-left py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(l => (
                  <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{format(new Date(l.captured_at), "M/d/yy")}</td>
                    <td className="py-2.5 text-sm font-medium">{l.name || "—"}</td>
                    <td className="py-2.5 text-xs text-muted-foreground">{l.phone || "—"}</td>
                    <td className="py-2.5 text-xs text-muted-foreground">{l.email || "—"}</td>
                    <td className="py-2.5 text-xs">{l.vehicle_interest || "—"}</td>
                    <td className="py-2.5"><span className="text-[10px] font-semibold bg-muted px-1.5 py-0.5 rounded">{l.source}</span></td>
                    <td className="py-2.5">
                      <select
                        value={l.status}
                        onChange={(e) => updateLead(l.id, { status: e.target.value as "new" | "contacted" | "converted" | "lost" })}
                        className="text-[10px] font-semibold bg-muted border-0 rounded px-1.5 py-0.5 cursor-pointer"
                      >
                        <option value="new">New</option>
                        <option value="contacted">Contacted</option>
                        <option value="converted">Converted</option>
                        <option value="lost">Lost</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Leads;
