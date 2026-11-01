import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShowcaseChunkBoundary } from "@/pages/Landing";

// The landing page's addendum showcase is lazily fetched, so its chunk can
// fail to arrive on a stale or half-deployed bundle. That failure must cost the
// showcase box, never the whole page.

const Boom = () => {
  throw new Error("Importing a module script failed.");
};

const Ok = () => <div data-testid="showcase">showcase</div>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShowcaseChunkBoundary", () => {
  it("renders the reserved placeholder instead of throwing when the chunk fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <ShowcaseChunkBoundary>
        <Boom />
      </ShowcaseChunkBoundary>,
    );
    expect(screen.queryByTestId("showcase")).toBeNull();
    expect(container.querySelector("div.bg-slate-50")).not.toBeNull();
  });

  it("renders the showcase untouched when the chunk loads", () => {
    render(
      <ShowcaseChunkBoundary>
        <Ok />
      </ShowcaseChunkBoundary>,
    );
    expect(screen.getByTestId("showcase")).toBeTruthy();
  });
});
