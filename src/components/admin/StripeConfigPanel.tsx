import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CreditCard, Check, X, RefreshCw, AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// StripeConfigPanel — super-admin Stripe health/setup.
//
// Secrets live in Supabase Edge Function env, never in the DB or
// the browser. This panel only REPORTS whether each secret is set
// (via stripe-config-status, which pings Stripe to confirm the key
// authenticates) and documents the setup. Per the cross-app
// contract, Autocurb remains the billing authority — AutoLabels'
// stripe-webhook is a shadow ledger only.
// ──────────────────────────────────────────────────────────────

interface Status {
  secret_key: boolean;
  webhook_secret: boolean;
  mode: "live" | "test" | null;
  price_tiers: string[];
  stripe_ok: boolean;
  account: string | null;
}

const SECRETS: { name: string; what: string }[] = [
  { name: "STRIPE_SECRET_KEY", what: "Your sk_live_… / sk_test_… secret key" },
  { name: "STRIPE_WEBHOOK_SECRET", what: "The whsec_… signing secret from your webhook endpoint" },
  { name: "STRIPE_PRICE_AUTOLABELS_<PLAN>", what: "One Stripe price_… per paid tier (e.g. _STICKER, _COMPLIANCE, _GROUP)" },
];

const StripeConfigPanel = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-config-status", {});
      if (error) throw error;
      setStatus(data as Status);
      const s = data as Status;
      toast.success(s.stripe_ok ? `Connected to Stripe${s.account ? ` · ${s.account}` : ""}` : s.secret_key ? "Secret key set but Stripe ping failed" : "No Stripe secret key configured yet");
    } catch (e) {
      toast.error((e as Error).message || "Could not check Stripe config");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-700 flex items-center justify-center"><CreditCard className="w-5 h-5" /></span>
            <div>
              <h2 className="font-display font-semibold text-foreground">Stripe Configuration</h2>
              <p className="text-xs text-muted-foreground">Verify the keys are set and the connection is live. Secrets stay in Supabase — they're never shown here.</p>
            </div>
          </div>
          <button onClick={check} disabled={loading} className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Test connection"}
          </button>
        </div>

        {status && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <StatusRow ok={status.stripe_ok} label="Stripe API" detail={status.stripe_ok ? (status.account || "Authenticated") : "Not reachable / key invalid"} />
            <StatusRow ok={status.secret_key} label="Secret key" detail={status.secret_key ? `Set${status.mode ? ` · ${status.mode} mode` : ""}` : "STRIPE_SECRET_KEY not set"} />
            <StatusRow ok={status.webhook_secret} label="Webhook secret" detail={status.webhook_secret ? "Set" : "STRIPE_WEBHOOK_SECRET not set"} />
            <StatusRow ok={status.price_tiers.length > 0} label="Price tiers" detail={status.price_tiers.length > 0 ? status.price_tiers.join(", ") : "No STRIPE_PRICE_AUTOLABELS_* set"} />
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground mb-3">Setup — set these in Supabase → Edge Functions → Secrets</h3>
        <ul className="space-y-2">
          {SECRETS.map((s) => (
            <li key={s.name} className="flex items-start gap-2.5">
              <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{s.name}</code>
              <span className="text-xs text-muted-foreground">{s.what}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-3">
          Create a Product + recurring Price per plan in Stripe, copy each <code className="font-mono">price_…</code> into the matching
          <code className="font-mono"> STRIPE_PRICE_AUTOLABELS_*</code> secret, then add a webhook endpoint pointing at your <code className="font-mono">stripe-webhook</code> function URL and copy its <code className="font-mono">whsec_…</code> into <code className="font-mono">STRIPE_WEBHOOK_SECRET</code>.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900">
          <p className="font-semibold">Autocurb is the billing authority.</p>
          <p className="mt-0.5">AutoLabels' <code className="font-mono">stripe-webhook</code> is a shadow ledger — it verifies the signature and records <code className="font-mono">billing_events</code> but does not flip entitlements. Paid-tier entitlements are written by Autocurb's webhook. Use the <span className="inline-flex items-center gap-1 font-semibold">Billing handshake <ShieldCheck className="w-3 h-3" /></span> tab to verify the handshake end to end.</p>
        </div>
      </div>

      <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
        Open Stripe webhooks dashboard <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
};

const StatusRow = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
  <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background p-2.5">
    <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${ok ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}`}>
      {ok ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <X className="w-4 h-4" strokeWidth={2.5} />}
    </span>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
      <p className="text-[11px] text-muted-foreground truncate">{detail}</p>
    </div>
  </div>
);

export default StripeConfigPanel;
