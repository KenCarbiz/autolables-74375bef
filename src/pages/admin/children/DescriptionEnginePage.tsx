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
import { fitNarrativeExact } from "../../../../supabase/functions/_shared/description-exact-fit";
import {
  PROPOSED_CT_DISCLOSURE_TEMPLATE, VAUTO_TARGET, classifyDisclosure, compareRoundTrip, decideVautoExport, destinationProfiles, formatMoney, renderDisclosure,
  resolveFeeBasis, rulesFor, segmentCounts, vautoWireProfile,
  type BlockReason, type DisclosureFeeStatement, type DisclosureStatus,
} from "@/lib/description/vautoExport";
import { disclosureForStore, useDescriptionEngineSource, type ServerCheck } from "@/pages/admin/views/descriptions/engineData";
import { cn } from "@/lib/utils";
import { Building2, Eye, ExternalLink, FileText, Gauge, History, ListChecks, Mic, Repeat, Scale, Server, ShieldCheck } from "lucide-react";

// Administration -> Publishing -> Description Engine. One place to see why a
// vehicle's vAuto export is or is not ready: the rooftop and its legal-reviewed
// disclosure, the customer advertisement as rendered, each destination's
// stored text against its limit, the evidence, a live counter against the
// exact 3,921-character target, and the server gate. The screen previews the
// same decision the server makes; only the server records, approves or
// releases an export.

const BACK_HREF = adminTabHref("destinations");
const CRUMBS = [{ label: "Administration", href: "/admin" }, { label: "Publishing", href: adminTabHref("effective-policy") }, { label: "Description Engine" }];

const STATEMENT_LABEL: Record<DisclosureFeeStatement, string> = {
  includes_fee: "Fee included",
  excludes_fee: "Fee extra",
  silent: "Fee not mentioned",
  mixed: "Contradicts itself",
};

const STATUS_CHIP: Record<DisclosureStatus, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  pending_legal_review: { tone: "warning", label: "Awaiting legal review" },
  approved: { tone: "success", label: "Approved" },
  retired: { tone: "neutral", label: "Retired" },
};

const textareaClass = "w-full rounded-md border border-adm-border bg-adm-surface px-3 py-2 text-[14px] leading-[20px] text-adm-ink font-mono disabled:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary";

