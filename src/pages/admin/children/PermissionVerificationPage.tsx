import { Link } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { Al97Frame, Banner, Card, KeyVals, Savebar, useFixtureCopy } from "@/components/admin/al97/al97ui";
import { PEOPLE_TRAIL } from "./AccessActivityPage";

// Permission verification: the expected allow and refusal for each role, as a
// test plan to run with synthetic tenants and role accounts. A role preview
// here is a simulation; nothing on this page grants, changes or tests access,
// and the checklist export is a file the viewer saves, not a server write.

export interface PermissionVerificationFixture { account: string; store: string | null }

export const VERIFICATION_MATRIX: Array<[string, string, string, string, string]> = [
  ["Read allowed store", "Allow", "Allow", "Scoped allow", "Deny"],
  ["Edit pricing assumptions", "Policy-defined", "Policy-defined", "Deny", "Deny"],
  ["Change feed binding", "Platform admin only", "Deny", "Deny", "Deny"],
  ["Approve duplicate plan", "Policy-defined", "Deny unless granted", "Deny", "Deny"],
  ["Read restricted evidence", "Policy-defined", "Scoped", "Scoped", "Deny"],
];
const ROLES = ["Owner", "Manager", "Salesperson", "Other tenant"];

export function checklistText(): string {
  const lines = ["Permission verification checklist", "Run with synthetic tenants and role accounts. Record each allow and refusal.", ""];
  for (const [action, ...cells] of VERIFICATION_MATRIX) {
    lines.push(action);
    cells.forEach((c, i) => lines.push(`  [ ] ${ROLES[i]}: expect ${c}`));
  }
  lines.push("", "Layers: navigation, direct URL, API / RPC, database.");
  return lines.join("\n");
}

function exportChecklist() {
  const url = URL.createObjectURL(new Blob([checklistText()], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "permission-verification-checklist.txt";
  a.click();
  URL.revokeObjectURL(url);
}

export default function PermissionVerificationPage() {
  const fx = useViewFixture<PermissionVerificationFixture>("al97-permissions");
  const copy = useFixtureCopy();
  const { tenant, currentStore } = useTenant();
  const scopeLabel = { account: fx?.account ?? tenant?.name ?? "This account", store: fx ? fx.store : currentStore?.name ?? null };
  const main = (
    <div className="work">
      <Banner tone="blue" icon="info" title="Owner inspection does not prove restricted-role enforcement" detail="Use synthetic tenants and role accounts; capture every expected allow and refusal." />
      <Card id="pv-matrix" title="Required verification matrix" description="Expected policy must be confirmed against the existing capability contract; do not invent new access grants.">
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Action</th>{ROLES.map((r) => <th key={r} scope="col">{r}</th>)}</tr></thead>
            <tbody>{VERIFICATION_MATRIX.map(([action, ...cells]) => <tr key={action}><td>{action}</td>{cells.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Card>
      <div className="split">
        <div>
          <Card id="pv-layers" title="Four enforcement layers">
            <KeyVals rows={[["Navigation", "Correct visible actions"], ["Direct URL", "No privilege from deep linking"], ["API / RPC", "Server checks authenticated role"], ["Database", "Tenant and store boundary enforced"]]} />
          </Card>
        </div>
        <div>
          <Card id="pv-results" title="Result evidence">
            <KeyVals rows={[["UI preview", <span className="chip blue">Simulation</span>], ["Restricted accounts", <span className="chip amber">{copy("permissions.restricted", "Not recorded")}</span>], ["Denied response", "No partial write"], ["Audit trail", "Actor + scope + outcome"]]} />
          </Card>
        </div>
      </div>
      <Savebar title="No permission granted" detail="Do not test by changing customer access or impersonating real staff."
        action={<button type="button" className="btn" onClick={exportChecklist}>Export test checklist</button>} />
    </div>
  );
  return (
    <Al97Frame section="people" trail={PEOPLE_TRAIL} crumb="Permission verification" title="Permission verification" subtitle="A role preview and a restricted-account test are different evidence." scopeLabel={scopeLabel} main={main}>
      <p className="mt-4 text-[13px] text-adm-muted">Recorded role changes are on <Link to={ADMIN_CHILD_ROUTES.accessActivity} className="font-semibold text-adm-primary hover:underline">Access activity</Link>.</p>
    </Al97Frame>
  );
}
