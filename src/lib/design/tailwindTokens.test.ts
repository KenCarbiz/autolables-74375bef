import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import resolveConfig from "tailwindcss/resolveConfig";
import cfg from "../../../tailwind.config";

// tailwind.config.ts had THREE keys declared twice in one object literal:
// fontSize, transitionDuration and transitionTimingFunction. A duplicate key
// in an object literal silently discards the earlier block, so the entire al-*
// type scale and the whole motion ladder never reached Tailwind. `text-al-page`
// and `duration-press` produced no styles at all.
//
// That is why adding a design system changed nothing on screen: it compiled,
// it was tested at the CSS-variable level, and Tailwind threw half of it away.
// Nothing in the build reports this — it is valid JavaScript.

const theme = resolveConfig(cfg as never).theme as Record<string, Record<string, unknown>>;

describe("the design tokens survive into Tailwind", () => {
  it("keeps the al-* type scale", () => {
    for (const k of ["al-page", "al-section", "al-card", "al-body", "al-button", "al-meta"]) {
      expect(theme.fontSize, `missing text-${k}`).toHaveProperty(k);
    }
  });

  it("keeps the Wave 2 display scale that collided with it", () => {
    // The merge has to preserve BOTH sides, not pick a winner.
    for (const k of ["display-xl", "display", "headline", "title", "body-sm", "caption"]) {
      expect(theme.fontSize, `missing text-${k}`).toHaveProperty(k);
    }
  });

  it("keeps the motion ladder", () => {
    for (const k of ["press", "hover", "select", "expand", "enter", "exit"]) {
      expect(theme.transitionDuration, `missing duration-${k}`).toHaveProperty(k);
    }
    for (const k of ["120", "200", "320", "480"]) {
      expect(theme.transitionDuration, `missing duration-${k}`).toHaveProperty(k);
    }
  });

  it("keeps the easing ladder", () => {
    for (const k of ["press", "standard", "enter", "exit"]) {
      expect(theme.transitionTimingFunction, `missing ease-${k}`).toHaveProperty(k);
    }
    for (const k of ["out-expo", "in-fast", "spring"]) {
      expect(theme.transitionTimingFunction, `missing ease-${k}`).toHaveProperty(k);
    }
  });

  it("binds the type scale to weight and line-height, not size alone", () => {
    // A heading used at the wrong weight is the failure the scale exists to
    // prevent, so each entry must carry its own metrics.
    const page = theme.fontSize["al-page"] as [string, Record<string, string>];
    expect(page[0]).toBe("32px");
    expect(page[1].fontWeight).toBe("700");
    expect(page[1].lineHeight).toBe("38px");
  });

  it("declares no key twice in extend", () => {
    // The root cause, guarded directly: any future duplicate silently deletes
    // whichever block comes first.
    const src = readFileSync(join(__dirname, "../../../tailwind.config.ts"), "utf8");
    const body = src.slice(src.indexOf("extend:"));
    const seen = new Map<string, number>();
    let depth = 0, base = -1;
    for (let i = body.indexOf("{"); i < body.length; i++) {
      const c = body[i];
      if (c === "{") { depth++; if (base < 0) base = depth; }
      else if (c === "}") { depth--; if (depth < base) break; }
      else if (depth === base && /[\s,{]/.test(body[i - 1] ?? "")) {
        // Anchored on the identifier itself. Allowing leading whitespace in
        // the match counts the same key once per space in front of it, which
        // reports every key as a duplicate and would make this guard useless.
        const m = /^"?([A-Za-z][\w-]*)"?\s*:/.exec(body.slice(i, i + 40));
        if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
      }
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes).toEqual([]);
  });
});
