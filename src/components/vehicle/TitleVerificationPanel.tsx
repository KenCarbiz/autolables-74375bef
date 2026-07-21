import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ShieldCheck, ShieldAlert, Loader2, FileSearch, RefreshCw, CheckCircle2,
  AlertTriangle, Lock, Eye, XCircle, Gauge,
} from "lucide-react";
import type { TitleVerification } from "@/hooks/useVehicleListing";

// ──────────────────────────────────────────────────────────────────────
// TitleVerificationPanel — dealer-facing NMVTIS (National Motor Vehicle Title
// Information System) title check via MarketCheck VINData. Compliance-Pro only.
//
// The raw title record shown here is DEALER-INTERNAL. The customer passport
// never sees it — it only sees the dealer's attestation (Clean Title, verified
// date) that the dealer publishes from this panel after reviewing the record.
//
// A "Generate" is a paid pull (~$0.49) and the report is reusable for 90 days,
// so the panel loads any cached report for free first and only charges on an
// explicit Generate / Regenerate click.
// ──────────────────────────────────────────────────────────────────────

interface TitleSummary {
  status: "clean" | "branded" | "unknown";
  brandCount: number;
  junkCount: number;
  brands: { brand: string; description: string; state: string; date: string; severity: string }[];
  junkSalvage: { disposition: string; entity: string; date: string }[];
  latestTitle: { state: string; date: string; odometer: string; type: string } | null;
  highestOdometer: number | null;
  message: string;
  messageColor: string;
}

interface Props {
  listingId: string;
  vin: string | null;
  tenantId: string | null;
  condition: string | null;
  titleVerification: TitleVerification | null;
  enabled: boolean;             // Compliance-Pro entitlement
  onUpdated?: () => void;
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export const TitleVerificationPanel = ({ listingId, vin, tenantId, condition, titleVerification, enabled, onUpdated }: Props) => {
  const isNew = String(condition || "").toLowerCase() === "new";
  const [summary, setSummary] = useState<TitleSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"generate" | "refresh" | "attest" | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const load = useCallback(async () => {
    if (!vin || !tenantId || isNew) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.functions.invoke("marketcheck-title-report", { body: { vin, tenant_id: tenantId, action: "load" } });
    const d = data as { available?: boolean; summary?: TitleSummary; generatedAt?: string; expiresAt?: string; expired?: boolean } | null;
    if (d?.available && d.summary) {
      setSummary(d.summary); setGeneratedAt(d.generatedAt || null); setExpiresAt(d.expiresAt || null); setExpired(!!d.expired);
    } else { setSummary(null); }
    setLoading(false);
  }, [vin, tenantId, isNew]);

  useEffect(() => { load(); }, [load]);

  const pull = async (action: "generate" | "refresh") => {
    if (!vin || !tenantId) return;
    setBusy(action);
    const { data, error } = await supabase.functions.invoke("marketcheck-title-report", { body: { vin, tenant_id: tenantId, action } });
    setBusy(null);
    const d = data as { available?: boolean; summary?: TitleSummary; generatedAt?: string; expiresAt?: string; reason?: string; error?: string; note?: string } | null;
    if (error || d?.error === "plan_required") { toast.error("Title verification is a Compliance Pro feature."); return; }
    if (!d?.available) {
      if (d?.reason === "no_report") { toast.error(d?.note || "No report on file yet — generate one."); }
      else if (d?.error === "not_configured") { toast.error("VINData (NMVTIS) access is not configured on the API key."); }
      else { toast.error("Title report unavailable — try again shortly."); }
      return;
    }
    setSummary(d.summary || null); setGeneratedAt(d.generatedAt || null); setExpiresAt(d.expiresAt || null); setExpired(false);
    toast.success(action === "generate" ? "NMVTIS title report generated" : "Title report refreshed");
  };

  const attest = async (status: "clean" | "branded") => {
    if (!vin || !tenantId) return;
    setBusy("attest");
    const { data: ures } = await supabase.auth.getUser();
    const payload: TitleVerification = {
      status,
      verified_at: new Date().toISOString(),
      verified_by: ures?.user?.id ?? null,
      source: "nmvtis",
      report_generated_at: generatedAt,
      report_expires_at: expiresAt,
      brand_note: status === "branded" ? (summary?.brands.map((b) => b.brand).join(", ") || "Title brand on record") : null,
    };
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as unknown as { from: (t: string) => any })
      .from("vehicle_listings").update({ title_verification: payload }).eq("id", listingId);
    setBusy(null);
    if (error) { toast.error("Could not save attestation"); return; }
    toast.success(status === "clean" ? "Clean title published to the passport" : "Title brand recorded");
    onUpdated?.();
  };

