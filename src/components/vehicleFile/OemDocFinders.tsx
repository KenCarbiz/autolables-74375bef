import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { harvestVerdict, type HarvestResponse, type HarvestVerdict } from "@/lib/ingest/harvestVerdict";
import { fetchHarvestedOemDocLink, hasStoredOemDocCopy } from "@/lib/oem/resolveOemDocLink";
import { recordIngestStep } from "@/lib/ingest/recordIngestStep";
import { Card, btn } from "./primitives";
import type { VehicleRow } from "./types";

// File the harvest outcome against this VIN. Best-effort: a ledger write that
// fails must not change what the operator is told about the harvest itself,
// but it is logged rather than discarded.
const recordHarvestVerdict = async (vehicle: VehicleRow, verdict: HarvestVerdict): Promise<void> => {
  await recordIngestStep({
    tenantId: vehicle.tenant_id,
    vin: vehicle.vin,
    vehicleId: vehicle.id,
    step: verdict.step,
    status: verdict.status,
    reason: verdict.reason,
    detail: { trigger: "vehicle_file_manual" },
  });
};

const ymmParts = (ymm: string | null) => {
  const parts = (ymm || "").trim().split(/\s+/);
  return {
    year: Number.parseInt(parts[0] || "", 10) || null,
    make: parts[1] || "",
    model: parts.slice(2).join(" "),
  };
};

export const BrochureFinderRow = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ url: string; year?: number | null } | null>(null);
  // Harvested at ingest, not by this button. Without this read the card asked
  // the operator to search for a document the pipeline had already filed — and
  // the harvester would refuse to look again precisely because it is cached.
  const [fromIngest, setFromIngest] = useState(false);
  const [stored, setStored] = useState(false);
  const { year, make, model } = ymmParts(vehicle.ymm);

  useEffect(() => {
    let cancelled = false;
    void fetchHarvestedOemDocLink("brochure", vehicle.ymm).then((row) => {
      if (cancelled || !row) return;
      setFound({ url: row.url, year: row.year });
      setFromIngest(true);
    });
    void hasStoredOemDocCopy("brochure", vehicle.tenant_id, vehicle.ymm).then((held) => {
      if (!cancelled) setStored(held);
    });
    return () => { cancelled = true; };
  }, [vehicle.ymm, vehicle.tenant_id]);

  const find = async () => {
    if (!make || !model) { toast.error("Vehicle year/make/model is incomplete"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("oem-brochure", { body: { make, model, year } });
      // One verdict drives the toast AND the per-VIN ledger row, so the operator
      // can never be told "linked" while the ledger says otherwise.
      const verdict = harvestVerdict("brochure", data as HarvestResponse | null, error?.message ?? null, make);
      await recordHarvestVerdict(vehicle, verdict);
      if (verdict.status !== "succeeded") { toast.error(verdict.toastMessage); return; }
      setFound({ url: String(data.url), year: data.year });
      setFromIngest(false);
      toast.success(verdict.toastMessage);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="OEM brochure" action={
      <button onClick={find} disabled={busy} className={btn}>
        {busy ? "Searching…" : found ? "Search again" : "Find OEM brochure"}
      </button>
    }>
      <p className="text-al-body text-muted-foreground">
        {found
          ? <>{fromIngest ? "Found automatically at intake" : "Linked"} to the manufacturer's official brochure{found.year ? ` (${found.year})` : ""}. <a href={found.url} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">Open</a>{stored ? " — a copy is stored for this dealership, so the packet keeps working if the manufacturer moves the file." : ""}</>
          : <>No official {make || "model"} brochure has been found yet. Intake looks for one automatically; search now to try again.</>}
      </p>
    </Card>
  );
};

// Owner's manual: harvest the OEM link (shows on the packet, no bytes stored),
// then optionally pull a copy into the vehicle's documents with one click.
export const OwnersManualFinderRow = ({ vehicle }: { vehicle: VehicleRow }) => {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ url: string; year?: number | null } | null>(null);
  const [fromIngest, setFromIngest] = useState(false);
  const [stored, setStored] = useState(false);
  const savedInDocs = (vehicle.documents || []).some((d) => d?.type === "owners_manual");
  const { year, make, model } = ymmParts(vehicle.ymm);

  useEffect(() => {
    let cancelled = false;
    void fetchHarvestedOemDocLink("owners_manual", vehicle.ymm).then((row) => {
      if (cancelled || !row) return;
      setFound({ url: row.url, year: row.year });
      setFromIngest(true);
    });
    void hasStoredOemDocCopy("owners_manual", vehicle.tenant_id, vehicle.ymm).then((held) => {
      if (!cancelled) setStored(held);
    });
    return () => { cancelled = true; };
  }, [vehicle.ymm, vehicle.tenant_id]);

  const find = async () => {
    if (!make || !model) { toast.error("Vehicle year/make/model is incomplete"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("oem-owners-manual", { body: { make, model, year } });
      const verdict = harvestVerdict("owners_manual", data as HarvestResponse | null, error?.message ?? null, make);
      await recordHarvestVerdict(vehicle, verdict);
      if (verdict.status !== "succeeded") { toast.error(verdict.toastMessage); return; }
      setFound({ url: String(data.url), year: data.year });
      setFromIngest(false);
      toast.success(verdict.toastMessage);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Owner's manual" action={
      savedInDocs ? undefined : (
        <button onClick={find} disabled={busy} className={btn}>
          {busy ? "Searching…" : found ? "Search again" : "Find owner's manual"}
        </button>
      )
    }>
      <p className="text-al-body text-muted-foreground">
        {savedInDocs
          ? <>Saved to this vehicle's documents.</>
          : found
          ? <>{fromIngest ? "Found automatically at intake" : "Linked"} to the manufacturer's official manual{found.year ? ` (${found.year})` : ""}. <a href={found.url} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">Open</a>{stored
              ? " — a copy is stored for this dealership, so the packet keeps working if the manufacturer moves the file."
              : " — the shopper packet links straight to the manufacturer."}</>
          : <>No official {make || "model"} owner's manual has been found yet. Intake looks for one automatically; search now to try again.</>}
      </p>
    </Card>
  );
};
