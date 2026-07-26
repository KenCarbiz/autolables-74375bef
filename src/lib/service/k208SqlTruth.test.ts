import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One-truth harness over the migration FILES: whatever the lexically latest
// migration says a function is, IS what production runs after `db push`. These
// tests pin the QR/K-208 rules to the newest definition so a later migration
// that redefines submit_safety_inspection / get_vehicle_ready /
// get_ready_blocks_finalize without the hub-token and signed-fail semantics
// fails CI instead of silently re-breaking the service station.

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

const norm = (sql: string) =>
  sql.toLowerCase().replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/,\s+/g, ",");

describe("submit_safety_inspection — latest migration definition (S1)", () => {
  const def = latestDefinition("submit_safety_inspection");
  const body = norm(def.body);

  it("accepts the permanent 'vehicle' hub token, not only 'service'", () => {
    expect(body).toContain("not in ('service','vehicle')");
  });

  it("consumes only the single-use 'service' token — the hub token lives on", () => {
    expect(body).toMatch(
      /if r\.department = 'service' then update public\.dept_signoff_tokens set status = 'used'/,
    );
  });

  it("refuses a duplicate submission once an executed (signed, non-fail) K-208 exists", () => {
    expect(body).toContain("'already_completed'");
  });

  it("stamps created_by so an authorized member's QR sign-off satisfies the authority gate", () => {
    expect(body).toContain("created_by");
  });
});

describe("get_vehicle_ready — latest migration definition (S8)", () => {
  const def = latestDefinition("get_vehicle_ready");
  const body = norm(def.body);

  it("does not count a signed FAIL as service_done (would lock the QR station)", () => {
    expect(body).toMatch(/v_service_done\s*:=[^;]*result is distinct from 'fail'/);
  });
});

describe("certify_safety_inspection — latest migration definition", () => {
  const def = latestDefinition("certify_safety_inspection");
  const body = norm(def.body);

  it("refuses to certify while item failures are open on the VIN", () => {
    expect(body).toContain("safety_inspection_item_failures");
    expect(body).toContain("repair_state <> 'passed_on_reinspection'");
    expect(body).toContain("'failed_items_open'");
  });

  it("still refuses a failed inspection and an unauthorized signer", () => {
    expect(body).toContain("'inspection_failed_items_open'");
    expect(body).toContain("k208_signer_allowed");
  });
});

// 20260726160000/161000: every intake draft RPC must check tenant membership
// INSIDE the function (SECURITY DEFINER bypasses RLS) now that authenticated
// holds EXECUTE for the retry buttons. A later redefinition that drops the
// guard reopens the cross-tenant injection hole — fail CI instead.
describe("create_draft_* — latest definitions carry the tenant-membership guard", () => {
  for (const fn of [
    "create_draft_addendum",
    "create_draft_buyers_guide",
    "create_draft_safety_inspection",
    "create_draft_get_ready",
    "create_draft_window_sticker",
  ]) {
    it(`${fn} asserts membership before writing`, () => {
      const body = norm(latestDefinition(fn).body);
      expect(body).toContain("perform public.assert_tenant_member_or_service(p_tenant_id)");
    });
  }

  it("the guard passes service contexts (NULL uid) and refuses non-members", () => {
    const body = norm(latestDefinition("assert_tenant_member_or_service").body);
    expect(body).toContain("if v_uid is null then return");
    expect(body).toContain("'not_a_tenant_member'");
  });

  it("stock comes from vehicle_files.stock_number first — mc_attributes stock_no is only a fallback", () => {
    for (const fn of ["create_draft_get_ready", "create_draft_window_sticker"]) {
      const body = norm(latestDefinition(fn).body);
      expect(body).toContain("from public.vehicle_files");
      expect(body).toContain("stock_number");
    }
  });
});

describe("recompute_delivery_clearance — latest migration definition", () => {
  const def = latestDefinition("recompute_delivery_clearance");
  const body = norm(def.body);

  it("picks the newest signed row with the shared tiebreak: signed_at DESC NULLS LAST, created_at DESC", () => {
    expect(body).toContain("order by signed_at desc nulls last,created_at desc");
  });
});

