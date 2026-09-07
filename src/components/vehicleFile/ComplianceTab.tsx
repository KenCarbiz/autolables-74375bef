import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FolderCheck, ShieldCheck } from "lucide-react";
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
import { Card, EmptyNote, Pair, TabHeader, btn, btnLarge, fmtWhen } from "./primitives";
import RecallCard from "./RecallCard";
import PriceIntegrityCards from "./PriceIntegrityCard";
import SignaturesSection, { useVehicleSignatures } from "./SignaturesSection";
import { readinessLabel, type ReadinessSummary, type VehicleRow } from "./types";

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

export const ComplianceTab = ({ vehicle, ready, recall, onReload }: {
  vehicle: VehicleRow;
  ready: ReadinessSummary;
  recall: ReturnType<typeof useRecallTask>;
  onReload: () => void;
}) => {
  const { tier } = useEntitlements();
  const titleVerifyEnabled = tier("autolabels") === "compliance_pro";
  const signatures = useVehicleSignatures(vehicle.vin);
  const { events } = useVehicleEvidence(vehicle.id, vehicle.vin, vehicle.tenant_id);
  const { truth, loading: truthLoading } = useVehicleTruth(vehicle.tenant_id, vehicle.id);
  const [building, setBuilding] = useState(false);
  const readiness = readinessLabel(ready);

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
        recall: {
          status: vehicle.recall_status,
          checked_at: vehicle.recall_checked_at,
          open_count: vehicle.open_recall_count,
          review_task: recall.task,
        },
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
      <TabHeader
        title="Compliance"
        description="Everything that has to be true, checked and signed for this VIN — and the evidence that proves it."
        action={
          <button onClick={buildPacket} disabled={building || events.length === 0} className={btnLarge}>
            <FolderCheck className="w-4 h-4" /> Build VIN defense packet
          </button>
        }
      />

      <Card title="Compliance status" action={
        <span className={`text-al-meta font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
          readiness.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
        }`}>{readiness.label}</span>
      }>
        {ready.remaining.length === 0 ? (
          <p className="text-al-body text-emerald-700 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 shrink-0" /> Every tracked item on this vehicle is complete.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {ready.remaining.map((c) => (
              <li key={c.label} className={`text-al-body inline-flex items-center gap-1.5 ${c.blocks ? "text-amber-700" : "text-muted-foreground"}`}>
                <AlertTriangle className="w-4 h-4 shrink-0" /> {c.label}{c.blocks ? " — blocks publish" : ""}
              </li>
            ))}
          </ul>
        )}
        {events.length === 0 && (
          <p className="text-al-meta text-muted-foreground">
            No evidence events are recorded for this VIN yet, so a defense packet cannot be built.
          </p>
        )}
      </Card>

      <PriceIntegrityCards vehicle={vehicle} />

      <RecallCard vehicle={vehicle} recall={recall} />

      <OfficialFormsCard vehicle={vehicle} />

      <DeliverySignoffs vin={vehicle.vin} tenantId={vehicle.tenant_id} condition={vehicle.condition} />

      <SignaturesSection vehicle={vehicle} record={signatures} />

      <Card title="Install proof">
        <p className="text-al-body text-muted-foreground">
          Vendor and detail-shop installs verified through the scan-to-verify QR flow.
        </p>
        <InstallProofList vin={vehicle.vin} />
      </Card>

      <TitleMcoPanel vin={vehicle.vin} tenantId={vehicle.tenant_id} condition={vehicle.condition} />

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
