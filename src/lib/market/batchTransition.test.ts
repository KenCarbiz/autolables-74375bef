// ── The inventory-wide button, withdrawn rather than broken ────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MARKET_BATCH_NOTICE } from "./batchTransition.ts";

const INVENTORY = "src/pages/InventoryModern.tsx";
const PRICE_INTEGRITY = "src/components/vehicleFile/PriceIntegrityCard.tsx";
const src = readFileSync(INVENTORY, "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The body of the withdrawn handler, bounded on code. */
const handler = (() => {
  const start = code.indexOf("const runMarketBatch =");
  return code.slice(start, code.indexOf("\n  };", start) + 5);
})();

describe("the batch handler makes no request", () => {
  it("exists and is bounded", () => {
    expect(handler.length).toBeGreaterThan(20);
    expect(handler).toContain("runMarketBatch");
  });

  it("no longer sends batch: true", () => {
    // Scoped to THIS handler. `runRecallBatch` legitimately still batches
    // against marketcheck-recalls, which is a different, working feature.
    expect(handler).not.toMatch(/batch:\s*true/);
    expect(code).not.toMatch(/marketcheck-market-pricing[\s\S]{0,120}batch:\s*true/);
  });

  it("does not invoke any function", () => {
    for (const call of [
      "supabase.functions.invoke", "marketcheck-market-pricing",
      "market-valuation-write", "fetch(", "await ",
    ]) {
      expect(handler, call).not.toContain(call);
    }
  });

  it("is not even async, so it cannot await a request", () => {
    expect(handler).toMatch(/const runMarketBatch = \(\) =>/);
    expect(handler).not.toContain("async");
  });

  it("shows no fabricated success", () => {
    expect(handler).not.toContain("toast.success");
    expect(handler).not.toContain("checked");
    expect(handler).not.toContain("greatDeals");
    expect(handler).not.toContain("broadcastSynced");
  });

  it("reads as a status, not an outage", () => {
    expect(handler).toContain("toast.info(MARKET_BATCH_NOTICE)");
    expect(handler).not.toContain("toast.error");
    expect(MARKET_BATCH_NOTICE).toBe("Automated market review is being prepared.");
    expect(MARKET_BATCH_NOTICE).not.toMatch(/error|fail|broken|outage|unavailable|sorry/i);
  });

  it("reloads nothing, since nothing changed", () => {
    expect(handler).not.toContain("load()");
  });
});

describe("the control is disabled and announced", () => {
  it("marks the action disabled with a title and an accessible description", () => {
    expect(code).toMatch(/label="Check Market Prices"[\s\S]{0,160}disabled/);
    expect(code).toContain("title={MARKET_BATCH_NOTICE}");
    expect(code).toContain('aria-describedby={disabled ? "market-batch-notice" : undefined}');
    expect(code).toContain('<span id="market-batch-notice" className="sr-only">{MARKET_BATCH_NOTICE}</span>');
  });

  it("passes the disabled attribute to the real button element", () => {
    expect(code).toMatch(/<button\b[\s\S]{0,220}disabled=\{disabled\}/);
    expect(code).toContain('aria-disabled={disabled ? true : undefined}');
  });

  it("drops the hover affordance only while disabled", () => {
    expect(code).toContain('"opacity-60 cursor-not-allowed"');
    expect(code).toContain('"hover:bg-white hover:border-blue-500 hover:shadow-sm"');
  });

  it("leaves every other quick action untouched", () => {
    for (const label of [
      "Add Vehicle", "Scan VIN", "OEM Window Sticker", "New Addendum",
      "Check Recalls", "CSV Import",
    ]) {
      expect(code, label).toContain(`label="${label}"`);
    }
    // And their handlers are still live.
    expect(code).toContain("onClick={runRecallBatch}");
  });
});

describe("the per-VIN dealer action is preserved", () => {
  const integrity = readFileSync(PRICE_INTEGRITY, "utf8");

  it("still calls the proxy for one VIN", () => {
    expect(integrity).toContain('supabase.functions.invoke("marketcheck-market-pricing"');
  });

  it("sends no batch flag", () => {
    expect(integrity).not.toMatch(/batch:\s*true/);
  });
});
