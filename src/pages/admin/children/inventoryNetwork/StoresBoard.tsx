import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { FeedBinding, StoreOverview } from "@/lib/inventoryNetwork/api";
import { Al97Frame, Banner, Card, ChipView, Glyph, KeyVals, Savebar, type ScopePicker } from "@/components/admin/al97/al97ui";
import { storeSourcePath, useLedgers } from "./ledgers";
import type { Chip } from "./overviewModel";
import { fileName, mcModeLabel, plural, useNet } from "./shared";

export interface StoreReadiness {
  store: StoreOverview;
  path: string | null;
  mapping: Chip;
  binding: Chip;
  feed: Chip;
  blockers: string[];
}

export function storeReadiness(s: StoreOverview, tenantId: string, path: string | null, bindings: FeedBinding[] | null): StoreReadiness {
  const st = s.store;
  const blockers: string[] = [];
  const approvedMapping = s.mappings.some((m) => m.status === "approved");
  const pendingMapping = s.mappings.some((m) => m.status === "pending");
  const mapping: Chip = approvedMapping ? { label: "Approved", tone: "green" } : pendingMapping ? { label: "Pending", tone: "amber" } : { label: "Missing", tone: "amber" };
  if (!approvedMapping) blockers.push(pendingMapping ? "dealer mapping pending" : "dealer mapping missing");

  let binding: Chip;
  if (!path) { binding = { label: "No file", tone: "neutral" }; blockers.push("no feed file recorded"); }
  else if (bindings === null) { binding = { label: "Unknown", tone: "neutral" }; blockers.push("file binding not read"); }
  else {
    const b = bindings.find((x) => x.path === path);
    if (!b) { binding = { label: "Missing", tone: "amber" }; blockers.push("file binding missing"); }
    else if (b.status === "approved" && b.tenant_id !== tenantId) { binding = { label: "Other account", tone: "red" }; blockers.push("file bound to another account"); }
    else if (b.status === "approved") binding = { label: "Approved", tone: "green" };
    else if (b.status === "pending") { binding = { label: "Pending", tone: "amber" }; blockers.push("file binding pending"); }
    else { binding = { label: "Disabled", tone: "neutral" }; blockers.push("file binding disabled"); }
  }

  let feed: Chip;
  if (st.status === "inactive") { feed = { label: "Inactive", tone: "neutral" }; blockers.push("store inactive"); }
  else if (!st.inventory_feed_enabled) { feed = { label: "Off", tone: "neutral" }; blockers.push("feed off"); }
  else if (st.feed_import_paused) { feed = { label: "Paused", tone: "neutral" }; blockers.push("store import paused"); }
  else feed = { label: "Importing", tone: "green" };
  return { store: s, path, mapping, binding, feed, blockers };
}

export default function StoresBoard({ scope, children }: { scope?: ScopePicker; children?: ReactNode }) {
  const { group, stores, href, go } = useNet();
  const [params] = useSearchParams();
  const l = useLedgers({ bindings: true, snapshots: true, runs: true });
  const rows = stores.map((s) => storeReadiness(s, group.tenant_id, storeSourcePath(s.store.id, s.mappings.map((m) => m.source_dealer_id), l.snapshots, l.runs), l.bindings));
  const notReady = rows.filter((r) => r.blockers.length > 0);
  const primary = stores.find((s) => s.store.is_primary_inventory_store) ?? null;
  const chosen = stores.find((s) => s.store.id === params.get("store")) ?? primary ?? stores[0] ?? null;
  const policy = chosen?.policy ?? null;
  const mode = mcModeLabel(policy);
  const modeTone = mode.tone === "danger" ? "red" : mode.tone === "warning" ? "amber" : "blue";
  const mappingsAllApproved = notReady.length > 0 && notReady.every((r) => r.mapping.tone === "green");

  const main = (
    <div className="work">
      {notReady.length > 0 && (
        <Banner
          tone="amber"
          icon="warning"
          title={`${plural(notReady.length, "store")} ${notReady.length === 1 ? "is" : "are"} not ready to import`}
          detail={mappingsAllApproved ? `${notReady.length === 1 ? "Its dealer mapping is" : "Their dealer mappings are"} approved. File bindings and store pauses are separate requirements.` : "Each row shows its dealer mapping, file binding and pause separately. Every one must be ready before import."}
        />
      )}
      <div>
        <Card id="inv-stores-h" title={group.name} description={`Primary: ${primary?.store.display_name ?? "Not set"} · sharing does not grant a paid-data entitlement.`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Store / source</th><th scope="col">Dealer mapping</th><th scope="col">File binding</th><th scope="col">Feed</th><th scope="col">Inventory</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6}>No stores in this group yet.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.store.store.id}>
                    <td><b>{r.store.store.display_name}</b><small>{r.path ? fileName(r.path) : "No feed file recorded"}</small></td>
                    <td><ChipView chip={r.mapping} /></td>
                    <td><ChipView chip={r.binding} /></td>
                    <td><ChipView chip={r.feed} /></td>
                    <td>{r.store.counts.present}</td>
                    <td>
                      <Link to={href("stores", { store: r.store.store.id })} aria-label={`Open ${r.store.store.display_name}${r.blockers.length ? `. Blockers: ${r.blockers.join(", ")}` : ". Ready to import"}`}>Open {"→"}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <div className="split">
        <div><div>
          <Card id="inv-identity-h" title="Store identity contract">
            <KeyVals rows={[
              ["Account", group.name],
              ["Store", chosen?.store.display_name ?? "No store"],
              ["Scope", "This store only"],
              ["Legacy record handling", chosen?.store.adopt_legacy_matches ? "Adopt exact matches" : "Review before assignment"],
            ]} />
          </Card>
        </div></div>
        <div><div>
          <Card id="inv-addl-h" title="Additional inventory policy">
            <KeyVals rows={[
              ["Provider mode", <ChipView key="m" chip={{ label: mode.label, tone: modeTone }} />],
              ["Paid refresh", policy?.mode === "enrichment" && policy.refresh_cadence_hours ? `Every ${plural(policy.refresh_cadence_hours, "hour")}` : "Off"],
              ["Shared-stock enrichment", policy?.enrich_shared_inventory ? "On" : "Off"],
              ["Customer sharing", chosen && chosen.store.inventory_sharing_enabled && chosen.sharing_out > 0 ? plural(chosen.sharing_out, "active rule") : "Requires an eligible store and active rule"],
            ]} />
          </Card>
        </div></div>
      </div>
      <Savebar
        title="Primary store retained"
        detail="Adding a sibling never changes the primary store or inherits its paid-data policy."
        action={<button type="button" className="btn" onClick={() => go("stores", { store: "new" })}><Glyph name="plus" />Add store</button>}
      />
    </div>
  );

  return <Al97Frame crumb="Stores & import readiness" title="Stores & import readiness" subtitle="One store identity for settings, feeds, inventory and customer output." scope={scope} storeName={chosen?.store.display_name ?? null} main={main}>{children}</Al97Frame>;
}
