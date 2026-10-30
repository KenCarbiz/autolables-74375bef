import { useState } from "react";
import { deriveRecallView } from "@/lib/vehicleTruth/recallView";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleAlert, FolderCheck, ShieldCheck } from "lucide-react";
import { InstallProofList } from "@/components/admin/InstallProofList";
import DeliverySignoffs from "@/components/vehicle/DeliverySignoffs";
import TitleMcoPanel from "@/components/vehicle/TitleMcoPanel";
import TitleVerificationPanel from "@/components/vehicle/TitleVerificationPanel";
import VehicleEvidenceTimeline from "@/components/vehicle/VehicleEvidenceTimeline";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useVehicleTruth, type VehicleTruth } from "@/hooks/useVehicleTruth";
import { useDealRecord, dealDocStatus } from "@/hooks/useDealRecord";
import { useVehicleEvidence } from "@/lib/stickerStudio/useVehicleEvidence";
import { useRecallTask } from "@/hooks/useRecallTask";
import { Card, EmptyNote, Pair, btn, fmtWhen } from "./primitives";
import { IdentityStrip, VehicleSubHeader, lifecycleFacts } from "./SubPageHeader";
import { useComplianceFacts } from "./useComplianceFacts";
import RecallCard from "./RecallCard";
import PriceIntegrityCards from "./PriceIntegrityCard";
import SignaturesSection, { useVehicleSignatures } from "./SignaturesSection";
import { type ReadinessSummary, type VehicleRow } from "./types";
import { deriveStatusFacts, recallFact } from "./statusFacts";
import type { LifecycleResult } from "./lifecycle";
import { Button, StatusText, WorkTable, Th, Td } from "@/components/product";
import type { ReactNode } from "react";

