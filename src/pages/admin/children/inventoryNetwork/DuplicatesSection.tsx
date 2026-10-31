import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, InlineNote, KeyValueList, LocalTabs, Panel, QueryState, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  applyDedupePreview, approveDedupePreview, checkDedupePurge, createDedupePreview, dedupeIdempotencyKey, explainError, getDedupeOverview, getDedupePreview,
  getDedupeRecoveryPlan, revealDedupeVin, runDedupeScan, setDedupeControls, setDedupeStorePause, undoDedupeOperation,
  type DedupeCandidate, type DedupeDisposition, type DedupeKind, type DedupeOperation, type DedupeOverview, type DedupePreview, type DedupeRecoveryPlan, type DedupeVerb,
} from "@/lib/inventoryNetwork/api";
import { cn } from "@/lib/utils";
import { humanize, inputClass, shortId, useAct, useNet, when } from "./shared";

type Tab = "candidates" | "review" | "reconciled" | "purge" | "history";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "candidates", label: "Candidates" },
  { key: "review", label: "Needs review" },
  { key: "reconciled", label: "Reconciled / archived" },
  { key: "purge", label: "Purge eligible" },
  { key: "history", label: "Operation history" },
];

const KIND_LABEL: Record<DedupeKind, string> = {
  duplicate_listings: "Duplicate active listings",
  unlinked_inventory: "Feed vehicle not linked to its listing",
  archived_episode: "Live vehicle with an archived listing",
  broken_link: "One-way inventory link",
  cross_tenant: "Same VIN in another account",
  store_identity: "Store ownership conflict",
};
const ACTION_LABEL: Record<string, string> = { archive_redundant: "Keep one listing, link, archive the rest", link_inventory: "Link feed vehicle to listing", none: "No automatic action" };

const REASON_LABEL: Record<string, string> = {
  store_unknown: "The owning store is unknown.",
  store_inactive: "The store is inactive.",
  store_mapping_not_approved: "The store has no approved feed mapping.",
  store_paused: "Duplicate handling is paused for this store.",
  vin_active_in_another_tenant: "The VIN is active in another account. Accounts are never merged.",
  open_store_transfer_conflict: "A transfer between stores is open for this VIN.",
  no_longer_duplicated: "Only one active listing remains.",
  no_live_inventory_episode: "No current feed record for this vehicle.",
  legacy_listing_ownership_unverified: "A legacy listing has no verified store owner.",
  listing_owned_by_other_store: "A listing belongs to a different store (a transfer, not a duplicate).",
  prior_episode_deal_recorded: "A listing went through a deal, so it may be an earlier sale of this car.",
  dependency_unchecked: "A related table could not be checked.",
  redundant_has_protected_history: "The record that would be archived holds documents, signatures or customer history.",
  redundant_has_public_identity: "The record that would be archived has a public Passport, QR code or shopper activity.",
  redundant_has_active_documents: "The record that would be archived has active stickers or descriptions.",
  enrichment_only_on_redundant: "Provider data exists only on the record that would be archived.",
  field_conflict: "The records disagree on identity fields.",
  already_linked: "The feed vehicle is already linked.",
  no_active_listing: "There is no active listing to link.",
  multiple_active_listings: "More than one active listing exists.",
  listing_linked_to_other_episode: "The listing is linked to a different inventory record.",
  archived_listing_for_live_inventory: "The car is in today's feed but its listing is archived. Restoring publishes a Passport and the archive may mark a real sale.",
  non_reciprocal_inventory_link: "The feed record and the listing do not point at each other.",
  cross_tenant_never_merged: "Records in different accounts are never merged.",
  duplicate_store_ownership_unresolved: "Two stores claim the same feed identity.",
};
const reasonText = (r: string) => REASON_LABEL[r] ?? humanize(r);

