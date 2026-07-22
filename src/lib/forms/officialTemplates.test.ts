import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { OFFICIAL_TEMPLATES } from "./officialTemplates";

// ──────────────────────────────────────────────────────────────
// Locked-master integrity guard.
//
// The official FTC Buyers Guide + CT K-208 are compliance forms — the
// government artwork must never change silently. This test pins each
// master's exact bytes: if a template is swapped, re-exported, or edited,
// its SHA-256 (and size) diverge and the build FAILS. Updating a master is
// then a deliberate act — re-approve the form, then update officialTemplates.ts
// AND bump its templateVersion so archived documents stay attributable to the
// exact master they were generated from. Never silence this by loosening the
// assertion; update the pinned hash only after visual re-verification.
// ──────────────────────────────────────────────────────────────

describe("official form templates — locked masters", () => {
  for (const [key, t] of Object.entries(OFFICIAL_TEMPLATES)) {
    describe(key, () => {
      const path = resolve(process.cwd(), "public", t.file);

      it("exists on disk", () => {
        expect(existsSync(path), `${t.file} missing`).toBe(true);
      });

      it("is an unaltered PDF matching the pinned master hash + size", () => {
        const buf = readFileSync(path);
        expect(buf.subarray(0, 5).toString("latin1"), `${t.file} is not a PDF`).toBe("%PDF-");
        expect(buf.length, `${t.name} byte size changed`).toBe(t.bytes);
        const sha = createHash("sha256").update(buf).digest("hex");
        expect(sha, `${t.name} master changed — re-approve the form, then update the pinned hash + bump templateVersion`).toBe(t.sha256);
      });
    });
  }

  it("every template carries a form identifier + version for audit attribution", () => {
    for (const t of Object.values(OFFICIAL_TEMPLATES)) {
      expect(t.formId.length).toBeGreaterThan(0);
      expect(t.templateVersion).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    }
  });
});
