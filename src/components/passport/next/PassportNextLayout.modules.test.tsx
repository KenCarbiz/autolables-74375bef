import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import rows from "@/lib/vehicleData/__fixtures__/acceptanceVehicles.json";
import { derivePassport } from "@/lib/passportV2Data";
import { deriveVerificationReport } from "@/lib/passport/verificationSummary";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { buildNextPassportData, buildNextPassportDealer } from "@/lib/passport/nextPassportData";
import { buildVehiclePassportDataContract } from "@/lib/vehicleData/dataContract";
import PassportNextLayout from "./PassportNextLayout";

type Row = Record<string, unknown> & { vin: string };

const build = (vin: string) => {
  const row = (rows as Row[]).find((r) => r.vin === vin);
  if (!row) throw new Error(`fixture ${vin} missing`);
  const listing = { ...row, status: "published" } as never;
  const d = derivePassport(listing);
  const data = buildNextPassportData({
    d,
    listing,
    report: deriveVerificationReport(d, listing),
    saleCard: buildPassportSaleCard(d, String((row as { condition?: string }).condition || "")),
    gallery: [],
    contract: buildVehiclePassportDataContract(listing, d),
  });
  return { data, dealer: buildNextPassportDealer(d, listing) };
};

const QX80 = "JN8AZ3CCXT9624250";
const SOLTERRA = "JTMABABA1PA013354";

const mount = (vin: string, onOpenDetail?: (s: string) => void) => {
  const { data, dealer } = build(vin);
  return render(<PassportNextLayout data={data} dealer={dealer} onOpenDetail={onOpenDetail} />);
};

const sectionOf = (heading: string) => {
  const h = screen.getByRole("heading", { name: heading });
  return h.closest("section") as HTMLElement;
};

describe("PassportNextLayout modules - QX80", () => {
  it("shows installed options with MSRP and the factory MSRP total", () => {
    const { container } = mount(QX80);
    const eq = sectionOf("Features & Packages");
    expect(within(eq).getAllByText(/Two-Tone Premium Paint/).length).toBeGreaterThan(0);
    expect(within(eq).getAllByText("$1,695").length).toBeGreaterThan(0);
    expect(within(eq).getAllByText(/Premium Cargo Package \(PIO\)/).length).toBeGreaterThan(0);
    const msrp = sectionOf("Factory MSRP");
    expect(within(msrp).getByText("$116,750")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).not.toMatch(/\$0(?![\d,.])/);
  });

  it("keeps every details element labeled and reachable", () => {
    const { container } = mount(QX80);
    const all = Array.from(container.querySelectorAll("details"));
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) {
      const summary = d.querySelector(":scope > summary");
      expect(summary).not.toBeNull();
      expect((summary as HTMLElement).textContent?.trim().length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Full equipment list")).toBeInTheDocument();
    expect(screen.getByText("Specifications")).toBeInTheDocument();
  });

  it("does not truncate the full equipment list", () => {
    const { data } = build(QX80);
    const { container } = mount(QX80);
    const total = data.equipment.categories.reduce((n, c) => n + c.items.length, 0);
    const list = container.querySelector("#pp-equipment details") as HTMLElement;
    expect(list.querySelectorAll("li").length).toBeGreaterThanOrEqual(total);
  });
});

describe("PassportNextLayout modules - Solterra EV", () => {
  it("labels fuel economy in MPGe and never bare MPG", () => {
    const { container } = mount(SOLTERRA);
    const fuel = sectionOf("Fuel Economy");
    expect(fuel.textContent).toContain("MPGe");
    expect(fuel.textContent).not.toMatch(/MPG(?!e)/);
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).not.toMatch(/\$0(?![\d,.])/);
  });
});

describe("PassportNextLayout detail wiring", () => {
  it("reports section names to onOpenDetail and opens in-page sections", () => {
    const spy = vi.fn();
    const { container } = mount(SOLTERRA, spy);
    fireEvent.click(screen.getByText("See Full Vehicle History"));
    expect(spy).toHaveBeenCalledWith("Verification");
    fireEvent.click(screen.getByText("View market details"));
    expect(spy).toHaveBeenCalledWith("Market Intelligence");

    fireEvent.click(screen.getByText(/Full specifications/));
    expect((container.querySelector("#pp-specs") as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(screen.getByText(/All features & packages/));
    expect((container.querySelector("#pp-equipment details") as HTMLDetailsElement).open).toBe(true);
    fireEvent.click(screen.getByText("Read more overview"));
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });
});
