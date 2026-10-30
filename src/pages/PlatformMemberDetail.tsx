import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminPlatform } from "@/hooks/useAdminPlatform";
import { ASSIGNABLE_ROLE_GROUPS, getDealerCapabilities, roleDisplayName, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { Breadcrumbs } from "@/components/admin/v2/AdminShell";
import { Button, EmptyState, KeyValueList, LinkButton, LocalTabs, PageBody, PageHeader, Panel, SkeletonBlock, StatusText, Td, Th, ValueOrUnknown, WorkTable, type Tone } from "@/components/product";
import { formatDate, memberLabel, memberStatus, planLabel } from "@/pages/PlatformTenantDetail";

// A member's effective access, derived per tenant from the seat's role and the
// tenant's AutoLabels entitlement. The matrix is read-only; the only change
// offered is a role change on one seat, drafted here and applied on confirm.

type Level = "Allow" | "Read only" | "Deny";

const LEVEL_TONE: Record<Level, Tone> = { Allow: "success", "Read only": "warning", Deny: "danger" };

const MATRIX: { label: string; view: DealerCapability; manage?: DealerCapability }[] = [
  { label: "Vehicles", view: "can_view_inventory", manage: "can_edit_inventory" },
  { label: "Get Ready", view: "can_view_get_ready", manage: "can_complete_get_ready" },
  { label: "Customers and deals", view: "can_view_deals", manage: "can_manage_deals" },
  { label: "Compliance", view: "can_view_compliance", manage: "can_manage_compliance" },
  { label: "Reports", view: "can_view_reports" },
  { label: "Administration", view: "can_manage_settings" },
  { label: "Team", view: "can_manage_team" },
  { label: "Billing", view: "can_manage_billing" },
];

export const levelFor = (caps: DealerCapability[], row: (typeof MATRIX)[number]): Level => {
  const has = (c: DealerCapability) => caps.includes(c);
  if (row.manage) return has(row.manage) ? "Allow" : has(row.view) ? "Read only" : "Deny";
  return has(row.view) ? "Allow" : "Deny";
};

const ROLE_OPTIONS = ASSIGNABLE_ROLE_GROUPS.flatMap((g) => g.roles);

const PlatformMemberDetail = () => {
  const { memberId = "" } = useParams<{ memberId: string }>();
  const [searchParams] = useSearchParams();
  const { isAdmin, loading } = useAuth();
  const { tenants, members, entitlements, setMemberRole } = useAdminPlatform();
  const [drafting, setDrafting] = useState(false);
  const [role, setRole] = useState("");
  const [applying, setApplying] = useState(false);

  const member = useMemo(() => (members.data || []).find((m) => m.id === memberId), [members.data, memberId]);
  const seats = useMemo(() => {
    if (!member) return [];
    return (members.data || []).filter((m) => (member.user_id ? m.user_id === member.user_id : m.id === member.id));
  }, [members.data, member]);
  const tenantName = (id: string) => (tenants.data || []).find((t) => t.id === id)?.name ?? "Unknown tenant";
  const entitlementFor = (tenantId: string) => (entitlements.data || []).find((e) => e.tenant_id === tenantId && e.app_slug === "autolabels") ?? null;

  if (loading) return null;
  if (!isAdmin) return null;

  const tabParam = searchParams.get("tab");
  const tab = tabParam === "tenants" ? "tenants" : tabParam === "overview" ? "overview" : "entitlements";
  const base = `/platform-admin/members/${memberId}`;
  const crumbs = [{ label: "Platform Console", href: "/platform-admin?tab=members" }, { label: "Members", href: "/platform-admin?tab=members" }, { label: member ? memberLabel(member) ?? "Pending seat" : "Member" }];

  if (members.isLoading || tenants.isLoading) {
    return (
      <div data-product-surface="platform">
        <PageBody>
          <Breadcrumbs crumbs={crumbs} />
          <div className="space-y-3" aria-busy="true" aria-label="Loading member">
            <SkeletonBlock className="h-9 w-72" />
            <SkeletonBlock className="h-64 w-full" />
          </div>
        </PageBody>
      </div>
    );
  }

  if (!member) {
    return (
      <div data-product-surface="platform">
        <PageBody>
          <Breadcrumbs crumbs={crumbs} />
          <PageHeader title="Member not found" />
          <Panel>
            <EmptyState title="Member not found" detail="No member with this id is visible to your platform role." action={<LinkButton to="/platform-admin?tab=members">Back to Platform Console</LinkButton>} compact />
          </Panel>
        </PageBody>
      </div>
    );
  }

  const status = memberStatus(member);
  const entitledSeats = seats.map((s) => ({ seat: s, ent: entitlementFor(s.tenant_id) }));
  const levels = (seat: (typeof seats)[number], entitled: boolean) => {
    const caps = getDealerCapabilities(seat.role);
    return MATRIX.map((row) => (entitled ? levelFor(caps, row) : "Deny"));
  };
  const isEntitled = (e: ReturnType<typeof entitlementFor>) => !!e && (e.status === "active" || e.status === "trial");

  const proposedCaps = role ? getDealerCapabilities(role) : [];
  const currentCaps = getDealerCapabilities(member.role);
  const delta = role
    ? MATRIX.map((row) => ({ label: row.label, from: levelFor(currentCaps, row), to: levelFor(proposedCaps, row) })).filter((d) => d.from !== d.to)
    : [];

  const apply = async () => {
    if (!role) return;
    setApplying(true);
    const ok = await setMemberRole(member.id, role);
    setApplying(false);
    if (ok) {
      toast.success("Role updated");
      setDrafting(false);
      setRole("");
    } else toast.error("Role change failed");
  };

  return (
    <div data-product-surface="platform">
      <PageBody>
        <div>
          <Breadcrumbs crumbs={crumbs} />
          <PageHeader
            className="mt-2"
            title={
              <span className="inline-flex items-center gap-3 flex-wrap">
                {memberLabel(member) ?? "Pending seat"}
                <StatusText tone={status.tone}>{roleDisplayName(member.role)}</StatusText>
              </span>
            }
            description={<>{tenantName(member.tenant_id)} · {status.label} · {member.accepted_at ? `Accepted ${formatDate(member.accepted_at)}` : `Invited ${formatDate(member.invited_at)}`}</>}
            actions={<Button variant="primary" onClick={() => setDrafting(true)} disabled={drafting}>Review access change</Button>}
          />
        </div>
        <LocalTabs
          label="Member sections"
          tabs={[
            { key: "overview", label: "Overview", to: `${base}?tab=overview`, active: tab === "overview" },
            { key: "entitlements", label: "Entitlements", to: base, active: tab === "entitlements" },
            { key: "tenants", label: "Tenants", to: `${base}?tab=tenants`, active: tab === "tenants" },
            { key: "audit", label: "Audit", to: "/platform-admin?tab=audit", active: false },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div className="min-w-0">
            {tab === "overview" ? (
              <Panel title="Member" titleSize="md" inset="sm">
                <KeyValueList
                  rows={[
                    { label: "Email", value: <ValueOrUnknown value={memberLabel(member)} /> },
                    { label: "Role", value: roleDisplayName(member.role) },
                    { label: "Primary tenant", value: tenantName(member.tenant_id) },
                    { label: "Seats", value: seats.length },
                    { label: "Status", value: <StatusText tone={status.tone}>{status.label}</StatusText> },
                    { label: "Invited", value: <ValueOrUnknown value={formatDate(member.invited_at)} /> },
                    { label: "Accepted", value: <ValueOrUnknown value={member.accepted_at ? formatDate(member.accepted_at) : null} unknownLabel="Not accepted" /> },
                  ]}
                />
              </Panel>
            ) : tab === "entitlements" ? (
              <Panel title="Effective access" titleSize="md" inset="sm" description="Derived from the seat's role and each tenant's AutoLabels entitlement. Read only." flush>
                <WorkTable caption="Effective access by tenant">
                  <thead>
                    <tr>
                      <Th>Capability</Th>
                      {entitledSeats.map(({ seat }) => <Th key={seat.id}>{tenantName(seat.tenant_id)}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {MATRIX.map((row, i) => (
                      <tr key={row.label}>
                        <Td className="whitespace-nowrap">{row.label}</Td>
                        {entitledSeats.map(({ seat, ent }) => {
                          const level = levels(seat, isEntitled(ent))[i];
                          return <Td key={seat.id}><StatusText tone={LEVEL_TONE[level]}>{level}</StatusText></Td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </WorkTable>
              </Panel>
            ) : (
              <Panel title="Tenants" titleSize="md" inset="sm" flush>
                <WorkTable caption="Seats by tenant">
                  <thead>
                    <tr><Th>Tenant</Th><Th>Role</Th><Th>Plan</Th><Th>Entitlement</Th></tr>
                  </thead>
                  <tbody>
                    {entitledSeats.map(({ seat, ent }) => (
                      <tr key={seat.id}>
                        <Td className="max-w-[240px]"><Link to={`/platform-admin/tenants/${seat.tenant_id}`} className="block truncate font-semibold text-adm-primary hover:underline">{tenantName(seat.tenant_id)}</Link></Td>
                        <Td className="whitespace-nowrap">{roleDisplayName(seat.role)}</Td>
                        <Td><ValueOrUnknown value={planLabel(ent?.plan_tier)} unknownLabel="None" /></Td>
                        <Td>{ent ? <StatusText tone={isEntitled(ent) ? "success" : "warning"}>{ent.status.replace("_", " ")}</StatusText> : <StatusText>Not entitled</StatusText>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </WorkTable>
              </Panel>
            )}
          </div>
          <aside className="flex flex-col gap-4" aria-label="Access change">
            <Panel title="Access change (draft)" titleSize="md" inset="sm">
              {!drafting ? (
                <div className="space-y-3">
                  <KeyValueList
                    className="grid-cols-[1fr_auto]"
                    rows={[
                      { label: "Current", value: roleDisplayName(member.role) },
                      { label: "Proposed", value: <span className="text-adm-muted">None drafted</span> },
                      { label: "Affected tenant", value: tenantName(member.tenant_id) },
                    ]}
                  />
                  <p className="text-[13px] leading-[18px] text-adm-muted">Review access change opens a role change for this seat. Nothing is written until you apply it.</p>
                </div>
              ) : (
                <div className="space-y-3 text-[14px] leading-[20px]">
                  <KeyValueList
                    className="grid-cols-[1fr_auto]"
                    rows={[
                      { label: "Current role", value: roleDisplayName(member.role) },
                      { label: "Affected tenant", value: tenantName(member.tenant_id) },
                    ]}
                  />
                  <label className="block">
                    <span className="block text-[12px] text-adm-muted mb-1">Proposed role</span>
                    <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 w-full rounded-md border border-adm-border bg-adm-surface px-2 text-sm">
                      <option value="">Choose a role</option>
                      {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>
                  {role && (
                    delta.length === 0 ? (
                      <p className="text-adm-muted">This role gives the same access in every area shown.</p>
                    ) : (
                      <ul className="space-y-1">
                        {delta.map((d) => <li key={d.label} className="flex items-center justify-between gap-2"><span>{d.label}</span><span className="text-adm-muted">{d.from} to {d.to}</span></li>)}
                      </ul>
                    )
                  )}
                  <div className="flex items-center gap-2">
                    <Button variant="primary" disabled={!role || applying} onClick={apply}>{applying ? "Applying" : "Apply change"}</Button>
                    <Button onClick={() => { setDrafting(false); setRole(""); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </Panel>
            {tab !== "overview" && (
            <Panel title="Member" titleSize="md" inset="sm">
              <KeyValueList
                className="grid-cols-[1fr_auto]"
                rows={[
                  { label: "Email", value: <ValueOrUnknown value={memberLabel(member)} /> },
                  { label: "Seats", value: seats.length },
                  { label: "Status", value: <StatusText tone={status.tone}>{status.label}</StatusText> },
                  { label: "Invited", value: <ValueOrUnknown value={formatDate(member.invited_at)} /> },
                ]}
              />
            </Panel>
            )}
          </aside>
        </div>
      </PageBody>
    </div>
  );
};

export default PlatformMemberDetail;