  const clearAttestation = async () => {
    setBusy("attest");
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as unknown as { from: (t: string) => any })
      .from("vehicle_listings").update({ title_verification: null }).eq("id", listingId);
    setBusy(null);
    if (error) { toast.error("Could not remove from passport"); return; }
    toast.success("Removed from passport");
    onUpdated?.();
  };

  // New vehicles carry an MCO, not an NMVTIS title history — don't offer it.
  if (isNew) return null;

  const published = titleVerification?.status === "clean" || titleVerification?.status === "branded";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-blue-600" /> Title Verification (NMVTIS)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            National title record via VINData. Dealer-internal — the shopper only sees the clean-title attestation you publish.
          </p>
        </div>
        {enabled && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 ring-1 ring-blue-100 rounded-full px-2 py-1 shrink-0">Compliance Pro</span>
        )}
      </div>

      {!enabled ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-2.5">
          <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-muted-foreground">
            NMVTIS title verification is included with <span className="font-semibold text-foreground">Compliance Pro</span>. Upgrade to pull authoritative title, brand, and salvage records per VIN.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-3"><Loader2 className="w-4 h-4 animate-spin" /> Checking for a title record…</div>
      ) : (
        <div className="space-y-3">
          {/* Attestation banner — what the shopper currently sees */}
          {published && (
            <div className={`rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 ${titleVerification?.status === "clean" ? "bg-emerald-50 ring-1 ring-emerald-100" : "bg-amber-50 ring-1 ring-amber-100"}`}>
              <div className="flex items-center gap-2 min-w-0">
                {titleVerification?.status === "clean"
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
                <span className="text-[12.5px] font-semibold text-foreground truncate">
                  {titleVerification?.status === "clean" ? "Clean title" : "Title brand"} published to passport
                  {titleVerification?.verified_at ? ` · verified ${fmtDate(titleVerification.verified_at)}` : ""}
                </span>
              </div>
              <button onClick={clearAttestation} disabled={busy === "attest"} className="text-[11px] font-semibold text-muted-foreground hover:text-red-600 inline-flex items-center gap-1 shrink-0">
                <XCircle className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          )}

          {/* Report result */}
          {summary ? (
            <>
              <div className={`rounded-xl border p-3.5 ${summary.status === "clean" ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                <div className="flex items-center gap-2">
                  {summary.status === "clean"
                    ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    : <ShieldAlert className="w-5 h-5 text-amber-600" />}
                  <div>
                    <p className="text-[13.5px] font-bold text-foreground">
                      {summary.status === "clean" ? "No title brands on record" : `${summary.brandCount + summary.junkCount} title record${summary.brandCount + summary.junkCount === 1 ? "" : "s"} found`}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      NMVTIS · pulled {fmtDate(generatedAt)}{expiresAt ? ` · valid to ${fmtDate(expiresAt)}` : ""}{expired ? " · expired" : ""}
                    </p>
                  </div>
                </div>

                {(summary.brands.length > 0 || summary.junkSalvage.length > 0) && (
                  <ul className="mt-2.5 space-y-1.5">
                    {summary.brands.map((b, i) => (
                      <li key={`b-${i}`} className="text-[12px] text-foreground flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                        <span><span className="font-semibold">{b.brand}</span>{b.state ? ` · ${b.state}` : ""}{b.date ? ` · ${b.date}` : ""}{b.description ? ` — ${b.description}` : ""}</span>
                      </li>
                    ))}
                    {summary.junkSalvage.map((j, i) => (
                      <li key={`j-${i}`} className="text-[12px] text-foreground flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                        <span><span className="font-semibold">{j.disposition}</span>{j.entity ? ` · ${j.entity}` : ""}{j.date ? ` · ${j.date}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {showRaw && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-1 text-[11.5px] text-muted-foreground">
                    {summary.latestTitle && (
                      <p>Latest title: {summary.latestTitle.type || "—"} · {summary.latestTitle.state || "—"}{summary.latestTitle.date ? ` · ${summary.latestTitle.date}` : ""}</p>
                    )}
                    {summary.highestOdometer != null && (
                      <p className="inline-flex items-center gap-1"><Gauge className="w-3.5 h-3.5" /> Highest reported odometer: {summary.highestOdometer.toLocaleString()} mi</p>
                    )}
                    {summary.message && <p>{summary.message}</p>}
                  </div>
                )}
                <button onClick={() => setShowRaw((v) => !v)} className="mt-2 text-[11.5px] font-semibold text-blue-600 inline-flex items-center gap-1 hover:underline">
                  <Eye className="w-3.5 h-3.5" /> {showRaw ? "Hide record details" : "View record details"}
                </button>
              </div>

              {/* Dealer actions */}
              <div className="flex flex-wrap items-center gap-2">
                {!published && summary.status === "clean" && (
                  <button onClick={() => attest("clean")} disabled={busy === "attest"} className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {busy === "attest" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Mark Clean Title &amp; Publish
                  </button>
                )}
                {!published && summary.status === "branded" && (
                  <button onClick={() => attest("branded")} disabled={busy === "attest"} className="h-9 px-3.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                    {busy === "attest" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Record Title Brand
                  </button>
                )}
                <button onClick={() => pull(expired ? "generate" : "refresh")} disabled={!!busy} className="h-9 px-3 rounded-lg border border-border text-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:border-blue-400 disabled:opacity-60">
                  {busy === "refresh" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {expired ? "Regenerate ($0.49)" : "Refresh"}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
              <div className="flex items-start gap-2.5">
                <FileSearch className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-[12.5px] text-foreground font-medium">No title report on file for this VIN.</p>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">Pull the NMVTIS record to check for salvage, flood, lemon, and other brands. A new report costs about $0.49 and stays valid for 90 days.</p>
                </div>
              </div>
              <button onClick={() => pull("generate")} disabled={busy === "generate"} className="mt-3 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                {busy === "generate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Generate Title Report ($0.49)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TitleVerificationPanel;
