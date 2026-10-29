import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The edge functions import the Signal House SDK by an exact npm: version, and
// the preview's Deno check resolves that against the node_modules installed
// from the lockfiles. On 2026-10-28 the lockfiles moved to 1.6.0 while the
// import still named 1.0.66, and the preview failed with "Could not find a
// matching package". The pin, its type declaration and both lockfiles must
// name the same version.
describe("the Signal House SDK pin matches the lockfiles", () => {
  const pinIn = (file: string) => readFileSync(file, "utf8").match(/npm:@signalhousellc\/sdk@([0-9.]+)/)?.[1];
  const pin = pinIn("supabase/functions/_shared/signalhouse.ts");

  it("the wrapper and its type declaration name the same version", () => {
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pinIn("supabase/functions/_shared/signalhouse-sdk.d.ts")).toBe(pin);
  });

  it("bun.lock and package-lock.json resolve that exact version", () => {
    const bun = readFileSync("bun.lock", "utf8").match(/"@signalhousellc\/sdk": \["@signalhousellc\/sdk@([0-9.]+)"/)?.[1];
    const npm = JSON.parse(readFileSync("package-lock.json", "utf8")).packages["node_modules/@signalhousellc/sdk"]?.version;
    expect({ bun, npm }).toEqual({ bun: pin, npm: pin });
  });
});
