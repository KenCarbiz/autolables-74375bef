import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { CommandCard, formatCommandDateTime, BTN_PRIMARY } from "@/components/command/CommandPrimitives";
import { cn } from "@/lib/utils";

// Manager messaging over service_messages (20260726106000). The thread is
// append-only support for the work; it never decides anything — approvals stay
// structured on service_requests (decide_service_request). Both surfaces say so
// in the UI so a chat "yes go ahead" is never mistaken for authorization.

export interface ServiceMessageRow {
  id: string;
  vin: string;
  author: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

const SUPPORT_NOTE = "Chat supports the work. Approvals are decided with the structured Approve / Decline buttons, never by a message.";

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

function useMessages(tenantId: string, vin?: string) {
  const [rows, setRows] = useState<ServiceMessageRow[] | null>(null);
  const load = useCallback(async () => {
    let q = sb().from("service_messages")
      .select("id, vin, author, author_name, body, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (vin) q = q.eq("vin", vin.toUpperCase());
    const { data, error } = await q;
    setRows(error ? [] : ((data as ServiceMessageRow[]) || []));
  }, [tenantId, vin]);
  useEffect(() => { void load(); }, [load]);
  return { rows, reload: load };
}

function Composer({ tenantId, vin, onSent, disabledReason }: {
  tenantId: string; vin: string | null; onSent: () => void; disabledReason?: string | null;
}) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = disabledReason ?? (!vin ? "Pick a vehicle to message about." : null);

  const send = async () => {
    if (blocked || !body.trim() || !vin) return;
    setBusy(true);
    const { error } = await sb().from("service_messages").insert({
      tenant_id: tenantId, vin: vin.toUpperCase(), author: user?.id ?? null,
      author_name: user?.email?.split("@")[0] || null, body: body.trim(),
    });
    setBusy(false);
    if (error) { toast.error("Couldn't send the message"); return; }
    setBody("");
    onSent();
  };

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Message sales manager"
        aria-label="Message sales manager"
        className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] text-muted-foreground">{SUPPORT_NOTE}</p>
        <span title={blocked ?? undefined}>
          <button
            type="button"
            onClick={send}
            aria-disabled={!!blocked || !body.trim() || busy || undefined}
            className={cn(BTN_PRIMARY, "h-10 shrink-0", (blocked || !body.trim() || busy) && "opacity-50 cursor-not-allowed")}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
            Send
          </button>
        </span>
      </div>
    </div>
  );
}

function MessageList({ rows, showVin }: { rows: ServiceMessageRow[]; showVin?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground py-2">No messages yet.</p>;
  }
  return (
    <ul className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
      {rows.map((m) => (
        <li key={m.id} className="rounded-xl border border-border bg-muted/30 p-2.5">
          <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{m.author_name || "Team member"}</span>
            <span>{formatCommandDateTime(m.created_at) ?? ""}</span>
          </div>
          {showVin ? <div className="font-mono text-[10px] text-muted-foreground mt-0.5">VIN …{m.vin.slice(-6)}</div> : null}
          <p className="text-[12.5px] text-foreground mt-1 whitespace-pre-wrap break-words">{m.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Per-vehicle thread panel for the workspace. */
export function ServiceMessagesThread({ tenantId, vin }: { tenantId: string; vin: string }) {
  const { rows, reload } = useMessages(tenantId, vin);
  return (
    <CommandCard title="Manager messages" subtitle={SUPPORT_NOTE}>
      <div className="space-y-3">
        <MessageList rows={rows ?? []} />
        <Composer tenantId={tenantId} vin={vin} onSent={() => void reload()} />
      </div>
    </CommandCard>
  );
}

/** Tenant-wide right rail for the queue: recent threads + a VIN-scoped composer. */
export function ManagerMessagesRail({ tenantId, vehicles }: {
  tenantId: string;
  vehicles: { vin: string; ymm: string }[];
}) {
  const { rows, reload } = useMessages(tenantId);
  const [filter, setFilter] = useState("all");
  const [composeVin, setComposeVin] = useState("");
  const [composing, setComposing] = useState(false);

  const visible = useMemo(
    () => (rows ?? []).filter((m) => filter === "all" || m.vin === filter),
    [rows, filter],
  );
  const vinsWithMessages = useMemo(
    () => Array.from(new Set((rows ?? []).map((m) => m.vin))),
    [rows],
  );
  const labelFor = (vin: string) =>
    vehicles.find((v) => v.vin === vin)?.ymm || `VIN …${vin.slice(-6)}`;

  // No messages and not composing: yield the rail space instead of parking a
  // permanent empty panel beside the queue.
  if ((rows ?? []).length === 0 && !composing) {
    return (
      <div className="rounded-2xl border border-border bg-card p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <p className="text-xs text-muted-foreground truncate">No manager messages</p>
        </div>
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="h-9 px-3 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted shrink-0"
        >
          New message
        </button>
      </div>
    );
  }

  return (
    <CommandCard
      title="Manager messages"
      leading={<MessageSquare className="w-4 h-4 text-primary" aria-hidden="true" />}
      action={
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter messages by vehicle"
          className="h-9 rounded-lg border border-border bg-background px-2 text-xs"
        >
          <option value="all">All vehicles</option>
          {vinsWithMessages.map((vin) => (
            <option key={vin} value={vin}>{labelFor(vin)}</option>
          ))}
        </select>
      }
    >
      <div className="space-y-3">
        <MessageList rows={visible} showVin={filter === "all"} />
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1" htmlFor="rail-msg-vin">
            About vehicle
          </label>
          <select
            id="rail-msg-vin"
            value={composeVin}
            onChange={(e) => setComposeVin(e.target.value)}
            className="w-full h-10 rounded-lg border border-border bg-background px-2 text-sm mb-2"
          >
            <option value="">Choose a vehicle…</option>
            {vehicles.map((v) => (
              <option key={v.vin} value={v.vin}>{v.ymm} · …{v.vin.slice(-6)}</option>
            ))}
          </select>
          <Composer tenantId={tenantId} vin={composeVin || null} onSent={() => void reload()} />
        </div>
      </div>
    </CommandCard>
  );
}
