import { useMemo, useState } from "react";
import { useAdminPlatform, type MemberRow } from "@/hooks/useAdminPlatform";
import { roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Users, Search } from "lucide-react";
import { AdminButton, AdminTable, StatusChip as StatusText, Td, Th } from "@/components/admin/v2/primitives";
import { TablePagination, useSortAndPaginate, toCsv, downloadCsv } from "./tablePrimitives";
import { TableEmptyState } from "./TableEmptyState";

const formatDate = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
};

export const PlatformMembers = () => {
  const { members, tenants, removeMember } = useAdminPlatform();
  const [q, setQ] = useState("");
  const [tenantFilter, setTenantFilter] = useState<string>("");

  const tenantsById = useMemo(() => {
    const m = new Map<string, string>();
    (tenants.data || []).forEach((t) => m.set(t.id, t.name));
    return m;
  }, [tenants.data]);

  const rows = useMemo(() => {
    const all = members.data || [];
    const lc = q.trim().toLowerCase();
    return all
      .filter((m) => (tenantFilter ? m.tenant_id === tenantFilter : true))
      .filter((m) => {
        if (!lc) return true;
        const tenantName = tenantsById.get(m.tenant_id) || "";
        return (
          (m.invited_email || "").toLowerCase().includes(lc) ||
          m.role.toLowerCase().includes(lc) ||
          tenantName.toLowerCase().includes(lc)
        );
      });
  }, [members.data, tenantFilter, q, tenantsById]);

  const handleRemove = async (m: MemberRow) => {
    if (!confirm(`Remove this member from the tenant? This does not delete their auth account.`)) return;
    const ok = await removeMember(m.id);
    if (ok) toast.success("Member removed");
    else toast.error("Remove failed");
  };

  const sortPag = useSortAndPaginate<MemberRow>(rows, {
    defaultSortKey: "invited_at",
    defaultSortDir: "desc",
    defaultPageSize: 50,
    getSortValue: (row, key) => {
      if (key === "tenant") return tenantsById.get(row.tenant_id) || "";
      if (key === "accepted") return row.accepted_at || "";
      return (row as unknown as Record<string, unknown>)[key];
    },
  });

  const sortTh = (label: string, key: string) => (
    <Th className="whitespace-nowrap">
      <button type="button" onClick={() => sortPag.toggleSort(key)} className="inline-flex items-center gap-1 hover:text-adm-ink" aria-label={`Sort by ${label.toLowerCase()}`}>
        {label}
        {sortPag.sortKey === key && (sortPag.sortDir === "asc" ? <ArrowUp className="w-4 h-4" aria-hidden="true" /> : <ArrowDown className="w-4 h-4" aria-hidden="true" />)}
      </button>
    </Th>
  );

  const handleExport = () => {
    const csv = toCsv<MemberRow>(sortPag.sorted, [
      { header: "Tenant",        get: r => tenantsById.get(r.tenant_id) || "" },
      { header: "Tenant ID",     get: r => r.tenant_id },
      { header: "Email",         get: r => r.invited_email || "" },
      { header: "User ID",       get: r => r.user_id || "" },
      { header: "Role",          get: r => r.role },
      { header: "Accepted at",   get: r => r.accepted_at || "" },
      { header: "Invited at",    get: r => r.invited_at },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`platform-members-${stamp}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-adm-muted">{members.data?.length ?? 0} members across {tenants.data?.length ?? 0} tenants</p>
        <div className="flex items-center gap-2">
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            aria-label="Filter by tenant"
            className="h-9 px-2 rounded-md border border-adm-border bg-adm-surface text-sm max-w-[220px]"
          >
            <option value="">All tenants</option>
            {(tenants.data || []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 text-adm-muted" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search email, role, tenant"
              aria-label="Search members"
              className="h-9 pl-9 pr-3 rounded-md border border-adm-border bg-adm-surface text-sm w-64"
            />
          </div>
        </div>
      </div>

      {members.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading members…</div>
      ) : rows.length === 0 ? (
        <TableEmptyState
          icon={Users}
          title={q || tenantFilter ? "No members match these filters" : "No members yet"}
          description={
            q || tenantFilter
              ? "Clear the search or tenant filter to see all seat assignments."
              : "Tenant members appear here as owners invite team mates. Invitations live until accepted."
          }
        />
      ) : (
        <div className="rounded-[6px] border border-adm-border bg-adm-surface overflow-hidden">
          <AdminTable caption="Members" minWidth={720}>
            <thead>
              <tr>
                {sortTh("Member", "invited_email")}
                {sortTh("Tenant", "tenant")}
                {sortTh("Role", "role")}
                {sortTh("Status", "accepted")}
                {sortTh("Invited", "invited_at")}
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {sortPag.paginated.map((m) => (
                <tr key={m.id}>
                  <Td className="max-w-[240px]">
                    <Link to={`/platform-admin/members/${m.id}`} className="block truncate font-semibold text-adm-primary hover:underline">
                      {m.invited_email || (m.user_id ? `${m.user_id.slice(0, 8)}…` : "Pending seat")}
                    </Link>
                  </Td>
                  <Td className="max-w-[200px]"><span className="block truncate">{tenantsById.get(m.tenant_id) || m.tenant_id.slice(0, 8)}</span></Td>
                  <Td className="whitespace-nowrap">{roleDisplayName(m.role)}</Td>
                  <Td>{m.accepted_at ? <StatusText tone="success">Active</StatusText> : <StatusText tone="warning">Invited</StatusText>}</Td>
                  <Td className="whitespace-nowrap text-adm-muted">{formatDate(m.invited_at)}</Td>
                  <Td align="right">
                    <AdminButton variant="ghost" size="sm" onClick={() => handleRemove(m)} className="text-adm-danger hover:bg-adm-danger-bg">Remove</AdminButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
          <TablePagination
            page={sortPag.page}
            totalPages={sortPag.totalPages}
            pageSize={sortPag.pageSize}
            totalCount={sortPag.totalCount}
            visibleCount={sortPag.paginated.length}
            setPage={sortPag.setPage}
            setPageSize={sortPag.setPageSize}
            onExportCsv={handleExport}
            exportLabel="Export CSV"
          />
        </div>
      )}
    </div>
  );
};

export default PlatformMembers;