describe("get_ready_blocks_finalize — latest migration definition (S8)", () => {
  const def = latestDefinition("get_ready_blocks_finalize");
  const body = norm(def.body);

  it("a signed FAIL never satisfies the finalize gate", () => {
    expect(body).toContain("is distinct from 'fail'");
  });
});

// 20260726190000: the safety_inspections write guard (audit D3.1 + D2.5).
// A later redefinition that drops the signed-birth authority check or the
// signed-row freeze reopens the direct-insert signing bypass — fail CI instead.
describe("enforce_safety_inspection_guard — latest migration definition (D3.1/D2.5)", () => {
  const body = norm(latestDefinition("enforce_safety_inspection_guard").body);

  it("a row only becomes signed with conduct authority or the QR token flag", () => {
    expect(body).toContain("k208_conduct_allowed");
    expect(body).toContain("current_setting('app.k208_token_submit',true)");
    expect(body).toContain("'not_authorized_to_sign_inspection'");
  });

  it("stamps created_by with the authenticated signer so authority checks cannot be spoofed", () => {
    expect(body).toContain("new.created_by := v_uid");
  });

  it("licensee certification cannot be born on INSERT and only signers may write it on UPDATE", () => {
    expect(body).toContain("'certification_only_via_certify_rpc'");
    expect(body).toContain("k208_signer_allowed");
    expect(body).toContain("'not_authorized_to_certify'");
  });

  it("signed rows freeze every legal field and only transition to voided", () => {
    expect(body).toContain("'signed_inspection_frozen'");
    for (const col of ["checklist", "result", "signature_data", "content_hash", "signed_at", "inspector_name"]) {
      expect(body).toContain(`new.${col} is distinct from old.${col}`);
    }
  });

  it("voiding a signed row requires manager authority and a documented reason", () => {
    expect(body).toContain("'not_authorized_to_void'");
    expect(body).toContain("'void_reason_required'");
  });

  it("voided rows are immutable", () => {
    expect(body).toContain("'voided_inspection_immutable'");
  });
});

describe("k208_conduct_allowed — latest migration definition", () => {
  it("mirrors save_inspection_draft's conduct role matrix exactly", () => {
    const guard = norm(latestDefinition("k208_conduct_allowed").body);
    const draft = norm(latestDefinition("save_inspection_draft").body);
    const roleList = "'owner','general_manager','gsm','admin','manager','service_manager','service_advisor','detail','service'";
    expect(guard).toContain(roleList);
    expect(draft).toContain(roleList);
  });
});

describe("submit_safety_inspection — write-guard integration (D3.1)", () => {
  const body = norm(latestDefinition("submit_safety_inspection").body);

  it("sets the transaction-local token flag before writing the signed row", () => {
    expect(body).toContain("set_config('app.k208_token_submit','1',true)");
  });
});

describe("transition_safety_inspection — latest migration definition (D2.5)", () => {
  const body = norm(latestDefinition("transition_safety_inspection").body);

  it("the void branch records the voided metadata the write guard requires", () => {
    expect(body).toContain("void_reason = trim(p_reason)");
    expect(body).toContain("voided_by = v_uid");
    expect(body).toContain("voided_at = now()");
  });

  it("still requires manager authority and a documented reason to void", () => {
    expect(body).toContain("'not_authorized_to_void'");
    expect(body).toContain("'void_reason_required'");
  });
});

// 20260726191000: tenant_members.role feeds k208_signer_allowed's compat
// fallback — role-granting authority must require an ACCEPTED admin membership
// and every tenant-level role change must be audited.
describe("member role authority — latest migration definitions (D2.1)", () => {
  it("rbac_is_tenant_admin requires an accepted membership", () => {
    const body = norm(latestDefinition("rbac_is_tenant_admin").body);
    expect(body).toContain("accepted_at is not null");
    expect(body).toContain("'owner','admin','general_manager'");
  });

  it("set_tenant_member_role audits the change like the platform-admin path", () => {
    const body = norm(latestDefinition("set_tenant_member_role").body);
    expect(body).toContain("'member_role_changed'");
    expect(body).toContain("prev_role");
  });
});
