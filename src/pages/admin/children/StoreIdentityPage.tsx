import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { US_STATES, normalizeStateCode } from "@/lib/dealerState";
import { getOverview, listGroups } from "@/lib/inventoryNetwork/api";
import { useBrandSource } from "@/pages/admin/views/brand/useBrandForm";
import { Al97Frame, Banner, Card, Glyph, KeyVals, Savebar } from "@/components/admin/al97/al97ui";
import storeScope from "@/assets/al97/store-scope.svg";

// Store identity & scope (AL97 05), read-only, beside the Identity tab.
// Identity comes from the account's dealer settings, which are stored once per
// account, so every value here applies to the whole account. A legacy state
// name is shown as its two-letter code without rewriting what is stored. The
// canonical store list (dealer_stores) is readable by platform admins only
// until the proposed registry migration is applied.

export const REGISTRY_MIGRATION = "supabase/proposed/20261108000000_canonical_store_registry.sql";
const IDENTITY_TAB = adminTabHref("identity");
const READ_ONLY = "This page is read-only. Edit identity on the Identity tab, which saves through its own review.";

export interface StoreIdentityFixture { registry: number | null }

export function stateDisplay(stored: string | null | undefined): { code: string; hint: string } {
  const raw = String(stored ?? "").trim();
  const code = normalizeStateCode(raw);
  if (!raw) return { code: "Not configured", hint: "No state is stored." };
  if (!code) return { code: raw, hint: `Stored as "${raw}", which is not a US state code. Correct it on the Identity tab.` };
  const name = US_STATES.find((s) => s.code === code)?.name ?? code;
  return raw === code
    ? { code, hint: `Stored as two-letter code; displayed as ${name}.` }
    : { code, hint: `Stored as "${raw}"; shown as ${code}. The stored text is unchanged until a reviewed migration normalizes it.` };
}

function useRegistryCount(enabled: boolean, tenantId: string | null): { count: number | null; state: "unknown" | "loading" | "ready" | "failed" } {
  const q = useQuery({
    queryKey: ["admin-v2", "store-identity", "registry", tenantId],
    enabled: enabled && !!tenantId,
    retry: false,
    queryFn: async () => {
      const groups = await listGroups();
      const group = groups.find((g) => g.tenant_id === tenantId);
      if (!group) return 0;
      const ov = await getOverview(group.id);
      return ov ? ov.stores.length : 0;
    },
  });
  if (!enabled || !tenantId) return { count: null, state: "unknown" };
  return q.isLoading ? { count: null, state: "loading" } : q.isError ? { count: null, state: "failed" } : { count: q.data ?? null, state: "ready" };
}

export default function StoreIdentityPage() {
  const fx = useViewFixture<StoreIdentityFixture>("al97-identity");
  const src = useBrandSource();
  const { isAdmin } = useAuth();
  const live = useRegistryCount(!src.isFixture && isAdmin, src.tenantId);
  const registry = fx ? { count: fx.registry, state: fx.registry == null ? "unknown" : "ready" } : live;
  const s = src.settings;
  const known = src.serverLoaded && !src.loadError;
  const value = (v: string | null | undefined) => (!known ? "Unknown" : v && v.trim() ? v : "Not configured");
  const state = stateDisplay(s.dealer_state);
  const name = known && s.dealer_name.trim() ? s.dealer_name : "This dealership";
  const place = [s.dealer_city.trim(), known ? normalizeStateCode(s.dealer_state) || s.dealer_state.trim() : ""].filter(Boolean).join(", ");
  const account = src.tenantName ?? "This account";
  const registryText = registry.state === "ready" ? "Canonical store registry" : "Unknown";
  const registryNote = registry.state === "ready"
    ? `${registry.count} ${registry.count === 1 ? "store is" : "stores are"} in the canonical registry. State normalization and legacy associations require a reviewed migration.`
    : `Store list unknown: dealer_stores is readable by platform admins only until ${REGISTRY_MIGRATION} is applied (proposed, not applied).`;

  const main = (
    <div className="work">
      {src.loadError
        ? <Banner tone="red" icon="warning" title="Identity could not be read" detail="Nothing is shown as configured because the settings read failed." />
        : (
          <div className="scope-bar">
            <Glyph name="store" />
            <div><b>Editing {name}</b><small>{account}{place ? ` / ${place}` : ""} · whole account</small></div>
            <span className="chip blue">Account setting</span>
          </div>
        )}
      <div className="split">
        <div><div>
          <Card id="si-identity" title="Identity">
            <div className="fields">
              <div className="field"><span>Display name</span><div className="input" aria-readonly="true">{value(s.dealer_name)}</div></div>
              <div className="field"><span>Legal name</span><div className="input" aria-readonly="true">{known ? "Not stored" : "Unknown"}</div></div>
              <div className="field"><span>Street</span><div className="input" aria-readonly="true">{value(s.dealer_address)}</div></div>
              <div className="field"><span>City</span><div className="input" aria-readonly="true">{value(s.dealer_city)}</div></div>
              <div className="field"><span>State</span><div className="input" aria-readonly="true">{known ? state.code : "Unknown"} ▾<Glyph name="chevron" /></div><small>{known ? state.hint : "Not read."}</small></div>
              <div className="field"><span>ZIP</span><div className="input" aria-readonly="true">{value(s.dealer_zip)}</div></div>
            </div>
          </Card>
        </div></div>
        <div><div>
          <Card id="si-applies" title="Where these values apply" description="Account defaults never silently replace store identity.">
            <KeyVals rows={[
              ["Customer Passport", "Account identity, every store"],
              ["Documents", "Account identity, every store"],
              ["Routing", "Account destinations"],
              ["Payment estimate", "Selected store’s published rules"],
            ]} />
            <img className="art" src={storeScope} alt="" />
          </Card>
        </div></div>
      </div>
      <Card id="si-sources" title="Default or override?">
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Setting group</th><th scope="col">Effective source</th><th scope="col">Action</th></tr></thead>
            <tbody>
              <tr><td>Brand appearance</td><td>Account default</td><td><Link to={adminTabHref("appearance")}>Open appearance</Link></td></tr>
              <tr><td>Contact and routing</td><td>Account default</td><td><Link to={ADMIN_CHILD_ROUTES.contactRouting}>Open routing</Link></td></tr>
              <tr><td>Finance assumptions</td><td>Store configuration</td><td><Link to={ADMIN_CHILD_ROUTES.paymentEstimator}>Open estimator</Link></td></tr>
              <tr><td>Inventory ownership</td><td>{registryText}</td><td><Link to={ADMIN_CHILD_ROUTES.legacyAssignments}>Review legacy assignments</Link></td></tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Savebar title="No changes pending" detail={registryNote}
        action={<><span id="si-review-reason" className="sr-only">{READ_ONLY}</span><button type="button" className="btn primary" disabled title={READ_ONLY} aria-describedby="si-review-reason">Review changes</button></>} />
    </div>
  );
  return (
    <Al97Frame section="brand" trail={[{ label: "Dealership & Brand", to: IDENTITY_TAB }]} crumb="Store identity & scope" title="Store identity & scope"
      subtitle={`${name}${place ? ` · ${place}` : ""}`} scopeLabel={{ account, store: src.stores.find((x) => x.id === src.activeStoreId)?.name ?? null }} main={main}>
      <p className="mt-4 text-[13px] text-adm-muted">Edit identity on the <Link to={IDENTITY_TAB} className="font-semibold text-adm-primary hover:underline">Identity tab</Link>.</p>
    </Al97Frame>
  );
}
