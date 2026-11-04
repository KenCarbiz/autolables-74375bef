// @vitest-environment node
// The shared rtgip/2 core and the vendored AutoCurb / AutoFrame adapters must match the
// SHA-256 recorded in VENDORED.json. The same manifest is checked in the other two repos'
// CI, so a drift in any repo fails here and there.
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./VENDORED.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

it.each(Object.entries(manifest.files))("%s matches its recorded SHA-256", (path, entry) => {
  const sha = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
  expect(sha, `${path} drifted from ${entry.origin}`).toBe(entry.sha256);
});
