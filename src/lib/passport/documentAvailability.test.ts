import { describe, it, expect } from "vitest";
import { countAvailableDocuments } from "./documentAvailability";

describe("countAvailableDocuments", () => {
  it("counts the four-record vehicle as 4, not a literal", () => {
    // Factory build record + CARFAX + owner's manual + OEM brochure.
    expect(countAvailableDocuments({
      uploadedCount: 0,
      hasFactoryRecord: true,
      externalLinks: [
        "https://www.carfax.com/vehicle/3PCAJ5JR1SF103167",
        "https://www.infinitiusa.com/brochure.pdf",
        "https://owners.infinitiusa.com/manual.pdf",
      ],
    })).toBe(4);
  });

  it("counts an external link with no ingested file", () => {
    expect(countAvailableDocuments({
      uploadedCount: 0, hasFactoryRecord: false,
      externalLinks: ["https://oem.example/manual.pdf"],
    })).toBe(1);
  });

  it("drops a module the dealer excluded", () => {
    expect(countAvailableDocuments({
      uploadedCount: 0, hasFactoryRecord: true,
      externalLinks: [null, undefined, ""],
    })).toBe(1);
  });

  it("ignores a whitespace-only URL rather than counting a dead card", () => {
    expect(countAvailableDocuments({
      uploadedCount: 0, hasFactoryRecord: false, externalLinks: ["   "],
    })).toBe(0);
  });

  it("adds stored documents to external links", () => {
    expect(countAvailableDocuments({
      uploadedCount: 3, hasFactoryRecord: true,
      externalLinks: ["https://a", "https://b"],
    })).toBe(6);
  });

  it("is zero for a vehicle with nothing", () => {
    expect(countAvailableDocuments({ uploadedCount: 0, hasFactoryRecord: false, externalLinks: [] })).toBe(0);
  });
});
