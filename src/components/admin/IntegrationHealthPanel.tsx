import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ICON, ICON_BOX } from "@/components/admin/v2/primitives";
import { AlertTriangle, CircleSlash, Network, RefreshCw } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// RooftopOS integration health, read-only.
//
// PLATFORM-ADMIN ONLY. Shows what the integration-health function reports from
// the real inbox/outbox/flag tables. It has no controls that change anything,
// and it never marks a connection as working: empty tables read as Not
// configured, and a configured connection only shows the facts recorded for it.
// ──────────────────────────────────────────────────────────────────────

interface StatusCount { total: number; last24h: number }
interface ConnectionInfo {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  display_name: string;
  status: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
}
interface AppInfo { state: "not_configured" | "configured"; connections: ConnectionInfo[] }
interface Health {
  state: "not_configured" | "configured";
  generated_at: string;
  apps: { autofilm: AppInfo; autocurb: AppInfo };
  inbox: {
    by_status: Record<string, StatusCount>;
    oldest_received_age_seconds: number | null;
    unmatched: number;
    dead: number;
  };
  outbox: {
    by_status: Record<string, StatusCount>;
    oldest_pending_age_seconds: number | null;
    pending: number;
    dead: number;
  };
  flags: { direction: string; enabled_tenants: number; configured_tenants: number }[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "error"; code: string }
  | { kind: "ready"; health: Health };

const APPS: { id: "autofilm" | "autocurb"; label: string }[] = [
  { id: "autofilm", label: "AutoFilm" },
  { id: "autocurb", label: "AutoCurb" },
];

const DIRECTION_LABEL: Record<string, string> = {
  labels_to_film: "AutoLabels to AutoFilm",
  film_to_labels: "AutoFilm to AutoLabels",
  labels_to_curb: "AutoLabels to AutoCurb",
  curb_to_labels: "AutoCurb to AutoLabels",
  film_to_curb: "AutoFilm to AutoCurb",
  curb_to_film: "AutoCurb to AutoFilm",
};

const age = (seconds: number | null) => {
  if (seconds === null) return "none waiting";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

async function errorCode(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = await ctx.json().catch(() => null) as { error?: string } | null;
    if (body?.error) return body.error;
  }
  return "request_failed";
}

export default function IntegrationHealthPanel() {
  const { isAdmin } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("integration-health", { method: "POST", body: {} });
      if (error) {
        const code = await errorCode(error);
        setState(code === "integrations_disabled" ? { kind: "disabled" } : { kind: "error", code });
        return;
      }
      setState({ kind: "ready", health: data as Health });
    } catch {
      setState({ kind: "error", code: "request_failed" });
    }
  }, []);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  const health = state.kind === "ready" ? state.health : null;

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
              Platform admin only
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground inline-flex items-center gap-2">
              <Network className={ICON.inline} /> Integration health
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Read-only view of the AutoFilm and AutoCurb connections, the event inbox and outbox, and which
              directions are switched on. A valid credential does not prove an integration works, so no connection is marked as working here.
            </p>
          </div>
          <button onClick={() => void load()} className="h-10 rounded-lg border border-border px-3 text-xs font-bold inline-flex items-center gap-2">
            <RefreshCw className={ICON.button} /> Refresh
          </button>
        </div>
      </div>

      {state.kind === "loading" && <p className="p-4 text-sm text-muted-foreground">Loading integration health…</p>}

      {state.kind === "disabled" && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <span className={`${ICON_BOX.circle} mx-auto mb-3 flex items-center justify-center bg-muted`}>
            <CircleSlash className={ICON.inCircle} />
          </span>
          Not configured. Integrations are switched off for this deployment.
        </div>
      )}

      {state.kind === "error" && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 inline-flex items-center gap-2">
          <AlertTriangle className={ICON.inline} /> Could not load integration health ({state.code}).
        </div>
      )}

      {health && health.state === "not_configured" && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <span className={`${ICON_BOX.circle} mx-auto mb-3 flex items-center justify-center bg-muted`}>
            <CircleSlash className={ICON.inCircle} />
          </span>
          Not configured. No integration connections exist yet, so there is nothing to report.
        </div>
      )}

      {health && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {APPS.map(({ id, label }) => {
              const app = health.apps[id];
              return (
                <div key={id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-foreground">{label}</p>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {app.state === "not_configured" ? "Not configured" : `${app.connections.length} connection${app.connections.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {app.connections.map((c) => (
                    <div key={c.id} className="mt-3 rounded-xl bg-muted p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-foreground truncate">{c.tenant_name || c.display_name}</span>
                        <span className="font-semibold uppercase tracking-wider text-muted-foreground">{c.status}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">Last success: {when(c.last_success_at)}</p>
                      <p className="text-muted-foreground">
                        Last error: {when(c.last_error_at)}{c.last_error_code ? ` (${c.last_error_code})` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-black text-foreground">Direction switches</p>
            <p className="text-xs text-muted-foreground">Per tenant, all off unless a tenant has turned one on.</p>
            <div className="mt-3 divide-y divide-border">
              {health.flags.map((f) => (
                <div key={f.direction} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-foreground">{DIRECTION_LABEL[f.direction] ?? f.direction}</span>
                  <span className={`font-semibold tabular-nums ${f.enabled_tenants > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                    {f.enabled_tenants > 0 ? `On for ${f.enabled_tenants} of ${f.configured_tenants}` : "Off"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <CountCard
              title="Inbox"
              counts={health.inbox.by_status}
              footer={`Oldest waiting: ${age(health.inbox.oldest_received_age_seconds)}`}
              flags={[["Unmatched", health.inbox.unmatched], ["Dead", health.inbox.dead]]}
            />
            <CountCard
              title="Outbox"
              counts={health.outbox.by_status}
              footer={`Oldest pending: ${age(health.outbox.oldest_pending_age_seconds)}`}
              flags={[["Pending", health.outbox.pending], ["Dead", health.outbox.dead]]}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CountCard({ title, counts, footer, flags }: {
  title: string;
  counts: Record<string, StatusCount>;
  footer: string;
  flags: [string, number][];
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-black text-foreground">{title}</p>
        <div className="flex gap-3">
          {flags.map(([label, n]) => (
            <span key={label} className={`text-xs font-bold ${n > 0 && label !== "Pending" ? "text-rose-700" : "text-muted-foreground"}`}>
              {label}: {n}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-al-meta font-bold uppercase text-muted-foreground">
          <span>Status</span><span>24h / total</span>
        </div>
        {Object.entries(counts).map(([status, c]) => (
          <div key={status} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{status}</span>
            <span className="font-semibold text-foreground tabular-nums">{c.last24h} / {c.total}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{footer}</p>
    </div>
  );
}