const TruthConflictsCard = ({ truth, loading }: { truth: VehicleTruth; loading: boolean }) => {
  const blocking = truth.conflicts.filter((c) => c.blocks_generation);
  const other = truth.conflicts.filter((c) => !c.blocks_generation);

  return (
    <Card title="Vehicle truth conflicts" action={
      loading ? undefined : (
        <span className={`text-al-meta font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
          blocking.length ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
        }`}>{blocking.length ? `${blocking.length} blocking` : "No blocking conflicts"}</span>
      )
    }>
      {loading ? (
        <p className="text-al-body text-muted-foreground">Reading the resolved snapshot…</p>
      ) : truth.conflicts.length === 0 ? (
        <p className="text-al-body text-emerald-700 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> Every source agrees on this vehicle's facts.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...blocking, ...other].map((c) => (
            <li key={c.id} className={`rounded-xl border px-4 py-3 ${c.blocks_generation ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-al-body font-semibold text-foreground">{c.fact_key.replace(/_/g, " ")}</p>
              <p className="text-al-meta text-muted-foreground">
                {c.candidates.map((x) => `${String(x.value)} (${x.sourceKind})`).join(" vs ")}
                {c.blocks_generation ? " · blocks document generation" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-al-meta text-muted-foreground">
        The full resolved snapshot — every fact next to who said it and how strongly — is on the Overview tab.
      </p>
    </Card>
  );
};

const OfficialFormsCard = ({ vehicle }: { vehicle: VehicleRow }) => {
  const navigate = useNavigate();
  const { record, loading } = useDealRecord(vehicle.vin, vehicle.id, vehicle.tenant_id);
  if (loading || !record) {
    return <Card title="Buyers Guide & safety inspection"><p className="text-al-body text-muted-foreground">Loading the deal record…</p></Card>;
  }
  const docs = dealDocStatus(record);
  if (!record.isUsed) {
    return (
      <Card title="Buyers Guide & safety inspection">
        <p className="text-al-body text-muted-foreground">
          The FTC Buyers Guide (16 CFR Part 455) and the state used-car safety inspection apply to used and CPO stock. This vehicle is new stock, so neither is required.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Buyers Guide & safety inspection" action={
      <button onClick={() => navigate(`/vehicle-file/${vehicle.id}?tab=documents`)} className={btn}>Open Documents</button>
    }>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Pair label="FTC Buyers Guide" value={docs.buyersGuide ? "Filed" : "Not filed"} />
        <Pair label="Guide version" value={record.buyersGuide?.version != null ? `v${record.buyersGuide.version}` : "None"} />
        <Pair label="Guide box" value={record.buyersGuide?.box ? record.buyersGuide.box.replace(/_/g, " ") : "Not selected"} />
        <Pair label="Guide language" value={record.buyersGuide?.lang ? record.buyersGuide.lang.toUpperCase() : "Not selected"} />
        <Pair label="Safety inspection" value={docs.k208 ? "Executed" : "Not executed"} />
        <Pair label="Inspection result" value={record.k208?.result ? record.k208.result.toUpperCase() : "No signed record"} />
        <Pair label="Certified" value={record.k208?.certifiedAt ? (fmtWhen(record.k208.certifiedAt) ?? "Yes") : "Not certified"} />
        <Pair label="Deal processed" value={record.processedAt ? (fmtWhen(record.processedAt) ?? "Yes") : "Not processed"} />
      </div>
      <p className="text-al-meta text-muted-foreground">
        Shown for visibility only. Signing and certification authority come from the store's own policy and are enforced server-side — never inferred from a job title.
      </p>
    </Card>
  );
};

export const ComplianceTab = ({ vehicle, ready, recall, lifecycle, onReload }: {
  strip?: ReactNode;
  vehicle: VehicleRow;
  ready: ReadinessSummary;
  lifecycle: LifecycleResult;
  recall: ReturnType<typeof useRecallTask>;
  onReload: () => void;
}) => {
  const { tier } = useEntitlements();
  const titleVerifyEnabled = tier("autolabels") === "compliance_pro";
  const signatures = useVehicleSignatures(vehicle.vin);
  const { events } = useVehicleEvidence(vehicle.id, vehicle.vin, vehicle.tenant_id);
  const { truth, loading: truthLoading } = useVehicleTruth(vehicle.tenant_id, vehicle.id);
  const [building, setBuilding] = useState(false);
  const facts = deriveStatusFacts({ vehicle, ready, lifecycle });
  const recallLine = recallFact(vehicle);
  const readiness = { label: facts.retail.value };
  const cf = useComplianceFacts(vehicle);

  const blockerRows: { key: string; item: string; details: string; evidence?: { label: string; to: string }; when: string | null }[] = [];
  if (recallLine.tone === "neutral") {
    blockerRows.push({ key: "recall", item: "Recall status unknown", details: "No VIN-level recall check has answered.", evidence: { label: "View recall card", to: "#vf-recall-card" }, when: vehicle.recall_checked_at });
  }
  for (const b of ready.blockers.filter((c) => /recall/i.test(c.label))) {
    blockerRows.push({ key: `ready-${b.label}`, item: b.label, details: "Blocks publishing until the service department records an outcome.", when: b.when });
  }
  if (!cf.loading) {
    if (cf.price.tone === "danger") blockerRows.push({ key: "price", item: "Price mismatch", details: cf.price.detail ?? "", evidence: { label: "View price card", to: "#vf-price-card" }, when: cf.price.checkedAt });
    if (cf.safety.tone === "danger") blockerRows.push({ key: "safety", item: `Safety inspection ${cf.safety.value.toLowerCase()}`, details: cf.safety.detail ?? "", evidence: { label: "View inspection", to: "#vf-forms-card" }, when: cf.safety.checkedAt });
    if (cf.delivery.tone === "warning") blockerRows.push({ key: "delivery", item: "Delivery sign-offs incomplete", details: `${cf.delivery.value}. ${cf.delivery.detail ?? ""}`.trim(), evidence: { label: "View sign-offs", to: "#vf-delivery-card" }, when: null });
    if (cf.title.tone === "warning") blockerRows.push({ key: "title", item: "Title missing", details: cf.title.detail ?? "", evidence: { label: "View title", to: "#vf-title-card" }, when: null });
  }
  const strip = (
    <IdentityStrip
      vehicle={vehicle}
      facts={(() => {
        const lc = lifecycleFacts(vehicle, lifecycle, blockerRows.length);
        return [
          { label: "Owner", value: lc.owner },
          { label: "Days in inventory", value: String(lc.days) },
          { label: "Current state", value: lc.state },
          { label: "Next action", value: lc.nextAction },
        ];
      })()}
      tag={blockerRows.length > 0 ? <StatusText tone="danger">Not retail ready</StatusText> : undefined}
    />
  );

  // The defense packet is the whole compliance state of one VIN in a single
  // file: what was checked, what was signed, what was advertised, and the
  // evidence timeline that backs each claim. It is assembled from stored rows
  // only — nothing here is generated to fill a gap.
  const buildPacket = () => {
    if (events.length === 0) {
      toast.error("No evidence has been recorded for this VIN yet — there is nothing to defend with.");
      return;
    }
    setBuilding(true);
    try {
      const packet = {
        built_at: new Date().toISOString(),
        vehicle: {
          id: vehicle.id,
          vin: vehicle.vin,
          ymm: vehicle.ymm,
          trim: vehicle.trim,
          condition: vehicle.condition,
          mileage: vehicle.mileage,
          advertised_price: vehicle.price,
          status: vehicle.status,
          published_at: vehicle.published_at,
        },
        readiness: {
          label: readiness.label,
          blockers: ready.blockers.map((b) => b.label),
          open_items: ready.remaining.map((b) => b.label),
        },
        recall: (() => {
          // The compliance packet is evidence. It carries the scope of every
          // recall answer so a reader can never mistake a model-level zero for
          // a verified VIN, and the raw columns stay beside it as provenance.
          const view = deriveRecallView(vehicle);
          return {
            vin_verification: {
              state: view.vin.state,
              check_complete: view.vin.checkComplete,
              clear_claim_allowed: view.vin.clearClaimAllowed,
              open_count: view.vin.openCount,
              source: view.vin.source,
              checked_at: view.vin.checkedAt,
            },
            model_campaign_context: view.model
              ? { state: view.model.state, campaign_count: view.model.campaignCount, source: view.model.source, checked_at: view.model.checkedAt }
              : null,
            do_not_drive: view.doNotDrive,
            stored_columns: {
              status: vehicle.recall_status,
              checked_at: vehicle.recall_checked_at,
              open_count: vehicle.open_recall_count,
            },
            review_task: recall.task,
          };
        })(),
        truth_conflicts: truth.conflicts.map((c) => ({
          fact_key: c.fact_key,
          blocks_generation: c.blocks_generation,
          candidates: c.candidates,
          status: c.status,
        })),
        signatures: {
          captured: signatures.signings,
          deal_tokens: signatures.tokens,
        },
        evidence: events.map((e) => ({
          at: e.at, category: e.category, title: e.title, detail: e.detail, content_hash: e.contentHash,
        })),
      };
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vin-defense-${vehicle.vin}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("VIN defense packet built");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-6">
      <VehicleSubHeader
        vehicle={vehicle}
        section="Compliance"
        crumbs={false}
        title="Vehicle compliance"
        description="Review compliance status and resolve any blockers."
        strip={strip}
        actions={
          <Button variant="primary" onClick={() => document.getElementById("vf-compliance-blockers")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            Review blocker
          </Button>
        }
      />

      <div className="space-y-3">
        <h3 className="text-[15px] leading-[22px] font-semibold text-adm-ink">Compliance status</h3>
        <dl className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Compliance status">
          {[
            { f: recallLine, to: "#vf-recall-card" },
            { f: cf.price, to: "#vf-price-card" },
            { f: cf.safety, to: "#vf-forms-card" },
            { f: cf.delivery, to: "#vf-delivery-card" },
            { f: cf.title, to: "#vf-title-card" },
          ].map(({ f, to }) => (
            <div key={f.label} className="min-w-0 rounded-[6px] border border-adm-border bg-adm-surface p-3">
              <dt className="text-[13px] leading-[18px] text-adm-ink">{f.label}</dt>
              <dd className="mt-1 flex flex-col items-start gap-1">
                <StatusText tone={f.tone}>{f.value}</StatusText>
                <span className="block min-h-[36px] text-[12px] leading-[18px] text-adm-muted">{f.detail}</span>
                <a href={to} className="text-[13px] font-semibold text-adm-primary hover:underline">View details</a>
              </dd>
            </div>
          ))}
        </dl>

        <div id="vf-compliance-blockers" className="scroll-mt-24">
          <p className="text-[15px] leading-[22px] font-semibold text-adm-ink mb-2">
            Current blockers ({blockerRows.length})
          </p>
          {blockerRows.length === 0 ? (
            <p className="text-[14px] leading-[20px] text-adm-muted">No compliance blockers on this vehicle.</p>
          ) : (
            <div className="overflow-hidden rounded-[6px] border border-adm-border bg-adm-surface">
              <WorkTable caption="Current blockers" minWidth={640}>
                <thead>
                  <tr><Th>Item</Th><Th>Details</Th><Th>Evidence</Th><Th>Updated</Th></tr>
                </thead>
                <tbody>
                  {blockerRows.map((r) => (
                    <tr key={r.key}>
                      <Td className="font-semibold">
                        <span className="inline-flex items-center gap-2"><CircleAlert className="h-5 w-5 shrink-0 text-adm-danger" aria-hidden="true" />{r.item}</span>
                      </Td>
                      <Td className="text-adm-muted">{r.details}</Td>
                      <Td>{r.evidence ? <a className="text-adm-primary hover:underline" href={r.evidence.to}>{r.evidence.label}</a> : <span className="text-adm-muted">-</span>}</Td>
                      <Td className="text-adm-muted">{fmtWhen(r.when) ?? "-"}</Td>
                    </tr>
                  ))}
                </tbody>
              </WorkTable>
            </div>
          )}
        </div>
        {events.length === 0 && (
          <p className="text-[12px] leading-[18px] text-adm-muted">
            No evidence events are recorded for this VIN yet, so a defense packet cannot be built.
          </p>
        )}
      </div>

      <div className="flex justify-start">
        <button onClick={buildPacket} disabled={building || events.length === 0} className={btn}>
          <FolderCheck className="w-5 h-5" /> Build VIN defense packet
        </button>
      </div>

      <div id="vf-price-card" className="scroll-mt-24"><PriceIntegrityCards vehicle={vehicle} /></div>

      <div id="vf-recall-card" className="scroll-mt-24"><RecallCard vehicle={vehicle} recall={recall} /></div>

      <div id="vf-forms-card" className="scroll-mt-24"><OfficialFormsCard vehicle={vehicle} /></div>

      <div id="vf-delivery-card" className="scroll-mt-24"><DeliverySignoffs vin={vehicle.vin} tenantId={vehicle.tenant_id} condition={vehicle.condition} /></div>

      <SignaturesSection vehicle={vehicle} record={signatures} />

      <Card title="Install proof">
        <p className="text-al-body text-muted-foreground">
          Vendor and detail-shop installs verified through the scan-to-verify QR flow.
        </p>
        <InstallProofList vin={vehicle.vin} />
      </Card>

      <div id="vf-title-card" className="scroll-mt-24"><TitleMcoPanel vin={vehicle.vin} tenantId={vehicle.tenant_id} condition={vehicle.condition} /></div>

      <TitleVerificationPanel
        listingId={vehicle.id}
        vin={vehicle.vin}
        tenantId={vehicle.tenant_id}
        condition={vehicle.condition}
        titleVerification={vehicle.title_verification}
        enabled={titleVerifyEnabled}
        onUpdated={onReload}
      />

      <TruthConflictsCard truth={truth} loading={truthLoading} />

      <Card title="Audit evidence">
        {events.length === 0 ? (
          <EmptyNote
            title="Nothing has been recorded against this VIN yet"
            detail="Evidence rows are written as documents are generated, printed, signed, scanned and published. The timeline fills itself as the vehicle moves."
          />
        ) : (
          <VehicleEvidenceTimeline
            vehicleId={vehicle.id}
            vin={vehicle.vin}
            tenantId={vehicle.tenant_id}
            vehicleTitle={vehicle.ymm || vehicle.vin}
          />
        )}
      </Card>
    </div>
  );
};

export default ComplianceTab;
