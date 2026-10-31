import { describe, expect, it } from "vitest";
import { prepProofNeeded, prepWorkCategories, prepWorkCategory } from "./prepWorkCategory";

describe("prepWorkCategory", () => {
  it("classifies by product name and defaults to accessories", () => {
    expect(prepWorkCategory("Paint & Fabric Protection")).toBe("detail");
    expect(prepWorkCategory("Nitrogen Tires")).toBe("mechanical");
    expect(prepWorkCategory("Paintless dent repair")).toBe("reconditioning");
    expect(prepWorkCategory("Wheel Locks")).toBe("accessories");
  });
  it("dedupes categories across items", () => {
    expect(prepWorkCategories([{ product_name: "Tint Film" }, { product_name: "Wheel Locks" }])).toEqual(["accessories"]);
  });
  it("derives outstanding proof from what is on file", () => {
    expect(prepProofNeeded({ install_photos: [], foreman_signature_data: null })).toBe("Photos + signature");
    expect(prepProofNeeded({ install_photos: [{}], foreman_signature_data: null })).toBe("Signature");
    expect(prepProofNeeded({ install_photos: [{}], foreman_signature_data: "x" })).toBe("None");
  });
});
