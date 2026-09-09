import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The renderer request lives in the edge function, outside tsconfig, so its
// shape is pinned here against the deployed source text. On 2026-09-08 the
// routine per-VIN render bundled html + a full-page screenshot + an LLM json
// extract; the provider refused that bundle at 402 with a healthy balance and
// a plain html scrape of the same page cost one credit. The bundle, fired
// 25 times in nine seconds against an 11/min plan, is why nothing was
// captured for a fortnight.

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);

const between = (start: string, end: string): string => {
  const a = SRC.indexOf(start);
  if (a < 0) throw new Error(`"${start}" not found in the crawl source`);
  const b = SRC.indexOf(end, a);
  if (b < 0) throw new Error(`"${end}" not found after "${start}"`);
  return SRC.slice(a, b);
};

describe("the routine render is html only", () => {
  const renderFn = between("async function firecrawlRender(", "const sleep =");

  it("declares the routine format as html and nothing else", () => {
    expect(SRC).toMatch(/const HTML_ONLY_FORMATS: RenderFormat\[\] = \["html"\];/);
  });

  it("does not request the json / LLM extract anywhere", () => {
    expect(renderFn).not.toContain('"json"');
    expect(SRC).not.toMatch(/type:\s*"json"/);
    expect(SRC).not.toContain("Extract the vehicle's advertised selling/internet price");
  });

  it("sends the formats it was handed, defaulting to html only", () => {
    expect(renderFn).toMatch(/formats: RenderFormat\[\] = HTML_ONLY_FORMATS/);
    expect(renderFn).toMatch(/^\s*formats,\s*$/m);
  });

  it("waits four seconds, in line with the working 1-credit pattern", () => {
    expect(renderFn).toMatch(/waitFor: 4000/);
    expect(renderFn).not.toMatch(/waitFor: 10000/);
  });

  it("leaves jsonPrice / jsonVin on the shape, always null", () => {
    expect(renderFn).toMatch(/jsonPrice: null,\s*jsonVin: null,\s*ok: true/);
    expect(SRC).toMatch(/jsonPrice: number \| null;/);
    expect(SRC).toMatch(/jsonVin: string \| null;/);
  });

  it("no longer consults the json extract as a price fallback", () => {
    expect(SRC).not.toMatch(/\.jsonPrice != null/);
  });

  it("the test button also renders html only", () => {
    const testMode = between("if (body.test_url) {", "const limit = Math.max(");
    expect(testMode).toContain("pacedRender(fetchUrl, HTML_ONLY_FORMATS, deadlineAt)");
  });
});

