import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AdminSpecsBackfillOne() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [vin, setVin] = useState("");
  const [tenantOverride, setTenantOverride] = useState("");
  const [fn, setFn] = useState<"marketcheck-specs" | "specs-backfill">("marketcheck-specs");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const run = async () => {
    const v = vin.trim().toUpperCase();
    const t = (tenantOverride.trim() || tenantId || "").trim();
    if (!v || !t) {
      toast.error("VIN and tenant_id required");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body =
        fn === "marketcheck-specs"
          ? { vin: v, tenant_id: t }
          : { vin: v, tenant_id: t, limit: 1, force: true };
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      setResult(data);
      toast.success(`${fn} completed`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ error: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Specs Backfill — Single VIN</h1>
        <p className="text-sm text-muted-foreground">
          Admin-only trigger. Invokes the selected function with your session token.
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border p-4 shadow-sm">
        <label className="block text-sm">
          <span className="text-muted-foreground">Function</span>
          <select
            value={fn}
            onChange={(e) => setFn(e.target.value as typeof fn)}
            className="mt-1 w-full rounded-md border px-3 py-2 bg-background"
          >
            <option value="marketcheck-specs">marketcheck-specs (single VIN)</option>
            <option value="specs-backfill">specs-backfill (batch, limit=1, force)</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-muted-foreground">VIN</span>
          <input
            value={vin}
            onChange={(e) => setVin(e.target.value)}
            placeholder="e.g. JN8AZ3BE9V9730002"
            className="mt-1 w-full rounded-md border px-3 py-2 font-mono uppercase bg-background"
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted-foreground">
            tenant_id (defaults to your current tenant: {tenantId ?? "none"})
          </span>
          <input
            value={tenantOverride}
            onChange={(e) => setTenantOverride(e.target.value)}
            placeholder={tenantId ?? ""}
            className="mt-1 w-full rounded-md border px-3 py-2 font-mono bg-background"
          />
        </label>

        <button
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Run
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Truth sweep (all tenants)</h2>
          <p className="text-sm text-muted-foreground">
            Kicks off the global enrich-sweep chain: market data, recall, value,
            and any still-missing NeoVIN decode. Self-chains until inventory is
            complete. Safe to click; if a chain is already running it returns
            immediately.
          </p>
        </div>
        <button
          onClick={async () => {
            setBusy(true); setResult(null);
            try {
              const { data, error } = await supabase.functions.invoke("enrich-sweep", { body: {} });
              if (error) throw error;
              setResult(data);
              toast.success("enrich-sweep launched");
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              setResult({ error: msg });
              toast.error(msg);
            } finally { setBusy(false); }
          }}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Run enrich-sweep
        </button>
      </div>

      {result !== null && (
        <pre className="max-h-[500px] overflow-auto rounded-2xl border bg-muted/40 p-4 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
