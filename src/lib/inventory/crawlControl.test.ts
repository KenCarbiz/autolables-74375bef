import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CRAWL_PAUSED_MESSAGE, parseCrawlControl, readCrawlControl } from "../../../supabase/functions/_shared/crawlControl";
import { supabaseCommitDb } from "../../../supabase/functions/_shared/crawlCommit";

describe("the crawl switches are off unless the database clearly says on", () => {
  it("reads both switches from the control row", () => {
    expect(parseCrawlControl([{ execution_enabled: true, promotion_enabled: false, version: 3 }], null))
      .toEqual({ execution: true, promotion: false, version: 3, source: "control" });
  });

  it("a missing function or table is off", () => {
    for (const code of ["PGRST202", "42883", "42P01", "PGRST205"]) {
      expect(parseCrawlControl(null, { code, message: "x" })).toMatchObject({ execution: false, promotion: false, source: "missing" });
    }
  });

  it("an unreadable answer is off", () => {
    expect(parseCrawlControl(null, { code: "57014", message: "statement timeout" })).toMatchObject({ execution: false, promotion: false, source: "unreadable" });
    expect(parseCrawlControl([], null)).toMatchObject({ execution: false, promotion: false, source: "unreadable" });
    expect(parseCrawlControl("on", null).execution).toBe(false);
    expect(parseCrawlControl([{ execution_enabled: "true", promotion_enabled: 1 }], null)).toMatchObject({ execution: false, promotion: false });
  });

  it("a thrown client is off", async () => {
    const admin = { rpc: vi.fn().mockRejectedValue(new Error("network")) };
    expect(await readCrawlControl(admin)).toMatchObject({ execution: false, promotion: false, source: "unreadable" });
  });

  it("the paused message is the agreed wording", () => {
    expect(CRAWL_PAUSED_MESSAGE).toBe("Temporarily paused for pricing verification");
  });
});

describe("the only listing write goes through crawl_promote_listing", () => {
  const rpcClient = (answer: { data: unknown; error: unknown }) => ({ rpc: vi.fn().mockResolvedValue(answer), from: vi.fn() });
  const expected = { id: "l1", advertised_price_before_doc: 1, doc_fee: 2, website_sale_price: 3 };

  it("passes the expected pricing and the patch to the database function and never writes the table itself", async () => {
    const admin = rpcClient({ data: "promoted", error: null });
    const r = await supabaseCommitDb(admin).promoteListing(expected, { website_sale_price: 4 }, "obs-1");
    expect(r).toEqual({ result: "promoted" });
    expect(admin.rpc).toHaveBeenCalledWith("crawl_promote_listing", {
      p_listing_id: "l1", p_expected: { advertised_price_before_doc: 1, doc_fee: 2, website_sale_price: 3 },
      p_patch: { website_sale_price: 4 }, p_observation_id: "obs-1",
    });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("treats a missing function as promotion off, and any other failure as a failed promotion", async () => {
    expect((await supabaseCommitDb(rpcClient({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })).promoteListing(expected, {}, "o")).result).toBe("held_promotion_off");
    expect((await supabaseCommitDb(rpcClient({ data: null, error: { code: "57014", message: "timeout" } })).promoteListing(expected, {}, "o")).result).toBe("error");
    expect((await supabaseCommitDb(rpcClient({ data: "held_promotion_off", error: null })).promoteListing(expected, {}, "o")).result).toBe("held_promotion_off");
    expect((await supabaseCommitDb(rpcClient({ data: "something else", error: null })).promoteListing(expected, {}, "o")).result).toBe("held_promotion_off");
  });

  it("the crawler has no other path that writes a listing's price fields", () => {
    const src = readFileSync("supabase/functions/crawl-advertised-prices/index.ts", "utf8") + readFileSync("supabase/functions/_shared/crawlCommit.ts", "utf8");
    const writes = [...src.matchAll(/from\("vehicle_listings"\)\s*\.update\(\{([^}]*)\}/g)].map((m) => m[1]);
    for (const w of writes) expect(w).not.toMatch(/advertised_price_before_doc|website_sale_price|doc_fee|retail_cash|dealer_discount|price_parse|price_source_url|price_last_verified_at|website_price_term/);
    expect(src).not.toMatch(/\.update\(patch\)/);
    expect(src).not.toMatch(/updateListingIfUnchanged/);
  });

  it("the crawler checks the execution switch before reading the request and before each vehicle", () => {
    const src = readFileSync("supabase/functions/crawl-advertised-prices/index.ts", "utf8");
    const serve = src.slice(src.indexOf("serve(async (req)"));
    expect(serve.indexOf("const control = await readCrawlControl(admin);")).toBeLessThan(serve.indexOf("body = await req.json()"));
    expect(serve).toMatch(/if \(!control\.execution\) \{\s*return new Response\(JSON\.stringify\(pausedBody\(control\)\), \{\s*status: 503/);
    expect(serve).toMatch(/for \(const row of rows\) \{[\s\S]{0,400}if \(!\(await readCrawlControl\(admin\)\)\.execution\) \{ pausedMidRun = true; break; \}/);
  });
});

describe("the proposed SQL enforces the same rules", () => {
  const sql = readFileSync("supabase/proposed/20261104000000_crawl_control.sql", "utf8");

  it("defaults both switches off and lets nobody but the audited admin function write them", () => {
    expect(sql).toMatch(/execution_enabled boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/promotion_enabled boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/REVOKE ALL ON public\.crawl_control FROM PUBLIC, anon, authenticated, service_role;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.crawl_control TO authenticated, service_role;/);
    const setter = sql.slice(sql.indexOf("FUNCTION public.platform_set_crawl_control("));
    expect(setter).toMatch(/NOT public\.has_role\(v_uid, 'admin'\)[\s\S]*ERRCODE = '42501'/);
    expect(setter).toMatch(/updated_by = v_uid/);
    expect(setter).toMatch(/INSERT INTO public\.audit_log/);
  });

  it("reads the promotion switch under a lock in the same transaction as the guarded write", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.crawl_promote_listing("));
    expect(fn.indexOf("FOR SHARE")).toBeLessThan(fn.indexOf("UPDATE public.vehicle_listings"));
    expect(fn).toMatch(/IF v_on IS NOT TRUE THEN\s+RETURN 'held_promotion_off';/);
    expect(fn).toMatch(/v\.website_sale_price IS NOT DISTINCT FROM \(p_expected->>'website_sale_price'\)::numeric/);
  });
});
