// ── The two edge functions, at their boundaries ────────────────────────────
//
// Neither `vehicle-enrich` nor `market-valuation-write` can be imported under
// vitest — both are `Deno.serve` modules holding live Supabase clients. What
// can be asserted is the shape of the production path, and the shapes below
// are the ones that decide whether money can be spent and whether a browser
// can start a run.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { WRITER_AUTH_ENV_NAME, WRITER_AUTH_HEADER } from "../../../supabase/functions/_shared/functionAuth.ts";

const ENRICH = "supabase/functions/vehicle-enrich/index.ts";
const WRITER = "supabase/functions/market-valuation-write/index.ts";
const CORS = "supabase/functions/_shared/http.ts";

const read = (p: string) => readFileSync(p, "utf8");
/** Comments stripped: these files describe the removed behaviour in prose. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const enrich = code(ENRICH);
const writer = code(WRITER);

describe("the writer's provider-disabled mode cannot spend", () => {
  it("selects the policy from the request and defaults to reserved", () => {
    expect(writer).toContain("const providerPolicy = readProviderPolicy(body.provider_policy);");
  });

  it("places the disabled branch ABOVE the branch that reserves", () => {
    // Order is the guarantee. The reservation RPC and the provider fetch live
    // in a branch that a disabled request never enters, so a budget cannot
    // reach past it.
    const disabledAt = writer.indexOf("} else if (!providerCallPermitted(providerPolicy)) {");
    const spendAt = writer.indexOf("} else if (built.request && MC_KEY && !dryRun) {");
    expect(disabledAt).toBeGreaterThan(-1);
    expect(spendAt).toBeGreaterThan(disabledAt);
  });

  it("keeps the reservation and the fetch inside the spending branch only", () => {
    const disabledAt = writer.indexOf("} else if (!providerCallPermitted(providerPolicy)) {");
    const spendAt = writer.indexOf("} else if (built.request && MC_KEY && !dryRun) {");
    const disabledBranch = writer.slice(disabledAt, spendAt);
    for (const spend of ["market_reserve_provider_call", "callProvider(", "MC_KEY", "predictionUrl("]) {
      expect(disabledBranch, spend).not.toContain(spend);
    }
    const spendBranch = writer.slice(spendAt);
    expect(spendBranch).toContain("market_reserve_provider_call");
    expect(spendBranch).toContain("callProvider(");
  });

  it("records the refusal distinctly from every budget answer", () => {
    expect(writer).toContain('reservationOutcome = "provider_disabled";');
    expect(writer).toContain('attemptOutcome = "not_attempted";');
  });

  it("still reserves on the ordinary authorized path", () => {
    // Provider support is not globally disabled — only this request shape.
    expect(writer).toContain('if (reservationOutcome === "reserved")');
    expect(writer).toMatch(/admin\.rpc\(\s*\n?\s*"market_reserve_provider_call"/);
  });

  it("marks the evidence and the response as shadow", () => {
    expect(writer).toContain("provider_policy: providerPolicy,");
    expect(writer).toContain("shadow ? { shadow: true, invocation_source: invocationSource }");
    expect(writer).toContain("shadow, provider_policy: providerPolicy, provider_attempt: attemptOutcome,");
  });

  it("sanitizes the invocation source before it reaches evidence", () => {
    expect(writer).toContain("sanitizeInvocationSource(body.invocation_source)");
    expect(writer).not.toContain("invocation_source: body.invocation_source");
  });

  it("refuses a compatibility write for any shadow evaluation", () => {
    expect(writer).toMatch(/decideCompatibilityWrite\(\{[\s\S]{0,200}shadow,/);
  });

  it("makes only one provider call site exist at all", () => {
    expect(writer.match(/callProvider\(/g)?.length).toBe(1);
    expect(writer.match(/market_reserve_provider_call/g)?.length).toBe(1);
  });
});

describe("vehicle-enrich triggers shadow only from a server path", () => {
  it("triggers after the write succeeds, never before", () => {
    const persistAt = enrich.indexOf("persisted = !error;");
    const triggerAt = enrich.indexOf("if (persisted && WRITER_AUTH_KEY) {");
    expect(persistAt).toBeGreaterThan(-1);
    expect(triggerAt).toBeGreaterThan(persistAt);
  });

  it("derives the source from the credential, so a browser is refused by name", () => {
    expect(enrich).toContain(
      'const shadowSource = hasCronSecret ? "enrichment_sweep" : isServiceRole ? "ingestion" : "browser";',
    );
  });

  it("never lets a request body choose the tenant or the source", () => {
    const block = enrich.slice(enrich.indexOf("if (persisted && WRITER_AUTH_KEY) {"));
    for (const injected of ["body.tenant_id", "body.source", "body.invocation_source", "body.shadow"]) {
      expect(block, injected).not.toContain(injected);
    }
    // The tenant is the one the auth gate already validated.
    expect(block).toContain("tenantId,\n      listingTenantId: tenantId,");
  });

  it("asks for the evidence-only policy", () => {
    expect(enrich).toContain("provider_policy: decision.providerPolicy,");
    expect(enrich).toContain("shadow: true,");
  });

  it("guards the call behind the decision", () => {
    expect(enrich).toContain("if (decision.invoke) {");
    expect(enrich).not.toMatch(/await fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/market-valuation-write`[\s\S]{0,80}\}\);\s*\n\s*\}\s*\n\s*\}\s*\n\s*\/\/ Value-history/);
  });

  it("dedupes against the stored evidence rather than a memory cache", () => {
    expect(enrich).toContain('from("vehicle_market_valuations")');
    expect(enrich).toContain("material_input_fingerprint");
    for (const weak of ["new Map(", "new Set(", "globalThis.", "let seen"]) {
      const block = enrich.slice(enrich.indexOf("if (persisted && WRITER_AUTH_KEY) {"));
      expect(block, weak).not.toContain(weak);
    }
  });

  it("cannot fail the ingestion it observes", () => {
    // Bounded on a CODE landmark: comments are stripped, so a comment marker
    // would slice to -1 and quietly scan the rest of the file.
    const start = enrich.indexOf("if (decision.invoke) {");
    const end = enrich.indexOf("if (wantMC && price != null) {", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = enrich.slice(start, end);
    expect(block).toContain("try {");
    expect(block).toContain("} catch {");
    // No throw, no early return, no non-2xx propagation out of the observer.
    expect(block).not.toMatch(/\bthrow\b|return json\(/);
  });

  it("never recurses: it calls the writer, not itself", () => {
    const block = enrich.slice(enrich.indexOf("if (persisted && WRITER_AUTH_KEY) {"));
    expect(block).not.toContain("functions/v1/vehicle-enrich");
    expect(enrich.match(/functions\/v1\/market-valuation-write/g)?.length).toBe(1);
  });

  it("runs at request time, never at module import or boot", () => {
    const boot = enrich.slice(0, enrich.indexOf("serve(") > -1 ? enrich.indexOf("serve(") : 4000);
    expect(boot).not.toContain("decideShadowRequest(");
    expect(boot).not.toContain("market-valuation-write");
  });
});

describe("the dedicated writer secret stays server-only", () => {
  it("is read from the environment, never from a request", () => {
    expect(read(ENRICH)).toContain(`Deno.env.get(${"WRITER_AUTH_ENV_NAME"})`);
    expect(enrich).not.toMatch(new RegExp(`headers\\.get\\(["']${WRITER_AUTH_HEADER}["']\\)`));
  });

  it("is never logged, returned or serialised", () => {
    expect(enrich).not.toMatch(/console\.(log|warn|error|info)\([^)]*WRITER_AUTH_KEY/);
    expect(enrich).not.toMatch(/json\([^)]*WRITER_AUTH_KEY/);
    expect(enrich).not.toContain("JSON.stringify(WRITER_AUTH_KEY");
  });

  it("logs a shadow failure without the credential", () => {
    expect(enrich).toContain('console.warn("shadow_evaluation_failed", res.status, decision.source);');
    expect(enrich).toContain('console.warn("shadow_evaluation_unreachable", decision.source);');
  });

  it("is absent from the CORS allow-list", () => {
    expect(read(CORS)).not.toContain(WRITER_AUTH_HEADER);
  });

  it("appears nowhere under src/", () => {
    const { execSync } = require("node:child_process");
    const hits = execSync(
      `grep -rl '${WRITER_AUTH_ENV_NAME}' src/ 2>/dev/null || true`,
      { encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});

describe("the single-writer boundary still holds", () => {
  it("vehicle-enrich decides no market verdict column", () => {
    for (const column of ["market_value", "market_position", "market_checked_at", "market_payload"]) {
      const writes = new RegExp(
        `(patch\\.${column}\\s*=(?!\\s*null\\b)|["']?${column}["']?\\s*:(?!\\s*null\\b)(?!\\s*[A-Za-z_$][\\w$]*[.?]))`,
      );
      expect(enrich, column).not.toMatch(writes);
    }
  });

  it("the certification repair from the previous gate is intact", () => {
    expect(enrich).toContain("resolveCertification({");
    expect(enrich).toContain("mergeResolvedCertification(");
    expect(enrich).toContain("if (certificationPatch) patch.certification = certificationPatch;");
  });
});
