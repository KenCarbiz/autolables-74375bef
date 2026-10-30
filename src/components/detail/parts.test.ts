import { describe, expect, it } from "vitest";
import { productTone } from "./parts";

describe("productTone", () => {
  it("maps command tone names onto the product scale", () => {
    expect(productTone("emerald")).toBe("success");
    expect(productTone("amber")).toBe("warning");
    expect(productTone("red")).toBe("danger");
    expect(productTone("blue")).toBe("info");
    expect(productTone("slate")).toBe("neutral");
  });

  it("falls back to neutral for unknown or missing tones", () => {
    expect(productTone(undefined)).toBe("neutral");
    expect(productTone("plaid")).toBe("neutral");
  });
});
