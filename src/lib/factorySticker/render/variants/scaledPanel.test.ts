import { describe, expect, it } from "vitest";
import { Painter, type LayoutPrimitive } from "../layout.ts";
import { paintScaled } from "./scaledPanel.ts";

describe("paintScaled keeps a Passport QR fully backed", () => {
  it("draws the QR's white backing at the QR's own full size and position", () => {
    const p = new Painter([]);
    paintScaled(p, 0.82, 400, 30, (q) => {
      q.rect(0, 0, 500, 300, "#000000");
      q.rect(420, 220, 64.8, 64.8, "#ffffff");
      q.qr(420, 220, 64.8, "https://autolabels.io/v/example", "#000000");
    });
    const prims = p.primitives as LayoutPrimitive[];
    const qr = prims.find((x) => x.kind === "qr");
    const backing = prims.filter((x) => x.kind === "rect" && x.fill === "#ffffff");
    expect(qr && qr.kind === "qr" ? qr.size : 0).toBeCloseTo(64.8);
    expect(backing).toHaveLength(1);
    const b = backing[0];
    if (qr?.kind !== "qr" || b.kind !== "rect") throw new Error("missing");
    expect(b.x).toBeCloseTo(qr.x);
    expect(b.y).toBeCloseTo(qr.y);
    expect(b.w).toBeCloseTo(qr.size);
    expect(b.h).toBeCloseTo(qr.size);
  });
});
