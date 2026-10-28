import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AdminCard, AdminTable, InlineNote, Td, Th } from "@/components/admin/v2/primitives";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { roleCatalog } from "@/lib/admin/people";
import { useTeamMembers } from "./useTeamMembers";

// Roles: the assignable role catalog with who holds each one. Roles are
// fixed by the capability contract; the policy page shows what each role can
// do and where that is enforced.

export default function RolesView() {
  const read = useTeamMembers();
  const catalog = useMemo(() => roleCatalog(read.members ?? []), [read.members]);
  const countsKnown = read.state === "ready";

  return (
    <div className="space-y-4">
      <InlineNote tone="info" title="Roles are defined by the capability contract.">
        Each role maps to a fixed set of capabilities. Open a policy to see the task matrix and where it is enforced today.
      </InlineNote>
      <AdminCard title="Role catalog" description="Every role that can be assigned on this rooftop." flush>
        <AdminTable caption="Role catalog">
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Department</Th>
              <Th align="right">Members</Th>
              <Th>Key permissions</Th>
              <Th>Restricted</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((r) => (
              <tr key={r.value}>
                <Td>
                  <span className="block font-semibold text-adm-ink">{r.label}</span>
                  <span className="block text-[12px] leading-[18px] text-adm-muted">{r.group}</span>
                </Td>
                <Td>{r.department}</Td>
                <Td align="right">
                  {countsKnown ? r.memberCount : <span className="text-adm-muted">{read.state === "loading" ? "Loading" : "Unknown"}</span>}
                </Td>
                <Td className="text-[13px] text-adm-muted">{r.summary.keyPermissions.join(", ") || "None in this summary"}</Td>
                <Td className="text-[13px] text-adm-muted">{r.summary.restricted.join(", ") || "None in this summary"}</Td>
                <Td align="right">
                  <Link to={ADMIN_CHILD_ROUTES.memberRole(r.value)} className="font-semibold text-adm-primary hover:underline whitespace-nowrap">View policy</Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminCard>
      {read.state === "failed" && (
        <InlineNote tone="warning" title="Member counts are unavailable.">{read.error ?? "The team could not be read, so counts show as Unknown rather than zero."}</InlineNote>
      )}
    </div>
  );
}
