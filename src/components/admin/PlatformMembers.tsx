import { useMemo, useState } from "react";
import { useAdminPlatform, type MemberRow } from "@/hooks/useAdminPlatform";
import { toast } from "sonner";
import { Users, Search, Trash2 } from "lucide-react";
import { SortHeader, TablePagination, useSortAndPaginate, toCsv, downloadCsv } from "./tablePrimitives";
import { TableEmptyState } from "./TableEmptyState";

const ROLES: MemberRow["role"][] = ["owner", "admin", "manager", "staff"];

const formatDate = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
};

export const PlatformMembers = () => {
  const { members, tenants, setMemberRole, removeMember } = useAdminPlatform();
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

  const handleRoleChange = async (m: MemberRow, role: MemberRow["role"]) => {
    const ok = await setMemberRole(m.id, role);
    if (ok) toast.success("Role updated");
    else toast.error("Role change failed");
  };

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
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Members</h2>
            <p className="text-[11px] text-muted-foreground">
              {members.data?.length ?? 0} total across {tenants.data?.length ?? 0} tenants
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="h-9 px-2 rounded-md border border-border bg-background text-sm max-w-[220px]"
          >
            <option value="">All tenants</option>
            {(tenants.data || []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search email, role, tenant…"
              className="h-9 pl-7 pr-3 rounded-md border border-border bg-background text-sm w-64"
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
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortHeader label="Tenant"   sortKey="tenant"        activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Email"    sortKey="invited_email" activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Role"     sortKey="role"          activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Accepted" sortKey="accepted"      activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Invited"  sortKey="invited_at"    activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} />
                <SortHeader label="Actions"  activeKey={sortPag.sortKey} dir={sortPag.sortDir} onToggle={sortPag.toggleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortPag.paginated.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-foreground">
                      {tenantsById.get(m.tenant_id) || m.tenant_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {m.invited_email || (m.user_id ? m.user_id.slice(0, 8) + "…" : "—")}
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m, e.target.value as MemberRow["role"])}
                      className="h-8 px-2 rounded-md border border-border bg-background text-xs font-semibold capitalize"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {m.accepted_at ? formatDate(m.accepted_at) : (
                      <span className="text-amber-600 text-[11px] font-semibold">Pending</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{formatDate(m.invited_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => handleRemove(m)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 h-7 rounded-md text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
