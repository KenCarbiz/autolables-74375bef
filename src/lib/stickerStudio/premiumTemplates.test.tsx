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

// The "Show dealer logo" control has to reach the rendered document, not just
// the preview chrome — these two assertions are the unit form of that promise.
describe("dealer logo toggle", () => {
  const withLogo = { ...BRAND, logoUrl: "https://cdn.example.com/dealer.png", addressLine2: "Hartford, CT 06120" };
  const render = (id: string, branding: StickerBranding) => {
    const t = STUDIO_SATURDAY_TEMPLATES.find((x) => x.config.id === id)!;
    return renderToStaticMarkup(<t.Render config={t.config} data={DATA} branding={branding} />);
  };

  for (const id of ["addendum-saturday-premium", "addendum-new-car-saas"]) {
    it(`${id} renders the resolved logo when the toggle is on`, () => {
      const html = render(id, { ...withLogo, showLogo: true });
      expect(html).toContain("https://cdn.example.com/dealer.png");
      expect(html).toContain("Hartford, CT 06120");
    });

    it(`${id} drops the logo but keeps the contact block when the toggle is off`, () => {
      const html = render(id, { ...withLogo, showLogo: false });
      expect(html).not.toContain("https://cdn.example.com/dealer.png");
      expect(html).toContain("Harte Infiniti");
      expect(html).toContain("Hartford, CT 06120");
      expect(html).toContain("harteinfiniti.com");
    });

    // The logo is the masthead, so it belongs in the FIRST slot of the header,
    // ahead of the vertical divider. It used to sit above the contact block on
    // the right, which read as a footnote rather than as letterhead.
    it(`${id} puts the logo in the header's left slot`, () => {
      const html = render(id, { ...withLogo, showLogo: true });
      const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
      const divider = header.indexOf("border-left");
      expect(divider).toBeGreaterThan(-1);
      expect(header.indexOf("https://cdn.example.com/dealer.png")).toBeLessThan(divider);
    });

    // The dealership name is stated once. With a logo it stays on the contact
    // block; without one it becomes the masthead itself.
    it(`${id} states the dealership name exactly once in the header`, () => {
      for (const showLogo of [true, false]) {
        const html = render(id, { ...withLogo, showLogo });
        const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
        // Text nodes only — the logo's alt text legitimately repeats the name.
        expect(header.split(">Harte Infiniti<").length - 1, `showLogo=${showLogo}`).toBe(1);
      }
    });
  }
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

// Value propositions are the dealership's own programs, merchandised on the
// sticker. The claim and its disclosure must always travel together.
describe("value propositions on the addendum", () => {
  const vp = {
    id: "vp-1",
    headline: "Lifetime Powertrain Warranty",
    supportingLine: "Included with qualifying vehicles",
    disclosure: "Available on qualifying vehicles. See dealer for complete terms.",
    imageUrl: "https://cdn.example.com/lifetime.png",
    displayStyle: "image_text" as "image" | "image_text" | "banner",
    showAskForDetails: true,
  };
  const render = (id: string, valueProps: (typeof vp)[]) => {
    const t = STUDIO_SATURDAY_TEMPLATES.find((x) => x.config.id === id)!;
    return renderToStaticMarkup(<t.Render config={t.config} data={{ ...DATA, valueProps }} branding={BRAND} />);
  };

  for (const id of ["addendum-saturday-premium", "addendum-new-car-saas"]) {
    it(`${id} prints the headline, supporting line, image, and disclosure`, () => {
      const html = render(id, [vp]);
      expect(html).toContain("Lifetime Powertrain Warranty");
      expect(html).toContain("Included with qualifying vehicles");
      expect(html).toContain("https://cdn.example.com/lifetime.png");
      expect(html).toContain("Ask for details");
      expect(html).toContain("See dealer for complete terms.");
    });

    it(`${id} still prints the disclosure when the dealer hides "Ask for details"`, () => {
      const html = render(id, [{ ...vp, showAskForDetails: false }]);
      expect(html).not.toContain("Ask for details");
      expect(html).toContain("See dealer for complete terms.");
    });

    it(`${id} keeps the disclosure on an image-only proposition`, () => {
      const html = render(id, [{ ...vp, displayStyle: "image" as const }]);
      expect(html).not.toContain("Included with qualifying vehicles");
      expect(html).toContain("See dealer for complete terms.");
    });

    it(`${id} renders nothing extra when no proposition is selected`, () => {
      expect(render(id, [])).not.toContain("Ask for details");
    });
  }
});

describe("addendum wordmark and value-prop sizing", () => {
  const renderAddendum = (id: string, data: StickerData, branding = BRAND) => {
    const t = STUDIO_SATURDAY_TEMPLATES.find((x) => x.config.id === id)!;
    return renderToStaticMarkup(<t.Render config={t.config} data={data} branding={branding} />);
  };
  const logoVp = {
    id: "vp-logo", headline: "Lifetime Powertrain", supportingLine: "On qualifying vehicles",
    disclosure: "See dealer for terms.", imageUrl: "https://cdn.example.com/lp.png",
    displayStyle: "image" as "image" | "image_text" | "banner", showAskForDetails: false,
  };

  for (const id of ["addendum-saturday-premium", "addendum-new-car-saas"]) {
    // The masthead is the DEALER's. AutoLabels attribution lives in the footer
    // lockup and nowhere else — the platform prints the document, it does not
    // sell the car. A header that led with the AutoLabels wordmark made a
    // dealer's addendum look like it came from a third party.
    it(`${id} gives the masthead to the dealer, not to AutoLabels`, () => {
      const red = renderAddendum(id, DATA, { ...BRAND, accentColor: "#b91c1c" });
      expect(red).not.toContain("labels.io<");
      expect(red).not.toContain("AI-Powered Vehicle Transparency");
      // The footer lockup is the site wordmark, inverted for the navy bar, and
      // carries no glyph beside it.
      expect(red).toContain(">auto</span>");
      expect(red).toContain(">(LABELS)</span>");
      expect(red).toContain("#3BB4FF");   // "auto" on dark
      expect(red).toContain("Powered by");
    });

    it(`${id} renders an image-only value proposition without its text`, () => {
      const html = renderAddendum(id, { ...DATA, valueProps: [logoVp] });
      expect(html).toContain("https://cdn.example.com/lp.png");
      expect(html).not.toContain("On qualifying vehicles");
      expect(html).toContain("See dealer for terms.");   // disclosure still prints
    });

    it(`${id} scales the value-prop image independently of the text`, () => {
      // The scale is now a max-height CEILING, not a fixed height. A fixed
      // height meant the artwork claimed its inches before the equipment,
      // benefit and upgrade rows were laid out, and whatever did not fit on
      // the 11-inch sheet was cropped in silence.
      const small = renderAddendum(id, { ...DATA, valueProps: [{ ...logoVp, imageScale: "sm" }] });
      const xl = renderAddendum(id, { ...DATA, valueProps: [{ ...logoVp, imageScale: "xl" }] });
      expect(small).toMatch(/max-height:\s*0\.42in/);
      expect(small).toContain("max-w-[1.1in]");
      expect(xl).toContain("max-w-[2.9in]");
      // Aspect ratio is preserved and the artwork is never stretched.
      expect(xl).toContain("h-auto");
      expect(xl).toContain("object-contain");
      expect(xl).not.toMatch(/class="[^"]*h-\[1\.15in\]/);
      const xlWithText = renderAddendum(id, {
        ...DATA,
        valueProps: [{ ...logoVp, displayStyle: "image_text", imageScale: "xl" }],
      });
      expect(xlWithText).toContain("max-w-[2.9in]");
      expect(xlWithText).toContain("On qualifying vehicles");
    });
  }
});
