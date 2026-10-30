import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminPlatform, type EntitlementRow, type MemberRow, type TenantSummary } from "@/hooks/useAdminPlatform";
import { PLAN_TIER_IDS, PLAN_TIER_LABELS, type PlanTier } from "@/data/planTiers";
import { roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";
import { Breadcrumbs } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, KeyValueList, LinkButton, LocalTabs, PageBody, PageHeader, Panel, SkeletonBlock, StatusText, Td, Th, ValueOrUnknown, WorkTable, type Tone } from "@/components/product";

// One dealership, read from the same platform queries the Tenants list uses.
// Plan changes are drafted here and applied only on an explicit confirm.

export const planLabel = (tier: string | null | undefined) => (tier ? PLAN_TIER_LABELS[tier as PlanTier] ?? tier : null);

export const formatDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null);

export const formatDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

const ENTITLEMENT_TONE: Record<EntitlementRow["status"], Tone> = { active: "success", trial: "info", paused: "warning", past_due: "danger", canceled: "neutral" };
const ENTITLEMENT_LABEL: Record<EntitlementRow["status"], string> = { active: "Active", trial: "Trial", paused: "Paused", past_due: "Past due", canceled: "Canceled" };

export const memberLabel = (m: MemberRow) => m.invited_email || null;
export const memberStatus = (m: MemberRow): { tone: Tone; label: string } => (m.accepted_at ? { tone: "success", label: "Active" } : { tone: "warning", label: "Invited" });

type TabId = "overview" | "entitlements" | "members" | "integrations";
const TAB_IDS: TabId[] = ["overview", "entitlements", "members", "integrations"];

interface ProfileRow {
  display_name: string | null;
  phone: string | null;
  website: string | null;
  stores: Array<{ name?: string; city?: string; state?: string }> | null;
}

const NotFound = ({ what }: { what: string }) => (
  <Panel>
    <EmptyState title={`${what} not found`} detail="No record with this id is visible to your platform role." action={<LinkButton to="/platform-admin?tab=tenants">Back to Platform Console</LinkButton>} compact />
  </Panel>
);

