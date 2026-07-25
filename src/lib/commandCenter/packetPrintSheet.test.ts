import { describe, it, expect } from "vitest";
import {
  openPacketPrintSheet,
  renderPacketPrintSheet,
  safeDocumentUrl,
  PACKET_PRINTED_MESSAGE,
} from "./packetPrintSheet";

const vehicle = { ymm: "2025 INFINITI QX80", vin: "JN8AZ2NE0P9300001", stockNumber: "H12345" };
const docs = [
  { label: "FTC Buyers Guide", version: "v2", url: "https://files.test/bg.pdf" },
  { label: "Used-Car Sticker", version: "v3", url: "https://files.test/win.pdf" },
];

describe("safeDocumentUrl", () => {
  // W6, SECURITY: the sheet is written into an about:blank window that INHERITS
  // THE APP ORIGIN, so a javascript: or data:text/html value in
  // generated_documents.pdf_url would execute in-origin. Escaping markup does
  // not escape a scheme.
  it("allows ordinary web URLs and inline PDFs/images", () => {
    expect(safeDocumentUrl("https://files.test/a.pdf")).toBe("https://files.test/a.pdf");
    expect(safeDocumentUrl("http://files.test/a.png")).toBe("http://files.test/a.png");
    expect(safeDocumentUrl("data:application/pdf;base64,AAAA")).toMatch(/^data:application\/pdf/);
    expect(safeDocumentUrl("data:image/png;base64,AAAA")).toMatch(/^data:image\/png/);
  });

  it("rejects every scheme that can execute in the app origin", () => {
    expect(safeDocumentUrl("javascript:alert(1)")).toBeNull();
    expect(safeDocumentUrl("  JavaScript:alert(1)")).toBeNull();
    expect(safeDocumentUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeDocumentUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeDocumentUrl("")).toBeNull();
  });

  it("rejects relative URLs, which cannot resolve in an about:blank window anyway", () => {
    expect(safeDocumentUrl("/v/2025-qx80")).toBeNull();
  });
});

describe("renderPacketPrintSheet", () => {
  it("puts every document on the sheet with its own open action", () => {
    const html = renderPacketPrintSheet(vehicle, docs);
    expect(html).toContain("FTC Buyers Guide");
    expect(html).toContain("Used-Car Sticker");
    expect(html).toContain("https://files.test/bg.pdf");
    expect(html).toContain("https://files.test/win.pdf");
  });

  // W7: cross-origin PDFs embedded as <iframe> are not reliably paginated into
  // the parent's window.print() in Chrome, and that cannot be verified without a
  // real browser. The sheet links each document instead of asserting a
  // behaviour nobody here can check.
  it("does not depend on iframe pagination", () => {
    expect(renderPacketPrintSheet(vehicle, docs)).not.toContain("<iframe");
  });

  // W4: printed_at / print_count are the evidence a regulator reads. The sheet
  // renders a confirmation a human has to press; opening a window is not paper.
  it("reports back only on an explicit human confirmation", () => {
    const html = renderPacketPrintSheet(vehicle, docs);
    expect(html).toContain(PACKET_PRINTED_MESSAGE);
    expect(html).toContain("postMessage");
    expect(html).toMatch(/Closing this tab records nothing/);
  });

  it("identifies the vehicle the paper belongs to", () => {
    const html = renderPacketPrintSheet(vehicle, docs);
    expect(html).toContain("2025 INFINITI QX80");
    expect(html).toContain("JN8AZ2NE0P9300001");
    expect(html).toContain("Stock H12345");
  });

  it("escapes label text rather than emitting it as markup", () => {
    const html = renderPacketPrintSheet(vehicle, [
      { label: '<img src=x onerror="alert(1)">', version: "v1", url: "https://files.test/a.pdf" },
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("openPacketPrintSheet", () => {
  // MessageEvent.source is a read-only accessor in jsdom, so it is defined onto
  // the event rather than assigned.
  const messageFrom = (source: Window, data: unknown): MessageEvent => {
    const ev = new MessageEvent("message", { data });
    Object.defineProperty(ev, "source", { value: source, configurable: true });
    return ev;
  };

  const fakeWindow = () => {
    const written: string[] = [];
    return {
      written,
      win: {
        closed: false,
        document: { open: () => {}, write: (s: string) => { written.push(s); }, close: () => {} },
      } as unknown as Window,
    };
  };

  it("writes the sheet into the opened window", () => {
    const { win, written } = fakeWindow();
    const handle = openPacketPrintSheet(win, vehicle, docs);
    expect(handle).not.toBeNull();
    expect(written.join("")).toContain("FTC Buyers Guide");
    expect(handle?.documents).toHaveLength(2);
  });

  // A blocked pop-up is the caller's signal to stamp nothing: printed_at and
  // print_count are the evidence of what was posted on the car.
  it("reports failure when the browser blocked the window", () => {
    expect(openPacketPrintSheet(null, vehicle, docs)).toBeNull();
  });

  it("reports failure when there is nothing to print", () => {
    const { win } = fakeWindow();
    expect(openPacketPrintSheet(win, vehicle, [])).toBeNull();
  });

  it("reports failure when every URL fails the scheme allowlist", () => {
    const { win } = fakeWindow();
    expect(openPacketPrintSheet(win, vehicle, [
      { label: "Hostile", version: "v1", url: "javascript:alert(1)" },
    ])).toBeNull();
  });

  it("drops an unsafe document rather than rendering it beside safe ones", () => {
    const { win, written } = fakeWindow();
    const handle = openPacketPrintSheet(win, vehicle, [
      ...docs,
      { label: "Hostile", version: "v1", url: "javascript:alert(1)" },
    ]);
    expect(handle?.documents).toHaveLength(2);
    expect(written.join("")).not.toContain("javascript:alert(1)");
  });

  it("reports failure when the window cannot be written to", () => {
    const hostile = { document: { open: () => { throw new Error("blocked"); } } } as unknown as Window;
    expect(openPacketPrintSheet(hostile, vehicle, docs)).toBeNull();
  });

  it("resolves false when the employee closes the tab without confirming", async () => {
    const { win } = fakeWindow();
    const handle = openPacketPrintSheet(win, vehicle, docs);
    (win as unknown as { closed: boolean }).closed = true;
    await expect(handle?.printed).resolves.toBe(false);
  });

  it("resolves true when the sheet reports the packet printed", async () => {
    const { win } = fakeWindow();
    const handle = openPacketPrintSheet(win, vehicle, docs);
    window.dispatchEvent(messageFrom(win, { type: PACKET_PRINTED_MESSAGE }));
    await expect(handle?.printed).resolves.toBe(true);
  });

  it("ignores a printed message from any other window", async () => {
    const { win } = fakeWindow();
    const handle = openPacketPrintSheet(win, vehicle, docs);
    window.dispatchEvent(messageFrom({} as Window, { type: PACKET_PRINTED_MESSAGE }));
    (win as unknown as { closed: boolean }).closed = true;
    await expect(handle?.printed).resolves.toBe(false);
  });
});
