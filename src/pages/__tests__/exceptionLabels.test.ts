import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Detection that nobody can read is not detection.
//
// The exceptions table renders `TYPE_LABEL[type] || type`, so a type nobody
// added a label for still appears — as a raw slug like
// `provider_payload_drift`. It does not look like a finding, it looks like a
// bug, which is exactly the wrong reaction to a decoder alarm.
//
// This walks the code that WRITES exceptions and asserts every type it can
// emit has a label, so the next one to be added cannot ship unlabelled.

const ROOT = join(__dirname, "..", "..", "..");
const page = readFileSync(join(ROOT, "src/pages/InventoryExceptions.tsx"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `exception_type: "..."` literal written anywhere in the codebase. */
function writtenTypes(): string[] {
  const found = new Set<string>();
  for (const file of [...walk(join(ROOT, "supabase/functions")), ...walk(join(ROOT, "src"))]) {
    // The page itself declares the labels; it is the reader, not a writer.
    if (file.endsWith("InventoryExceptions.tsx")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/exception_type:\s*"([a-z_]+)"/g)) found.add(m[1]);
  }
  return [...found].sort();
}

const labelled = (): string[] => {
  const block = page.slice(page.indexOf("const TYPE_LABEL"), page.indexOf("};", page.indexOf("const TYPE_LABEL")));
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort();
};

describe("every exception a writer can emit has a human label", () => {
  it("finds the writers at all", () => {
    // Guard the guard: if the scan returns nothing, the assertion below would
    // pass vacuously and this whole file would be decoration.
    expect(writtenTypes().length).toBeGreaterThan(5);
  });

  it("labels every type that is actually written", () => {
    const missing = writtenTypes().filter((t) => !labelled().includes(t));
    expect(missing).toEqual([]);
  });

  it("labels the provider drift alarm as a provider problem", () => {
    // Named specifically because it is the one that reads as a vehicle defect
    // when it is really a decoder alarm.
    expect(page).toMatch(/provider_payload_drift: "Provider response changed"/);
  });
});
