import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentCoverThumbnail, coverBrand, coverLabel, formatVin } from "./DocumentCoverThumbnail";
import { documentCoverType } from "@/lib/passport/documentArtwork";

// The manual and the brochure are external links we deliberately do not
// ingest -- some of those PDFs are hundreds of megabytes. So every assertion
// below is really the same assertion: a cover has to be complete without the
// document, and nothing here may reach for the file.

const QX55 = {
  year: 2025, make: "INFINITI", model: "QX55", trim: "LUXE",
  vin: "3PCAJ5JR1SF103167",
  primaryVehiclePhotoUrl: "https://cdn.example/qx55.jpg",
} as const;

const imgs = (c: HTMLElement) => Array.from(c.querySelectorAll("img"));
const srcs = (c: HTMLElement) => imgs(c).map((i) => i.getAttribute("src") || "");

describe("an external record renders a real cover with no stored thumbnail", () => {
  it("owner's manual: brand, model and title, no blank sheet", () => {
    const { container } = render(<DocumentCoverThumbnail type="owners_manual" {...QX55} />);
    expect(screen.getByLabelText("2025 INFINITI QX55 owner's manual cover")).toBeTruthy();
    expect(container.textContent).toContain("INFINITI");
    expect(container.textContent).toContain("2025 QX55");
    expect(container.textContent).toContain("Owner's Manual");
  });

  it("OEM brochure: full-bleed photo under a gradient, with its own label", () => {
    const { container } = render(<DocumentCoverThumbnail type="oem_brochure" {...QX55} />);
    expect(screen.getByLabelText("2025 INFINITI QX55 official brochure cover")).toBeTruthy();
    expect(container.textContent).toContain("Official Vehicle Brochure");
    expect(srcs(container)).toContain(QX55.primaryVehiclePhotoUrl);
    // Cropping happens only inside the cover; the source image is untouched.
    expect(imgs(container)[0].className).toContain("object-cover");
  });
});

describe("CARFAX branding", () => {
  // There is no authorized CARFAX asset in this repository, so the cover is
  // unbranded and must never imitate their mark.
  it("renders an unbranded history cover carrying the VIN", () => {
    const { container } = render(<DocumentCoverThumbnail type="carfax" provider="carfax" {...QX55} />);
    expect(container.textContent).toContain("Vehicle History");
    expect(container.textContent).toContain("3PC AJ5JR1 SF103167");
    expect(container.textContent).not.toMatch(/carfax/i);
  });

  it("names the provider in the accessible label without drawing their mark", () => {
    expect(coverLabel({ type: "carfax", provider: "carfax", vin: QX55.vin }))
      .toBe("CARFAX vehicle history report for VIN 3PCAJ5JR1SF103167");
    expect(coverLabel({ type: "vehicle_history", provider: "autocheck", vin: QX55.vin }))
      .toContain("AutoCheck");
  });

  it("still renders without a VIN", () => {
    const { container } = render(<DocumentCoverThumbnail type="carfax" year={2025} make="INFINITI" model="QX55" />);
    expect(container.textContent).toContain("Vehicle History");
    expect(container.textContent).not.toContain("VIN");
  });
});

describe("stored thumbnails", () => {
  it("wins over the drawn cover when it loads", () => {
    const { container } = render(
      <DocumentCoverThumbnail type="owners_manual" {...QX55} thumbnailUrl="https://cdn.example/p1.png" />,
    );
    expect(srcs(container)).toEqual(["https://cdn.example/p1.png"]);
    expect(container.textContent).not.toContain("Owner's Manual");
  });

  it("falls back to the drawn cover on error, and does not loop", () => {
    const { container } = render(
      <DocumentCoverThumbnail type="owners_manual" {...QX55} thumbnailUrl="https://cdn.example/gone.png" />,
    );
    fireEvent.error(imgs(container)[0]);
    expect(container.textContent).toContain("Owner's Manual");
    // The failed URL is gone from the tree, so onError cannot fire again.
    expect(srcs(container)).not.toContain("https://cdn.example/gone.png");
  });
});

