import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectAll, TARGET_DIR, PAGE_VIEW_FILES, INTELLIGENCE_PREFIX, readMirror, TRUTH_PREFIX, WARRANTY_PREFIX } from "../../../scripts/sync-edge-sticker-lib.mjs";

// Supabase ships only supabase/functions/ to the edge runtime, so the
// orchestrator cannot import the engine out of src/ — a deploy fails
// outright if it tries. The engine therefore exists in both trees, with
// src/ authoritative and the edge copy generated.
//
// Two copies drift. This test is what stops that: it fails the suite the
// moment a source module changes without `bun run sync:edge-sticker`, so
// the edge bundle can never quietly render from stale code while the app
// renders from current code.

describe("edge factory-sticker mirror", () => {
  const source = collectAll();
  const mirror = readMirror();

  it("mirrors every pure engine module", () => {
    expect(source.size).toBeGreaterThan(15);
    const missing = [...source.keys()].filter((k) => !mirror.has(k));
    expect(missing, `run: bun run sync:edge-sticker`).toEqual([]);
  });

  it("mirrors the truth layer the orchestrator resolves vehicles with", () => {
    const truth = [...source.keys()].filter((k) => k.startsWith(TRUTH_PREFIX));
    expect(truth).toContain(`${TRUTH_PREFIX}snapshot.ts`);
    expect(truth).toContain(`${TRUTH_PREFIX}precedence.ts`);
    expect(truth).toContain(`${TRUTH_PREFIX}ingest.ts`);
    // Rewritten on copy: inside lib/vehicleTruth the engine is one level up.
    expect(mirror.get(`${TRUTH_PREFIX}snapshot.ts`)).not.toContain("../factorySticker/");
  });

  it("mirrors the MarketPass assessment the marketpass-assessment function serves", () => {
    expect(mirror.has(`${INTELLIGENCE_PREFIX}marketPass/handler.ts`)).toBe(true);
    expect(mirror.has(`${INTELLIGENCE_PREFIX}readModels/listingFacts.ts`)).toBe(true);
    expect(mirror.has(`${WARRANTY_PREFIX}inServiceEvidence.ts`)).toBe(true);
  });

  it("mirrors the customer Passport page view and the functions it runs", () => {
    for (const key of ["marketPass/pageView.ts", "marketPass/pageViewTypes.ts", "marketPass/pageViewHandler.ts", "vehicleListingType.ts"]) {
      expect(mirror.has(key), key).toBe(true);
    }
    for (const src of PAGE_VIEW_FILES) {
      const key = src.replace(/^src\/lib\//, "");
      expect(mirror.has(key), key).toBe(true);
    }
    expect(mirror.has("marketPass/pageView.test.ts")).toBe(false);
  });

  it("re-points every page-view import at a file that exists in the mirror or in _shared", () => {
    const pageView = [...mirror.keys()].filter((k) => k.startsWith("marketPass/") || PAGE_VIEW_FILES.some((f) => f.endsWith(`/${k}`)));
    expect(pageView.length).toBeGreaterThan(10);
    for (const key of pageView) {
      const body = mirror.get(key) as string;
      expect(body, key).not.toMatch(/from\s+"@\//);
      expect(body, key).not.toMatch(/import\(\s*"@\//);
      for (const m of body.matchAll(/(?:from\s+|import\(\s*)"(\.[^"]+)"/g)) {
        expect(existsSync(resolve(dirname(join(TARGET_DIR, key)), m[1])), `${key} imports ${m[1]}`).toBe(true);
      }
    }
  });

  it("carries no file the source no longer has", () => {
    const extra = [...mirror.keys()].filter((k) => !source.has(k));
    expect(extra, `run: bun run sync:edge-sticker`).toEqual([]);
  });

  it("is byte-identical to the source", () => {
    const drifted = [...source.entries()]
      .filter(([k, body]) => mirror.get(k) !== body)
      .map(([k]) => k);
    expect(drifted, `run: bun run sync:edge-sticker`).toEqual([]);
  });

  it("excludes tests and fixtures from the edge bundle", () => {
    for (const key of source.keys()) {
      expect(key, key).not.toMatch(/\.test\.ts$/);
      expect(key, key).not.toMatch(/__fixtures__|__snapshots__/);
    }
  });

  it("keeps every mirrored import extension-qualified for Deno", () => {
    for (const [key, body] of mirror) {
      const specifiers = [...body.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec, `${key} imports ${spec}`).toMatch(/\.ts$/);
      }
    }
  });
});
