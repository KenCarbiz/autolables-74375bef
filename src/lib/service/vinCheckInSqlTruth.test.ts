import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-truth harness over the migration FILES for VIN check-in. Whatever the
// lexically latest migration says the function is, IS what production runs
// after `db push`, and SQL is outside tsconfig — so this is the only thing that
// stops a later edit from quietly turning a public identifier back into an
// authorisation.
//
// What is being pinned: a QR token is a capability (holding the link proves the
// dealership sent it), a VIN is not (it is legible through every windshield on
// the lot). Replacing one with the other is only safe while the authority comes
// from the session instead.

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

function latestDefinition(fn: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const marker = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`, "g");
  let hit: { file: string; body: string } | null = null;
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    let m: RegExpExecArray | null = null;
    let last: number | null = null;
    while ((m = marker.exec(text)) !== null) last = m.index;
    marker.lastIndex = 0;
    if (last === null) continue;
    const rest = text.slice(last);
    const open = rest.match(/AS\s+(\$[a-zA-Z_]*\$)/);
    if (!open) { hit = { file, body: rest }; continue; }
    const tag = open[1];
    const bodyStart = (open.index as number) + open[0].length;
    const close = rest.indexOf(tag, bodyStart);
    hit = { file, body: close === -1 ? rest : rest.slice(0, close + tag.length) };
  }
  if (!hit) throw new Error(`no migration defines public.${fn}`);
  return hit;
}

const allSql = (): string =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");

const norm = (sql: string) =>
  sql.toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("resolve_vin_checkin — a scanned VIN selects the car, the session grants the right", () => {
  const definition = latestDefinition("resolve_vin_checkin");
  const body = norm(definition.body);

  it("refuses a caller with no session before it looks at anything else", () => {
    expect(body).toContain("if v_uid is null then");
    expect(body).toContain("'not_authenticated'");
    const uidGuard = body.indexOf("'not_authenticated'");
    expect(uidGuard).toBeGreaterThan(-1);
    expect(uidGuard).toBeLessThan(body.indexOf("from public.tenant_members"));
  });

  it("is never granted to anon — that is the whole difference from the QR pages", () => {
    const grants = norm(allSql());
    expect(grants).toContain("revoke all on function public.resolve_vin_checkin(text) from public, anon");
    expect(grants).toContain("grant execute on function public.resolve_vin_checkin(text) to authenticated");
    expect(grants).not.toMatch(/grant execute on function public\.resolve_vin_checkin\(text\) to anon/);
  });

  it("takes the vendor's address from the JWT, never from a parameter", () => {
    expect(body).toContain("auth.jwt() ->> 'email'");
    // The only argument is the VIN. An email parameter would let one vendor ask
    // for another vendor's work.
    expect(definition.body).toMatch(/resolve_vin_checkin\(\s*p_vin text\s*\)/);
  });

  it("validates the VIN server-side rather than trusting the scanner", () => {
    expect(body).toContain("length(v_vin) <> 17");
    expect(body).toContain("v_vin ~ '[ioq]'");
    expect(body).toContain("'invalid_vin'");
  });

  it("scopes a third-party vendor to lines addressed to their own email", () => {
    expect(body).toContain("lower(trim(coalesce(x.item ->> 'vendoremail', ''))) = v_email");
    expect(body).toContain("'not_assigned'");
    // The vendor branch must return before any hub token is minted.
    const vendorReturn = body.indexOf("'mode', 'vendor'");
    expect(vendorReturn).toBeGreaterThan(-1);
    expect(vendorReturn).toBeLessThan(body.indexOf("issue_vehicle_ready_token"));
  });

  it("never hands a vendor the vehicle's get-ready hub token", () => {
    const vendorBranch = body.slice(
      body.indexOf("if v_role in ('third_party_vendor', 'vendor') then"),
      body.indexOf("if v_role not in ("),
    );
    expect(vendorBranch).not.toContain("issue_vehicle_ready_token");
    expect(vendorBranch).toContain("'ready_token', null");
  });

  it("only offers the install-proof surface to a vendor with an install line on THAT car", () => {
    const vendorBranch = body.slice(
      body.indexOf("if v_role in ('third_party_vendor', 'vendor') then"),
      body.indexOf("if v_role not in ("),
    );
    const installIndex = vendorBranch.indexOf("v_install := v_listing.install_token");
    expect(installIndex).toBeGreaterThan(-1);
    expect(vendorBranch.slice(0, installIndex)).toContain("a ->> 'category' = 'accessory'");
  });

  it("tells a vendor apart from a stranger: the car exists, the work is not theirs", () => {
    expect(body).toContain("'vehicle_not_found'");
    expect(body).toContain("'not_assigned'");
    expect(body).toContain("'no_membership'");
    expect(body).toContain("'role_not_permitted'");
  });

  it("does not let a role without get-ready work open a sign-off", () => {
    const denied = ["salesperson", "biller", "readonly", "finance", "compliance", "office", "sales_manager"];
    const allowList = body.slice(body.indexOf("if v_role not in ("), body.indexOf("'role_not_permitted'"));
    for (const role of denied) expect(allowList).not.toContain(`'${role}'`);
    for (const role of ["service_manager", "service_advisor", "detail", "technician"]) {
      expect(allowList).toContain(`'${role}'`);
    }
  });

  it("mints the hub token through the one function that already mints it", () => {
    expect(body).toContain("v_token := public.issue_vehicle_ready_token(v_tenant, v_vin)");
    // Minting inline would bypass issue_vehicle_ready_token's own membership check.
    expect(body).not.toContain("insert into public.dept_signoff_tokens");
  });
});

describe("the printed QR routes stay live", () => {
  it("keeps the anon token RPCs the existing labels resolve through", () => {
    const sql = norm(allSql());
    for (const fn of [
      "get_vehicle_ready(text)",
      "get_dept_signoff_token(text)",
      "submit_detail_signoff",
      "submit_safety_inspection",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")}[^;]*to anon`));
    }
  });
});
