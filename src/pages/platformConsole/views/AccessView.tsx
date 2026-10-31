import { ConsoleFrame } from "@/components/platformConsole/ConsoleFrame";
import { ConsoleIcon } from "@/components/platformConsole/icons";
import { Panel, TextLink, ViewState, type Column } from "@/components/platformConsole/ui";
import { Pill, RefTable, ReviewAction } from "@/components/platformConsole/uiB";
import { useConsoleView } from "@/lib/platformConsole/dataSource";
import { loadAccess, type AccessModel, type AccessRow } from "@/lib/platformConsole/live/access";

const columns: Column<AccessRow>[] = [
  { key: "member", header: "Member", width: "250px", render: (r) => r.member },
  { key: "scope", header: "Scope", width: "180px", render: (r) => r.scope },
  { key: "role", header: "Role", width: "250px", render: (r) => r.role },
  { key: "signin", header: "Last sign-in", width: "240px", render: (r) => r.lastSignIn },
  { key: "state", header: "Access state", width: "235px", render: (r) => <Pill tone={r.state.tone}>{r.state.label}</Pill> },
  { key: "action", header: "Action", width: "minmax(0,1fr)", render: (r) => <TextLink to={r.href}>{r.actionLabel}</TextLink> },
];

export default function AccessView() {
  const view = useConsoleView<AccessModel>("access", () => loadAccess());
  const m = view.data;
  return (
    <ConsoleFrame title="Members & access" subtitle="Store memberships are not platform permissions." onRefresh={view.isFixture ? undefined : view.refresh} refreshing={view.status === "loading"}>
      {view.status !== "ready" || !m ? (
        <ViewState status={view.status === "ready" ? "empty" : view.status} error={view.error} onRetry={view.refresh} what="access" />
      ) : (
        <>
          <div className="flex justify-end">
            <ReviewAction variant="primary" kind="member_invite" scope="store-membership" label="Invite member" icon="plus" title="Invite a member" summary="Sends no invitation from this screen. The invite is reviewed, scoped to one store and recorded in the audit trail." className="w-[200px] justify-start" submitLabel="Request invite" />
          </div>
          <RefTable rows={m.rows} columns={columns} rowKey={(r) => r.id} caption="Members and access" rowHeight={76} emptyNote={m.rowsNote} />
          <div className="-mt-1 grid grid-cols-1 gap-[22px] xl:grid-cols-[minmax(0,640fr)_minmax(0,658fr)]">
            <Panel id="pc-acc-priv" title="Privileged access" helper={m.privilegedHelper} className="min-h-[220px]">
              <div className="mt-[41px]">
                <ReviewAction kind="platform_roles_review" scope="platform-roles" label="Review platform roles" title="Review platform roles" summary="Platform roles are listed for review only. Changing a role needs a separate reviewed action with a reason." className="w-[300px] justify-start" submitLabel="Request review" />
              </div>
            </Panel>
            <Panel id="pc-acc-sig" title="Security signals" helper={m.signalsHelper} className="min-h-[220px]">
              <p className="mt-[24px] flex items-start gap-2 text-[13px] leading-[18px]">
                {m.signalsLine.startsWith("Not monitored") && <ConsoleIcon name="info" size={16} className="mt-[1px] shrink-0 text-[#52677C]" />}
                {m.signalsLine}
              </p>
              <p className="mt-[24px] text-[12px] leading-[16px] text-[#52677C]">{m.signalsNote}</p>
            </Panel>
          </div>
        </>
      )}
    </ConsoleFrame>
  );
}