const DISPOSITION: Record<DedupeDisposition, { label: string; tone: Tone }> = {
  eligible: { label: "Ready for preview", tone: "info" },
  needs_review: { label: "Needs review", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
};
const VERB_STYLE: Record<DedupeVerb, string> = {
  KEEP: "border-adm-primary text-adm-primary",
  LINK: "border-adm-primary text-adm-primary",
  PRESERVE: "border-adm-muted text-adm-ink",
  ARCHIVE: "border-adm-warning text-[#5F3F00] bg-adm-warning-bg",
  BLOCKED: "border-adm-danger text-adm-danger bg-adm-danger-bg",
};
const Verb = ({ verb }: { verb: DedupeVerb }) => (
  <span className={cn("inline-flex min-w-[84px] justify-center rounded-[2px] border px-2 py-[3px] text-[12px] font-bold tracking-wide", VERB_STYLE[verb])}>{verb}</span>
);

function vehicleLabel(c: DedupeCandidate) {
  const v = c.vehicle;
  const name = v ? [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") : c.listing_ymm;
  return name || "Vehicle details unavailable";
}

function VinCell({ c }: { c: DedupeCandidate }) {
  const [full, setFull] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="whitespace-nowrap font-mono text-[13px]">
      {full ?? `...${c.vin_suffix}`}
      {!full && (
        <button type="button" className="ml-2 font-sans text-[12px] text-adm-primary underline-offset-2 hover:underline" onClick={() => revealDedupeVin(c.id).then(setFull, (e) => setErr(explainError(e)))}>
          Show full VIN
        </button>
      )}
      {err && <span className="block font-sans text-[12px] text-adm-danger">{err}</span>}
    </span>
  );
}

function ControlsPanel({ data }: { data: DedupeOverview }) {
  const { stores, groupId } = useNet();
  const { act, busy } = useAct();
  const [reason, setReason] = useState("");
  const c = data.controls;
  const paused = new Map(data.store_controls.map((s) => [s.store_id, s]));
  const reasonOk = reason.trim().length >= 3;
  return (
    <Panel title="Safety controls" description={`Policy ${data.policy_version}. Every change needs a reason and is written to the change log.`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <KeyValueList divided rows={[
          { label: "Detection", value: c.detection_enabled ? <StatusText tone="info">On</StatusText> : <StatusText tone="warning">Off</StatusText> },
          { label: "Automatic reconciliation", value: <span><StatusText tone="neutral">Off</StatusText><span className="ml-2 text-[12px] text-adm-muted">{c.limits_approved_at ? "Limits approved" : "Needs owner-approved limits before it can be turned on"}</span></span> },
          { label: "Permanent purge", value: <span><StatusText tone="neutral">Off</StatusText><span className="ml-2 text-[12px] text-adm-muted">Not available: no approved retention policy</span></span> },
          { label: "Emergency stop", value: c.emergency_stop ? <StatusText tone="danger">Stopped</StatusText> : <StatusText tone="neutral">Not engaged</StatusText> },
          { label: "Proposed limits", value: <span className="text-[13px]">{c.max_sets_per_run} sets per run, {c.max_store_share_pct}% of a store's active stock, {c.max_unresolved_conflicts} open conflicts, {c.max_failures} failure, previews last {c.preview_ttl_minutes} min, approvals {c.approval_ttl_minutes} min. <span className="text-adm-muted">{c.limits_approved_at ? `Approved ${when(c.limits_approved_at)}` : "Not yet approved by the owner."}</span></span> },
        ]} />
        <div className="space-y-3">
          <div>
            <label htmlFor="dedupe-reason" className="mb-1 block text-[13px] font-semibold text-adm-ink">Reason for a control change</label>
            <input id="dedupe-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required, at least 3 characters" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={c.emergency_stop ? "secondary" : "danger"} disabled={busy || !reasonOk}
              onClick={() => act(() => setDedupeControls({ emergency_stop: !c.emergency_stop }, reason), c.emergency_stop ? "Emergency stop cleared" : "Emergency stop engaged").then(() => setReason(""))}>
              {c.emergency_stop ? "Clear emergency stop" : "Engage emergency stop"}
            </Button>
            <Button size="sm" disabled={busy || !reasonOk} onClick={() => act(() => setDedupeControls({ detection_enabled: !c.detection_enabled }, reason), c.detection_enabled ? "Detection turned off" : "Detection turned on").then(() => setReason(""))}>
              {c.detection_enabled ? "Turn detection off" : "Turn detection on"}
            </Button>
          </div>
          <ul className="space-y-2" aria-label="Per-store pause">
            {stores.map((s) => {
              const p = paused.get(s.store.id);
              return (
                <li key={s.store.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-adm-border pb-2 text-[14px]">
                  <span className="font-medium">{s.store.display_name}{p?.paused && <StatusText tone="warning" className="ml-2">Paused</StatusText>}</span>
                  <Button size="sm" variant="ghost" disabled={busy || !reasonOk} onClick={() => act(() => setDedupeStorePause(s.store.id, !p?.paused, reason), `${s.store.display_name}: duplicate handling ${p?.paused ? "resumed" : "paused"}`)}>
                    {p?.paused ? "Resume store" : "Pause store"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-adm-muted">Group {shortId(groupId)}. An empty feed, a missing vehicle or a provider failure never archives or deletes inventory.</p>
        </div>
      </div>
    </Panel>
  );
}

function CandidateTable({ rows, onPreview, busy }: { rows: DedupeCandidate[]; onPreview: (c: DedupeCandidate) => void; busy: boolean }) {
  return (
    <WorkTable caption="Duplicate candidates" minWidth={1100}>
      <thead><tr><Th>Store and vehicle</Th><Th>VIN</Th><Th>Finding</Th><Th>Recommendation</Th><Th>Status</Th><Th>Why</Th><Th>Last checked</Th><Th align="right">Action</Th></tr></thead>
      <tbody>{rows.map((c) => (
        <tr key={c.id}>
          <Td><span className="font-semibold">{vehicleLabel(c)}</span><span className="block text-[12px] text-adm-muted">{c.store_name ?? "Store unknown"}{c.vehicle?.stock_number ? `, stock ${c.vehicle.stock_number}` : ""}</span></Td>
          <Td><VinCell c={c} /></Td>
          <Td>{KIND_LABEL[c.kind]}<span className="block text-[12px] text-adm-muted">{c.summary.listing_count ?? 0} listing record{c.summary.listing_count === 1 ? "" : "s"}</span></Td>
          <Td className="text-[13px]">{ACTION_LABEL[c.summary.action ?? "none"] ?? humanize(c.summary.action)}</Td>
          <Td><StatusText tone={DISPOSITION[c.disposition].tone}>{DISPOSITION[c.disposition].label}</StatusText></Td>
          <Td className="max-w-[340px] text-[13px]">{c.reasons.length === 0 ? "Every automatic rule is satisfied." : <ul className="list-disc pl-4">{c.reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul>}</Td>
          <Td className="whitespace-nowrap text-[13px]">{when(c.last_checked_at)}</Td>
          <Td align="right"><Button size="sm" variant={c.disposition === "eligible" ? "primary" : "secondary"} disabled={busy} onClick={() => onPreview(c)}>Build preview</Button></Td>
        </tr>
      ))}</tbody>
    </WorkTable>
  );
}

function PreviewPanel({ previewId, onClose }: { previewId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { stores } = useNet();
  const { act, busy } = useAct();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["inv-net", "dedupe-preview", previewId], queryFn: () => getDedupePreview(previewId) });
  const reload = () => qc.invalidateQueries({ queryKey: ["inv-net"] });
  if (q.isLoading || q.isError || !q.data) {
    return <Panel title="Preview"><QueryState status={q.isLoading ? "loading" : "error"} errorTitle="Could not load this preview" errorDetail={q.error ? explainError(q.error) : undefined} onRetry={() => q.refetch()}>{null}</QueryState></Panel>;
  }
  const p: DedupePreview = q.data;
  const plan = p.plan;
  const expired = new Date(p.expires_at).getTime() <= Date.now();
  const canApprove = p.status === "pending" && plan.disposition === "eligible" && plan.action !== "none" && !expired;
  const canApply = p.status === "approved" && !!p.approval_expires_at && new Date(p.approval_expires_at).getTime() > Date.now();
  const listingName = (id: string | null | undefined) => {
    if (!id) return "None";
    const l = plan.listings.find((x) => x.id === id);
    return l ? `${shortId(id)} (${l.status}${l.slug ? `, /v/${l.slug}` : ""})` : shortId(id);
  };

  return (
    <Panel
      title={`Preview ${shortId(p.id)}: ${KIND_LABEL[plan.kind]}`}
      description={`${plan.store_name ?? "Store unknown"}, VIN ending ${plan.vin_suffix}. Generated ${when(plan.generated_at)}; expires ${when(p.expires_at)}. Hash ${p.plan_sha256.slice(0, 12)}. Approval applies to this exact preview only.`}
      action={<Button size="sm" variant="ghost" onClick={onClose}>Close preview</Button>}
    >
      <div className="space-y-5">
        {p.status === "invalidated" && <InlineNote tone="warning" title="This preview is no longer valid">{humanize(p.status_reason)}. Run detection again and build a new preview.</InlineNote>}
        {p.status === "applied" && <InlineNote tone="info" title="Applied">Operation {shortId(p.applied_operation_id)}. See Operation history to review or undo it.</InlineNote>}
        {plan.disposition !== "eligible" && (
          <InlineNote tone={plan.disposition === "blocked" ? "danger" : "warning"} title={plan.disposition === "blocked" ? "Blocked: no automatic action" : "Needs a person's review"}>
            <ul className="list-disc pl-4">{plan.reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul>
          </InlineNote>
        )}

        <section aria-labelledby="dedupe-decisions">
          <h3 id="dedupe-decisions" className="mb-2 text-[15px] font-semibold">What happens to each record</h3>
          <ul className="divide-y divide-adm-border rounded-[4px] border border-adm-border">
            {plan.decisions.map((d, i) => (
              <li key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                <Verb verb={d.verb} />
                <div className="min-w-0 text-[14px]">
                  <span className="break-words font-semibold">{d.record === "vehicle_listings" ? `Listing ${listingName(d.id)}` : d.record === "store_inventory" ? `Feed record ${shortId(d.id)}` : "Documents and history"}</span>
                  <p className="text-adm-muted">{d.why}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {plan.listings.length > 0 && (
          <section aria-labelledby="dedupe-records">
            <h3 id="dedupe-records" className="mb-2 text-[15px] font-semibold">Records compared</h3>
            <WorkTable caption="Listing records in this set" minWidth={900}>
              <thead><tr><Th>Listing</Th><Th>Owner store</Th><Th>Source</Th><Th>Public identity</Th><Th>Protected history</Th><Th>Evidence</Th><Th>Market value</Th><Th>Created</Th></tr></thead>
              <tbody>{plan.listings.map((l) => {
                const s = plan.scores[l.id];
                return (
                  <tr key={l.id}>
                    <Td className="break-words font-medium">{listingName(l.id)}</Td>
                    <Td>{l.owning_store_id ? stores.find((s) => s.store.id === l.owning_store_id)?.store.display_name ?? `Store ${shortId(l.owning_store_id)}` : <span className="text-adm-muted">Not verified</span>}</Td>
                    <Td>{humanize(l.feed_source) || "Unknown"}</Td>
                    <Td>{s ? (s.published || s.public_identity > 0 ? `Yes${s.public_identity ? ` (${s.public_identity} links or visits)` : ""}` : "None found") : "Not scored"}</Td>
                    <Td>{s ? (s.protected > 0 ? `${s.protected} record${s.protected === 1 ? "" : "s"}` : "None found") : "Not scored"}</Td>
                    <Td>{s ? (s.evidence > 0 ? `${s.evidence} record${s.evidence === 1 ? "" : "s"}` : "None found") : "Not scored"}{s && s.unchecked > 0 && <span className="block text-[12px] text-adm-danger">{s.unchecked} tables unchecked</span>}</Td>
                    <Td>{l.market_value === null ? "Missing" : `$${Number(l.market_value).toLocaleString()}`}{l.market_checked_at && <span className="block text-[12px] text-adm-muted">observed {when(l.market_checked_at)}</span>}</Td>
                    <Td className="whitespace-nowrap">{when(l.created_at)}</Td>
                  </tr>
                );
              })}</tbody>
            </WorkTable>
          </section>
        )}

        <section aria-labelledby="dedupe-domains">
          <h3 id="dedupe-domains" className="mb-2 text-[15px] font-semibold">Effective values by domain</h3>
          <p className="mb-2 text-[13px] text-adm-muted">Values are not copied between records. Each domain names its authority and keeps its observation date; raw source records stay where they are.</p>
          <WorkTable caption="Field authority" minWidth={760}>
            <thead><tr><Th>Domain</Th><Th>Authority</Th><Th>Effective source</Th><Th>Value or state</Th></tr></thead>
            <tbody>{plan.domains.map((d) => (
              <tr key={d.domain}>
                <Td className="font-medium">{humanize(d.domain)}</Td>
                <Td className="text-[13px]">{d.authority}</Td>
                <Td className="text-[13px]">{d.effective_source}</Td>
                <Td className="text-[13px]">{describeDomain(d)}</Td>
              </tr>
            ))}</tbody>
          </WorkTable>
        </section>

        {plan.conflicts.length > 0 && (
          <InlineNote tone="warning" title="Conflicts held for review">
            <ul className="list-disc pl-4">{plan.conflicts.map((c, i) => <li key={i}>{humanize(c.field)}: kept "{String(c.canonical)}" vs "{String(c.redundant)}" ({c.rule})</li>)}</ul>
          </InlineNote>
        )}
        {plan.blocked_dependencies.length > 0 && (
          <InlineNote tone="danger" title="Dependencies on the record that would be archived">
            <ul className="list-disc pl-4">{plan.blocked_dependencies.map((d, i) => <li key={i}>{d.label}: {d.count === null ? "could not be checked" : d.count}</li>)}</ul>
          </InlineNote>
        )}

        <KeyValueList divided rows={[
          { label: "Expected changes", value: Object.keys(plan.expected_counts).length === 0 ? "None" : Object.entries(plan.expected_counts).map(([k, v]) => `${humanize(k)}: ${v}`).join("; ") },
          { label: "Provider calls", value: `${plan.provider_calls} (reconciliation never calls a paid provider)` },
          { label: "Storage operations", value: `${plan.storage_operations} (no stored file is moved or deleted)` },
          { label: "Fingerprint", value: <span className="break-all font-mono text-[12px]">{plan.fingerprint}</span> },
        ]} />

        <div className="flex flex-wrap gap-2">
          {canApprove && <Button variant="primary" disabled={busy} onClick={() => act(() => approveDedupePreview(p.id, p.plan_sha256).then((r) => { if (!r.approved) throw new Error(r.reason ?? "preview_stale"); return r; }), "Preview approved").then(reload)}>Approve this exact preview</Button>}
          {canApply && <Button variant="primary" disabled={busy} onClick={() => setConfirm(true)}>Apply</Button>}
          {p.status === "pending" && !canApprove && <span className="self-center text-[13px] text-adm-muted">{expired ? "This preview has expired." : "This preview cannot be approved."}</span>}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="rounded-[6px]">
          <DialogHeader>
            <DialogTitle>Apply reconciliation for VIN ending {plan.vin_suffix}?</DialogTitle>
            <DialogDescription>
              The server re-checks every record first. If anything changed since this preview, nothing is applied. Archived records are kept, aliased and can be restored while they are unchanged. Nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-[14px]">
            {plan.decisions.filter((d) => d.verb === "ARCHIVE" || d.verb === "LINK").map((d, i) => <li key={i}>{d.verb === "ARCHIVE" ? `Archive listing ${listingName(d.id)}` : `Link feed record ${shortId(d.id)} to listing ${listingName(plan.canonical_listing_id)}`}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => {
              setConfirm(false);
              act(() => applyDedupePreview(p.id, dedupeIdempotencyKey("apply", p.id)).then((r) => { if (!r.applied && !r.replayed) throw new Error(r.reason ?? "not_applied"); return r; }), "Reconciliation applied").then(reload);
            }}>Apply reconciliation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function describeDomain(d: Record<string, unknown>): string {
  if (d.domain === "feed_fields") {
    const parts = [d.stock_number ? `stock ${d.stock_number}` : "stock missing", d.mileage === null || d.mileage === undefined ? "mileage missing" : `${Number(d.mileage).toLocaleString()} mi`,
      typeof d.feed_price === "number" ? `feed price $${d.feed_price.toLocaleString()}` : String(d.feed_price ?? "feed price missing")];
    return parts.join(", ") + (d.observed_at ? `; seen ${when(String(d.observed_at))}` : "");
  }
  if (d.domain === "market_value") return d.value === null || d.value === undefined ? "Missing" : `$${Number(d.value).toLocaleString()}, ${String(d.freshness)}${d.observed_at ? `, observed ${when(String(d.observed_at))}` : ""}`;
  if ("present" in d) return d.present ? "Present on the kept listing" : "Missing (refresh stays a separate, disabled workflow)";
  if ("observed_at" in d) return d.observed_at ? `Checked ${when(String(d.observed_at))}` : "Not checked";
  if ("value" in d) return d.value === null || d.value === undefined ? "Missing" : String(d.value);
  return "No change";
}

function RecoveryRow({ op }: { op: DedupeOperation }) {
  const { act, busy } = useAct();
  const [plan, setPlan] = useState<DedupeRecoveryPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reversibleKind = op.kind === "apply" && op.status === "applied" && !op.undone;
  return (
    <tr>
      <Td className="whitespace-nowrap">{when(op.created_at)}</Td>
      <Td>{op.kind === "undo" ? `Undo of ${shortId(op.undo_of)}` : humanize(op.action) || "Apply"}</Td>
      <Td className="font-mono text-[13px]">...{op.vin_suffix}</Td>
      <Td><StatusText tone={op.status === "applied" ? "info" : op.status === "rejected" ? "warning" : "danger"}>{op.status}</StatusText>{op.reason && <span className="block text-[12px] text-adm-muted">{humanize(op.reason)}</span>}{op.undone && <span className="block text-[12px] text-adm-muted">Undone</span>}</Td>
      <Td className="text-[13px]">{op.batch_id ? `Batch ${shortId(op.batch_id)}` : "Single set"}<span className="block text-adm-muted">Operation {shortId(op.id)}</span></Td>
      <Td align="right">
        {reversibleKind && !plan && <Button size="sm" disabled={busy} onClick={() => getDedupeRecoveryPlan(op.id).then(setPlan, (e) => setErr(explainError(e)))}>Review recovery</Button>}
        {plan && plan.reversible && plan.plan_sha256 && (
          <Button size="sm" disabled={busy} onClick={() => act(() => undoDedupeOperation(op.id, plan.plan_sha256!, dedupeIdempotencyKey("undo", op.id)).then((r) => { if (!r.undone) throw new Error(r.reason ?? "not_reversible"); return r; }), "Reconciliation undone")}>
            Undo (reversible)
          </Button>
        )}
        {plan && !plan.reversible && (
          <span className="block max-w-[320px] text-left text-[12px] text-adm-danger">
            Records changed since this reconciliation, so a blind undo is refused. Changed: {(plan.changed_since ?? []).map((c) => `${c.record} ${shortId(c.id)} (${c.changed_fields.join(", ")})`).join("; ") || humanize(plan.reason)}.
          </span>
        )}
        {err && <span className="block text-[12px] text-adm-danger">{err}</span>}
      </Td>
    </tr>
  );
}

function PurgeTab({ data }: { data: DedupeOverview }) {
  const [results, setResults] = useState<Record<string, { eligible: boolean; reasons: string[] } | string>>({});
  return (
    <Panel title="Purge eligible" description="Permanent purge is a separate, irreversible decision and is not available.">
      <div className="space-y-4">
        <InlineNote tone="danger" title="Permanent purge is off and cannot be turned on here">
          It needs a separate platform-admin permission, an approved retention policy, a fresh dependency scan, an exact preview and verified recovery. Archived duplicates stay archived. Deleting a listing would cascade to its QR codes, documents and source records.
        </InlineNote>
        {data.reconciled.length === 0 ? <EmptyState title="No archived duplicates" compact /> : (
          <WorkTable caption="Archived duplicates and purge checks" minWidth={700}>
            <thead><tr><Th>Archived listing</Th><Th>Kept listing</Th><Th>VIN</Th><Th>Purge check</Th><Th align="right">Action</Th></tr></thead>
            <tbody>{data.reconciled.filter((a) => !a.retired_at).map((a) => {
              const r = results[a.alias_listing_id];
              return (
                <tr key={a.alias_listing_id}>
                  <Td>{shortId(a.alias_listing_id)}</Td><Td>{shortId(a.canonical_listing_id)}</Td><Td className="font-mono text-[13px]">...{a.vin_suffix}</Td>
                  <Td className="text-[13px]">{!r ? "Not checked" : typeof r === "string" ? <span className="text-adm-danger">{r}</span> : `Not eligible: ${r.reasons.map(humanize).join(", ")}`}</Td>
                  <Td align="right"><Button size="sm" onClick={() => checkDedupePurge(a.alias_listing_id).then((x) => setResults((m) => ({ ...m, [a.alias_listing_id]: x })), (e) => setResults((m) => ({ ...m, [a.alias_listing_id]: explainError(e) })))}>Check eligibility</Button></Td>
                </tr>
              );
            })}</tbody>
          </WorkTable>
        )}
      </div>
    </Panel>
  );
}

export default function DuplicatesSection() {
  const { groupId, href } = useNet();
  const { act, busy } = useAct();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get("dtab"))?.key ?? "candidates") as Tab;
  const previewId = params.get("preview");
  const q = useQuery({ queryKey: ["inv-net", "dedupe", groupId], queryFn: () => getDedupeOverview(groupId) });
  const setPreview = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set("preview", id); else n.delete("preview"); return n; });

  const build = (c: DedupeCandidate) => act(() => createDedupePreview(c.id), "Preview built").then((r) => { if (r.ok) setPreview(r.value.preview_id); });

  if (q.isLoading || q.isError || !q.data) {
    return <Panel title="Duplicate handling"><QueryState status={q.isLoading ? "loading" : "error"} errorTitle="Could not load duplicate handling" errorDetail={q.error ? explainError(q.error) : undefined} onRetry={() => q.refetch()}>{null}</QueryState></Panel>;
  }
  const d = q.data;
  const eligible = d.candidates.filter((c) => c.disposition === "eligible");
  const review = d.candidates.filter((c) => c.disposition !== "eligible");
  const active = d.reconciled.filter((a) => !a.retired_at);

  return (
    <div className="space-y-4">
      <Panel
        title="Duplicate handling"
        description="Detect, preview, approve, then reconcile. Reconciliation keeps the established listing, links the feed record to it and archives only confirmed redundant listings. It never deletes, never calls a paid provider and never changes prices."
        action={<Button variant="primary" disabled={busy || !d.controls.detection_enabled} onClick={() => act(() => runDedupeScan(groupId), "Detection finished")}>Run detection</Button>}
      >
        <p className="text-[14px]">
          Last checked: <span className="font-semibold">{d.last_checked_at ? when(d.last_checked_at) : "Never"}</span>.
          {" "}{eligible.length} ready for preview, {review.length} need review or are blocked, {active.length} archived as duplicates.
        </p>
        {d.controls.emergency_stop && <InlineNote className="mt-3" tone="danger" title="Emergency stop is engaged">No reconciliation will be applied until it is cleared.</InlineNote>}
      </Panel>

      <LocalTabs label="Duplicate handling views" tabs={TABS.map((t) => ({
        key: t.key, active: tab === t.key, to: href("duplicates", { dtab: t.key }),
        label: t.label, count: t.key === "candidates" ? eligible.length : t.key === "review" ? review.length : t.key === "reconciled" ? active.length : t.key === "history" ? d.operations.length : null,
      }))} />

      {previewId && <PreviewPanel previewId={previewId} onClose={() => setPreview(null)} />}

      {tab === "candidates" && (
        <Panel title="Candidates" description="Sets that satisfy every automatic rule. Each still needs an exact preview and an approval." flush>
          {eligible.length === 0 ? <EmptyState title="No candidates ready" detail="Run detection to check current records. Sets that need a person's decision are under Needs review." compact /> : <CandidateTable rows={eligible} onPreview={build} busy={busy} />}
        </Panel>
      )}
      {tab === "review" && (
        <Panel title="Needs review" description="Findings that a rule keeps out of automatic reconciliation. Previews show why; resolve these outside this flow." flush>
          {review.length === 0 ? <EmptyState title="Nothing needs review" compact /> : <CandidateTable rows={review} onPreview={build} busy={busy} />}
        </Panel>
      )}
      {tab === "reconciled" && (
        <Panel title="Reconciled / archived" description="Archived duplicates keep their history and point to the listing that replaced them. A later import resolves to the kept listing." flush>
          {d.reconciled.length === 0 ? <EmptyState title="Nothing reconciled yet" compact /> : (
            <WorkTable caption="Reconciled listings" minWidth={760}>
              <thead><tr><Th>Archived listing</Th><Th>Replaced by</Th><Th>VIN</Th><Th>Operation</Th><Th>When</Th><Th>State</Th></tr></thead>
              <tbody>{d.reconciled.map((a) => (
                <tr key={a.alias_listing_id + a.created_at}>
                  <Td>{shortId(a.alias_listing_id)}{a.alias_slug && <span className="block text-[12px] text-adm-muted">/v/{a.alias_slug}</span>}</Td>
                  <Td>{shortId(a.canonical_listing_id)}</Td>
                  <Td className="font-mono text-[13px]">...{a.vin_suffix}</Td>
                  <Td>{shortId(a.operation_id)}</Td>
                  <Td className="whitespace-nowrap">{when(a.created_at)}</Td>
                  <Td>{a.retired_at ? <StatusText tone="neutral">Restored {when(a.retired_at)}</StatusText> : <StatusText tone="warning">Archived duplicate</StatusText>}</Td>
                </tr>
              ))}</tbody>
            </WorkTable>
          )}
        </Panel>
      )}
      {tab === "purge" && <PurgeTab data={d} />}
      {tab === "history" && (
        <Panel title="Operation history" description="Every apply, rejection and undo. Undo is checked against later edits and is refused if records changed." flush>
          {d.operations.length === 0 ? <EmptyState title="No operations yet" compact /> : (
            <WorkTable caption="Reconciliation operations" minWidth={900}>
              <thead><tr><Th>When</Th><Th>Action</Th><Th>VIN</Th><Th>Result</Th><Th>Scope</Th><Th align="right">Recovery</Th></tr></thead>
              <tbody>{d.operations.map((op) => <RecoveryRow key={op.id} op={op} />)}</tbody>
            </WorkTable>
          )}
          {d.batches.length > 0 && (
            <div className="border-t border-adm-border p-4 text-[14px]">
              <h3 className="mb-2 font-semibold">Batches</h3>
              <ul className="space-y-1">{d.batches.map((b) => <li key={b.batch_id}>Batch {shortId(b.batch_id)}: {humanize(b.status)}{b.stop_reason ? ` (${humanize(b.stop_reason)})` : ""}. {b.applied} applied, {b.failed} failed, {b.skipped} skipped, {b.pending} pending of {b.total}.</li>)}</ul>
            </div>
          )}
        </Panel>
      )}
      <ControlsPanel data={d} />
      <p className="sr-only" aria-live="polite">{busy ? "Working" : ""}</p>
    </div>
  );
}
