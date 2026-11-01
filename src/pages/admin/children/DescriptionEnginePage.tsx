import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminTable, ICON, InlineNote, KeyValueList, SkeletonBlock, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { ReviewDialog } from "@/components/admin/v2/ReviewDialog";
import { AdminSelect, Field } from "@/pages/admin/views/pricing/ui";
import { adminTabHref } from "@/lib/admin/sections";
import { CHANNEL_META } from "@/lib/description/model";
import { describeFeeBasis } from "@/lib/admin/pricing/feeBasis";
import { fitNarrativeExact, disclosureDecision } from "../../../../supabase/functions/_shared/description-exact-fit";
import {
  VAUTO_TARGET, checkPriceDisclosure, destinationProfiles, evaluateVautoText, formatMoney, segmentCounts, vautoApprovalGate, vautoWireProfile,
  type BlockReason, type DisclosureFeeStatement,
} from "@/lib/description/vautoExport";
import { useDescriptionEngineSource } from "@/pages/admin/views/descriptions/engineData";
import { cn } from "@/lib/utils";
import { ExternalLink, FileText, Gauge, History, ListChecks, Scale, ShieldCheck, Mic } from "lucide-react";

// Administration -> Publishing -> Description Engine. One place to see why a
// vehicle's vAuto export is or is not ready: the store voice and disclosure,
// each destination's limits, the evidence behind the draft, a live counter
// against the exact 3,921-character target, the price basis the disclosure
// must agree with, and the approval that stays disabled until all of it does.

const BACK_HREF = adminTabHref("destinations");
const CRUMBS = [{ label: "Administration", href: "/admin" }, { label: "Publishing", href: adminTabHref("effective-policy") }, { label: "Description Engine" }];

const STATEMENT_LABEL: Record<DisclosureFeeStatement, string> = {
  includes_fee: "Says the price includes the fee",
  excludes_fee: "Says the fee is extra",
  silent: "Does not mention the fee",
  mixed: "Says both",
};

const textareaClass = "w-full rounded-md border border-adm-border bg-adm-surface px-3 py-2 text-[14px] leading-[20px] text-adm-ink font-mono disabled:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const Reasons = ({ reasons, empty }: { reasons: BlockReason[]; empty: string }) =>
  reasons.length === 0 ? (
    <p className="text-[14px] leading-[20px] text-adm-success font-semibold">{empty}</p>
  ) : (
    <ul className="space-y-2" aria-label="Blocking reasons">
      {reasons.map((r, i) => (
        <li key={`${r.code}-${i}`} className="flex items-start gap-3 rounded-[6px] border border-[#F3B4AE] bg-adm-danger-bg px-3 py-2">
          <StatusChip tone="danger" className="mt-0.5 font-mono">{r.code}</StatusChip>
          <span className="text-[14px] leading-[20px] text-adm-ink">{r.message}</span>
        </li>
      ))}
    </ul>
  );

const Segment = ({ label, value, className }: { label: string; value: number; className: string }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2 text-[12px] leading-[18px] text-adm-muted"><span className={cn("inline-block w-3 h-3 rounded-[2px]", className)} aria-hidden="true" />{label}</div>
    <div className="text-[18px] leading-[26px] font-semibold tabular-nums text-adm-ink">{value.toLocaleString("en-US")}</div>
  </div>
);

