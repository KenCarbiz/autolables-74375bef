import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ChannelCardGrid, ChannelCard, ChannelLogo } from "./ChannelCard";
import { CHANNEL_CARDS } from "@/lib/description/model";
import {
  CHANNEL_ASSETS, assetFor, isRenderable, logoBox, missingAssets, LOGO_VIEWPORT,
} from "@/lib/description/channelAssets";

// The channel selector is a read: it swaps which saved version is shown. These
// tests pin that it never becomes a write, and that a provider whose licensed
// logo we do not have says so instead of showing a look-alike wordmark.

const ready = () => ({ state: "ready" as const, note: "Export only" });

describe("channel cards", () => {
  it("renders all seven providers including vAuto", () => {
    render(<ChannelCardGrid cards={CHANNEL_CARDS} statusFor={ready} selected="autotrader" onSelect={() => {}} />);
    for (const name of ["AutoTrader", "Cars.com", "CarGurus", "Facebook Marketplace",
                        "Dealer Website", "Google SEO", "vAuto"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("radio")).toHaveLength(7);
  });

  it("keeps vAuto reachable in the same grid rather than behind a scroll", () => {
    const { container } = render(
      <ChannelCardGrid cards={CHANNEL_CARDS} statusFor={ready} selected="autotrader" onSelect={() => {}} />);
    const grid = container.querySelector('[role="radiogroup"]')!;
    // Two per row at the narrowest width, three from small up — never a
    // single scrolling row that strands the last card.
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("sm:grid-cols-3");
    expect(within(grid as HTMLElement).getByTestId("channel-card-vauto")).toBeInTheDocument();
  });

  it("exposes selection as radio semantics, not colour alone", () => {
    render(<ChannelCardGrid cards={CHANNEL_CARDS} statusFor={ready} selected="cargurus" onSelect={() => {}} />);
    expect(screen.getByTestId("channel-card-cargurus")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("channel-card-autotrader")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radiogroup", { name: /publishing channel/i })).toBeInTheDocument();
  });

  it("selects on click and on keyboard activation", () => {
    const onSelect = vi.fn();
    render(<ChannelCardGrid cards={CHANNEL_CARDS} statusFor={ready} selected="autotrader" onSelect={onSelect} />);
    const card = screen.getByTestId("channel-card-vauto");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("vauto");
    // A <button> activates on Enter and Space natively, which is exactly why
    // this is a button and not a div with an onClick.
    expect(card.tagName).toBe("BUTTON");
  });

  it("carries a visible focus ring distinct from the selected state", () => {
    render(<ChannelCardGrid cards={CHANNEL_CARDS} statusFor={ready} selected="autotrader" onSelect={() => {}} />);
    const card = screen.getByTestId("channel-card-cars_com");
    expect(card.className).toContain("focus-visible:ring-2");
    expect(card.className).not.toContain("ring-blue-500 bg-blue-50");
  });

  it("does not select a disabled card and explains why", () => {
    const onSelect = vi.fn();
    render(
      <ChannelCard
        meta={CHANNEL_CARDS[0]}
        status={{ state: "disabled", disabledReason: "Disabled for this dealership" }}
        selected={false}
        onSelect={onSelect}
      />);
    const card = screen.getByTestId("channel-card-autotrader");
    fireEvent.click(card);
    expect(onSelect).not.toHaveBeenCalled();
    expect(card).toBeDisabled();
    expect(screen.getAllByText(/Disabled for this dealership/).length).toBeGreaterThan(0);
  });

  it("shows a configuration warning without ever claiming publication", () => {
    render(
      <ChannelCard
        meta={CHANNEL_CARDS[1]}
        status={{ state: "warning", note: "No connector" }}
        selected={false}
        onSelect={() => {}}
      />);
    // Twice on purpose: the visible chip and the screen-reader description,
    // so the state is never conveyed by the amber pill alone.
    expect(screen.getAllByText("No connector")).toHaveLength(2);
    expect(screen.queryByText(/published/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
  });

  it("respects reduced motion on the hover treatment", () => {
    render(<ChannelCard meta={CHANNEL_CARDS[0]} status={ready()} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId("channel-card-autotrader").className).toContain("motion-safe:hover:");
  });
});

describe("provider logo assets", () => {
  it("has a manifest entry for every card", () => {
    for (const c of CHANNEL_CARDS) expect(assetFor(c.key)).toBeDefined();
  });

  it("never substitutes a text wordmark for a missing logo", () => {
    render(<ChannelCardGrid cards={CHANNEL_CARDS} statusFor={ready} selected="autotrader" onSelect={() => {}} />);
    for (const c of CHANNEL_CARDS) {
      const asset = assetFor(c.key)!;
      if (isRenderable(asset) || c.key === "dealer_website") continue;
      const card = screen.getByTestId(`channel-card-${c.key}`);
      // The placeholder is explicitly a placeholder. The provider name that
      // remains on the card is the card's LABEL, never a styled wordmark
      // standing in for the logo.
      expect(within(card).getByTestId(`logo-missing-${c.key}`)).toBeInTheDocument();
      expect(within(card).getByText("Logo pending")).toBeInTheDocument();
      expect(within(card).queryByRole("img")).toBeNull();
    }
  });

  it("treats a hand-drawn wordmark as unauthorized rather than usable", () => {
    // Two approximation SVGs exist in public/marketplace-logos. They are Arial
    // text shaped to resemble a trademark, so they must not render.
    const approximations = CHANNEL_ASSETS.filter((a) => a.authorization === "unauthorized_approximation");
    expect(approximations.length).toBeGreaterThan(0);
    for (const a of approximations) {
      expect(isRenderable(a)).toBe(false);
      expect(a.note).toBeTruthy();
    }
  });

  it("reports every asset an operator still has to obtain", () => {
    const pending = missingAssets();
    expect(pending.length).toBeGreaterThan(0);
    // The dealer-website icon is AutoLabels' own, so it is never a blocker.
    expect(pending.some((a) => a.channel === "dealer_website")).toBe(false);
    for (const a of pending) expect(a.note).toBeTruthy();
  });

  it("normalizes every logo into one viewport without distorting it", () => {
    const wide = { ...assetFor("cargurus")!, src: "/x.svg", authorization: "authorized" as const,
                   intrinsicWidth: 400, intrinsicHeight: 60, opticalScale: 1 };
    const square = { ...assetFor("facebook")!, src: "/y.svg", authorization: "authorized" as const,
                     intrinsicWidth: 100, intrinsicHeight: 100, opticalScale: 1 };
    const wideBox = logoBox(wide);
    const squareBox = logoBox(square);
    // Contained on both axes.
    for (const b of [wideBox, squareBox]) {
      expect(b.width).toBeLessThanOrEqual(LOGO_VIEWPORT.width);
      expect(b.height).toBeLessThanOrEqual(LOGO_VIEWPORT.height);
    }
    // Aspect ratio preserved to within rounding — never stretched to fill.
    expect(wideBox.width / wideBox.height).toBeCloseTo(400 / 60, 0);
    expect(squareBox.width / squareBox.height).toBeCloseTo(1, 1);
  });

  it("applies optical scale so a compact glyph does not overpower a wordmark", () => {
    const asset = { ...assetFor("facebook")!, src: "/y.svg", authorization: "authorized" as const,
                    intrinsicWidth: 100, intrinsicHeight: 100 };
    const scaled = logoBox(asset);
    const unscaled = logoBox({ ...asset, opticalScale: 1 });
    expect(asset.opticalScale).toBeLessThan(1);
    expect(scaled.height).toBeLessThan(unscaled.height);
  });

  it("renders the AutoLabels-owned dealer website icon rather than a placeholder", () => {
    const { container } = render(<ChannelLogo channel="dealer_website" name="Dealer Website" />);
    expect(container.querySelector('[data-testid="logo-missing-dealer_website"]')).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
