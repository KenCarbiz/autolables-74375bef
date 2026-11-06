import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import type { VehicleFile } from "@/types/vehicleFile";
import { recordLabel } from "@/pages/admin/children/inventoryNetwork/ledgers";
import { Al97Frame, Banner, Card, KeyVals, Metrics, Savebar, useFixtureCopy, type MetricItem } from "@/components/admin/al97/al97ui";
import preserveRecords from "@/assets/al97/preserve-records.svg";

// Vehicle files by store association. Reads the existing file records only:
// no association writer exists on the server, so this page assigns nothing,
// deletes nothing and never regenerates a file. Every row links to the file
// itself, read-only, and the full list stays on the Vehicle files tab.

export interface VehicleFileRowView {
  id: string;
  storeId: string | null;
  evidence: string[];
}

export interface VehicleFilesFixture {
  account: string;
  store: string | null;
  storeId: string | null;
  rows: VehicleFileRowView[];
  stats: { tenantTotal: number; storeAssigned: number; unassigned: number } | null;
  /** Provider re-pulls during association; null when no ledger was read. */
  providerRepulls?: number | null;
}

const FILES_TAB = adminTabHref("vehicle-files");
const ROW_LIMIT = 25;

export function fileEvidence(f: Pick<VehicleFile, "signings" | "attached_documents" | "deal_qr_token" | "stickers">): string[] {
  const parts: string[] = [];
  if (f.signings?.length) parts.push("Signed document");
  if (f.attached_documents?.length) parts.push(f.attached_documents.length === 1 ? f.attached_documents[0].label || "Document" : `${f.attached_documents.length} documents`);
  if (f.deal_qr_token || f.stickers?.some((s) => !!s.tracking_code)) parts.push("QR link");
  return parts.length ? parts : ["Vehicle data only"];
}

