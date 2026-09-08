import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { harvestVerdict, type HarvestResponse, type HarvestVerdict } from "@/lib/ingest/harvestVerdict";
import {
  fetchHarvestedOemDocLink, fetchOemDocCopyStatus, hasStoredOemDocCopy,
  type OemDocCopyStatus, type OemDocKind,
} from "@/lib/oem/resolveOemDocLink";
// The one wording for a copy outcome, shared with the edge function that
// writes the ledger row. A second phrasing here would drift from the reason
// actually recorded, and the whole point of the ledger is that the dealer and
// the record say the same thing.
import { explainCopyOutcome } from "../../../supabase/functions/_shared/oemDocCopy";
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

interface FinderState {
  found: { url: string; year?: number | null } | null;
  fromIngest: boolean;
  stored: boolean;
  copy: OemDocCopyStatus | null;
}

/**
 * What ingest already knows about this vehicle's document.
 *
 * Three reads, deliberately: the harvested manufacturer link, whether a copy
 * is held, and the copy ledger's reason when one is not. Without the third the
 * card could only say "no copy", which reads as a bug for the one case that is
 * not one — a car outside the dealer's franchise, where linking IS the answer.
 */
const useOemDocState = (kind: OemDocKind, vehicle: VehicleRow) => {
  const [state, setState] = useState<FinderState>({ found: null, fromIngest: false, stored: false, copy: null });

  useEffect(() => {
    let cancelled = false;
    void fetchHarvestedOemDocLink(kind, vehicle.ymm).then((row) => {
      if (cancelled || !row) return;
      setState((s) => ({ ...s, found: { url: row.url, year: row.year }, fromIngest: true }));
    });
    void hasStoredOemDocCopy(kind, vehicle.tenant_id, vehicle.ymm).then((held) => {
      if (!cancelled) setState((s) => ({ ...s, stored: held }));
    });
    void fetchOemDocCopyStatus(kind, vehicle.tenant_id, vehicle.ymm).then((copy) => {
      if (!cancelled) setState((s) => ({ ...s, copy }));
    });
    return () => { cancelled = true; };
  }, [kind, vehicle.ymm, vehicle.tenant_id]);

  return [state, setState] as const;
};

/**
 * The sentence that says which branch this vehicle took and why.
 *
 * A held copy wins over the ledger: the file is the fact, and a later
 * transient failure against the same model must not make a stored document
 * read as missing.
 */
const copyNote = (state: FinderState, kind: OemDocKind): string => {
  if (state.stored) return explainCopyOutcome("stored", kind);
  if (state.copy) return explainCopyOutcome(state.copy.outcome, kind);
  return "";
};

interface FinderProps {
  vehicle: VehicleRow;
  kind: OemDocKind;
  fn: string;
  title: string;
  noun: string;
  action?: (state: FinderState) => boolean;
  body?: (state: FinderState) => ReactNode | null;
}

const OemDocFinder = ({ vehicle, kind, fn, title, noun, action, body }: FinderProps) => {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useOemDocState(kind, vehicle);
  const { year, make, model } = ymmParts(vehicle.ymm);

  const find = async () => {
    if (!make || !model) { toast.error("Vehicle year/make/model is incomplete"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { make, model, year } });
      // One verdict drives the toast AND the per-VIN ledger row, so the operator
      // can never be told "linked" while the ledger says otherwise.
      const verdict = harvestVerdict(kind, data as HarvestResponse | null, error?.message ?? null, make);
      await recordHarvestVerdict(vehicle, verdict);
      if (verdict.status !== "succeeded") { toast.error(verdict.toastMessage); return; }
      setState((s) => ({ ...s, found: { url: String(data.url), year: data.year }, fromIngest: false }));
      toast.success(verdict.toastMessage);
    } finally {
      setBusy(false);
    }
  };

  const override = body?.(state);
  const note = copyNote(state, kind);
  const showAction = action ? action(state) : true;

  return (
    <Card title={title} action={
      showAction ? (
        <button onClick={find} disabled={busy} className={btn}>
          {busy ? "Searching…" : state.found ? "Search again" : `Find ${noun}`}
        </button>
      ) : undefined
    }>
      <p className="text-al-body text-muted-foreground">
        {override ?? (state.found
          ? <>
              {state.fromIngest ? "Found automatically at intake" : "Linked"} to the manufacturer's official {noun}
              {state.found.year ? ` (${state.found.year})` : ""}.{" "}
              <a href={state.found.url} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">Open</a>
              {note ? ` — ${note}` : ""}
            </>
          : <>No official {make || "model"} {noun} has been found yet. Intake looks for one automatically; search now to try again.</>)}
      </p>
    </Card>
  );
};

export const BrochureFinderRow = ({ vehicle }: { vehicle: VehicleRow }) => (
  <OemDocFinder vehicle={vehicle} kind="brochure" fn="oem-brochure" title="OEM brochure" noun="brochure" />
);

// Owner's manual: harvest the OEM link (shows on the packet), and the copy —
// when this dealership is franchised for the brand — is taken by ingest and
// the nightly sweep, with no button to press.
export const OwnersManualFinderRow = ({ vehicle }: { vehicle: VehicleRow }) => {
  const savedInDocs = (vehicle.documents || []).some((d) => d?.type === "owners_manual");
  return (
    <OemDocFinder
      vehicle={vehicle}
      kind="owners_manual"
      fn="oem-owners-manual"
      title="Owner's manual"
      noun="owner's manual"
      action={() => !savedInDocs}
      body={() => (savedInDocs ? <>Saved to this vehicle's documents.</> : null)}
    />
  );
};