export default function DescriptionEnginePage() {
  const [params, setParams] = useSearchParams();
  const src = useDescriptionEngineSource(params.get("vehicle"));
  const vehicleId = src.vehicleId;
  const vehicle = src.vehicles.find((v) => v.id === vehicleId) ?? null;
  const detail = src.detail;

  const storedDisclosure = String(src.descriptionSettings.required_legal_text ?? "").trim();
  const cta = String(src.descriptionSettings.channel_overrides?.vauto?.ctaTemplate ?? src.descriptionSettings.cta_template ?? "").trim() || null;

  const [disclosureDraft, setDisclosureDraft] = useState<string | null>(null);
  const disclosure = (disclosureDraft ?? storedDisclosure).trim();
  const disclosureSaved = disclosure === storedDisclosure;
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void disclosureDecision({ required_legal_text: disclosure }).then((d) => { if (!off) setVersion(d.version); });
    return () => { off = true; };
  }, [disclosure]);

  const [text, setText] = useState<string>("");
  const [textFor, setTextFor] = useState<string | null>(null);
  useEffect(() => {
    if (detail && textFor !== vehicleId) { setText(detail.vautoText ?? ""); setTextFor(vehicleId); }
  }, [detail, vehicleId, textFor]);

  const price = useMemo(() => checkPriceDisclosure({ settings: src.dealerSettings, row: vehicle?.price ?? null, observed: vehicle?.observed ?? null, disclosureText: disclosure }),
    [src.dealerSettings, vehicle, disclosure]);
  const approvedDisclosure = { text: disclosure, version: version ?? "pending", approved: disclosureSaved && !!disclosure };
  const evaluation = useMemo(() => evaluateVautoText({ text, cta, disclosure: approvedDisclosure, price }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, cta, disclosure, disclosureSaved, version, price]);
  const counts = useMemo(() => segmentCounts(text, cta, disclosure), [text, cta, disclosure]);
  const differsFromStored = !!detail && text !== (detail.vautoText ?? "");
  const gate = vautoApprovalGate({ exportResult: evaluation, canApprove: src.canApprove, hasVersion: !!detail?.caseId && !!detail?.masterVersionId });
  const gateReasons = differsFromStored
    ? [...gate.reasons, { code: "PREVIEW_EDITED", message: "The preview differs from the stored vAuto version. Save it as a version in Description Intelligence, then approve that version." }]
    : gate.reasons;
  const approvalEnabled = gate.enabled && !differsFromStored;

  const narrativeSource = useMemo(() => {
    if (detail?.narrative) return detail.narrative;
    const stored = detail?.vautoText ?? "";
    if (!stored) return null;
    let body = storedDisclosure && stored.endsWith(storedDisclosure) ? stored.slice(0, stored.length - storedDisclosure.length).trimEnd() : stored;
    if (cta && body.endsWith(cta)) body = body.slice(0, body.length - cta.length).trimEnd();
    return body || null;
  }, [detail, storedDisclosure, cta]);

  const refit = () => {
    if (!narrativeSource) return;
    const fit = fitNarrativeExact({ narrative: narrativeSource, cta, disclosure: approvedDisclosure, profile: vautoWireProfile() });
    if (fit.ok && fit.text) { setText(fit.text); toast.success(`Refitted to exactly ${VAUTO_TARGET.toLocaleString("en-US")} characters from whole verified sentences.`); }
    else toast.error(fit.code === "EXACT_LENGTH_UNREACHABLE"
      ? "No set of whole verified sentences reaches the target with this disclosure. Nothing was padded or cut."
      : fit.message ?? "The text could not be refitted.");
  };

  const [reviewOpen, setReviewOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const saveDisclosure = async () => {
    setBusy(true);
    const r = await src.saveDisclosure(disclosure);
    setBusy(false);
    setReviewOpen(false);
    if (!r.ok) { toast.error(r.error ?? "Nothing was saved."); return; }
    setDisclosureDraft(null);
    toast.success("Store disclosure saved. Earlier exact-length approvals no longer match its version.");
  };
  const approve = async () => {
    if (!detail?.caseId || !detail.masterVersionId) return;
    setBusy(true);
    const r = await src.approve(detail.caseId, detail.masterVersionId, note.trim());
    setBusy(false);
    setApproveOpen(false);
    if (!r.ok) { toast.error(r.error ?? "Nothing was approved."); return; }
    toast.success("vAuto version approved.");
  };

  const profiles = useMemo(() => destinationProfiles(CHANNEL_META.map((c) => c.key)), []);
  const verdictTone: Tone = evaluation.reasons.length === 0 ? "success" : "danger";

  if (src.state === "loading") {
    return (
      <ChildPageFrame section="publishing" sectionRow="above" crumbs={CRUMBS} title="Description Engine" backHref={BACK_HREF} backLabel="Back to destinations">
        <div className="space-y-4" aria-busy="true" aria-label="Loading the description engine"><SkeletonBlock className="h-24 w-full" /><SkeletonBlock className="h-96 w-full" /></div>
      </ChildPageFrame>
    );
  }
  if (src.state === "error") {
    return (
      <ChildPageFrame section="publishing" sectionRow="above" crumbs={CRUMBS} title="Description Engine" backHref={BACK_HREF} backLabel="Back to destinations">
        <InlineNote tone="danger" title="The description settings could not be loaded.">Nothing on this page was changed. Reload to try again.</InlineNote>
      </ChildPageFrame>
    );
  }

  return (
    <ChildPageFrame
      section="publishing"
      sectionRow="above"
      crumbs={CRUMBS}
      title="Description Engine"
      badge={src.isFixture ? <StatusChip tone="info">Synthetic example</StatusChip> : undefined}
      subtitle={`${src.storeName ?? "This dealership"}: voice, disclosure, destination limits, evidence and the exact ${VAUTO_TARGET.toLocaleString("en-US")}-character vAuto export.`}
      backHref={BACK_HREF}
      backLabel="Back to destinations"
    >
      <div className="space-y-4">
        <InlineNote tone={verdictTone} title={evaluation.reasons.length === 0 ? "vAuto export agrees with the price and disclosure" : `vAuto export blocked: ${evaluation.reasons.length} reason${evaluation.reasons.length === 1 ? "" : "s"}`}>
          {evaluation.reasons.length === 0
            ? `Exactly ${VAUTO_TARGET.toLocaleString("en-US")} characters, the complete disclosure once at the end, and a verified fee basis.`
            : "Each reason is listed under Validation. The export stays blocked until every one is resolved; nothing is padded, cut or repriced to make it pass."}
        </InlineNote>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4 min-w-0">
            <AdminCard
              title={<span className="inline-flex items-center gap-2"><Gauge className={ICON.inline} aria-hidden="true" />Preview and live vAuto counter</span>}
              description="Counts every character, spaces included, exactly as the export is serialized."
            >
              <div className="space-y-4">
                {narrativeSource && <AdminButton size="sm" variant="outline" onClick={refit}>Refit with this disclosure</AdminButton>}
                <Field label="Vehicle" htmlFor="de-vehicle">
                  <AdminSelect id="de-vehicle" value={vehicleId ?? ""} onChange={(e) => { const p = new URLSearchParams(params); p.set("vehicle", e.target.value); setParams(p, { replace: true }); }}>
                    {src.vehicles.length === 0 && <option value="">No vehicles</option>}
                    {src.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}{v.stock ? ` (stock ${v.stock})` : ""}</option>)}
                  </AdminSelect>
                </Field>
                <div data-testid="vauto-counter" className="rounded-[6px] border border-adm-border bg-adm-workspace px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[30px] leading-[36px] font-bold tabular-nums text-adm-ink">{counts.total.toLocaleString("en-US")}<span className="text-[16px] font-semibold text-adm-muted"> / {VAUTO_TARGET.toLocaleString("en-US")}</span></div>
                    <StatusChip tone={counts.remaining === 0 ? "success" : "danger"}>
                      {counts.remaining === 0 ? "Exact" : counts.remaining > 0 ? `${counts.remaining.toLocaleString("en-US")} short` : `${(-counts.remaining).toLocaleString("en-US")} over`}
                    </StatusChip>
                  </div>
                  <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-adm-border" aria-hidden="true">
                    <div className="bg-adm-primary" style={{ width: `${Math.min(100, (counts.narrative / VAUTO_TARGET) * 100)}%` }} />
                    <div className="bg-[#6B4FC9]" style={{ width: `${Math.min(100, (counts.cta / VAUTO_TARGET) * 100)}%` }} />
                    <div className="bg-[#1E8E4E]" style={{ width: `${Math.min(100, (counts.disclosure / VAUTO_TARGET) * 100)}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Segment label="Description" value={counts.narrative} className="bg-adm-primary" />
                    <Segment label="Call to action" value={counts.cta} className="bg-[#6B4FC9]" />
                    <Segment label="Disclosure" value={counts.disclosure} className="bg-[#1E8E4E]" />
                    <Segment label="Joining spaces" value={counts.separators} className="bg-adm-border" />
                  </div>
                </div>
                {src.detailLoading ? <SkeletonBlock className="h-64 w-full" /> : (
                  <Field label="vAuto text (single line, ASCII)" htmlFor="de-text" hint={detail?.vautoText ? "Loaded from the latest stored vAuto version. Edits here are a preview only." : "No vAuto version is stored for this vehicle yet. Generate one in Description Intelligence."}>
                    <textarea id="de-text" rows={12} className={textareaClass} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
                  </Field>
                )}
              </div>
            </AdminCard>

            <AdminCard title={<span className="inline-flex items-center gap-2"><ListChecks className={ICON.inline} aria-hidden="true" />Validation</span>} description="Why the export is blocked, in the order to fix it.">
              <Reasons reasons={evaluation.reasons} empty="No blocking reasons. The export text, price basis and disclosure agree." />
              {evaluation.findings.filter((f) => f.severity !== "blocking").length > 0 && (
                <ul className="mt-3 space-y-1">
                  {evaluation.findings.filter((f) => f.severity !== "blocking").map((f, i) => (
                    <li key={i} className="text-[13px] leading-[18px] text-adm-muted"><StatusChip tone="warning" className="mr-2">{f.code}</StatusChip>{f.message}</li>
                  ))}
                </ul>
              )}
            </AdminCard>

            <AdminCard flush title={<span className="inline-flex items-center gap-2"><FileText className={ICON.inline} aria-hidden="true" />Evidence behind this description</span>} description="The verified facts the writer was allowed to use. A claim with no fact here is not written.">
              {(detail?.facts.length ?? 0) === 0 ? (
                <p className="px-6 pb-6 text-[14px] text-adm-muted">No fact snapshot is stored for this vehicle.</p>
              ) : (
                <div className="max-h-[480px] overflow-y-auto" tabIndex={0} aria-label="Evidence facts, scrollable">
                <AdminTable inset caption="Evidence facts" minWidth={640}>
                  <thead><tr><Th>Fact</Th><Th>Value</Th><Th>Source</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {detail!.facts.map((f) => (
                      <tr key={f.id}><Td>{f.label}</Td><Td>{f.value}</Td><Td>{f.source}</Td><Td><StatusChip tone={f.status === "verified" ? "success" : "neutral"}>{f.status}</StatusChip></Td></tr>
                    ))}
                  </tbody>
                </AdminTable>
                </div>
              )}
            </AdminCard>

            <AdminCard flush title={<span className="inline-flex items-center gap-2"><History className={ICON.inline} aria-hidden="true" />Version history</span>} description="Stored vAuto versions for this vehicle and the store voice profile versions.">
              <div className="space-y-4 pb-4">
                <AdminTable inset caption="vAuto versions" minWidth={640}>
                  <thead><tr><Th>Created</Th><Th align="right">Characters</Th><Th>Validation</Th><Th>Approval</Th><Th>Policy</Th></tr></thead>
                  <tbody>
                    {(detail?.versions ?? []).length === 0 && <tr><Td colSpan={5}>No vAuto versions yet.</Td></tr>}
                    {(detail?.versions ?? []).map((v) => (
                      <tr key={v.id}>
                        <Td>{fmtDate(v.createdAt)}{v.manualEdit ? " (edited)" : ""}</Td>
                        <Td align="right">{v.characterCount?.toLocaleString("en-US") ?? "Unknown"}</Td>
                        <Td><StatusChip tone={v.validationStatus === "passed" ? "success" : v.validationStatus === "failed" ? "danger" : "warning"}>{v.validationStatus}</StatusChip></Td>
                        <Td>{v.approval ?? "pending"}</Td>
                        <Td className="font-mono text-[12px]">{v.policyVersion ?? "Unknown"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
                <AdminTable inset caption="Voice profile versions" minWidth={560}>
                  <thead><tr><Th>Saved</Th><Th>Version</Th><Th>Status</Th><Th>Reason</Th></tr></thead>
                  <tbody>
                    {src.voice.history.length === 0 && <tr><Td colSpan={4}>No voice profile saved yet.</Td></tr>}
                    {src.voice.history.map((h, i) => (
                      <tr key={`${h.version}-${i}`}><Td>{fmtDate(h.createdAt)}</Td><Td className="font-mono text-[12px]">{h.version}</Td><Td>{h.status}</Td><Td>{h.reason ?? ""}</Td></tr>
                    ))}
                  </tbody>
                </AdminTable>
              </div>
            </AdminCard>
          </div>

          <div className="space-y-4 min-w-0">
            <AdminCard title={<span className="inline-flex items-center gap-2"><Scale className={ICON.inline} aria-hidden="true" />Price and disclosure review</span>} description="Read from the stored price fields and the dealership's fee basis setting, never from a price label.">
              <div className="space-y-4">
                <KeyValueList divided rows={[
                  { label: "Fee basis", value: price.basis === "includes_fee" ? "Advertised price includes the fee" : price.basis === "before_fee" ? "Fee is added to the advertised price" : price.basis === "conflict" ? "Settings conflict" : "Not set" },
                  { label: "Basis source", value: <span className="font-mono text-[12px] break-all">{price.basisSource}</span> },
                  { label: "Selling price", value: price.breakdown ? <span className="tabular-nums">{formatMoney(price.breakdown.sellingPrice)} <span className="text-adm-muted text-[12px]">({price.breakdown.sources.sellingPrice})</span></span> : "Blocked" },
                  { label: "Documentation fee", value: price.breakdown ? <span className="tabular-nums font-semibold">{formatMoney(price.breakdown.docFee)} <span className="text-adm-muted text-[12px] font-normal">({price.breakdown.sources.docFee})</span></span> : vehicle?.price.docFee != null ? `${formatMoney(vehicle.price.docFee)} (stored, unverified)` : "Not stored" },
                  { label: "Advertised total", value: price.breakdown ? <span className="tabular-nums">{formatMoney(price.breakdown.advertisedTotal)} <span className="text-adm-muted text-[12px]">({price.breakdown.sources.advertisedTotal})</span></span> : "Blocked" },
                  { label: "Disclosure says", value: <StatusChip tone={price.reasons.some((r) => r.code.startsWith("DISCLOSURE")) ? "danger" : "success"}>{STATEMENT_LABEL[price.statement]}</StatusChip> },
                ]} />
                <p className="text-[12px] leading-[18px] text-adm-muted">{describeFeeBasis(price.basis)} No price is changed here and the proposed fee-basis policy is not activated.</p>
                {price.proposedWording && disclosure !== price.proposedWording && (
                  <InlineNote tone="info" title="Proposed wording for a fee-inclusive price" action={src.canConfigure ? <AdminButton size="sm" variant="outline" onClick={() => setDisclosureDraft(price.proposedWording)}>Use this wording</AdminButton> : undefined}>
                    {price.proposedWording}
                  </InlineNote>
                )}
                <Field label="Store disclosure (exported verbatim, last)" htmlFor="de-disclosure" hint={`Version ${version ?? "pending"}. ${disclosureSaved ? "Saved for the store." : "Draft: not saved."}`}>
                  <textarea id="de-disclosure" rows={4} className={textareaClass} value={disclosure} disabled={!src.canConfigure} onChange={(e) => setDisclosureDraft(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <AdminButton variant="primary" disabled={disclosureSaved || !src.canConfigure || !disclosure} onClick={() => setReviewOpen(true)}>Review disclosure change</AdminButton>
                  {!disclosureSaved && <AdminButton variant="ghost" onClick={() => setDisclosureDraft(null)}>Discard draft</AdminButton>}
                </div>
              </div>
            </AdminCard>

            <AdminCard title={<span className="inline-flex items-center gap-2"><ShieldCheck className={ICON.inline} aria-hidden="true" />Review and approval</span>} description="vAuto approval stays disabled until every blocking reason is resolved.">
              <div className="space-y-3">
                <Reasons reasons={gateReasons.filter((r) => !evaluation.reasons.includes(r))} empty={approvalEnabled ? "Ready to approve." : "Resolve the validation reasons first."} />
                <AdminButton variant="primary" className="w-full" disabled={!approvalEnabled || busy} onClick={() => setApproveOpen(true)}>Approve vAuto export</AdminButton>
                {vehicleId && <Link to={`/description-intelligence/${encodeURIComponent(vehicleId)}`} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-adm-primary hover:underline">Open in Description Intelligence<ExternalLink className={ICON.inline} aria-hidden="true" /></Link>}
              </div>
            </AdminCard>

            <AdminCard title={<span className="inline-flex items-center gap-2"><Mic className={ICON.inline} aria-hidden="true" />Store voice</span>} description="Generation runs only against an approved voice profile.">
              <KeyValueList divided rows={[
                { label: "Status", value: <StatusChip tone={src.voice.status === "approved" ? "success" : "warning"}>{src.voice.status}</StatusChip> },
                { label: "Version", value: <span className="font-mono text-[12px]">{src.voice.version ?? "None"}</span> },
                { label: "Tone", value: src.voice.tone ?? "Not set" },
                { label: "Call to action", value: cta ?? "None" },
              ]} />
              <Link to="/admin/description-voice" className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-adm-primary hover:underline">Edit voice and approved claims<ExternalLink className={ICON.inline} aria-hidden="true" /></Link>
            </AdminCard>
          </div>
        </div>

        <AdminCard flush title="Destination profiles" description="Each destination's limit and where it comes from. An unverified limit is an AutoLabels default, not the destination's published rule.">
          <AdminTable inset caption="Destination profiles" minWidth={900}>
            <thead><tr><Th>Destination</Th><Th align="right">Limit</Th><Th>Exact total</Th><Th>Limit verified</Th><Th>Draft range</Th><Th>Format</Th><Th>Source</Th></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.key}>
                  <Td className="font-semibold">{p.label}</Td>
                  <Td align="right" className="tabular-nums">{p.characterLimit.toLocaleString("en-US")}</Td>
                  <Td>{p.exactTotal ? <StatusChip tone="info">{p.exactTotal.toLocaleString("en-US")} incl. disclosure</StatusChip> : "None"}</Td>
                  <Td><StatusChip tone={p.limitVerified ? "success" : "warning"}>{p.limitVerified ? "Verified" : "Unverified"}</StatusChip></Td>
                  <Td className="tabular-nums">{p.recommended}</Td>
                  <Td>{p.wire}</Td>
                  <Td className="text-[13px] leading-[18px] text-adm-muted max-w-[360px]">{p.source}</Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </AdminCard>
      </div>

      <ReviewDialog
        open={reviewOpen}
        title="Review disclosure change"
        subtitle="The disclosure is exported verbatim at the end of every vAuto description. Changing it changes its version, so earlier exact-length approvals no longer match."
        onClose={() => setReviewOpen(false)}
        footer={<><AdminButton onClick={() => setReviewOpen(false)}>Cancel</AdminButton><AdminButton variant="primary" disabled={busy} onClick={saveDisclosure}>Save store disclosure</AdminButton></>}
      >
        <div className="space-y-3">
          <Field label="Current"><p className="rounded-md border border-adm-border bg-adm-workspace px-3 py-2 text-[14px]">{storedDisclosure || "None"}</p></Field>
          <Field label="New"><p className="rounded-md border border-adm-primary bg-adm-selected px-3 py-2 text-[14px]">{disclosure}</p></Field>
          <Reasons reasons={price.reasons.filter((r) => r.code.startsWith("DISCLOSURE"))} empty="The new wording agrees with this vehicle's verified fee basis." />
        </div>
      </ReviewDialog>

      <ReviewDialog
        open={approveOpen}
        title="Approve vAuto export"
        subtitle={`${vehicle?.label ?? "Vehicle"}: exactly ${VAUTO_TARGET.toLocaleString("en-US")} characters with disclosure version ${version ?? "pending"}.`}
        onClose={() => setApproveOpen(false)}
        footer={<><AdminButton onClick={() => setApproveOpen(false)}>Cancel</AdminButton><AdminButton variant="primary" disabled={busy || !approvalEnabled} onClick={approve}>Approve</AdminButton></>}
      >
        <div className="space-y-3">
          {price.breakdown && <KeyValueList divided rows={[
            { label: "Selling price", value: formatMoney(price.breakdown.sellingPrice) },
            { label: "Documentation fee", value: formatMoney(price.breakdown.docFee) },
            { label: "Advertised total", value: formatMoney(price.breakdown.advertisedTotal) },
          ]} />}
          <Field label="Approval note (optional)" htmlFor="de-note"><textarea id="de-note" rows={2} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </ReviewDialog>
    </ChildPageFrame>
  );
}
