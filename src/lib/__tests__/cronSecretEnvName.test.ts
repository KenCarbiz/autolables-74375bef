import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// supabase/functions is outside tsconfig's `include`, so nothing typechecks
// these files. This guard covers the one failure they have already produced at
// scale: the cron shared-secret env var name splitting three ways.
//
// `passport-lead-escalation` (19,376 runs) and `passport-delivery-flush`
// (10,514 runs) returned 401 on every single run while pg_cron logged each as
// "succeeded" — pg_cron records success when net.http_post QUEUES the request
// and never sees the response, so a permanently unauthorised schedule looks
// healthy forever. The cause was three names for one secret:
// MARKETCHECK_CRON_SECRET and CRON_SHARED_SECRET in the shared gate, and a
// third, CRON_SECRET, read locally inside a function. Only
// MARKETCHECK_CRON_SECRET is actually set on the project (proven by
// `autolabels_crawl_advertised_prices`, which sends nothing but x-cron-secret
// and returns 200), so the local name could never match.
//
// The rule: the accepted names are declared once, in _shared/supabase.ts, and
// cron-authenticated functions go through isServiceOrCron rather than reading
// an env var of their own.

const fnDir = join(__dirname, "../../../supabase/functions");
const sharedGate = join(fnDir, "_shared/supabase.ts");

const readFn = (name: string) => readFileSync(join(fnDir, name, "index.ts"), "utf8");

// Any Deno.env.get("...CRON...") read — the shape that splits.
const CRON_ENV_READ = /Deno\.env\.get\(\s*["'`]([A-Z0-9_]*CRON[A-Z0-9_]*)["'`]\s*\)/g;

const cronEnvNamesIn = (src: string): string[] =>
  [...src.matchAll(CRON_ENV_READ)].map((m) => m[1]);

// Functions that still read a cron secret name of their own instead of calling
// isServiceOrCron. Neither currently has a pg_cron schedule pointed at it, so
// neither is burning runs — but both are the same latent defect. This list may
// only ever SHRINK: migrating one to the shared gate without deleting its entry
// here fails the "no stale entries" test below.
const NOT_YET_ON_SHARED_GATE = new Set([
  "send-ct-mvp-compliance-digests",
]);

// Functions whose auth gate must be the shared one, no local env lookup.
const MUST_USE_SHARED_GATE = [
  "passport-lead-escalation",
  "send-passport-document-deliveries",
];

describe("cron shared-secret env var name", () => {
  const gateSrc = readFileSync(sharedGate, "utf8");

  // The declared list, parsed out of the source so the test reads the same
  // truth the deployed function does.
  const declared = (() => {
    const m = gateSrc.match(/CRON_SECRET_ENV_NAMES\s*=\s*\[([^\]]*)\]/);
    expect(m, "_shared/supabase.ts must declare CRON_SECRET_ENV_NAMES").toBeTruthy();
    return (m as RegExpMatchArray)[1]
      .split(",")
      .map((t) => t.trim().replace(/^["'`]|["'`]$/g, ""))
      .filter(Boolean);
  })();

  it("declares the accepted names in exactly one place", () => {
    expect(declared.length).toBeGreaterThan(0);
    // The name that is actually set on the Supabase project. Dropping it
    // silently 401s every schedule, and pg_cron will still say "succeeded".
    expect(declared).toContain("MARKETCHECK_CRON_SECRET");
    // isServiceOrCron must read the declared list, not inline names.
    expect(gateSrc).toMatch(/CRON_SECRET_ENV_NAMES\s*\n?\s*\.map\(/);
    const inlineReads = cronEnvNamesIn(gateSrc);
    expect(inlineReads).toEqual([]);
  });

  for (const name of MUST_USE_SHARED_GATE) {
    it(`${name} authenticates through isServiceOrCron`, () => {
      const src = readFn(name);
      expect(src).toMatch(/import\s*\{[^}]*isServiceOrCron[^}]*\}\s*from\s*["'][^"']*_shared\/supabase\.ts["']/);
      expect(src).toMatch(/!isServiceOrCron\(req\)/);
      // No private env lookup to drift away from the shared list.
      expect(cronEnvNamesIn(src)).toEqual([]);
    });
  }

  const entrypoints = readdirSync(fnDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared")
    .filter((d) => existsSync(join(fnDir, d.name, "index.ts")))
    .map((d) => d.name);

  it("has entrypoints to check", () => {
    expect(entrypoints.length).toBeGreaterThan(5);
  });

  it("no edge function reads a cron secret name the shared gate does not accept", () => {
    const offenders: string[] = [];
    for (const name of entrypoints) {
      if (NOT_YET_ON_SHARED_GATE.has(name)) continue;
      for (const envName of cronEnvNamesIn(readFn(name))) {
        if (!declared.includes(envName)) offenders.push(`${name}: ${envName}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the not-yet-migrated allowlist has no stale entries", () => {
    const stale: string[] = [];
    for (const name of NOT_YET_ON_SHARED_GATE) {
      if (!entrypoints.includes(name)) { stale.push(`${name} (no such function)`); continue; }
      const off = cronEnvNamesIn(readFn(name)).filter((n) => !declared.includes(n));
      if (off.length === 0) stale.push(`${name} (now clean — delete it from the list)`);
    }
    expect(stale).toEqual([]);
  });
});
