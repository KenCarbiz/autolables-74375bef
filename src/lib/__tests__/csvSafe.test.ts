import { describe, it, expect } from "vitest";
import { escapeCsvCell, neutralizeCsvCell } from "@/lib/csvSafe";
import { toCsv } from "@/components/admin/tablePrimitives";

describe("CSV formula neutralization", () => {
  it("prefixes cells starting with formula characters =, +, -, @", () => {
    expect(neutralizeCsvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
    expect(neutralizeCsvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(neutralizeCsvCell("-1+1")).toBe("'-1+1");
    expect(neutralizeCsvCell("@HYPERLINK(\"http://evil\")")).toBe("'@HYPERLINK(\"http://evil\")");
  });

  it("prefixes formula characters preceded by whitespace or tab/CR", () => {
    expect(neutralizeCsvCell("  =HYPERLINK(\"http://evil\")")).toBe("'  =HYPERLINK(\"http://evil\")");
    expect(neutralizeCsvCell("\t=1+1")).toBe("'\t=1+1");
    expect(neutralizeCsvCell("\r=1+1")).toBe("'\r=1+1");
  });

  it("preserves normal text, numbers, and escapes quotes", () => {
    expect(escapeCsvCell('Jane "Ace" Doe')).toBe('"Jane ""Ace"" Doe"');
    expect(escapeCsvCell(29995)).toBe('"29995"');
    expect(neutralizeCsvCell(null)).toBe("");
  });

  it("neutralizes formulas in admin tablePrimitives toCsv", () => {
    const csv = toCsv(
      [{ name: "=HYPERLINK(\"https://evil.example\")", notes: "ok" }],
      [
        { header: "Dealership", get: (r) => r.name },
        { header: "Notes", get: (r) => r.notes },
      ],
    );
    expect(csv).toContain("\"'=HYPERLINK(\"\"https://evil.example\"\")\",ok");
  });
});