import { describe, it, expect } from "vitest";
import { STUDIO_SATURDAY_TEMPLATES, premiumTemplateFromConfig } from "./saturdayTemplates";
import { renderToStaticMarkup } from "react-dom/server";
import { USED_ADDENDUM_CATALOG_50 } from "@/components/saturday/UsedAddendumCatalog";
import { buildConfig, getStudioTemplate, type StickerData, type StickerBranding, type StickerTemplateConfig, templateFromConfig } from "./templates";

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
    expect(render("window-luxury", DATA)).toContain("#0b0f17");          // dark hero
    expect(render("window-luxury", DATA, { labelMode: "white" })).toContain("#faf7f0"); // cream variant
  });

  it("Big Price sticker shows the CALL FOR PRICE fallback", () => {
    expect(render("window-bold", { ...DATA, price: "", msrp: "" })).toContain("CALL FOR PRICE");
  });
});

// StickerPrint resolves premiumTemplateFromConfig first — a Saturday config
// must never fall back to the generic engine or the printed sheet differs
// from the studio preview.
describe("saturday template print resolution", () => {
  it("resolves every saturday id to its saturday renderer", () => {
    for (const t of STUDIO_SATURDAY_TEMPLATES) {
      const resolved = premiumTemplateFromConfig(t.config) ?? templateFromConfig(t.config);
      expect(resolved.Render).toBe(t.Render);
      expect(templateFromConfig(t.config).Render).not.toBe(t.Render);
    }
  });
});

describe("new car SaaS template", () => {
  const template = STUDIO_SATURDAY_TEMPLATES.find((t) => t.config.id === "addendum-new-car-saas")!;

  it("is registered with its own renderer and name", () => {
    expect(template).toBeDefined();
    expect(template.config.name).toBe("New Car SaaS Template");
    expect(template.config.type).toBe("addendum");
  });

  it("renders the addendum with the vehicle identity and MSRP-based total", () => {
    const html = renderToStaticMarkup(<template.Render config={template.config} data={DATA} branding={BRAND} />);
    expect(html).toContain("ADDENDUM");
    expect(html).toContain("5N1AL1F87VC331335");
    expect(html).toContain("I21567");
    expect(html).toContain("MSRP (BASE PRICE)");
  });
});

// A duplicated template is a new row with its own key; until a dedicated
// renderer is bound to that key it must render with the source layout.
describe("duplicated template resolution", () => {
  const resolve = (config: StickerTemplateConfig) => premiumTemplateFromConfig(config) ?? templateFromConfig(config);

  it("renders a saturday copy with the source renderer", () => {
    const source = STUDIO_SATURDAY_TEMPLATES.find((t) => t.config.id === "addendum-saturday-premium")!;
    const copy = { ...source.config, id: "addendum-saturday-premium-copy", name: "Premium (Copy)", copyOfTemplateId: "addendum-saturday-premium" };
    expect(resolve(copy).Render).toBe(source.Render);
    expect(resolve(copy).config.id).toBe("addendum-saturday-premium-copy");
  });

  it("renders a used addendum catalog copy with the catalog layout", () => {
    const source = USED_ADDENDUM_CATALOG_50[0];
    const copy = buildConfig("addendum", { id: `${source.id}-copy`, name: `${source.name} (Copy)`, copyOfTemplateId: source.id });
    const resolved = resolve(copy);
    expect(resolved.Render).not.toBe(templateFromConfig(copy).Render);
    const html = renderToStaticMarkup(<resolved.Render config={resolved.config} data={DATA} branding={BRAND} />);
    expect(html).toContain("5N1AL1F87VC331335");
  });

  it("falls back to the generic engine when the source has no dedicated layout", () => {
    const copy = buildConfig("addendum", { id: "new-addendum-core-msrp-plus-accessories-copy", name: "Stub (Copy)", copyOfTemplateId: "new-addendum-core-msrp-plus-accessories" });
    expect(premiumTemplateFromConfig(copy)).toBeUndefined();
    expect(resolve(copy).config.id).toBe("new-addendum-core-msrp-plus-accessories-copy");
  });
});
