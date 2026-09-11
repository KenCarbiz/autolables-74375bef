// ── The retired proxy gets the same comparison the writer got ──────────────
//
// Gate 14D replaced `auth !== SERVICE_KEY` in `market-valuation-write` with a
// reviewed constant-time comparison, and left the identical line standing in
// `marketcheck-market-pricing`. Same secret, same variable-time equality, same
// exposure — JavaScript string comparison returns at the first differing byte,
// so how long it takes tells an attacker how much of a guess was right.
//
// This is a source-level audit rather than an executed request: the proxy is a
// `Deno.serve` module with a live Supabase client, so it cannot be imported
// under vitest. What CAN be asserted here is that the dangerous shape is gone,
// the reviewed one is present, the response contract is untouched, and no
// credential material was committed. The executed proof of the comparison
// itself lives next door in
// `supabase/functions/_shared/functionAuth_test.ts`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// Imported rather than spelled out. `functionAuth.test.ts` guards that the
// literal secret name never appears anywhere under src/, which is the tree
// that ships to a browser — and a test asserting the name is ABSENT is still
// the name, present. Importing the constants keeps the guard intact and
// makes these assertions survive a rename.
import {
  WRITER_AUTH_ENV_NAME, WRITER_AUTH_HEADER,
} from "../../../supabase/functions/_shared/functionAuth.ts";

const PROXY = "supabase/functions/marketcheck-market-pricing/index.ts";
const CORS = "supabase/functions/_shared/http.ts";
const src = readFileSync(PROXY, "utf8");
/** Comments removed: this file's own header quotes the deleted line. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the variable-time comparison is gone", () => {
  it("carries no direct equality against the service key", () => {
    expect(code).not.toMatch(/auth\s*!==\s*SERVICE_KEY/);
    expect(code).not.toMatch(/auth\s*===\s*SERVICE_KEY/);
    expect(code).not.toMatch(/SERVICE_KEY\s*[!=]==\s*auth/);
  });

  it("uses the reviewed shared comparison instead", () => {
    expect(src).toContain('import { constantTimeEquals } from "../_shared/functionAuth.ts";');
    expect(code).toContain("await constantTimeEquals(auth, SERVICE_KEY)");
  });

  it("still fails closed when no service key is configured", () => {
    // An unconfigured deployment must not accept a credential, and must not
    // reach the comparison with an empty configured value.
    expect(code).toMatch(/if \(!SERVICE_KEY \|\| !auth \|\| !\(await constantTimeEquals\(auth, SERVICE_KEY\)\)\)/);
  });
});

describe("the contract is unchanged", () => {
  it("reads the credential from Authorization only, as before", () => {
    // `readCredentials` would also accept an `apikey` header as a service
    // credential. Widening which header can carry one is not a timing fix.
    expect(code).toContain('req.headers.get("Authorization")');
    expect(code).not.toContain("readCredentials(");
    expect(code).not.toContain('headers.get("apikey")');
  });

  it("keeps the same fallbacks: 401, then tenant_id, then admin, then membership", () => {
    for (const shape of [
      'json(401, { error: "authentication required" })',
      'json(400, { error: "tenant_id required" })',
      'json(403, { error: "not a member of this tenant" })',
      'json(400, { error: "invalid_vin" })',
      'json(405, { error: "method not allowed" })',
    ]) {
      expect(code, shape).toContain(shape);
    }
  });

  it("keeps the per-VIN response shape: delegate and return verbatim", () => {
    expect(code).toContain("return await delegate(vin, tenantId, body.force === true);");
    expect(code).toMatch(/const body = await res\.json\(\)[\s\S]*return json\(res\.status, body\);/);
  });

  it("leaves batch behaviour exactly as it was", () => {
    // Still 400 batch_retired. Changing it is a separate, product-gated
    // decision — the live caller in InventoryModern still sends batch: true.
    expect(code).toContain('error: "batch_retired"');
    expect(code).toMatch(/if \(body\.batch\) \{/);
  });

  it("writes no column and performs no market arithmetic", () => {
    for (const column of ["market_value", "market_position", "market_payload", "market_checked_at"]) {
      expect(code, column).not.toContain(`${column}:`);
    }
    expect(code).not.toContain(".update(");
    expect(code).not.toContain(".insert(");
  });
});

describe("no credential is exposed", () => {
  it("never logs, returns or serialises the key", () => {
    expect(code).not.toMatch(/console\.(log|error|warn|info)\([^)]*SERVICE_KEY/);
    expect(code).not.toMatch(/json\([^)]*SERVICE_KEY/);
    expect(code).not.toContain("JSON.stringify(SERVICE_KEY");
  });

  it("does not reference the dedicated writer key", () => {
    // The proxy authenticates to the writer with the service role, which the
    // writer's legacy path accepts. It has no business holding the scoped key.
    expect(src).not.toContain(WRITER_AUTH_ENV_NAME);
    expect(src).not.toContain(WRITER_AUTH_HEADER);
  });

  it("does not add the custom writer header to CORS", () => {
    const cors = readFileSync(CORS, "utf8");
    expect(cors).not.toContain(WRITER_AUTH_HEADER);
  });

  it("commits no credential-shaped literal", () => {
    for (const shape of [/sb_secret_[A-Za-z0-9_-]{8,}/, /eyJhbGciOi[A-Za-z0-9_-]{12,}/, /service_role["']?\s*:\s*["']ey/]) {
      expect(src, String(shape)).not.toMatch(shape);
    }
  });
});
