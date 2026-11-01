import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { describeAccessEvent } from "@/lib/admin/people";
import { useAccessActivity } from "@/pages/admin/views/people/useTeamMembers";
import { Al97Frame, Banner, Card, KeyVals, Savebar, useFixtureCopy } from "@/components/admin/al97/al97ui";

// Access activity: membership changes the server recorded for this account,
// with the event kinds it does not audit yet named as such, never shown as
// history. Reading this page changes no access.

export interface AccessActivityFixture {
  account: string;
  store: string | null;
  scope: string;
  /** Synthetic examples of the target events, shown only by a fixture. */
  targets?: Array<{ id: string; at: string; action: string; actor: string }>;
}

export const PEOPLE_TRAIL = [{ label: "People & Access", to: adminTabHref("team") }];
const UNAUDITED = ["Invitation created", "Invitation revoked", "Member removed"];

export function whenLabel(iso: string, now: number): string {
  const t = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(t);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const prefix = day(t) === day(new Date(now)) ? "Today" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(t);
  return `${prefix} · ${time}`;
}

export default function AccessActivityPage() {
  const fx = useViewFixture<AccessActivityFixture>("al97-access");
  const now = useAdminNow();
  const copy = useFixtureCopy();
  const { tenant, currentStore } = useTenant();
  const activity = useAccessActivity();
  const events = useMemo(() => (activity.rows ? activity.rows.map(describeAccessEvent) : null), [activity.rows]);
  const scopeName = fx?.scope ?? tenant?.name ?? "This account";
  const scopeLabel = { account: fx?.account ?? tenant?.name ?? "This account", store: fx ? fx.store : currentStore?.name ?? null };

  const recorded = events?.map((e) => ({ id: e.id, when: whenLabel(e.at, now), action: e.title, actor: e.actor ?? "Unknown" })) ?? [];
  const targets = fx?.targets
    ? fx.targets.map((t) => ({ id: t.id, when: whenLabel(t.at, now), action: t.action, actor: t.actor }))
    : UNAUDITED.map((a) => ({ id: a, when: "No server event", action: a, actor: "Not recorded" }));

  const table = activity.state === "loading" ? (
    <p aria-busy="true">Reading access activity.</p>
  ) : activity.state === "failed" || activity.state === "no-tenant" || !events ? (
    <Banner tone="red" icon="warning" title="Access activity could not be read" detail={activity.error ?? "No account is selected. Nothing is shown because the read did not answer, not because nothing happened."} />
  ) : (
    <div className="table-wrap">
      <table>
        <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Scope</th><th scope="col">Actor</th><th scope="col">Outcome</th></tr></thead>
        <tbody>
          {recorded.map((r) => <tr key={r.id}><td>{r.when}</td><td>{r.action}</td><td>{scopeName}</td><td>{r.actor}</td><td><span className="chip green">Recorded</span></td></tr>)}
          {targets.map((r) => <tr key={r.id}><td>{r.when}</td><td>{r.action}</td><td>{scopeName}</td><td>{r.actor}</td><td><span className="chip blue">{copy("access.target", "Not audited")}</span></td></tr>)}
        </tbody>
      </table>
    </div>
  );

  const main = (
    <div className="work">
      <Banner tone="amber" icon="warning" title="Membership audit coverage needs expansion" detail="Role changes are recorded. Invitation, removal and revocation events need server-side audit coverage." />
      <Card id="aa-changes" title="Membership changes" description={copy("access.note", "Role changes the server recorded, newest first. Event kinds it does not audit yet are listed as not audited, not as history.")}>
        {table}
      </Card>
      <div className="split">
        <div>
          <Card id="aa-contract" title="Audit event contract">
            <KeyVals rows={[["Identity", "Actor + membership reference"], ["Boundary", "Tenant + canonical store"], ["Before / after", "Role or access state"], ["Outcome", "Succeeded / denied / failed"], ["Reason", "Required for sensitive changes"]]} />
          </Card>
        </div>
        <div>
          <Card id="aa-coverage" title="Verification coverage">
            <KeyVals rows={[["Owner UI", "Read path inspected"], ["Manager restrictions", <span className="chip amber">Needs restricted test</span>], ["Direct URL / API", "Not proven by hiding navigation"], ["Audit immutability", "Enforce server-side"]]} />
          </Card>
        </div>
      </div>
      <Savebar title="No access changed" detail="A role preview is not a permission enforcement test."
        action={<Link to={ADMIN_CHILD_ROUTES.permissionVerification} className="btn">Open verification checklist</Link>} />
    </div>
  );
  return (
    <Al97Frame section="people" trail={PEOPLE_TRAIL} crumb="Access activity" title="Access activity" subtitle="Who changed access, for which store, and whether the server accepted it." scopeLabel={scopeLabel} main={main}>
      <p className="mt-4 text-[13px] text-adm-muted">Member details and role changes stay on <Link to={adminTabHref("team")} className="font-semibold text-adm-primary hover:underline">Team</Link>.</p>
    </Al97Frame>
  );
}