export function VehicleFilesScreen({ account, store, storeId, rows, stats, providerRepulls = null, loading = false }: VehicleFilesFixture & { loading?: boolean }) {
  const copy = useFixtureCopy();
  const scopeLabel = { account, store };
  const more = (
    <p className="mt-4 text-[13px] text-adm-muted">
      Search, stickers and signing status for every file stay on the <Link to={FILES_TAB} className="font-semibold text-adm-primary hover:underline">Vehicle files</Link> tab. Custody episodes, service visits and returns are on <Link to={ADMIN_CHILD_ROUTES.vehicleRecords} className="font-semibold text-adm-primary hover:underline">Vehicle records &amp; lifecycle</Link>.
    </p>
  );
  const frame = (crumb: string, subtitle: string, main: ReactNode) => (
    <Al97Frame crumb={crumb} title={crumb} subtitle={subtitle} scopeLabel={scopeLabel} main={main}>{more}</Al97Frame>
  );
  const baseSubtitle = "Existing compliance records stay with the vehicle throughout reconciliation.";

  if (loading) return frame("Vehicle files", baseSubtitle, <div className="work" aria-busy="true"><Banner tone="blue" icon="info" title="Reading vehicle files" detail="Counts show once the file records answer." /></div>);
  if (!stats) {
    const unknownStats: MetricItem[] = [
      { label: "Tenant files", value: "Unknown", sub: "Read failed", icon: "file", known: false },
      { label: "Assigned to this store", value: "Unknown", sub: "Read failed", icon: "store", known: false },
      { label: "Unassigned legacy", value: "Unknown", sub: "Read failed", icon: "warning", known: false },
      { label: "Deleted by this review", value: "0", sub: "Preserve all originals", icon: "shield" },
    ];
    return frame("Vehicle files", baseSubtitle, (
      <div className="work">
        <Banner tone="red" icon="warning" title="Vehicle files could not be read" detail="This is a read failure, not an empty file cabinet. No file is shown as missing or unassigned." />
        <Metrics label="Vehicle file ownership" items={unknownStats} />
      </div>
    ));
  }

  const own = rows.filter((r) => storeId && r.storeId === storeId);
  const loose = rows.filter((r) => !r.storeId);

  if (stats.storeAssigned > 0) {
    const listed = [...own, ...loose].slice(0, ROW_LIMIT);
    const items: MetricItem[] = [
      { label: "Tenant files", value: stats.tenantTotal.toLocaleString(), sub: copy("files.totalSub", "Existing records"), icon: "file" },
      { label: "Selected-store files", value: stats.storeAssigned.toLocaleString(), sub: copy("files.storeSub", "Exact store filter"), icon: "store" },
      { label: "Still unassigned", value: stats.unassigned.toLocaleString(), sub: "Ambiguity retained", icon: "warning" },
      { label: "Provider re-pulls", value: providerRepulls == null ? "Unknown" : providerRepulls.toLocaleString(), sub: providerRepulls == null ? "Not tracked here" : "Saved data reused", icon: "shield", known: providerRepulls != null },
    ];
    return frame("Vehicle files / associated", `Repaired visibility state${copy("caption", "")}`, (
      <div className="work">
        <Banner tone="blue" icon="info" title="Existing records are visible" detail={copy("files.associatedDetail", "Files assigned to this store and files without a store are both listed; nothing was regenerated.")} />
        <Metrics label="Vehicle file ownership" items={items} />
        <Card id="vf-registry" title="Store file registry" description={copy("files.registryNote", `${stats.storeAssigned.toLocaleString()} assigned to this store and ${stats.unassigned.toLocaleString()} without a store, read from the file records.`)}>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">File</th><th scope="col">Store association</th><th scope="col">Evidence retained</th><th scope="col">State</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {listed.map((r) => (
                  <tr key={r.id}>
                    <td>{recordLabel("VF", r.id)}</td>
                    <td>{r.storeId ? "Confirmed owning store" : "Unassigned"}</td>
                    <td>{r.storeId ? r.evidence.join(" · ") : "Original record preserved"}</td>
                    <td>{r.storeId ? <span className="chip green">Available</span> : <span className="chip amber">Needs review</span>}</td>
                    <td><Link to={`/vehicle-file/${r.id}`}>{r.storeId ? "Open file" : "Review association"}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="split">
          <div><Card id="vf-preservation" title="Preservation checks"><KeyVals rows={[["File IDs", "Unchanged"], ["Signed document hashes", "Unchanged"], ["Public links", "Preserved"], ["Compatible paid evidence", "Retained with provenance"]]} /></Card></div>
          <div><Card id="vf-recovery" title="Recovery"><KeyVals rows={[["Operation", "Versioned association plan"], ["Before-images", "Retained securely"], ["Later edits", "Blind undo refused"], ["Ambiguous ownership", "Never automatically assigned"]]} /></Card></div>
        </div>
        <Savebar title="No regeneration needed" detail="Selected-store readers include only permitted records and truthfully expose unassigned totals."
          action={<Link to={adminTabHref("activity")} className="btn">View association history</Link>} />
      </div>
    ));
  }

  const queue = loose.slice(0, ROW_LIMIT);
  const items: MetricItem[] = [
    { label: "Tenant files", value: stats.tenantTotal.toLocaleString(), sub: "Existing records", icon: "file" },
    { label: "Assigned to this store", value: stats.storeAssigned.toLocaleString(), sub: "Exact store filter", icon: "store" },
    { label: "Unassigned legacy", value: stats.unassigned.toLocaleString(), sub: "Ownership review needed", icon: "warning" },
    { label: "Deleted by this review", value: "0", sub: "Preserve all originals", icon: "shield" },
  ];
  return frame("Vehicle files", baseSubtitle, (
    <div className="work">
      {stats.unassigned > 0
        ? <Banner tone="amber" icon="warning" title={`${stats.unassigned.toLocaleString()} legacy ${stats.unassigned === 1 ? "file needs" : "files need"} a store association review`} detail="These records exist. They must not disappear behind an exact-store filter or be recreated as replacements." />
        : <Banner tone="blue" icon="info" title="No vehicle files for this store yet" detail="Files appear here when a sticker is published for a vehicle at this store." />}
      <Metrics label="Vehicle file ownership" items={items} />
      <Card id="vf-queue" title="Legacy association queue" description={copy("files.queueNote", "Assigning a store needs a reviewed server writer that does not exist yet, so this list is read-only.")}>
        <div className="table-wrap">
          <table>
            {loose.length > queue.length && <caption className="sr-only">{`First ${queue.length} of ${loose.length} unassigned files.`}</caption>}
            <thead><tr><th scope="col">Record</th><th scope="col">Current owner</th><th scope="col">Related evidence</th><th scope="col">Disposition</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.id}>
                  <td>{recordLabel("VF", r.id)}</td>
                  <td>Unassigned</td>
                  <td>{r.evidence.join(" + ")}</td>
                  <td><span className="chip amber">Review ownership</span></td>
                  <td><Link to={`/vehicle-file/${r.id}`}>Inspect</Link></td>
                </tr>
              ))}
              {queue.length === 0 && <tr><td colSpan={5}>No unassigned files.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="split">
        <div>
          <Card id="vf-preserve" title="Preserve linked records">
            <img className="art" src={preserveRecords} alt="" />
            <p>Established listing → Passport / QR → documents → signed evidence → provider cache.</p>
          </Card>
        </div>
        <div>
          <Card id="vf-safeguards" title="Assignment safeguards">
            <KeyVals rows={[["Tenant boundary", "Exact account match required"], ["Store evidence", "Identity and ownership reviewed"], ["Concurrent edits", "Recheck before applying"], ["Recovery", "Versioned reversible association"]]} />
          </Card>
        </div>
      </div>
      <Savebar title="Review before assignment" detail="No bulk ownership guessing, duplicate generation or provider re-pulls."
        action={<Link to={FILES_TAB} className="btn primary">Review legacy associations</Link>} />
    </div>
  ));
}

function LiveVehicleFiles() {
  const { tenant, currentStore } = useTenant();
  const storeId = currentStore?.id ?? "";
  const { files, stats, isError, loading } = useVehicleFiles(storeId);
  return (
    <VehicleFilesScreen
      account={tenant?.name ?? "This account"}
      store={currentStore?.name ?? null}
      storeId={storeId || null}
      rows={files.map((f) => ({ id: f.id, storeId: f.store_id || null, evidence: fileEvidence(f) }))}
      stats={isError ? null : { tenantTotal: stats.tenantTotal, storeAssigned: stats.storeAssigned, unassigned: stats.unassigned }}
      loading={loading && !isError}
    />
  );
}

export default function VehicleFilesPage() {
  const fx = useViewFixture<VehicleFilesFixture>("vehicle-files");
  return fx ? <VehicleFilesScreen {...fx} /> : <LiveVehicleFiles />;
}
