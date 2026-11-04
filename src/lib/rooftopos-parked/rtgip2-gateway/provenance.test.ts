import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import provenance from "../../../../supabase/tests/rtgip/gateway/PROVENANCE.json";

// Every vendored file must hash to its upstream bytes, or to the last listed amendment that changed it.
const root = path.resolve(__dirname, "../../../..");
const expected = new Map(provenance.files.map((f) => [f.vendored, f.sha256]));
for (const a of provenance.amendments) for (const f of a.files) expected.set(f.vendored, f.sha256_after);

describe("rtgip2-gateway provenance", () => {
  it("pins the candidate commit", () => {
    expect(provenance.commit).toBe("da5118a43e7174dd8b003425b597bc3b8ef71da0");
  });
  it.each([...expected.entries()])("%s matches its recorded sha256", (file, sha) => {
    expect(createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")).toBe(sha);
  });
});
