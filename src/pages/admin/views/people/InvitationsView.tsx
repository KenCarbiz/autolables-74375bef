import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AdminButton, AdminCard, AdminTable, EmptyState, InlineNote, SkeletonBlock, Td, Th } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import type { TeamMember } from "@/lib/admin/people";
import { InviteForm, MemberAvatar, MemberStatusText } from "./components";
import { useTeamAuthority, useTeamMembers, useTeamWriters } from "./useTeamMembers";

// Invitations: pending membership rows (invited, not yet accepted) and the
// invite form. Both go through invite_tenant_member and remove_tenant_member;
// the server decides who may call them.

export default function InvitationsView() {
  const read = useTeamMembers();
  const authority = useTeamAuthority();
  const writers = useTeamWriters();
  const [revokeFor, setRevokeFor] = useState<TeamMember | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const onRevokeCloseAutoFocus = useReturnFocus(!!revokeFor);
  const pending = read.members ? read.members.filter((m) => m.status === "invited") : null;

  const confirmRevoke = async () => {
    if (!revokeFor) return;
    const target = revokeFor;
    setRevokeFor(null);
    const r = await writers.remove(target.id);
    setFlash({ tone: r.ok ? "success" : "danger", text: r.ok ? `The invitation for ${target.email} was revoked.` : r.message });
  };

  const body = (() => {
    if (read.state === "loading") {
      return (
        <div className="px-6 pb-6 space-y-3" aria-busy="true" aria-label="Loading invitations">
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-11 w-full" />)}
        </div>
      );
    }
    if (read.state === "no-tenant") return <InlineNote tone="info" className="mx-6 mb-6">Select a rooftop to manage its invitations.</InlineNote>;
    if (read.state === "failed" || !pending) {
      return (
        <InlineNote tone="danger" title="Invitations could not be read for this rooftop." className="mx-6 mb-6" action={<AdminButton size="sm" onClick={() => void read.refetch()}>Retry</AdminButton>}>
          {read.error ?? "Nothing is shown because the read failed, not because there are no invitations."}
        </InlineNote>
      );
    }
    if (pending.length === 0) return <EmptyState compact title="No pending invitations" detail="Everyone invited to this rooftop has signed in." />;
    return (
      <AdminTable caption="Pending invitations">
        <thead>
          <tr>
            <Th>Invited</Th>
            <Th>Role</Th>
            <Th>Department</Th>
            <Th>Status</Th>
            <Th><span className="sr-only">Actions</span></Th>
          </tr>
        </thead>
        <tbody>
          {pending.map((m) => (
            <tr key={m.id}>
              <Td>
                <span className="flex items-center gap-3">
                  <MemberAvatar initials={m.initials} department={m.department} />
                  <span className="font-semibold text-adm-ink truncate">{m.email}</span>
                </span>
              </Td>
              <Td>{m.roleLabel}</Td>
              <Td>{m.department}</Td>
              <Td><MemberStatusText status={m.status} /></Td>
              <Td align="right">
                <AdminButton size="sm" variant="danger" disabled={!authority.canWrite} onClick={() => setRevokeFor(m)}>Revoke</AdminButton>
              </Td>
            </tr>
          ))}
        </tbody>
      </AdminTable>
    );
  })();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
      <AdminCard title="Pending invitations" description="People invited to this rooftop who have not signed in yet." flush>
        {flash && <InlineNote tone={flash.tone} className="mx-6 mb-4" action={<AdminButton size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</AdminButton>}>{flash.text}</InlineNote>}
        {body}
      </AdminCard>
      <div className="space-y-4">
        <AdminCard title="Invite a teammate" description="Access to this rooftop starts when they sign in with this address.">
          <InviteForm authority={authority} writers={writers} />
        </AdminCard>
        <InlineNote tone="info" title="Invitations are not written to the audit ledger today.">
          Role changes are recorded by the server. Invitations and revocations exist only as membership rows.
        </InlineNote>
      </div>

      <AlertDialog open={!!revokeFor} onOpenChange={(o) => { if (!o) setRevokeFor(null); }}>
        <AlertDialogContent className="rounded-[8px]" onCloseAutoFocus={onRevokeCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke the invitation for {revokeFor?.email}?</AlertDialogTitle>
            <AlertDialogDescription>The membership row is removed. You can invite this address again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRevoke()}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
