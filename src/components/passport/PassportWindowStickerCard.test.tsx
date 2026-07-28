import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PassportWindowStickerCard from "./PassportWindowStickerCard";

// The mobile well was a fixed 128px box holding a sheet that carried
// aspect-ratio 11/8.5 and max-w-full. A stored sticker preview is an SVG with
// a viewBox and no intrinsic size, so it took the full width of the card and
// the ratio then demanded ~238px of height. Nothing clipped it, so the sheet
// painted 118px past the well and straight over the heading, the description,
// the meta row and the button.
//
// jsdom does no layout, so these assert the class contract that makes the
// overflow impossible rather than the pixels: the well is shaped by the page
// (never a fixed height that the sheet can outgrow), the sheet is sized from
// the well's height (never from its own width), and the well clips regardless.

const STICKER = {
  thumbnailUrl: "https://cdn.example/sticker-p1.svg",
  pdfUrl: "https://cdn.example/sticker.pdf",
  publishedAt: "2026-07-28T00:00:00Z",
} as never;

const renderCard = (variant: "desktop" | "mobile") =>
  render(
    <PassportWindowStickerCard
      sticker={STICKER}
      vehicleLabel="2025 INFINITI QX55"
      onAllDocuments={() => {}}
      variant={variant}
    />,
  );

const wellOf = (c: HTMLElement) => c.querySelector("img")!.parentElement!;

describe("the sticker sheet cannot escape its well", () => {
  it("shapes the mobile well by the page instead of pinning a height", () => {
    const well = wellOf(renderCard("mobile").container);
    expect(well.className).toContain("aspect-[11/8.5]");
    // h-32 is the regression: a 128px box a 238px sheet does not fit inside.
    expect(well.className).not.toMatch(/\bh-32\b/);
  });

  it("clips the well in both variants", () => {
    for (const v of ["mobile", "desktop"] as const) {
      expect(wellOf(renderCard(v).container).className).toContain("overflow-hidden");
    }
  });

  it("sizes the sheet from the well's height, not its own width", () => {
    for (const v of ["mobile", "desktop"] as const) {
      const img = renderCard(v).container.querySelector("img")!;
      expect(img.className).toContain("h-full");
      expect(img.className).toContain("w-auto");
      // max-h-full was the old guard and it did not hold for a sizeless SVG.
      expect(img.className).not.toContain("max-h-full");
    }
  });

  it("keeps the heading and the actions in the document after the sheet", () => {
    const { container } = renderCard("mobile");
    expect(container.textContent).toContain("Original Equipment & MSRP Window Sticker");
    expect(container.querySelector("a[href='https://cdn.example/sticker.pdf']")).toBeTruthy();
  });

  it("shows a placeholder rather than a sized-from-nothing sheet with no thumbnail", () => {
    const { container } = render(
      <PassportWindowStickerCard
        sticker={{ ...(STICKER as object), thumbnailUrl: null } as never}
        vehicleLabel="2025 INFINITI QX55"
        onAllDocuments={() => {}}
        variant="mobile"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
