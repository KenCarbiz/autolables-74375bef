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

describe("get_ready_blocks_finalize — latest migration definition (S8)", () => {
  const def = latestDefinition("get_ready_blocks_finalize");
  const body = norm(def.body);

  it("a signed FAIL never satisfies the finalize gate", () => {
    expect(body).toContain("is distinct from 'fail'");
  });
});
