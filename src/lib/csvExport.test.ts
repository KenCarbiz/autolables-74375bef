import { describe, expect, it } from "vitest";
import { toCsv } from "./csvExport";

describe("toCsv", () => {
  it("quotes cells with commas, quotes and newlines", () => {
    expect(toCsv([["a", "b,c"], ['say "hi"', "x\ny"]])).toBe('a,"b,c"\r\n"say ""hi""","x\ny"');
  });
});
