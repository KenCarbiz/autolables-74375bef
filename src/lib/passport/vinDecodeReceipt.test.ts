// public-listing-view's VIN decode receipts: the minimum evidence the Passport
// identity check needs, for exactly this VIN, read from stored snapshots only.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  projectVinDecodeReceipts, VIN_DECODE_RECEIPT_SELECT, VIN_DECODE_RECEIPT_LIMIT,
} from "../../../supabase/functions/_shared/vinDecodeReceipt.ts";
import { PUBLIC_VIEW_DENY } from "../../../supabase/functions/_shared/lotFeedRow.ts";
import { resolveVinDecode } from "./verificationSummary";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const ROOT = join(__dirname, "..", "..", "..");
const view = readFileSync(join(ROOT, "supabase/functions/public-listing-view/index.ts"), "utf8");
const block = view.slice(view.indexOf("// ── VIN decode receipts."), view.indexOf("// ── Final deny sweep."));

const Q50 = "JN1EV7CR5PM543599";
// Shaped like the Q50's real neovin_snapshots row as the SELECT returns it.
const snap = (o: Record<string, unknown> = {}) => ({
  vin: Q50, endpoint: `https://api.marketcheck.com/v2/decode/car/neovin/${Q50}/specs?api_key=***`,
  http_status: 200, fetched_at: "2026-08-31 03:07:20.881033+00",
  payload_hash: "8d446d1f5136b7f093e3bb0a2d28eba007cfb8509693a8c2a32822ebe6ef0686",
  dvin: Q50, year: "2023", make: "INFINITI", model: "Q50", trim: "SENSORY", ...o,
});

describe("VIN decode receipts: minimal, exact-VIN, read-only", () => {
  it("ships only the approved fields, never the endpoint, key or payload", () => {
    const [r] = projectVinDecodeReceipts([{ ...snap(), payload: { secret: 1 }, tenant_id: "t", vehicle_id: "v", raw_key_count: 50 }], Q50);
    expect(Object.keys(r).sort()).toEqual(["fetched_at", "http_status", "make", "model", "payload_hash", "provider", "trim", "vin", "year"]);
    expect(JSON.stringify(r)).not.toMatch(/api_key|marketcheck\.com|endpoint|secret|tenant|vehicle_id/);
    expect(r.provider).toBe("neovin");
  });

  it("drops another vehicle's snapshot, by column or by the provider's own decoded VIN", () => {
    expect(projectVinDecodeReceipts([snap({ vin: "3PCAJ5L32NF114756", dvin: "3PCAJ5L32NF114756" })], Q50)).toEqual([]);
    expect(projectVinDecodeReceipts([snap({ dvin: "3PCAJ5L32NF114756" })], Q50)).toEqual([]);
    expect(projectVinDecodeReceipts([snap({ dvin: null })], Q50)).toEqual([]);
  });

  it("drops failed requests and invalid VINs, and caps the list", () => {
    expect(projectVinDecodeReceipts([snap({ http_status: 422 })], Q50)).toEqual([]);
    expect(projectVinDecodeReceipts([snap()], "NOTAVIN")).toEqual([]);
    expect(projectVinDecodeReceipts(Array.from({ length: 9 }, () => snap()), Q50)).toHaveLength(VIN_DECODE_RECEIPT_LIMIT);
  });

  it("the SELECT reads named JSON paths, never the whole payload", () => {
    expect(VIN_DECODE_RECEIPT_SELECT.split(",").map((c) => c.trim())).not.toContain("payload");
    expect(VIN_DECODE_RECEIPT_SELECT).not.toMatch(/\*/);
  });

  it("the function filters by this listing's VIN, reads only, and calls no provider", () => {
    expect(block).toMatch(/\.from\("neovin_snapshots"\)\s*\n\s*\.select\(VIN_DECODE_RECEIPT_SELECT\)\s*\n\s*\.eq\("vin", vinKey\)/);
    expect(block).toMatch(/projectVinDecodeReceipts\(snaps, vinKey\)/);
    expect(block).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(block).not.toMatch(/fetch\(|marketcheck|neovin\/|functions\.invoke/i);
    // A failure ships no receipts rather than raw rows.
    expect(block).toMatch(/catch \{ row\.vin_decode_receipts = \[\]; \}/);
    // The receipts are attached before the allowlist projection, which names the key.
    expect(view.indexOf("vin_decode_receipts")).toBeLessThan(view.indexOf("shipped = projectPublicListing(row)"));
    expect(PUBLIC_VIEW_DENY.has("vin_decode_receipts")).toBe(false);
  });

  it("the projected Q50 receipt verifies the Q50 and nothing else", () => {
    const receipts = projectVinDecodeReceipts([snap()], Q50);
    const q50 = { vin: Q50, ymm: "2023 INFINITI Q50", vin_decode_receipts: receipts } as unknown as VehicleListing;
    expect(resolveVinDecode(q50).state).toBe("decoded");
    // Pasted onto another car the receipt is a mismatch, never a pass.
    const other = { vin: "3PCAJ5L32NF114756", ymm: "2022 INFINITI QX55", vin_decode_receipts: receipts } as unknown as VehicleListing;
    expect(resolveVinDecode(other).state).toBe("vin_mismatch");
  });

  it("the current Passport ignores receipts it does not know about (function can deploy first)", () => {
    // Before this PR the client never read vin_decode_receipts; the field is
    // additive, so deploying the function ahead of the frontend changes nothing.
    const before = readFileSync(join(ROOT, "src/lib/passportV2Data.ts"), "utf8");
    expect(before).not.toMatch(/vin_decode_receipts/);
  });
});
