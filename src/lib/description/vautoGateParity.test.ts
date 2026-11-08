import { describe, it, expect } from "vitest";
import { evidenceContradicts as adminEvidence, planFeeChange, resolveFeeBasis as adminResolve, type StoredPriceRow } from "@/lib/admin/pricing/feeBasis";
import { evidenceContradicts, reconcileRow, resolveFeeBasis } from "./vautoExport";

// The server gate carries its own copy of the fee-basis rules (Deno cannot
// import src/). This keeps the copy equal to the Admin contract.

const settings: unknown[] = [
  {}, null, [], { advertised_includes_doc_fee: true }, { advertised_includes_doc_fee: "false" }, { advertised_includes_doc_fee: "yes" },
  { advertised_excludes_doc_fee: true }, { advertised_excludes_doc_fee: false }, { advertised_includes_doc_fee: true, advertised_excludes_doc_fee: true },
  { advertised_includes_doc_fee: true, advertised_excludes_doc_fee: false }, { advertised_includes_doc_fee: null, advertised_excludes_doc_fee: "TRUE" },
];

const rows: StoredPriceRow[] = [];
for (const price of [null, 0, 28995, 28496]) for (const before of [null, 28496, 28000]) for (const sale of [null, 28995, 29494]) for (const fee of [null, 0, 499, 499.5]) {
  rows.push({ price, advertisedBeforeDoc: before, websiteSalePrice: sale, docFee: fee });
}

describe("server gate fee rules match the Admin contract", () => {
  it.each(settings.map((s) => [JSON.stringify(s), s]))("resolveFeeBasis(%s)", (_k, s) => {
    expect(resolveFeeBasis(s)).toEqual(adminResolve(s));
  });
  it("reconcileRow agrees with planFeeChange at the row's own fee", () => {
    for (const basis of ["includes_fee", "before_fee", "unconfigured", "conflict"] as const) {
      for (const row of rows) {
        const plan = planFeeChange(basis, row, row.docFee ?? 0);
        const mine = reconcileRow(basis, row);
        const expected = plan.status === "unchanged" ? "consistent" : plan.status === "change" ? "incomplete" : plan.status;
        expect({ basis, row, status: mine.status }).toEqual({ basis, row, status: expected });
        if (basis === "includes_fee") expect(mine.salePriceDiffers).toBe(plan.salePriceDiffers);
      }
    }
  });
  it("evidenceContradicts agrees", () => {
    for (const basis of ["includes_fee", "before_fee", "unconfigured"] as const) {
      for (const row of rows) for (const observed of [null, 28995, 29494, 28496]) {
        expect(evidenceContradicts(basis, row.price, row.docFee, observed)).toBe(adminEvidence(basis, row.price, row.docFee, observed));
      }
    }
  });
});
