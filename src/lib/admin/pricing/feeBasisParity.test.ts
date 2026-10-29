import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidenceContradicts, planFeeChange, resolveFeeBasis, type FeeBasis } from "./feeBasis";

// The SQL contract's own answers for a grid of settings, rows and fees,
// exported from the isolated database by scripts/db-verify/41_parity_export.sql
// (rerun `scripts/db-verify/run.sh --policy-b` to refresh). The TypeScript
// contract must give the same answer for every case.
type Num = number | null;
interface PlanCase {
  basis: FeeBasis; new_fee: number; row: { price: Num; adv: Num; wsp: Num; fee: Num };
  status: string; selling_before: Num; selling_after: Num; total_before: Num; total_after: Num; adv_after: Num; wsp_after: Num; sale_price_differs: boolean;
}
const sql = JSON.parse(readFileSync(resolve(__dirname, "../../../../scripts/admin-parity/evidence/pricing/policy-b-sql-plans.json"), "utf8")) as {
  basis: Array<{ settings: unknown; basis: string; source: string }>;
  plans: PlanCase[];
  evidence: Array<{ basis: FeeBasis; price: number; fee: number; observed: Num; contradicts: boolean }>;
};
const n = (v: Num): Num => (v == null ? null : Number(v));

describe("SQL and TypeScript fee basis contracts agree", () => {
  it.each(sql.basis.map((c) => [JSON.stringify(c.settings), c] as const))("basis for %s", (_, c) => {
    expect(resolveFeeBasis(c.settings)).toEqual({ basis: c.basis, source: c.source });
  });

  it(`every row plan (${sql.plans.length} cases)`, () => {
    for (const c of sql.plans) {
      const p = planFeeChange(c.basis, { price: n(c.row.price), advertisedBeforeDoc: n(c.row.adv), websiteSalePrice: n(c.row.wsp), docFee: n(c.row.fee) }, c.new_fee);
      const ts = {
        status: p.status, selling_before: p.sellingBefore, selling_after: p.sellingAfter, total_before: p.totalBefore, total_after: p.totalAfter,
        adv_after: p.after.advertisedBeforeDoc, wsp_after: p.after.websiteSalePrice, sale_price_differs: p.salePriceDiffers,
      };
      const expected = {
        status: c.status, selling_before: n(c.selling_before), selling_after: n(c.selling_after), total_before: n(c.total_before), total_after: n(c.total_after),
        adv_after: n(c.adv_after), wsp_after: n(c.wsp_after), sale_price_differs: c.sale_price_differs,
      };
      expect({ case: c, ...ts }).toEqual({ case: c, ...expected });
    }
  });

  it(`every evidence check (${sql.evidence.length} cases)`, () => {
    for (const e of sql.evidence) expect({ e, contradicts: evidenceContradicts(e.basis, e.price, e.fee, n(e.observed)) }).toEqual({ e, contradicts: e.contradicts });
  });
});