const fmtDate = (iso: string | null) => {
  if (!iso) return "Not recorded";
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
          <StatusChip tone="danger" className="mt-0.5 font-mono shrink-0">{r.code}</StatusChip>
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

const CardTitle = ({ icon: Icon, children }: { icon: typeof Gauge; children: string }) => (
  <span className="inline-flex items-center gap-2"><Icon className={ICON.inline} aria-hidden="true" />{children}</span>
);

export default function DescriptionEnginePage() {
  const [params, setParams] = useSearchParams();
  const src = useDescriptionEngineSource(params.get("vehicle"), params.get("store"));
  const { vehicleId, storeId, detail } = src;
  const vehicle = src.vehicles.find((v) => v.id === vehicleId) ?? null;
  const store = src.stores.find((s) => s.id === storeId) ?? null;
  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    p.set(key, value);
    if (key === "store") p.delete("vehicle");
    setParams(p, { replace: true });
  };

  const storeOverrides = store?.overrides ?? {};
  const cta = String(storeOverrides.cta_template ?? src.descriptionSettings.channel_overrides?.vauto?.ctaTemplate ?? src.descriptionSettings.cta_template ?? "").trim() || null;
  const state = String(storeOverrides.state ?? store?.state ?? "") || null;
  const rules = useMemo(() => rulesFor(state), [state]);
  const { basis } = resolveFeeBasis(src.dealerSettings);
  const basisKey = basis === "before_fee" ? "before_fee" : "includes_fee";
  const governing = useMemo(() => disclosureForStore(src.disclosures, storeId, basisKey), [src.disclosures, storeId, basisKey]);
  const activeDisclosure = governing.approved ?? governing.pending;

  const [text, setText] = useState("");
  const [textFor, setTextFor] = useState<string | null>(null);
  useEffect(() => {
    if (detail && textFor !== vehicleId) { setText(detail.vautoText ?? ""); setTextFor(vehicleId); }
  }, [detail, vehicleId, textFor]);

  const decision = useMemo(() => decideVautoExport({
    content: text, cta, settings: src.dealerSettings, row: vehicle?.price ?? null, observed: vehicle?.observed ?? null,
    disclosure: activeDisclosure, rules, evidence: detail?.evidence ?? null, authorized: src.canApprove,
  }), [text, cta, src.dealerSettings, vehicle, activeDisclosure, rules, detail?.evidence, src.canApprove]);
  const rendered = decision.renderedDisclosure;
  const statement = useMemo(() => classifyDisclosure(rendered), [rendered]);
  const counts = useMemo(() => segmentCounts(text, cta, rendered), [text, cta, rendered]);
  const differsFromStored = !!detail && text !== (detail.vautoText ?? "");

  const [proposal, setProposal] = useState<string | null>(null);
  const proposalPreview = useMemo(() => renderDisclosure(proposal ?? "", vehicle?.price.docFee ?? null), [proposal, vehicle]);

  const [server, setServer] = useState<ServerCheck | null>(null);
  useEffect(() => { setServer(null); }, [vehicleId, storeId, text]);
  const [busy, setBusy] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [note, setNote] = useState("");
  const [observedText, setObservedText] = useState("");
  const roundTrip = useMemo(() => (observedText.trim() && detail?.vautoText ? compareRoundTrip(detail.vautoText, observedText, rendered) : null), [observedText, detail?.vautoText, rendered]);
  const [channelKey, setChannelKey] = useState("vauto");

  const narrativeSource = useMemo(() => {
    if (detail?.narrative) return detail.narrative;
    const stored = detail?.vautoText ?? "";
    if (!stored) return null;
    let body = rendered && stored.endsWith(rendered) ? stored.slice(0, stored.length - rendered.length).trimEnd() : stored;
    if (cta && body.endsWith(cta)) body = body.slice(0, body.length - cta.length).trimEnd();
    return body || null;
  }, [detail, rendered, cta]);

  const refit = () => {
    if (!narrativeSource) return;
    const fit = fitNarrativeExact({ narrative: narrativeSource, cta, disclosure: { text: rendered, version: activeDisclosure?.version ?? "none", approved: true }, profile: vautoWireProfile() });
    if (fit.ok && fit.text) { setText(fit.text); toast.success(`Refitted to exactly ${VAUTO_TARGET.toLocaleString("en-US")} characters from whole verified sentences. Preview only until saved as a version.`); }
    else toast.error(fit.code === "EXACT_LENGTH_UNREACHABLE"
      ? "No set of whole verified sentences reaches the target with this disclosure. Nothing was padded or cut."
      : fit.message ?? "The text could not be refitted.");
  };

  const runServerCheck = async () => {
    setBusy(true);
    const r = await src.serverCheck(detail?.vautoChannelVersionId ?? null);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setServer(r.value);
  };
  const approve = async () => {
    if (!server?.checkId) return;
    setBusy(true);
    const r = await src.serverApprove(server.checkId, note.trim());
    setBusy(false);
    setApproveOpen(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("The server recorded the vAuto approval.");
  };
  const exportText = async () => {
    if (!detail?.vautoChannelVersionId) return;
    setBusy(true);
    const r = await src.serverExport(detail.vautoChannelVersionId);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    try { await navigator.clipboard.writeText(r.value); toast.success("Approved vAuto text copied. Paste it into vAuto as one field."); }
    catch { toast.error("The text was released but the clipboard is unavailable."); }
  };
  const propose = async () => {
    if (!proposal) return;
    setBusy(true);
    const r = await src.proposeDisclosure(storeId, basisKey, proposal.trim());
    setBusy(false);
    setProposeOpen(false);
    if (!r.ok) { toast.error(r.error); return; }
    setProposal(null);
    toast.success("Submitted for legal review. It cannot be exported until counsel's review is recorded and it is approved.");
  };

  const profiles = useMemo(() => destinationProfiles(CHANNEL_META.map((c) => c.key)), []);
  const channel = detail?.channels.find((c) => c.channel === channelKey) ?? null;
  const channelProfile = profiles.find((p) => p.key === channelKey) ?? null;
  const channelCount = channel ? [...channel.content].length : 0;

  const serverReady = !!server && server.ok && !server.simulated && !!server.checkId && !differsFromStored;
  const verdictTone: Tone = decision.ok ? "success" : "danger";
  const b = decision.breakdown;

  if (src.state === "loading" || src.state === "error") {
    return (
      <ChildPageFrame section="publishing" sectionRow="above" crumbs={CRUMBS} title="Description Engine" backHref={BACK_HREF} backLabel="Back to destinations">
        {src.state === "loading"
          ? <div className="space-y-4" aria-busy="true" aria-label="Loading the description engine"><SkeletonBlock className="h-24 w-full" /><SkeletonBlock className="h-96 w-full" /></div>
          : <InlineNote tone="danger" title="The description settings could not be loaded.">Nothing on this page was changed. Reload to try again.</InlineNote>}
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
      subtitle={`${src.storeName ?? "This dealership"}: disclosure, customer advertisement, destination limits, evidence and the exact ${VAUTO_TARGET.toLocaleString("en-US")}-character vAuto export.`}
      backHref={BACK_HREF}
      backLabel="Back to destinations"
    >
      <div className="space-y-4">
        <InlineNote tone={verdictTone} title={decision.ok ? "Preview: the vAuto export agrees with the price, disclosure and evidence" : `vAuto export blocked: ${decision.reasons.length} reason${decision.reasons.length === 1 ? "" : "s"}`}>
          {decision.ok
            ? "Only the server can record, approve and release it. Run the server check below."
            : "Each reason is listed under Validation. Nothing is padded, cut or repriced to make it pass, and the server applies the same rules."}
        </InlineNote>

        <AdminCard title={<CardTitle icon={Building2}>Rooftop</CardTitle>} description="Each rooftop keeps its own disclosure, call to action, voice and review rules. Changing one rooftop never changes another.">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-start">
            <Field label="Store" htmlFor="de-store">
              <AdminSelect id="de-store" value={storeId ?? ""} onChange={(e) => setParam("store", e.target.value)}>
                {src.stores.length === 0 && <option value="">Dealership default</option>}
                {src.stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state ? ` (${s.state})` : ""}</option>)}
              </AdminSelect>
            </Field>
            <Field label="Vehicle" htmlFor="de-vehicle">
              <AdminSelect id="de-vehicle" value={vehicleId ?? ""} onChange={(e) => setParam("vehicle", e.target.value)}>
                {src.vehicles.length === 0 && <option value="">No vehicles at this store</option>}
                {src.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}{v.stock ? ` (stock ${v.stock})` : ""}</option>)}
              </AdminSelect>
            </Field>
            <KeyValueList rows={[
              { label: "Store settings", value: !src.storeSettingsInstalled ? "Not installed: dealership defaults apply" : store?.overridesVersion ? `Own settings, version ${store.overridesVersion}` : "Uses dealership defaults" },
              { label: "State rules", value: rules.state ? `${rules.state}: ${rules.source}` : "No state rule on file; general checks only" },
            ]} />
          </div>
        </AdminCard>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4 min-w-0">
            <AdminCard title={<CardTitle icon={Eye}>Customer advertisement as rendered</CardTitle>} description="How a shopper reads this vehicle's listing: advertised price, the separately stated fee, the description and the disclosure.">
              <div data-testid="ad-preview" className="rounded-[8px] border border-adm-border bg-adm-surface p-5 space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-[18px] leading-[26px] font-semibold text-adm-ink">{vehicle?.label ?? "No vehicle"}</h3>
                  <div className="text-right">
                    <div className="text-[12px] leading-[18px] text-adm-muted">Advertised price</div>
                    <div className="text-[28px] leading-[34px] font-bold tabular-nums text-adm-ink">{b ? formatMoney(b.advertisedTotal) : "Blocked"}</div>
                  </div>
                </div>
                {b && (
                  <p className="text-[13px] leading-[18px] text-adm-ink">
                    <span className="font-bold">Dealer Conveyance Fee: {formatMoney(b.docFee)}</span>
                    <span className="text-adm-muted"> (included in the advertised price; selling price before the fee {formatMoney(b.sellingPrice)})</span>
                  </p>
                )}
                <p className="text-[14px] leading-[22px] text-adm-ink whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto" tabIndex={0} aria-label="Description as rendered, scrollable">
                  {counts.disclosureAtEnd ? text.slice(0, text.length - rendered.length).trimEnd() : text || "No stored vAuto text."}
                </p>
                <p className="border-t border-adm-border pt-3 text-[13px] leading-[19px] text-adm-ink">{rendered || "No disclosure."}</p>
              </div>
              {rules.typographyRequirement && (
                <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">{rules.typographyRequirement} vAuto receives plain text, so bold type cannot be carried there; counsel must record that the plain-text form is acceptable.</p>
              )}
            </AdminCard>

            <AdminCard title={<CardTitle icon={Gauge}>Preview and live vAuto counter</CardTitle>} description="Counts every character, spaces included, exactly as the export is serialized.">
              <div className="space-y-4">
                {narrativeSource && <AdminButton size="sm" variant="outline" onClick={refit}>Refit with this disclosure</AdminButton>}
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
                  <Field label="vAuto text (single line, ASCII)" htmlFor="de-text" hint={detail?.vautoText ? "Loaded from the latest stored vAuto version. Edits here are a preview only and are never exported." : "No vAuto version is stored for this vehicle yet. Generate one in Description Intelligence."}>
                    <textarea id="de-text" rows={10} className={textareaClass} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
                  </Field>
                )}
              </div>
            </AdminCard>

            <AdminCard title={<CardTitle icon={ListChecks}>Validation</CardTitle>} description="Why the export is blocked, in the order to fix it.">
              <Reasons reasons={differsFromStored ? [...decision.reasons, { code: "PREVIEW_EDITED", message: "The preview differs from the stored vAuto version. Save it as a version in Description Intelligence before the server can check it." }] : decision.reasons}
                empty="No blocking reasons. The export text, price basis, disclosure and evidence agree." />
            </AdminCard>

            <AdminCard flush title={<CardTitle icon={FileText}>Channel previews</CardTitle>} description="The stored text for each destination from the same approved master version, against that destination's limit.">
              <div className="px-6 pb-6 space-y-3">
                <div role="tablist" aria-label="Destinations" className="flex flex-wrap gap-2">
                  {(detail?.channels ?? []).map((c) => (
                    <button key={c.channel} role="tab" type="button" aria-selected={c.channel === channelKey} onClick={() => setChannelKey(c.channel)}
                      className={cn("rounded-full border px-3 py-1 text-[13px] font-semibold", c.channel === channelKey ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border text-adm-ink hover:bg-adm-workspace")}>
                      {profiles.find((p) => p.key === c.channel)?.label ?? c.channel}
                    </button>
                  ))}
                  {(detail?.channels ?? []).length === 0 && <p className="text-[14px] text-adm-muted">No channel versions are stored for this vehicle.</p>}
                </div>
                {channel && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <StatusChip tone={channelProfile && channelCount > channelProfile.characterLimit ? "danger" : "success"}>{channelCount.toLocaleString("en-US")} / {channelProfile?.characterLimit.toLocaleString("en-US") ?? "?"} characters</StatusChip>
                      {channelProfile && <StatusChip tone={channelProfile.limitVerified ? "success" : "warning"}>{channelProfile.limitVerified ? "Limit verified" : "Limit unverified"}</StatusChip>}
                      <StatusChip tone={channel.validationStatus === "passed" ? "success" : "warning"}>{channel.validationStatus}</StatusChip>
                      {channelProfile && <span className="text-adm-muted">{channelProfile.wire}</span>}
                    </div>
                    <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-adm-border bg-adm-workspace px-3 py-2 text-[13px] leading-[19px] text-adm-ink font-mono" tabIndex={0}>{channel.content}</pre>
                  </>
                )}
              </div>
            </AdminCard>

            <AdminCard flush title={<CardTitle icon={FileText}>Evidence behind this description</CardTitle>} description="The verified facts the writer was allowed to use. A claim with no fact here is not written.">
              <div className="px-6 pb-3 flex flex-wrap gap-2">
                <StatusChip tone={detail?.evidence.factSnapshot ? "success" : "danger"}>{detail?.evidence.factSnapshot ? "Fact snapshot stored" : "No fact snapshot"}</StatusChip>
                <StatusChip tone={(detail?.evidence.openBlockingExceptions ?? 0) === 0 ? "success" : "danger"}>{detail?.evidence.openBlockingExceptions ?? 0} blocking exceptions</StatusChip>
                <StatusChip tone={(detail?.evidence.openBlockingFindings ?? 0) === 0 ? "success" : "danger"}>{detail?.evidence.openBlockingFindings ?? 0} blocking findings</StatusChip>
                <StatusChip tone={detail?.evidence.potentiallyStale ? "danger" : "success"}>{detail?.evidence.potentiallyStale ? "Source data changed since writing" : "Current"}</StatusChip>
              </div>
              {(detail?.facts.length ?? 0) === 0 ? (
                <p className="px-6 pb-6 text-[14px] text-adm-muted">No fact snapshot is stored for this vehicle.</p>
              ) : (
                <div className="max-h-[420px] overflow-y-auto" tabIndex={0} aria-label="Evidence facts, scrollable">
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

            <AdminCard title={<CardTitle icon={Repeat}>vAuto round-trip check</CardTitle>} description="Paste the description exactly as vAuto, or a listing site fed by vAuto, shows it. This compares it with the exported text; it changes nothing.">
              <div className="space-y-3">
                <Field label="Text as it appears downstream" htmlFor="de-observed">
                  <textarea id="de-observed" rows={4} className={textareaClass} value={observedText} onChange={(e) => setObservedText(e.target.value)} spellCheck={false} />
                </Field>
                {roundTrip && (
                  <KeyValueList divided rows={[
                    { label: "Result", value: <StatusChip tone={roundTrip.identical ? "success" : "danger"}>{roundTrip.identical ? "Identical" : "Differs"}</StatusChip> },
                    { label: "Characters", value: <span className="tabular-nums">{roundTrip.exportedCount.toLocaleString("en-US")} exported, {roundTrip.observedCount.toLocaleString("en-US")} shown</span> },
                    { label: "Disclosure intact", value: roundTrip.disclosureIntact ? "Yes" : "No" },
                    { label: "Vendor text added", value: roundTrip.appendedSuffix ? <span className="font-mono text-[12px] break-all">{roundTrip.appendedSuffix.slice(0, 160)}</span> : roundTrip.prependedPrefix ? <span className="font-mono text-[12px] break-all">Before: {roundTrip.prependedPrefix.slice(0, 160)}</span> : "None" },
                    { label: "Cut", value: roundTrip.truncatedAt != null ? `After ${roundTrip.truncatedAt.toLocaleString("en-US")} characters` : "No" },
                    { label: "Punctuation", value: roundTrip.punctuationChanges.length ? roundTrip.punctuationChanges.join("; ") : "Unchanged" },
                  ]} />
                )}
              </div>
            </AdminCard>

            <AdminCard flush title={<CardTitle icon={History}>Version history</CardTitle>} description="Stored vAuto versions for this vehicle and the store voice profile versions.">
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
            <AdminCard title={<CardTitle icon={Server}>Server gate</CardTitle>} description="The server re-reads the stored text, price, fee settings, disclosure and evidence, and decides. Approval and export happen only there.">
              <div className="space-y-3">
                {!src.gateInstalled && <InlineNote tone="warning" title="Server gate not installed">The export gate migration and function are proposed and not applied. Nothing can be approved or exported until they are.</InlineNote>}
                {server && (
                  <InlineNote tone={server.ok ? "success" : "danger"} title={server.simulated ? `Simulated server decision: ${server.ok ? "would pass" : "would refuse"}` : server.ok ? "Server check passed" : "Server refused"}>
                    {server.simulated ? "Synthetic example: the shared gate ran in the browser. A real check is recorded by the server." : `Check ${server.checkId ?? ""}`}
                  </InlineNote>
                )}
                {server && <Reasons reasons={[...server.reasons, ...server.sqlBlockers.map((c) => ({ code: c, message: "The database re-check found this independently." }))]} empty="No blocking reasons." />}
                <div className="grid gap-2">
                  <AdminButton variant="outline" className="w-full" disabled={busy || !detail?.vautoText || differsFromStored} onClick={runServerCheck}>Run server check</AdminButton>
                  <AdminButton variant="primary" className="w-full" disabled={busy || !serverReady || !src.canApprove} onClick={() => setApproveOpen(true)}>Approve vAuto export</AdminButton>
                  <AdminButton variant="secondary" className="w-full" disabled={busy || !detail?.exportApproved} onClick={exportText}>Copy approved vAuto text</AdminButton>
                </div>
                <p className="text-[12px] leading-[18px] text-adm-muted">A check expires after 15 minutes. Any change to the text, price, fee, fee basis, disclosure or evidence voids every earlier check and approval.</p>
                {vehicleId && <Link to={`/description-intelligence/${encodeURIComponent(vehicleId)}`} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-adm-primary hover:underline">Open in Description Intelligence<ExternalLink className={ICON.inline} aria-hidden="true" /></Link>}
              </div>
            </AdminCard>

            <AdminCard title={<CardTitle icon={Scale}>Price and disclosure review</CardTitle>} description="Read from the stored price fields and the dealership's fee basis setting, never from a price label.">
              <div className="space-y-4">
                <KeyValueList divided rows={[
                  { label: "Fee basis", value: basis === "includes_fee" ? "Advertised price includes the fee" : basis === "before_fee" ? "Fee is added to the advertised price" : basis === "conflict" ? "Settings conflict" : "Not set" },
                  { label: "Selling price", value: b ? <span className="tabular-nums">{formatMoney(b.sellingPrice)} <span className="text-adm-muted text-[12px]">({b.sources.sellingPrice})</span></span> : "Blocked" },
                  { label: "Conveyance fee", value: b ? <span className="tabular-nums font-semibold">{formatMoney(b.docFee)} <span className="text-adm-muted text-[12px] font-normal">({b.sources.docFee})</span></span> : vehicle?.price.docFee != null ? `${formatMoney(vehicle.price.docFee)} (stored, unverified)` : "Not stored" },
                  { label: "Advertised total", value: b ? <span className="tabular-nums">{formatMoney(b.advertisedTotal)} <span className="text-adm-muted text-[12px]">({b.sources.advertisedTotal})</span></span> : "Blocked" },
                ]} />
                <p className="text-[12px] leading-[18px] text-adm-muted">{describeFeeBasis(basis)} No price is changed here.</p>
              </div>
            </AdminCard>

            <AdminCard title={<CardTitle icon={ShieldCheck}>Store disclosure</CardTitle>} description="Exported verbatim at the end of every vAuto description. Only counsel-reviewed wording, approved for this rooftop, can be exported.">
              <div className="space-y-4">
                {activeDisclosure ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={STATUS_CHIP[activeDisclosure.status].tone}>{STATUS_CHIP[activeDisclosure.status].label}</StatusChip>
                      <StatusChip tone="neutral">Version {activeDisclosure.version}</StatusChip>
                      {governing.inherited && <StatusChip tone="info">Dealership default</StatusChip>}
                    </div>
                    <KeyValueList divided rows={[
                      { label: "Legal review", value: activeDisclosure.legalReviewedBy ? `${activeDisclosure.legalReviewedBy}, ${fmtDate(activeDisclosure.legalReviewedAt)}` : "Not recorded" },
                      { label: "Reference", value: activeDisclosure.legalReference ?? "None" },
                      { label: "Plain-text format", value: activeDisclosure.plainTextFormatAccepted ? "Accepted by counsel" : "Not accepted" },
                      { label: "Approved", value: activeDisclosure.approvedAt ? `${activeDisclosure.approvedBy ?? ""} ${fmtDate(activeDisclosure.approvedAt)}`.trim() : "Not approved" },
                      { label: "Disclosure says", value: <StatusChip tone={statement === (basis === "before_fee" ? "excludes_fee" : "includes_fee") ? "success" : "danger"}>{STATEMENT_LABEL[statement]}</StatusChip> },
                    ]} />
                    <Field label="Rendered for this vehicle"><p className="rounded-md border border-adm-border bg-adm-workspace px-3 py-2 text-[14px] leading-[20px]">{rendered}</p></Field>
                  </>
                ) : (
                  <InlineNote tone="warning" title="No disclosure for this rooftop">Propose wording below and have counsel review it.</InlineNote>
                )}
                {src.canConfigure && (proposal == null ? (
                  <div className="flex flex-wrap gap-2">
                    <AdminButton size="sm" variant="outline" onClick={() => setProposal(PROPOSED_CT_DISCLOSURE_TEMPLATE)}>Start from the proposed CT wording</AdminButton>
                    <AdminButton size="sm" variant="ghost" onClick={() => setProposal(activeDisclosure?.template ?? "")}>Propose a revision</AdminButton>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Field label="Proposed wording" htmlFor="de-proposal" hint="Use {conveyance_fee} where the fee amount goes; it is filled from each vehicle's stored fee.">
                      <textarea id="de-proposal" rows={5} className={textareaClass} value={proposal} onChange={(e) => setProposal(e.target.value)} />
                    </Field>
                    <p className="text-[12px] leading-[18px] text-adm-muted">Preview: {proposalPreview.text}</p>
                    <div className="flex flex-wrap gap-2">
                      <AdminButton variant="primary" disabled={!proposal.trim()} onClick={() => setProposeOpen(true)}>Submit for legal review</AdminButton>
                      <AdminButton variant="ghost" onClick={() => setProposal(null)}>Discard</AdminButton>
                    </div>
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title={<CardTitle icon={Mic}>Store voice</CardTitle>} description="Generation runs only against an approved voice profile.">
              <KeyValueList divided rows={[
                { label: "Status", value: <StatusChip tone={src.voice.status === "approved" ? "success" : "warning"}>{src.voice.status}</StatusChip> },
                { label: "Version", value: <span className="font-mono text-[12px]">{src.voice.version ?? "None"}</span> },
                { label: "Tone", value: String(storeOverrides.brand_voice ?? src.voice.tone ?? "Not set") },
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
        open={proposeOpen}
        title="Submit disclosure for legal review"
        subtitle={`For ${store?.name ?? "the dealership"}. It stays unexportable until counsel's review is recorded, counsel accepts the plain-text format, and it is approved.`}
        onClose={() => setProposeOpen(false)}
        footer={<><AdminButton onClick={() => setProposeOpen(false)}>Cancel</AdminButton><AdminButton variant="primary" disabled={busy} onClick={propose}>Submit for legal review</AdminButton></>}
      >
        <div className="space-y-3">
          <Field label="Current"><p className="rounded-md border border-adm-border bg-adm-workspace px-3 py-2 text-[14px]">{activeDisclosure?.template ?? "None"}</p></Field>
          <Field label="Proposed"><p className="rounded-md border border-adm-primary bg-adm-selected px-3 py-2 text-[14px]">{proposal}</p></Field>
          <Field label="Rendered for this vehicle"><p className="rounded-md border border-adm-border px-3 py-2 text-[14px]">{proposalPreview.text}</p></Field>
        </div>
      </ReviewDialog>

      <ReviewDialog
        open={approveOpen}
        title="Approve vAuto export"
        subtitle={`${vehicle?.label ?? "Vehicle"}: exactly ${VAUTO_TARGET.toLocaleString("en-US")} characters with disclosure version ${activeDisclosure?.version ?? "none"}. The server re-proves every condition when you approve.`}
        onClose={() => setApproveOpen(false)}
        footer={<><AdminButton onClick={() => setApproveOpen(false)}>Cancel</AdminButton><AdminButton variant="primary" disabled={busy || !serverReady} onClick={approve}>Approve</AdminButton></>}
      >
        <div className="space-y-3">
          {b && <KeyValueList divided rows={[
            { label: "Selling price", value: formatMoney(b.sellingPrice) },
            { label: "Dealer Conveyance Fee", value: formatMoney(b.docFee) },
            { label: "Advertised price", value: formatMoney(b.advertisedTotal) },
          ]} />}
          <Field label="Approval note (optional)" htmlFor="de-note"><textarea id="de-note" rows={2} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </ReviewDialog>
    </ChildPageFrame>
  );
}
