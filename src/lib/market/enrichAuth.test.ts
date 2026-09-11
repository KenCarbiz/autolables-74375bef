// ── The last variable-time secret comparison, removed ──────────────────────
//
// `vehicle-enrich` compared two secrets with `===`. JavaScript string equality
// returns at the first differing byte, so the time it takes leaks how much of
// a guess was correct. Gate 14D removed this shape from the writer, 14F-B from
// the proxy; this was the third and last.
//
// What must NOT change: which credentials are accepted, and where they are
// read from. Widening either is not a timing fix.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WRITER_AUTH_ENV_NAME, WRITER_AUTH_HEADER } from "../../../supabase/functions/_shared/functionAuth.ts";

const ENRICH = "supabase/functions/vehicle-enrich/index.ts";
const CORS = "supabase/functions/_shared/http.ts";
const src = readFileSync(ENRICH, "utf8");
/** Comments stripped: the header quotes the removed line. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the direct comparisons are gone", () => {
  it("carries no === or !== against either secret", () => {
    expect(code).not.toMatch(/authToken\s*[!=]==\s*SERVICE_KEY/);
    expect(code).not.toMatch(/SERVICE_KEY\s*[!=]==\s*authToken/);
    expect(code).not.toMatch(/secret\s*[!=]==\s*CRON_SECRET/);
    expect(code).not.toMatch(/CRON_SECRET\s*[!=]==\s*secret/);
  });

  it("uses the reviewed shared comparison for both", () => {
    expect(src).toContain("constantTimeEquals");
    expect(src).toContain('from "../_shared/functionAuth.ts"');
    expect(code).toContain("await constantTimeEquals(authToken, SERVICE_KEY)");
    expect(code).toContain("await constantTimeEquals(secret, CRON_SECRET)");
  });

  it("fails closed when a secret is unconfigured or a credential is empty", () => {
    expect(code).toMatch(/isServiceRole = !!SERVICE_KEY && !!authToken/);
    expect(code).toMatch(/hasCronSecret = !!CRON_SECRET && !!secret/);
  });
});

describe("the accepted credentials are unchanged", () => {
  it("reads the same two slots as before", () => {
    expect(code).toContain('req.headers.get("authorization")');
    expect(code).toContain('req.headers.get("x-cron-secret")');
    // No new slot was opened.
    expect(code).not.toContain("readCredentials(");
    expect(code).not.toMatch(/headers\.get\("apikey"\)/);
  });

  it("keeps the user fallback: platform admin, then accepted tenant membership", () => {
    expect(code).toContain("admin.auth.getUser(authToken)");
    expect(code).toContain('json(401, { error: "authentication required" })');
    expect(code).toContain('.eq("role", "admin")');
    expect(code).toContain('.not("accepted_at", "is", null)');
    expect(code).toContain('json(403, { error: "not a member of this tenant" })');
  });

  it("authenticates before any provider call or write", () => {
    // Scoped to the REQUEST HANDLER. `mcFetch` is defined near the top of the
    // module as a helper; a whole-file index would read that definition as a
    // call made before authentication, which is not what it is.
    const handler = code.slice(code.indexOf("serve(async (req) => {"));
    expect(handler.length).toBeGreaterThan(1000);
    const authAt = handler.indexOf("const authToken =");
    expect(authAt).toBeGreaterThan(-1);
    for (const later of [
      "admin.auth.getUser(",
      'from("vehicle_listings")',
      // What the HANDLER actually calls. `mcFetch` is one level down inside
      // these, so naming it here would assert against a symbol the handler
      // never mentions.
      "await fetchComps(",
      "await fetchMds(",
      "await fetchHistory(",
      "update(patch)",
      "market-valuation-write",
    ]) {
      const at = handler.indexOf(later);
      expect(at, `${later} must appear after authentication`).toBeGreaterThan(authAt);
    }
  });
});

describe("no secret material is exposed", () => {
  it("never logs, returns or serialises either secret", () => {
    for (const secret of ["SERVICE_KEY", "CRON_SECRET", "WRITER_AUTH_KEY"]) {
      expect(code, secret).not.toMatch(new RegExp(`console\\.(log|warn|error|info)\\([^)]*${secret}`));
      expect(code, secret).not.toMatch(new RegExp(`json\\([^)]*${secret}`));
      expect(code, secret).not.toContain(`JSON.stringify(${secret}`);
    }
  });

  it("does not send the dedicated writer key to a provider or a browser", () => {
    // It goes to exactly one place: the writer, server to server.
    const uses = code.split("WRITER_AUTH_KEY").length - 1;
    expect(uses).toBeGreaterThan(0);
    expect(code).toMatch(new RegExp(`\\[WRITER_AUTH_HEADER\\]: WRITER_AUTH_KEY`));
    expect(code).not.toMatch(/mcFetch\([^)]*WRITER_AUTH_KEY/);
  });

  it("leaves CORS unchanged and free of the writer header", () => {
    expect(readFileSync(CORS, "utf8")).not.toContain(WRITER_AUTH_HEADER);
  });

  it("commits no credential-shaped literal", () => {
    for (const shape of [/sb_secret_[A-Za-z0-9_-]{12,}/, /eyJhbGciOi[A-Za-z0-9_-]{20,}/]) {
      expect(src, String(shape)).not.toMatch(shape);
    }
  });

  it("keeps the env name out of the browser tree", () => {
    const { execSync } = require("node:child_process");
    const hits = execSync(
      `grep -rl '${WRITER_AUTH_ENV_NAME}' src/ 2>/dev/null || true`, { encoding: "utf8" },
    ).trim().split("\n").filter((l: string) => l && !l.includes(".test."));
    expect(hits).toEqual([]);
  });
});
