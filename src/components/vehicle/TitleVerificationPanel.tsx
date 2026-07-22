import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ShieldCheck, ShieldAlert, Loader2, FileSearch, RefreshCw, CheckCircle2,
  AlertTriangle, Lock, Eye, XCircle, Gauge, Receipt, Info,
} from "lucide-react";
import type { TitleVerification } from "@/hooks/useVehicleListing";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ──────────────────────────────────────────────────────────────────────
// TitleVerificationPanel — dealer-facing NMVTIS title check via MarketCheck
// VINData. Compliance-Pro only.
//
// VINData terms compliance: VINData responses are NEVER persisted. The title
// record is fetched live and held only in this open panel for the session
// (state below) — nothing is written to our database. Re-viewing within 90 days
// uses the cheap provider-side access-report. What DOES persist is the dealer's
// own attestation (clean/branded + verified date), which is a dealership
// business record, not a VINData response. A required "as is" disclaimer and
// VINData attribution show whenever the record is displayed.
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

interface PullStats {
  monthCount: number;
  monthCost: number;
  totalCount: number;
  unitCost: number;
  lastGeneratedAt: string | null;
  withinWindow: boolean;
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
  const [summary, setSummary] = useState<TitleSummary | null>(null);   // session-only, never persisted
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"view" | "generate" | "attest" | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [stats, setStats] = useState<PullStats | null>(null);
  // Null = closed; boolean = the fetchRecord(force) arg to run after the dealer
  // confirms a charged ($0.49) generate. Required by the VINData usage rules:
  // never charge without an explicit confirmation.
  const [confirmForce, setConfirmForce] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!vin || !tenantId || isNew) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.functions.invoke("marketcheck-title-report", { body: { vin, tenant_id: tenantId, action: "load" } });
    const d = data as { stats?: PullStats } | null;
    if (d?.stats) setStats(d.stats);
    setLoading(false);
  }, [vin, tenantId, isNew]);

  useEffect(() => { load(); }, [load]);

  // Fetch the record live for this session. Prefer the cheap access-report when
  // a report was generated in the last 90 days; otherwise a paid generate.
  const fetchRecord = async (forceGenerate = false) => {
    if (!vin || !tenantId) return;
    const action = forceGenerate || !stats?.withinWindow ? "generate" : "view";
    setBusy(action === "generate" ? "generate" : "view");
    const { data, error } = await supabase.functions.invoke("marketcheck-title-report", { body: { vin, tenant_id: tenantId, action } });
    setBusy(null);
    const d = data as { available?: boolean; summary?: TitleSummary; checkedAt?: string; reason?: string; error?: string; note?: string; stats?: PullStats } | null;
    if (d?.stats) setStats(d.stats);
    if (error || d?.error === "plan_required") { toast.error("Title verification is a Compliance Pro feature."); return; }
    if (!d?.available) {
      if (d?.reason === "no_report") { toast.error(d?.note || "No report on file yet — generate one."); }
      else if (d?.error === "not_configured") { toast.error("VINData (NMVTIS) access is not configured on the API key."); }
      else { toast.error("Title record unavailable — try again shortly."); }
      return;
    }
    setSummary(d.summary || null); setCheckedAt(d.checkedAt || null);
    if (action === "generate") toast.success("NMVTIS title record retrieved");
  };

  const attest = async (status: "clean" | "branded") => {
    if (!vin || !tenantId) return;
    setBusy("attest");
    const { data: ures } = await supabase.auth.getUser();
    // Store the dealer's own conclusion only — NOT VINData response data.
    const payload: TitleVerification = {
      status,
      verified_at: new Date().toISOString(),
      verified_by: ures?.user?.id ?? null,
      source: "nmvtis",
      report_generated_at: checkedAt,
      report_expires_at: null,
      brand_note: status === "branded" ? "Title brand on record (reviewed in the NMVTIS title record)" : null,
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

      {enabled && stats && (
        <div className="mb-3 -mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Receipt className="w-3.5 h-3.5 shrink-0" />
          <span>
            <span className="font-semibold text-foreground tabular-nums">{stats.monthCount}</span> report{stats.monthCount === 1 ? "" : "s"} generated this month
            {stats.monthCost > 0 ? ` · ~$${stats.monthCost.toFixed(2)}` : ""}
            {" · "}<span className="tabular-nums">{stats.totalCount}</span> all-time
          </span>
        </div>
      )}

      {!enabled ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-2.5">
          <Lock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-muted-foreground">
            NMVTIS title verification is included with <span className="font-semibold text-foreground">Compliance Pro</span>. Upgrade to pull authoritative title, brand, and salvage records per VIN.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-3"><Loader2 className="w-4 h-4 animate-spin" /> Loading title status…</div>
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

          {/* Live record — session only, never stored */}
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
                    <p className="text-[11.5px] text-muted-foreground">NMVTIS · retrieved {fmtDate(checkedAt)} · shown for this session only</p>
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

              {/* Required NMVTIS / VINData disclaimer + attribution (shown with the record) */}
              <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p>
                    NMVTIS provides title and brand history but does not include detailed repair history. Data may be incomplete &mdash; reporting timeframes and state participation vary, and significant damage may not appear unless it resulted in a total-loss report or a state title brand. This is not a substitute for an independent inspection.
                  </p>
                  <p>Title data provided by VINData, LLC via MarketCheck (NMVTIS).</p>
                </div>
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
                <button onClick={() => setConfirmForce(true)} disabled={!!busy} className="h-9 px-3 rounded-lg border border-border text-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:border-blue-400 disabled:opacity-60">
                  {busy === "generate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Regenerate ($0.49)
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
              <div className="flex items-start gap-2.5">
                <FileSearch className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-[12.5px] text-foreground font-medium">
                    {stats?.withinWindow ? "A title record is on file for this VIN." : "No title record pulled yet for this VIN."}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5">
                    {stats?.withinWindow
                      ? `Retrieve it to check for salvage, flood, lemon, and other brands. Re-viewing within 90 days is free${stats.lastGeneratedAt ? ` (last generated ${fmtDate(stats.lastGeneratedAt)})` : ""}.`
                      : "Pull the NMVTIS record to check for salvage, flood, lemon, and other brands. A new report costs about $0.49 and stays retrievable for 90 days."}
                  </p>
                </div>
              </div>
              <button onClick={() => stats?.withinWindow ? fetchRecord(false) : setConfirmForce(false)} disabled={busy === "view" || busy === "generate"} className="mt-3 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                {(busy === "view" || busy === "generate") ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {stats?.withinWindow ? "View Title Record" : "Generate Title Report ($0.49)"}
              </button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmForce !== null} onOpenChange={(o) => { if (!o) setConfirmForce(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a new NMVTIS title report?</AlertDialogTitle>
            <AlertDialogDescription>
              This pulls a fresh report from VINData and costs about <span className="font-semibold text-foreground">$0.49</span>. The report then stays retrievable at no additional charge for 90 days. Only continue if you need a new report.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const f = confirmForce ?? false; setConfirmForce(null); fetchRecord(f); }}
              className="bg-blue-600 hover:bg-blue-700">
              Generate ($0.49)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TitleVerificationPanel;