describe("missing or broken assets never collapse the cover", () => {
  it("no vehicle photograph: silhouette, still a full cover", () => {
    const { container } = render(
      <DocumentCoverThumbnail type="owners_manual" year={2025} make="INFINITI" model="QX55" />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).toContain("Owner's Manual");
  });

  it("photograph that errors is replaced, not left broken", () => {
    const { container } = render(<DocumentCoverThumbnail type="oem_brochure" {...QX55} />);
    fireEvent.error(imgs(container)[0]);
    expect(srcs(container)).not.toContain(QX55.primaryVehiclePhotoUrl);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).toContain("Official Vehicle Brochure");
  });

  it("no OEM logo asset: the make renders as styled text", () => {
    const { container } = render(<DocumentCoverThumbnail type="owners_manual" {...QX55} oemLogoUrl={null} />);
    expect(container.textContent).toContain("INFINITI");
  });

  it("an OEM logo that errors falls back to the wordmark", () => {
    const { container } = render(
      <DocumentCoverThumbnail type="owners_manual" year={2025} make="INFINITI" model="QX55"
        oemLogoUrl="https://cdn.example/badge.svg" />,
    );
    expect(srcs(container)).toContain("https://cdn.example/badge.svg");
    fireEvent.error(imgs(container)[0]);
    expect(container.textContent).toContain("INFINITI");
  });

  it("with every optional asset gone it is still a cover, not an icon", () => {
    const { container } = render(<DocumentCoverThumbnail type="owners_manual" year={2025} make="INFINITI" model="QX55" />);
    expect(container.textContent).toContain("2025 QX55");
    expect(container.firstElementChild?.getAttribute("role")).toBe("img");
  });
});

describe("it works across the brand family, not just the reference car", () => {
  for (const [make, model] of [
    ["INFINITI", "QX55"], ["Nissan", "Rogue"], ["Toyota", "RAV4"],
    ["Honda", "CR-V"], ["Chevrolet", "Tahoe"], ["Ford", "F-150"],
  ] as const) {
    it(`${make} ${model}`, () => {
      const { container } = render(
        <DocumentCoverThumbnail type="owners_manual" year={2025} make={make} model={model} />,
      );
      const brand = coverBrand(make);
      expect(container.textContent).toContain(brand.name);
      expect(container.textContent).toContain(`2025 ${model}`);
      // A pale OEM header colour would put white text on white paper.
      expect(brand.dark).toMatch(/^#/);
    });
  }

  it("a make outside the OEM registry still gets a cover", () => {
    const { container } = render(<DocumentCoverThumbnail type="owners_manual" year={2026} make="Rivian" model="R1S" />);
    expect(container.textContent).toContain("RIVIAN");
  });
});

describe("no document is fetched to draw a cover", () => {
  it("never points an <img> at the external document URL", () => {
    for (const type of ["owners_manual", "oem_brochure", "carfax"] as const) {
      const { container } = render(
        <DocumentCoverThumbnail type={type} {...QX55} externalUrl="https://oem.example/manual.pdf" />,
      );
      expect(srcs(container).some((u) => /\.pdf($|\?)/i.test(u))).toBe(false);
      expect(srcs(container)).not.toContain("https://oem.example/manual.pdf");
    }
  });
});

describe("formatVin", () => {
  it("groups a 17-character VIN and leaves anything else alone", () => {
    expect(formatVin("3PCAJ5JR1SF103167")).toBe("3PC AJ5JR1 SF103167");
    expect(formatVin("SHORT")).toBe("SHORT");
    expect(formatVin(null)).toBe("");
  });
});

describe("documentCoverType is the one place the vocabularies meet", () => {
  it("maps the stored types onto cover types", () => {
    expect(documentCoverType("factory_sticker")).toBe("factory_sticker");
    expect(documentCoverType("window_sticker")).toBe("factory_sticker");
    expect(documentCoverType("build_sheet")).toBe("factory_sticker");
    expect(documentCoverType("owners_manual")).toBe("owners_manual");
    expect(documentCoverType("Owner Manual")).toBe("owners_manual");
    expect(documentCoverType("brochure")).toBe("oem_brochure");
    expect(documentCoverType("OEM Brochure")).toBe("oem_brochure");
    expect(documentCoverType("buyers_guide")).toBe("buyers_guide");
    expect(documentCoverType("warranty")).toBe("warranty");
    expect(documentCoverType("something odd")).toBe("generic");
  });

  it("splits the history report on provider", () => {
    expect(documentCoverType("vehicle_history", null, "carfax")).toBe("carfax");
    expect(documentCoverType("vehicle_history", null, "autocheck")).toBe("vehicle_history");
    expect(documentCoverType("carfax")).toBe("carfax");
  });
});