const PlatformTenantDetail = () => {
  const { tenantId = "" } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const { isAdmin, loading } = useAuth();
  const { tenants, members, entitlements, marketcheck, setTenantTier, setTenantActive } = useAdminPlatform();
  const [drafting, setDrafting] = useState(false);
  const [proposed, setProposed] = useState<PlanTier | "">("");
  const [applying, setApplying] = useState(false);
  const tabParam = searchParams.get("tab") ?? "overview";
  const tab: TabId = (TAB_IDS as string[]).includes(tabParam) ? (tabParam as TabId) : "overview";

  const profile = useQuery({
    queryKey: ["admin", "tenant-profile", tenantId],
    enabled: !!tenantId && isAdmin,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await (supabase as any).from("onboarding_profiles").select("display_name, phone, website, stores").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data as ProfileRow | null) ?? null;
    },
  });

  const tenant: TenantSummary | undefined = useMemo(() => (tenants.data || []).find((t) => t.id === tenantId), [tenants.data, tenantId]);
  const tenantMembers = useMemo(() => (members.data || []).filter((m) => m.tenant_id === tenantId), [members.data, tenantId]);
  const tenantEntitlements = useMemo(() => (entitlements.data || []).filter((e) => e.tenant_id === tenantId), [entitlements.data, tenantId]);
  const mc = useMemo(() => (marketcheck.data || []).find((r) => r.tenant_id === tenantId) ?? null, [marketcheck.data, tenantId]);
  const labelsEntitlement = tenantEntitlements.find((e) => e.app_slug === "autolabels") ?? null;
  const currentTier = labelsEntitlement?.plan_tier ?? null;

  if (loading) return null;
  if (!isAdmin) return null;

  const tabHref = (id: TabId) => `/platform-admin/tenants/${tenantId}${id === "overview" ? "" : `?tab=${id}`}`;
  const crumbs = [{ label: "Platform Console", href: "/platform-admin?tab=tenants" }, { label: "Tenants", href: "/platform-admin?tab=tenants" }, { label: tenant?.name ?? "Tenant" }];

  if (tenants.isLoading) {
    return (
      <div data-product-surface="platform">
        <PageBody>
          <Breadcrumbs crumbs={crumbs} />
          <div className="space-y-3" aria-busy="true" aria-label="Loading tenant">
            <SkeletonBlock className="h-9 w-72" />
            <SkeletonBlock className="h-64 w-full" />
          </div>
        </PageBody>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div data-product-surface="platform">
        <PageBody>
          <Breadcrumbs crumbs={crumbs} />
          <PageHeader title="Tenant not found" />
          <NotFound what="Tenant" />
        </PageBody>
      </div>
    );
  }

  const store = profile.data?.stores?.[0];
  const location = [store?.city, store?.state].filter(Boolean).join(", ");

  const confirmPlan = async () => {
    if (!proposed) return;
    setApplying(true);
    const ok = await setTenantTier(tenant.id, proposed);
    setApplying(false);
    if (ok) {
      toast.success(`${tenant.name} set to ${PLAN_TIER_LABELS[proposed]}`);
      setDrafting(false);
      setProposed("");
    } else toast.error("Could not change the plan tier");
  };

  const toggleActive = async () => {
    const next = !tenant.is_active;
    if (!next && !window.confirm(`Suspend ${tenant.name}? Their members lose access until it is reactivated.`)) return;
    const ok = await setTenantActive(tenant.id, next);
    if (ok) toast.success(`${tenant.name} ${next ? "reactivated" : "suspended"}`);
    else toast.error("Action failed");
  };

  const dealershipPanel = (
    <Panel title="Dealership information" titleSize="md" inset="sm">
      <KeyValueList
        rows={[
          { label: "Legal name", value: profile.data?.display_name || tenant.name },
          { label: "Slug", value: tenant.slug },
          { label: "Domain", value: <ValueOrUnknown value={tenant.domain} /> },
          { label: "Location", value: <ValueOrUnknown value={location} /> },
          { label: "Phone", value: <ValueOrUnknown value={profile.data?.phone} /> },
          { label: "Source", value: <span className="capitalize">{tenant.source}</span> },
          { label: "Created", value: <ValueOrUnknown value={formatDate(tenant.created_at)} /> },
        ]}
      />
    </Panel>
  );

  const providerPanel = (
    <Panel title="Provider health" titleSize="md" inset="sm" flush>
      <WorkTable caption="Provider health">
        <thead>
          <tr><Th>Provider</Th><Th>Status</Th><Th>Last sync</Th></tr>
        </thead>
        <tbody>
          <tr>
            <Td>MarketCheck inventory</Td>
            <Td>
              {!mc || !mc.allowed ? <StatusText>Not granted</StatusText> : mc.enabled ? <StatusText tone="success">Enabled</StatusText> : <StatusText tone="warning">Granted, not enabled</StatusText>}
            </Td>
            <Td className="whitespace-nowrap"><ValueOrUnknown value={formatDateTime(mc?.last_run_at)} unknownLabel="No sync recorded" /></Td>
          </tr>
        </tbody>
      </WorkTable>
    </Panel>
  );

  const membersPanel = (limit?: number) => {
    const shown = limit ? tenantMembers.slice(0, limit) : tenantMembers;
    return (
      <Panel title={`Members (${tenantMembers.length})`} titleSize="md" inset="sm" flush>
        {tenantMembers.length === 0 ? (
          <EmptyState title="No members" detail="This tenant has no seats yet." compact />
        ) : (
          <>
            <WorkTable caption="Members">
              <thead>
                <tr><Th>Member</Th><Th>Role</Th><Th>Status</Th><Th>Last active</Th></tr>
              </thead>
              <tbody>
                {shown.map((m) => {
                  const st = memberStatus(m);
                  return (
                    <tr key={m.id}>
                      <Td className="max-w-[240px]">
                        <Link to={`/platform-admin/members/${m.id}`} className="block truncate font-semibold text-adm-primary hover:underline">
                          {memberLabel(m) ?? "Pending seat"}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">{roleDisplayName(m.role)}</Td>
                      <Td><StatusText tone={st.tone}>{st.label}</StatusText></Td>
                      <Td className="whitespace-nowrap text-adm-muted"><ValueOrUnknown value={formatDate(m.accepted_at)} unknownLabel="Not accepted" /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </WorkTable>
            {limit && tenantMembers.length > limit && (
              <div className="px-4 py-3 text-right">
                <Link to={tabHref("members")} className="text-[13px] font-semibold text-adm-primary hover:underline">View all members</Link>
              </div>
            )}
          </>
        )}
      </Panel>
    );
  };

  const entitlementsPanel = (
    <Panel title="Effective entitlements" titleSize="md" inset="sm" flush>
      {tenantEntitlements.length === 0 ? (
        <EmptyState title="No entitlements" detail="No app is entitled for this tenant." compact />
      ) : (
        <WorkTable caption="Effective entitlements">
          <thead>
            <tr><Th>App</Th><Th>Plan</Th><Th>Status</Th><Th align="right">Seats</Th><Th>Renews or expires</Th></tr>
          </thead>
          <tbody>
            {tenantEntitlements.map((e) => (
              <tr key={e.id}>
                <Td className="capitalize">{e.app_slug}</Td>
                <Td>{planLabel(e.plan_tier)}</Td>
                <Td><StatusText tone={ENTITLEMENT_TONE[e.status]}>{ENTITLEMENT_LABEL[e.status]}</StatusText></Td>
                <Td align="right"><ValueOrUnknown value={e.seat_limit} unknownLabel="Not capped" /></Td>
                <Td className="whitespace-nowrap"><ValueOrUnknown value={formatDate(e.expires_at ?? e.trial_ends_at)} unknownLabel="Not set" /></Td>
              </tr>
            ))}
          </tbody>
        </WorkTable>
      )}
    </Panel>
  );

  const entitlementsCompact = (
    <Panel title="Effective entitlements" titleSize="md" inset="sm">
      {tenantEntitlements.length === 0 ? (
        <p className="text-[14px] text-adm-muted">No app is entitled for this tenant.</p>
      ) : (
        <KeyValueList
          className="grid-cols-[1fr_auto]"
          rows={tenantEntitlements.map((e) => ({
            label: <span className="capitalize">{e.app_slug}</span>,
            value: <span className="inline-flex items-center gap-2">{planLabel(e.plan_tier)}<StatusText tone={ENTITLEMENT_TONE[e.status]}>{ENTITLEMENT_LABEL[e.status]}</StatusText></span>,
          }))}
        />
      )}
    </Panel>
  );

  const summary = (
    <aside className="flex flex-col gap-4" aria-label="Plan and status">
      <Panel title="Plan and status" titleSize="md" inset="sm">
        <KeyValueList
          className="grid-cols-[1fr_auto]"
          rows={[
            { label: "Current plan", value: <span className="font-semibold">{planLabel(currentTier) ?? "Unknown"}</span> },
            { label: "Status", value: <StatusText tone={tenant.is_active ? "success" : "neutral"}>{tenant.is_active ? "Active" : "Suspended"}</StatusText> },
            { label: "Entitlement", value: labelsEntitlement ? <StatusText tone={ENTITLEMENT_TONE[labelsEntitlement.status]}>{ENTITLEMENT_LABEL[labelsEntitlement.status]}</StatusText> : <span className="text-adm-muted">None</span> },
            { label: "Effective date", value: <ValueOrUnknown value={formatDate(labelsEntitlement?.activated_at)} /> },
            { label: "Next renewal", value: <ValueOrUnknown value={formatDate(labelsEntitlement?.expires_at)} unknownLabel="Not set" /> },
            { label: "Members", value: tenant.member_count },
            { label: "Active apps", value: tenant.active_apps },
          ]}
        />
        <div className="mt-4">
          <Button size="sm" variant={tenant.is_active ? "danger" : "secondary"} onClick={toggleActive}>{tenant.is_active ? "Suspend tenant" : "Reactivate tenant"}</Button>
        </div>
      </Panel>
      {drafting && (
        <Panel title="Plan change (draft)" titleSize="md" inset="sm">
          <div className="space-y-3 text-[14px] leading-[20px]">
            <label className="block">
              <span className="block text-[12px] text-adm-muted mb-1">Proposed plan</span>
              <select value={proposed} onChange={(e) => setProposed(e.target.value as PlanTier)} className="h-9 w-full rounded-md border border-adm-border bg-adm-surface px-2 text-sm">
                <option value="">Choose a plan</option>
                {PLAN_TIER_IDS.map((id) => <option key={id} value={id} disabled={id === currentTier}>{PLAN_TIER_LABELS[id]}</option>)}
              </select>
            </label>
            {proposed && (
              <p className="text-adm-muted">
                {planLabel(currentTier) ?? "No plan"} to {PLAN_TIER_LABELS[proposed]}. This applies the plan's feature preset to {tenant.name} and is recorded in the platform audit log.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="primary" disabled={!proposed || applying} onClick={confirmPlan}>{applying ? "Applying" : "Apply plan change"}</Button>
              <Button onClick={() => { setDrafting(false); setProposed(""); }}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
    </aside>
  );

  return (
    <div data-product-surface="platform">
      <PageBody>
        <div>
          <Breadcrumbs crumbs={crumbs} />
          <PageHeader
            className="mt-2"
            title={
              <span className="inline-flex items-center gap-3 flex-wrap">
                {tenant.name}
                <StatusText tone={tenant.is_active ? "success" : "neutral"}>{tenant.is_active ? "Active" : "Suspended"}</StatusText>
              </span>
            }
            description={<>Dealership{location ? ` · ${location}` : ""} · Tenant ID: <span className="font-mono text-[13px]">{tenant.id}</span></>}
            actions={<Button variant="primary" onClick={() => setDrafting(true)} disabled={drafting}>Review plan change</Button>}
          />
        </div>
        <LocalTabs
          label="Tenant sections"
          tabs={[
            ...TAB_IDS.map((id) => ({ key: id, label: id === "overview" ? "Overview" : id === "entitlements" ? "Entitlements" : id === "members" ? "Members" : "Integrations", to: tabHref(id), active: id === tab })),
            { key: "audit", label: "Audit", to: "/platform-admin?tab=audit", active: false },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div className="flex flex-col gap-4 min-w-0">
            {tab === "overview" && (
              <>
                {dealershipPanel}
                {providerPanel}
                {membersPanel(5)}
              </>
            )}
            {tab === "entitlements" && entitlementsPanel}
            {tab === "members" && membersPanel()}
            {tab === "integrations" && providerPanel}
          </div>
          <div className="flex flex-col gap-4">
            {summary}
            {tab === "overview" && entitlementsCompact}
          </div>
        </div>
      </PageBody>
    </div>
  );
};

export default PlatformTenantDetail;
