import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminNow } from "@/lib/admin/dataSource";
import { approveDedupePreview, getDedupePreview, type DedupePreview } from "@/lib/inventoryNetwork/api";
import { Al97Frame, Banner, Card, KeyVals, Savebar, useFixtureCopy, useNetFixture, type ScopePicker } from "@/components/admin/al97/al97ui";
import { useDedupeOverview } from "./DuplicateHandling";
import { useAct, useNet } from "./shared";

// Review exact reconciliation (AL97 14). Reads one existing preview
// (inv_dedupe_get_preview) and the controls. Approval goes only through
// inv_dedupe_approve with the pinned plan hash, and stays disabled while the
// emergency stop is engaged. Apply is never offered here.

export function approveBlocked(p: DedupePreview | null, emergencyStop: boolean | null, now: number): string | null {
  if (!p) return "The preview could not be read.";
  if (emergencyStop !== false) return emergencyStop ? "The emergency stop is engaged, so no plan can be approved." : "The safety controls could not be read.";
  if (p.status !== "pending") return `This preview is ${p.status}.`;
  if (Date.parse(p.expires_at) <= now) return "This preview has expired. Build a new one.";
  if (p.plan.disposition !== "eligible" || p.plan.action === "none") return "This plan needs a person's review and cannot be approved.";
  return null;
}

export default function ReconciliationReview({ scope, previewId, children }: { scope?: ScopePicker; previewId: string; children?: ReactNode }) {
  const fx = useNetFixture();
  const copy = useFixtureCopy();
  const now = useAdminNow();
  const { refresh } = useNet();
  const { act, busy } = useAct();
  const { data: overview } = useDedupeOverview();
  const q = useQuery({ queryKey: ["inv-net", "dedupe-preview", previewId], queryFn: () => getDedupePreview(previewId), enabled: !fx && !!previewId });
  const p = fx ? fx.dedupePreview ?? null : q.data ?? null;
  const stop = overview ? overview.controls.emergency_stop : null;
  const reason = approveBlocked(p, stop, now);
  const plan = p?.plan ?? null;

  const canonical = plan?.canonical_listing_id ?? null;
  const cs = canonical ? plan?.scores[canonical] : undefined;
  const cl = canonical ? plan?.listings.find((l) => l.id === canonical) : undefined;
  const redundant = plan?.redundant_listing_ids ?? [];
  const rs = redundant[0] ? plan?.scores[redundant[0]] : undefined;
  const ownership = plan && plan.reasons.some((r) => /store|tenant|owner|episode/.test(r)) ? "Needs review" : "Same tenant / confirmed store episode";
  const deps = !plan ? "Unknown" : plan.blocked_dependencies.length ? `${plan.blocked_dependencies.length} blocking` : rs && rs.unchecked > 0 ? "Fresh scan required" : rs ? "None found" : "Unknown";
  const mins = p ? Math.round((Date.parse(p.expires_at) - now) / 60000) : null;

  const main = !plan ? (
    <div className="work"><Banner tone="amber" icon="warning" title="Preview could not be read" detail="Nothing is shown as reviewed. Build a preview from Duplicate handling." /></div>
  ) : (
    <div className="work">
      {stop !== false
        ? <Banner tone="amber" icon="warning" title="Review only — Apply blocked by emergency stop" detail="Preserve the existing listing and attach the feed record. Never choose a canonical record from recency alone." />
        : <Banner tone="blue" icon="info" title="Review only — Apply is a separate step" detail="Preserve the existing listing and attach the feed record. Never choose a canonical record from recency alone." />}
      <div className="split">
        <div><div>
          <Card id="rr-keep" title="Keep established listing">
            <KeyVals rows={[
              ["Record", canonical ?? "Unknown"],
              ["Existing customer links", !cs ? "Unknown" : cs.published || cs.public_identity > 0 ? "Passport + QR retained" : "None found"],
              ["NeoVIN / MarketCheck", !cs ? "Unknown" : cs.evidence > 0 || cl?.market_value != null ? "Matching saved evidence retained" : "None saved"],
              ["Documents", !cs ? "Unknown" : cs.protected > 0 ? "Signed versions retained" : "None found"],
              ["Price", "No change"],
            ]} />
            <span className="chip blue">Canonical proposal</span>
          </Card>
        </div></div>
        <div><div>
          <Card id="rr-archive" title="Archive redundant listing">
            <KeyVals rows={[
              ["Record", redundant.length ? `${redundant[0]}${redundant.length > 1 ? ` +${redundant.length - 1}` : ""}` : "None"],
              ["Ownership", ownership],
              ["Dependencies", deps],
              ["Public alias", "Existing links resolve safely"],
              ["Deletion", "None"],
            ]} />
          </Card>
        </div></div>
      </div>
      <Card id="rr-plan" title="Exact plan">
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Domain</th><th scope="col">Proposed action</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              <tr><td>Feed association</td><td>{plan.inventory_id ? "LINK to established listing" : "None"}</td><td>{plan.inventory_id ? "Confirmed VIN + owner + episode" : "No current feed record"}</td></tr>
              <tr><td>Existing enrichment</td><td>KEEP matching saved data</td><td>Preserve provenance and freshness</td></tr>
              <tr><td>Conflicting attributes</td><td>{plan.conflicts.length ? "HOLD for manual choice" : "None found"}</td><td>Never overwrite silently</td></tr>
              <tr><td>Redundant listing</td><td>{redundant.length ? "ARCHIVE if dependencies permit" : "None"}</td><td>Reversible; no hard deletion</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
      <div className="review-meta">
        <span className="chip blue">Plan SHA-256 pinned</span>
        <span className="chip neutral">Base versions pinned</span>
        <span className={`chip ${mins != null && mins > 0 ? "neutral" : "amber"}`}>{mins != null && mins > 0 ? `Preview expires in ${mins} min` : "Preview expired"}</span>
        <p>Approval belongs to this exact plan. Any concurrent change invalidates it.</p>
      </div>
      <Savebar title={reason ? `Blocked: ${stop ? "emergency stop" : "not approvable"}` : "Ready for approval"}
        detail="Approval and Apply are separate. Production reconciliation requires explicit authorization."
        action={<><span id="rr-approve-reason" className="sr-only">{reason ?? ""}</span>
          <button type="button" className="btn primary" disabled={!!reason || busy} title={reason ?? undefined} aria-describedby={reason ? "rr-approve-reason" : undefined}
            onClick={() => p && void act(() => approveDedupePreview(p.id, p.plan_sha256).then((r) => { if (!r.approved) throw new Error(r.reason ?? "preview_stale"); return r; }), "Preview approved").then(refresh)}>Approve exact preview</button></>} />
    </div>
  );
  return (
    <Al97Frame crumb="Review exact reconciliation" title="Review exact reconciliation" subtitle={plan ? `${copy("dedupe.candidate", "Candidate")} · VIN ending ${plan.vin_suffix}` : "Preview unknown"}
      scope={scope} storeName={plan?.store_name ?? null} main={main}>{children}</Al97Frame>
  );
}
