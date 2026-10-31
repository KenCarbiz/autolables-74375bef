import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStaleQueue, resolveFlag, type StaleFlag } from "@/lib/stickerStudio/useStaleFlags";
import { useAuth } from "@/contexts/AuthContext";
import { logStickerAudit } from "@/lib/stickerStudio/api";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, Check, EyeOff, RefreshCw, Printer } from "lucide-react";
import { Button, PageBody, PageHeader, Panel, QueryState, StatusText, WorkTable, Th, Td, type Tone } from "@/components/product";
import { toast } from "sonner";

const sevMeta: Record<StaleFlag["severity"], { tone: Tone; label: string }> = {
  compliance_block: { tone: "danger", label: "Compliance block" },
  warning: { tone: "warning", label: "Warning" },
  info: { tone: "neutral", label: "Info" },
};
const fmtVal = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : String(v ?? "—"));

// Manager review queue for stickers/addendums that may be stale due to
// inventory/pricing changes. /dashboard/document-review.
const DocumentReview = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { flags, loading, available, reload } = useStaleQueue();

  const [queueing, setQueueing] = useState<string | null>(null);

  const act = async (flag: StaleFlag, status: StaleFlag["status"], successMessage?: string) => {
    const ok = await resolveFlag(flag.id, status, user?.id);
    if (ok) {
      await logStickerAudit("stale_flag_" + status, { tenantId: tenant?.id, entityType: "generated_document", entityId: flag.generated_document_id || flag.vehicle_id, details: { field: flag.changed_field, severity: flag.severity } });
      toast.success(successMessage || `Marked ${status}`);
      reload();
    } else toast.error("Action failed");
  };

  // Resolving a price-change flag usually means the sticker must be
  // reprinted — queue the VIN into the Print department (vin_queue) so the
  // review queue hands off to the print queue instead of dead-ending.
  const queueReprint = async (flag: StaleFlag) => {
    setQueueing(flag.id);
    try {
      const { data: veh } = await (supabase as any)
        .from("vehicle_listings")
        .select("vin, mileage")
        .eq("id", flag.vehicle_id)
        .maybeSingle();
      if (!veh?.vin) { toast.error("Couldn't find the vehicle for this flag."); return; }
      const { error } = await (supabase as any).from("vin_queue").insert({
        vin: String(veh.vin).toUpperCase(),
        stock_number: "",
        mileage: veh.mileage != null ? String(veh.mileage) : "",
        notes: `Reprint — ${flag.changed_field || "vehicle data"} changed`,
        status: "queued",
      });
      if (error) { toast.error("Couldn't queue the reprint."); return; }
      await act(flag, "resolved", "Reprint queued and flag resolved");
    } finally {
      setQueueing(null);
    }
  };

  // Loading and an unavailable table are their own states; an empty queue is
  // reported only after the read succeeded.
  const status = loading ? "loading" : !available ? "error" : flags.length === 0 ? "empty" : "ready";

  return (
    <PageBody width="wide">
      <PageHeader
        title="Document review queue"
        description="Stickers and addendums that may be stale because the vehicle's price, MSRP, or details changed after they were generated."
        actions={
          <Button onClick={reload} disabled={loading}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </Button>
        }
      />
      <Panel flush title={status === "ready" ? `${flags.length} open ${flags.length === 1 ? "review" : "reviews"}` : undefined}>
        <QueryState
          status={status}
          onRetry={reload}
          errorTitle="The review queue is not available."
          errorDetail="The stale-document flag table could not be read, so the queue is unknown rather than empty."
          emptyTitle="No documents are waiting for review."
          emptyDetail="Nothing is flagged as stale for this rooftop right now."
        >
          <WorkTable caption="Documents needing review" minWidth={820}>
            <thead>
              <tr>
                <Th>Severity</Th>
                <Th>Reason</Th>
                <Th>Sticker value</Th>
                <Th>Current value</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => {
                const m = sevMeta[f.severity];
                return (
                  <tr key={f.id}>
                    <Td>
                      <StatusText tone={m.tone}>{m.label}</StatusText>
                      {f.changed_field && <p className="mt-1 font-mono text-[12px] text-adm-muted">{f.changed_field}</p>}
                    </Td>
                    <Td>{f.reason}</Td>
                    <Td align="right">{fmtVal(f.old_value)}</Td>
                    <Td align="right">{fmtVal(f.new_value)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => navigate(`/vehicle-file/${f.vehicle_id}?tab=labels`)}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open vehicle</Button>
                        <Button size="sm" onClick={() => queueReprint(f)} disabled={queueing === f.id}><Printer className="h-3.5 w-3.5" aria-hidden="true" /> Queue reprint</Button>
                        <Button size="sm" onClick={() => act(f, "resolved")}><Check className="h-3.5 w-3.5" aria-hidden="true" /> Resolve</Button>
                        <Button size="sm" onClick={() => act(f, "ignored")}><EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Ignore</Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </WorkTable>
        </QueryState>
      </Panel>
    </PageBody>
  );
};

export default DocumentReview;
