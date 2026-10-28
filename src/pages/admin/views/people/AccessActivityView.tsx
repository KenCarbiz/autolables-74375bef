import { useMemo } from "react";
import { AdminCard, AdminTable, EmptyState, InlineNote, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { useAdminNow } from "@/lib/admin/dataSource";
import { describeAge } from "@/lib/admin/health";
import { describeAccessEvent } from "@/lib/admin/people";
import { useAccessActivity, useTeamMembers } from "./useTeamMembers";

// Access activity: what the ledger holds about team changes for this rooftop.
// Only role changes are written by the server today; the view says so rather
// than implying a complete history.

export default function AccessActivityView() {
  const read = useTeamMembers();
  const activity = useAccessActivity();
  const now = useAdminNow();
  const events = useMemo(() => (activity.rows ? activity.rows.map(describeAccessEvent) : null), [activity.rows]);
  const emailFor = (memberId: string | null): string | null => (memberId ? read.members?.find((m) => m.id === memberId)?.email ?? null : null);

  const body = (() => {
    if (activity.state === "loading") {
      return (
        <div className="px-6 pb-6 space-y-3" aria-busy="true" aria-label="Loading access activity">
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-11 w-full" />)}
        </div>
      );
    }
    if (activity.state === "no-tenant") return <InlineNote tone="info" className="mx-6 mb-6">Select a rooftop to see its access activity.</InlineNote>;
    if (activity.state === "failed" || !events) {
      return (
        <InlineNote tone="danger" title="Access activity could not be read." className="mx-6 mb-6">
          {activity.error ?? "Nothing is shown because the read failed, not because nothing happened."}
        </InlineNote>
      );
    }
    if (events.length === 0) return <EmptyState compact title="No access changes recorded" detail="Role changes made through the team procedures will appear here." />;
    return (
      <AdminTable caption="Access activity">
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Event</Th>
            <Th>Member</Th>
            <Th>Change</Th>
            <Th>By</Th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const email = emailFor(e.memberId);
            return (
              <tr key={e.id}>
                <Td className="whitespace-nowrap"><time dateTime={e.at} title={e.at}>{describeAge(e.at, now)}</time></Td>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-semibold text-adm-ink">{e.title}</span>
                    <StatusChip tone={e.source === "server" ? "success" : "neutral"}>{e.source === "server" ? "Server" : "Note"}</StatusChip>
                  </span>
                </Td>
                <Td>{email ?? (e.memberId ? <span className="text-adm-muted">Former member</span> : <span className="text-adm-muted">Unknown</span>)}</Td>
                <Td>{e.change ?? <span className="text-adm-muted">Not recorded</span>}</Td>
                <Td>{e.actor ?? <span className="text-adm-muted">Unknown</span>}</Td>
              </tr>
            );
          })}
        </tbody>
      </AdminTable>
    );
  })();

  return (
    <div className="space-y-4">
      <AdminCard title="Access activity" description="Team changes the ledger holds for this rooftop, newest first." flush>
        {body}
      </AdminCard>
      <InlineNote tone="info" title="Coverage">
        Only role changes are recorded today, by set_tenant_member_role. Invitations and removals are not written to the audit ledger; they exist only as membership rows.
      </InlineNote>
    </div>
  );
}
