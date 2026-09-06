import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminIcon } from "./AdminIcon";
import { ADMIN_ICON_PATHS } from "@/lib/design/adminIconPaths";
import { ADMIN_ASSETS } from "@/lib/design/adminAssets";

// The asset package's two silent-failure rules, enforced in the component so
// no screen has to remember them.

describe("icons render inline, not as file references", () => {
  it("puts the geometry in the document so currentColor can inherit", () => {
    // An <img src="...svg"> cannot inherit colour. If this ever becomes an
    // img, every icon quietly turns the same shade and the currentColor
    // variant was pointless.
    const { container } = render(<AdminIcon id="010A" label="Home" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(svg!.getAttribute("stroke")).toBe("currentColor");
    expect(svg!.innerHTML).toContain("path");
  });

  it("covers every icon in the pack", () => {
    expect(Object.keys(ADMIN_ICON_PATHS)).toHaveLength(118);
  });

  it("renders nothing for an unknown id rather than an empty box", () => {
    const { container } = render(<AdminIcon id="999Z" label="Nope" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("accessibility is not optional", () => {
  it("names an icon that carries meaning", () => {
    render(<AdminIcon id="066A" label="Failed inspection" />);
    expect(screen.getByRole("img", { name: "Failed inspection" })).toBeTruthy();
  });

  it("hides a decorative icon from assistive technology", () => {
    const { container } = render(<AdminIcon id="010A" decorative />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
  });
});

describe("semantic colour is honoured, and overridable", () => {
  it("colours a state icon the way it was drawn", () => {
    // 066A Fail was drawn in #DC2626. Rendering it in body text colour would
    // lose the state the designer encoded.
    expect(ADMIN_ASSETS["066A"].semanticHint).toBe("#DC2626");
    const { container } = render(<AdminIcon id="066A" label="Fail" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("text-[hsl(0_72%_51%)]");
  });

  it("leaves a neutral icon inheriting from its parent", () => {
    expect(ADMIN_ASSETS["010A"].semanticHint).toBeNull();
    const { container } = render(<AdminIcon id="010A" label="Home" />);
    const cls = container.querySelector("svg")!.getAttribute("class") || "";
    expect(cls).not.toMatch(/text-\[hsl/);
  });

  it("lets a caller inherit instead, for the navy rail", () => {
    // On the dark rail every icon takes the rail's colour; a hardcoded green
    // would be unreadable there.
    const { container } = render(<AdminIcon id="054A" label="Verified" inherit />);
    const cls = container.querySelector("svg")!.getAttribute("class") || "";
    expect(cls).not.toMatch(/text-\[hsl/);
  });
});

describe("sizing follows the package guidance", () => {
  it("defaults to a navigation-appropriate size", () => {
    const { container } = render(<AdminIcon id="010A" decorative />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("18");
  });

  it("can be set for a dense table row", () => {
    const { container } = render(<AdminIcon id="010A" decorative size={16} />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("16");
  });
});
