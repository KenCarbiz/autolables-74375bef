// ── A flag nothing reads is a label, not a control ─────────────────────────
//
// Six of the seven Market V2 flags have zero production readers. Reporting a
// stored `false` on one of them as "V2 is off" credits a rollout to a switch
// that is not wired to anything — and, worse, an "on" would read in an audit
// as though a shadow pilot had run and found nothing.
//
// This file does two jobs. It counts the readers against the real tree, so the
// claim cannot go stale silently. And it fixes, as executable policy, what
// `market_value_v2_shadow` has to mean before it may be called a control.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MARKET_FLAG_NAMES, MARKET_FLAGS, readMarketFlag, readMarketFlags,
  decideShadowEvaluation, isInertWithoutReader,
  SHADOW_CONTROL_REQUIREMENTS, type ShadowInvocationSource,
} from "./flags.ts";

const ROOTS = ["src", "supabase/functions"];
const SELF = join("src", "lib", "market", "flags.ts");

/** Production modules only: no tests, no fixtures, and not the generated mirror. */
function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const unix = full.split("\\").join("/");
    if (statSync(full).isDirectory()) {
      if (unix.includes("_shared/factorySticker") || entry === "__fixtures__" || entry === "__snapshots__") continue;
      productionFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    if (full === SELF) continue;
    out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => productionFiles(r));
const readersOf = (flag: string): string[] =>
  FILES.filter((f) => new RegExp(`readMarketFlag\\([^)]*"${flag}"\\)`).test(readFileSync(f, "utf8")));

/**
 * The audited state, 2026-09-11. This is a RECORD, not a target: when a reader
 * is implemented, update the number here in the same commit, so the count and
 * the claim can never disagree.
 */
const AUDITED_READERS: Record<string, number> = {
  market_value_v2_admin: 1,
  market_value_v2_shadow: 0,
  market_value_v2_public: 0,
  marketcheck_current_endpoint: 0,
  marketcheck_premium_comparables: 0,
  pricing_position_v2_shadow: 0,
  market_invalid_claim_suppression: 0,
};

describe("the flag reader audit", () => {
  it("scans a real tree", () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("matches the audited reader count for every flag", () => {
    for (const flag of MARKET_FLAG_NAMES) {
      expect(readersOf(flag).length, `${flag}: ${readersOf(flag).join(", ")}`)
        .toBe(AUDITED_READERS[flag]);
    }
  });

  it("names the only live reader, so a second one is a deliberate decision", () => {
    expect(readersOf("market_value_v2_admin"))
      .toEqual(["supabase/functions/market-valuation-write/index.ts"]);
  });

  it("keeps the audit covering every declared flag", () => {
    expect(Object.keys(AUDITED_READERS).sort()).toEqual([...MARKET_FLAG_NAMES].sort());
  });

  it("states plainly which flags are inert", () => {
    const inert = MARKET_FLAG_NAMES.filter((f) => isInertWithoutReader(readersOf(f).length));
    expect(inert).toHaveLength(6);
    expect(inert).toContain("market_value_v2_shadow");
  });
});

describe("every flag still defaults off", () => {
  it("declares false for all seven", () => {
    for (const flag of MARKET_FLAG_NAMES) expect(MARKET_FLAGS[flag]).toBe(false);
  });

  it("resolves absence, malformation and truthy impostors to off", () => {
    for (const settings of [
      null, undefined, {}, { market_flags: null }, { market_flags: "all" },
      { market_flags: { market_value_v2_shadow: "true" } },
      { market_flags: { market_value_v2_shadow: 1 } },
      { market_flags: { market_value_v2_shadow: "yes" } },
    ]) {
      expect(readMarketFlag(settings, "market_value_v2_shadow"), JSON.stringify(settings)).toBe(false);
    }
    // Only a literal true.
    expect(readMarketFlag({ market_flags: { market_value_v2_shadow: true } }, "market_value_v2_shadow")).toBe(true);
  });

  it("reads Harte's stored blob as seven falses", () => {
    const harte = { market_flags: Object.fromEntries(MARKET_FLAG_NAMES.map((f) => [f, false])) };
    expect(Object.values(readMarketFlags(harte)).every((v) => v === false)).toBe(true);
  });
});

describe("what shadow must mean before it is a control", () => {
  const on = { market_flags: { market_value_v2_shadow: true } };

  it("records the ten requirements as data, not prose", () => {
    expect([...SHADOW_CONTROL_REQUIREMENTS]).toEqual([
      "server_side_only", "tenant_scoped", "no_public_rendering",
      "no_compatibility_column_write", "no_automatic_provider_call",
      "no_budget_bypass", "append_only_evidence", "auditable_invocation_source",
      "immediate_off_switch", "no_browser_controlled_provider_spend",
    ]);
  });

  it("refuses when the flag is off — the immediate off switch", () => {
    const d = decideShadowEvaluation({ settings: {}, tenantId: "t", source: "server_scheduled" });
    expect(d.run).toBe(false);
    expect(d.reasons).toEqual(["shadow_flag_off"]);
  });

  it("refuses without a tenant scope", () => {
    for (const tenantId of [null, undefined, ""]) {
      const d = decideShadowEvaluation({ settings: on, tenantId, source: "server_scheduled" });
      expect(d.run, String(tenantId)).toBe(false);
      expect(d.reasons).toContain("shadow_requires_tenant_scope");
    }
  });

  it("refuses a browser-initiated evaluation by name", () => {
    // A page that can ask the server to evaluate a vehicle is a page that can
    // ask the server to spend money.
    for (const source of ["browser", "unknown"] as ShadowInvocationSource[]) {
      const d = decideShadowEvaluation({ settings: on, tenantId: "t", source });
      expect(d.run, source).toBe(false);
      expect(d.reasons).toContain("no_browser_controlled_provider_spend");
    }
  });

  it("allows a server-side, tenant-scoped evaluation and nothing more", () => {
    for (const source of ["server_scheduled", "server_operator"] as ShadowInvocationSource[]) {
      const d = decideShadowEvaluation({ settings: on, tenantId: "t", source });
      expect(d.run, source).toBe(true);
      // Even when it runs: no spending, no customer columns, no rendering.
      expect(d.allowProviderCall).toBe(false);
      expect(d.allowCompatibilityWrite).toBe(false);
      expect(d.allowPublicRender).toBe(false);
      expect(d.reasons).toContain(`shadow_invocation_source_${source}`);
    }
  });

  it("cannot grant a permission in any branch", () => {
    const every = [
      decideShadowEvaluation({ settings: {}, tenantId: "t", source: "server_scheduled" }),
      decideShadowEvaluation({ settings: on, tenantId: null, source: "server_scheduled" }),
      decideShadowEvaluation({ settings: on, tenantId: "t", source: "browser" }),
      decideShadowEvaluation({ settings: on, tenantId: "t", source: "server_operator" }),
    ];
    for (const d of every) {
      expect(d.allowProviderCall).toBe(false);
      expect(d.allowCompatibilityWrite).toBe(false);
      expect(d.allowPublicRender).toBe(false);
    }
  });

  it("adds no caller, scheduler, fetch or write in this gate", () => {
    const flags = readFileSync("src/lib/market/flags.ts", "utf8");
    for (const sideEffect of ["fetch(", "Deno.serve", "supabase", ".from(", "setInterval", "setTimeout"]) {
      expect(flags, sideEffect).not.toContain(sideEffect);
    }
  });
});