describe("the screenshot is its own decision", () => {
  it("lives in a separate evidence format", () => {
    expect(SRC).toMatch(/const EVIDENCE_FORMATS: RenderFormat\[\] = \["html", \{ type: "screenshot", fullPage: true \}\];/);
  });

  it("is captured only behind a condition, never unconditionally", () => {
    const calls = [...SRC.matchAll(/captureScreenshot\(admin, /g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const loop = between("for (const row of rows) {", "// ── Discovery:");
    // First stage: only when the row was already known to need evidence.
    expect(loop).toMatch(/if \(evidenceDue\) \{[\s\S]*?screenshot = await captureScreenshot\(/);
    // Second stage: only when the price or a component moved, there is no
    // prior screenshot, or the caller forced it.
    expect(loop).toMatch(/priceChanged \|\| componentsChanged \|\| evidenceDue \|\| \(!cheapFailed && await shouldCaptureEvidence\(row\)\)/);
    expect(loop).toMatch(/if \(ev\.render\?\.ok\) \{\s*screenshot = await captureScreenshot\(/);
  });

  it("is captured on render success, not parse success", () => {
    const loop = between("for (const row of rows) {", "// ── Discovery:");
    expect(loop).not.toMatch(/if \(result\.price != null\) \{\s*screenshot = await captureScreenshot/);
    const first = loop.indexOf("if (evidenceDue) {");
    const parse = loop.indexOf("result = extractAdvertised(priceEvidenceHtml(r.html)");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(parse);
  });

  it("honours force_screenshot and the single-VIN re-check", () => {
    expect(SRC).toMatch(/body\.force_screenshot === true \|\| targetVin/);
  });

  it("leaves a failed parse with a picture to look at", () => {
    const err = between('reason: result.reason || "no_price_extracted"', "continue;");
    expect(err).toContain("screenshot_path: screenshot?.path ?? null");
  });
});

describe("an unchanged price is still an observation", () => {
  // advertised_price_crawl_queue orders by the latest row's captured_at. Once
  // a VIN has a screenshot-backed row, a held price with no new screenshot
  // used to write nothing, so its captured_at never advanced and the same
  // stalest vehicles were re-rendered every run.
  const loop = between("for (const row of rows) {", "// ── Discovery:");

  it("no longer skips the write when the price held and no screenshot was taken", () => {
    expect(loop).not.toMatch(/if \(!priceChanged && !screenshot\) \{\s*unchanged\+\+;\s*continue;/);
    expect(loop).not.toMatch(/Math\.abs\(newPrice - row\.advertised_price\) < 1 && !screenshot/);
  });

  it("counts unchanged only after the observation row is written", () => {
    const insert = loop.indexOf('admin.from("advertised_prices").insert(insRow)');
    const count = loop.indexOf("if (priceChanged) updated++; else unchanged++;");
    expect(insert).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(insert);
    expect(loop.match(/unchanged\+\+/g)?.length ?? 0).toBe(1);
  });

  it("names a held price in the row's notes instead of a no-op arrow", () => {
    expect(loop).toMatch(/· unchanged \$\$\{newPrice\.toLocaleString\(\)\}/);
  });

  it("rotates a walled lot larger than one run's render budget", () => {
    // The documented rules: the queue is the latest row per VIN ordered by
    // captured_at ascending; a run visits the first `budget` rows; a visit
    // writes a row (post-change) or writes nothing when the price held and
    // the VIN already has a screenshot (pre-change).
    const simulate = (writesOnHeldPrice: boolean, vins: number, budget: number, runs: number) => {
      const capturedAt = new Map<number, number>();
      for (let v = 0; v < vins; v++) capturedAt.set(v, v);
      const visited = new Set<number>();
      let clock = vins;
      for (let r = 0; r < runs; r++) {
        const queue = [...capturedAt.entries()].sort((a, b) => a[1] - b[1]).slice(0, budget);
        for (const [v] of queue) {
          visited.add(v);
          if (writesOnHeldPrice) capturedAt.set(v, clock++);
        }
      }
      return visited.size;
    };
    expect(simulate(false, 132, 36, 12)).toBe(36);
    expect(simulate(true, 132, 36, 4)).toBe(132);
  });
});

describe("the renderer is paced", () => {
  it("every render goes through the pacer", () => {
    const direct = [...SRC.matchAll(/await firecrawlRender\(/g)];
    expect(direct).toHaveLength(1);
    const pacedFn = between("async function pacedRender(", "serve(async (req)");
    expect(pacedFn).toContain("await firecrawlRender(url, formats)");
    expect(pacedFn).toContain("pacer.waitBeforeRender(");
    expect(pacedFn).toContain("pacer.noteRenderStarted(");
  });

  it("retries a 429 at most twice and never past the deadline", () => {
    expect(SRC).toMatch(/const MAX_RATE_LIMIT_RETRIES = 2;/);
    const pacedFn = between("async function pacedRender(", "serve(async (req)");
    expect(pacedFn).toMatch(/if \(last\?\.status !== 429\) return/);
    expect(pacedFn).toMatch(/parseRetryAfter\(last\.retryAfterHeader, last\.error/);
    expect(pacedFn).toMatch(/> deadlineAt\) return \{[^}]*gaveUp: "out_of_time"/);
    expect(pacedFn).toMatch(/attempt === MAX_RATE_LIMIT_RETRIES\) return \{[^}]*gaveUp: "rate_limited"/);
  });

  it("derives the render budget from the wall clock and the paced rate", () => {
    expect(SRC).toMatch(/deriveRenderBudget\(RUN_BUDGET_MS, RENDERS_PER_MINUTE\)/);
    expect(SRC).toMatch(/body\.test_url \? 1 : \(targetVin \? 3 : pacedBudget\)/);
    expect(SRC).not.toMatch(/targetVin \? 3 : 30\)/);
  });

  it("reads the rate from FIRECRAWL_RPM through the clamp", () => {
    expect(SRC).toMatch(/resolveRendersPerMinute\(Deno\.env\.get\("FIRECRAWL_RPM"\)\)/);
  });

  it("keeps the loop sequential", () => {
    const loop = between("for (const row of rows) {", "// ── Discovery:");
    expect(loop).not.toMatch(/Promise\.all/);
    expect(loop).not.toMatch(/Promise\.allSettled/);
  });

  it("writes the pacing decision where a canary can read it", () => {
    expect(SRC).toContain("paced_wait_ms");
    expect(SRC).toMatch(/_detail: \[pacingNote, cls\.detail\]/);
    expect(SRC).toMatch(/render_pacing: \{/);
  });
});

describe("what must survive the change", () => {
  it("still classifies through the shared outcome module", () => {
    expect(SRC).toMatch(/import \{ classifyCrawlOutcome \} from "\.\.\/_shared\/crawlOutcome\.ts";/);
    expect(SRC).toContain("classifyCrawlOutcome({");
  });

  it("still labels observations and writes the ledger", () => {
    expect(SRC).toContain('captured_method: "dealer_vdp_observation"');
    expect(SRC).toContain('admin.rpc("record_advertised_price_crawl_attempt"');
  });

  it("keeps the MSRP plausibility guard in the extractor", () => {
    expect(SRC).toMatch(/msrp != null && best < msrp \* 0\.3/);
  });
});

describe("what the crawler writes back is always an observation", () => {
  // The queue used to hand feed rows to the crawler as if they were the last
  // look at the page, and the crawler inherited the row's channel for what it
  // wrote back: a real page observation labelled source_channel='feed' with
  // captured_method='dealer_vdp_observation', the contradiction migration
  // 20260908280000's self-check exists to catch.
  const helper = between("function observationChannel(", "// SSRF guard");

  it("maps a feed channel to website at the queue row and at the insert", () => {
    expect(SRC).toMatch(/source_label: observationChannel\(q\.source_channel\),/);
    expect(SRC).toMatch(/source_channel: observationChannel\(row\.source_label\),/);
    expect(SRC).not.toMatch(/source_label: q\.source_channel \|\| "website"/);
  });

  it("names the feed channels it refuses to inherit", () => {
    expect(SRC).toMatch(/const FEED_CHANNELS = new Set\(\["feed", "marketcheck", "marketcheck_syndication"\]\);/);
    expect(helper).toMatch(/if \(!l \|\| FEED_CHANNELS\.has\(l\.toLowerCase\(\)\)\) return "website";/);
  });

  it("asks the screenshot question on the observation channel", () => {
    expect(SRC).toMatch(/hasEvidenceScreenshot\(row\.tenant_id, row\.vin, observationChannel\(row\.source_label\)\)/);
  });
});

describe("the price never depends on the screenshot", () => {
  const loop = between("for (const row of rows) {", "// ── Discovery:");

  it("retries a refused evidence bundle as plain html, once, within budget", () => {
    expect(loop).toMatch(/if \(evidenceDue && pr\.render && !pr\.render\.ok && pr\.render\.status !== 429 && pr\.gaveUp == null && renderBudget > 0\) \{/);
    const fallback = between("evidenceRefused = { status: pr.render.status, error: pr.render.error };", "const r = pr.render;");
    expect(fallback).toContain("renderBudget--;");
    expect(fallback).toContain("pr = await pacedRender(fetchUrl, HTML_ONLY_FORMATS, deadlineAt);");
    expect(fallback).toContain("evidenceDue = false;");
  });

  it("does not spend the second-stage render asking for the same refused picture", () => {
    expect(loop).toMatch(/if \(!screenshot && !evidenceRefused && renderBudget > 0 && \(priceChanged/);
  });

  it("leaves a 429 to the pacer's retry, not the fallback", () => {
    expect(loop).toMatch(/pr\.render\.status !== 429 && pr\.gaveUp == null/);
  });

  it("records the refusal where the ledger and the response can show it", () => {
    expect(SRC).toMatch(/evidence_refused: evidenceRefused,/);
    expect(SRC).toMatch(/evidence_refused=\$\{evidenceRefused\.status \?\? "err"\}/);
  });
});

describe("a failed screenshot query does not buy a render", () => {
  it("treats a query error as 'has a screenshot'", () => {
    const fn = between("const hasEvidenceScreenshot = async (", "const shouldCaptureEvidence = async (");
    expect(fn).toMatch(/const \{ data, error \} = await admin\.from\("advertised_prices"\)/);
    expect(fn).toMatch(/if \(error\) return true;/);
    expect(fn).toMatch(/\} catch \{ return true; \}/);
  });
});

describe("retired listings leave the rotation", () => {
  it("skips queue rows for archived VINs unless the caller named the VIN", () => {
    expect(SRC).toMatch(/\.or\("archived_at\.not\.is\.null,status\.eq\.archived"\)/);
    expect(SRC).toMatch(/if \(!targetVin && archivedKeys\.has\(key\)\) continue;/);
  });

  it("never seeds a first crawl from an archived listing", () => {
    const seed = between("let seedQuery = admin", "const { data: seedRows }");
    expect(seed).toContain('.is("archived_at", null)');
    expect(seed).toContain('.neq("status", "archived")');
  });

  it("skips before the VIN is counted as priced, so depth reflects live cars", () => {
    const queueLoop = between("for (const q of (queued || []) as QueueRow[]) {", "// Seed pass:");
    expect(queueLoop.indexOf("archivedKeys.has(key)")).toBeLessThan(queueLoop.indexOf("pricedKeys.add(key)"));
  });
});
