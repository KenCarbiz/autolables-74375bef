import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getStudioTemplate, type StickerData, type StickerBranding } from "./templates";

const DATA: StickerData = {
  vehicleTitle: "2027 INFINITI QX60 LUXE", vin: "5N1AL1F87VC331335", stock: "I21567",
  mileage: "17000", msrp: "62335", price: "58835",
  installed: [{ name: "AWD" }, { name: "Bose Audio" }, { name: "Moonroof" }, { name: "ProPILOT" }, { name: "Heated Seats" }, { name: "Captain's Chairs" }, { name: "Tow Package" }],
  upgrades: [], benefits: [{ name: "Lifetime Washes" }, { name: "Loaners" }], notes: "", qrUrl: "https://autolabels.io/v/demo",
};
const BRAND: StickerBranding = {
  dealerName: "Harte Infiniti", address: "Hartford, CT", phone: "(860) 555-0100", website: "harteinfiniti.com",
  logoUrl: "", showLogo: true, valueProp: "Lifetime powertrain", disclaimer: "See dealer for details.", accentColor: "#2563EB",
};
const PREMIUM = ["window-premium", "window-bold", "window-luxury"];
const render = (id: string, data: StickerData, options = {}) => {
  const t = getStudioTemplate(id)!;
  const Render = t.Render;
  return renderToStaticMarkup(<Render config={t.config} data={data} branding={BRAND} options={options} />);
};

describe("premium window templates", () => {
  for (const id of PREMIUM) {
    it(`${id} renders price + VIN + stock`, () => {
      const html = render(id, DATA);
      expect(html).toContain("58,835");          // formatted price
      expect(html).toContain("5N1AL1F87VC331335"); // VIN always visible
      expect(html).toContain("I21567");           // stock always visible
    });
    it(`${id} renders gracefully with missing price`, () => {
      const html = render(id, { ...DATA, price: "", msrp: "" });
      expect(html.length).toBeGreaterThan(200);
      expect(html).toContain("5N1AL1F87VC331335");
    });
    it(`${id} renders gracefully with a very long title and no logo`, () => {
      const html = render(id, { ...DATA, vehicleTitle: "2027 MERCEDES-BENZ AMG GT 63 S E PERFORMANCE 4MATIC+ EXECUTIVE EDITION" });
      expect(html.length).toBeGreaterThan(200);
    });
    it(`${id} keeps the disclaimer footer`, () => {
      expect(render(id, DATA)).toContain("See dealer for details.");
    });
  }

  it("Executive Noir is dark by default and light under white label", () => {
    expect(render("window-noir", DATA)).toContain("#0b0f17");          // dark hero
    expect(render("window-noir", DATA, { labelMode: "white" })).toContain("#faf7f0"); // cream variant
  });

  it("Big Price sticker shows the CALL FOR PRICE fallback", () => {
    expect(render("window-value", { ...DATA, price: "", msrp: "" })).toContain("CALL FOR PRICE");
  });
});
