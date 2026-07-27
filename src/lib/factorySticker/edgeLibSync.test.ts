import { describe, expect, it } from "vitest";
import { collectAll, readMirror, TRUTH_PREFIX } from "../../../scripts/sync-edge-sticker-lib.mjs";

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
