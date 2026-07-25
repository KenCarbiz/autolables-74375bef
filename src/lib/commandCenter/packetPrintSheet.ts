// ──────────────────────────────────────────────────────────────────────
// "Print Complete Vehicle Packet" has to put paper in somebody's hand before it
// stamps printed_at / print_count, because those two columns are the evidence a
// regulator reads as what was posted on the car, and `printed` has no
// mark_printed transition — so a false stamp is permanent. Writing the sheet
// into a window is not printing it: the employee can close the tab and the FTC
// Buyers Guide is left carrying print_count = 1 for paper that never existed,
// with "Reprinting is not available from this screen" forever after.
//
// So the sheet reports back. It posts a message to its opener only when a human
// says the packet printed, and the caller stamps nothing until that arrives.
// If the window is closed instead, `printed` resolves false and nothing moves.
//
// Two deliberate choices about the sheet's shape:
//
//  1. Documents are LINKS, not <iframe>s. Cross-origin PDFs embedded in an
//     iframe are not reliably paginated into the parent's window.print() in
//     Chrome — the likely real output was a stack of blank boxes — and that
//     behaviour cannot be verified without a real browser. Linking each
//     document is the only version that is certainly true.
//  2. Every URL is scheme-checked before it reaches an href. The sheet is
//     written into an about:blank window that INHERITS THE APP ORIGIN, so a
//     `javascript:` or `data:text/html` value in generated_documents.pdf_url
//     would execute in-origin. Escaping markup does not escape a scheme.
// ──────────────────────────────────────────────────────────────────────

export interface PacketPrintDocument {
  label: string;
  version: string;
  url: string;
}

export interface PacketPrintVehicle {
  ymm: string;
  vin: string;
  stockNumber: string | null;
}

export interface PacketPrintHandle {
  /** The documents that survived the URL allowlist and reached the sheet. */
  documents: PacketPrintDocument[];
  /**
   * Resolves true once a human confirms in the sheet that the packet printed,
   * false when the window is closed without that confirmation. The caller
   * stamps printed_at / print_count only on true.
   */
  printed: Promise<boolean>;
}

export const PACKET_PRINTED_MESSAGE = "autolabels:packet-printed";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Allowlist, not denylist: anything that is not an ordinary web URL or an inline
// PDF/image is dropped rather than rendered as a link.
export function safeDocumentUrl(raw: string): string | null {
  const url = (raw || "").trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:(image\/[a-z0-9.+-]+|application\/pdf)[;,]/i.test(url)) return url;
  return null;
}

export function renderPacketPrintSheet(
  vehicle: PacketPrintVehicle,
  docs: PacketPrintDocument[],
): string {
  const heading = esc(vehicle.ymm || vehicle.vin || "Vehicle packet");
  const sub = [vehicle.stockNumber ? `Stock ${vehicle.stockNumber}` : "", vehicle.vin ? `VIN ${vehicle.vin}` : ""]
    .filter(Boolean).map(esc).join(" · ");
  const items = docs.map((d, i) => `
      <li class="doc">
        <span class="n">${i + 1}</span>
        <span class="meta"><span class="name">${esc(d.label)}</span> <span class="ver">${esc(d.version)}</span></span>
        <a class="open" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open &amp; print</a>
      </li>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vehicle packet — ${heading}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: Inter, system-ui, Arial, sans-serif; color: #0F172A; background: #F8FAFC; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748B; font-size: 13px; margin: 0 0 20px; }
  ol { list-style: none; margin: 0 0 24px; padding: 0; }
  .doc { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 12px 14px; margin-bottom: 10px; }
  .n { width: 26px; height: 26px; border-radius: 999px; background: #EFF6FF; color: #2563EB; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none; }
  .meta { flex: 1; min-width: 0; font-size: 14px; }
  .name { font-weight: 600; }
  .ver { color: #64748B; font-weight: 500; }
  .open { color: #2563EB; font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap; }
  .confirm { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 16px; }
  .confirm p { margin: 0 0 12px; font-size: 13px; color: #334155; }
  button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 12px; background: #2563EB; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button[disabled] { background: #94A3B8; cursor: default; }
  .done { display: none; margin: 12px 0 0; font-size: 13px; color: #047857; font-weight: 600; }
</style></head><body><div class="wrap">
  <h1>${heading}</h1>
  <p class="sub">${sub}</p>
  <ol>${items}</ol>
  <div class="confirm">
    <p>Open and print each document above. Once the packet is on paper, confirm below — that is what files the print record against ${docs.length === 1 ? "this document" : "these documents"}. Closing this tab records nothing.</p>
    <button type="button" id="confirm">The packet printed — file the print record</button>
    <p class="done" id="done">Print record filed. You can close this tab.</p>
  </div>
</div>
<script>
(function () {
  var btn = document.getElementById("confirm");
  btn.addEventListener("click", function () {
    try { window.opener && window.opener.postMessage({ type: ${JSON.stringify(PACKET_PRINTED_MESSAGE)} }, window.origin); } catch (e) {}
    btn.disabled = true;
    btn.textContent = "Print record filed";
    document.getElementById("done").style.display = "block";
  });
})();
</script></body></html>`;
}

/**
 * Writes the sheet into an already-opened window. Returns null when the window
 * was blocked or unusable, or when no document survived the URL allowlist —
 * either way the caller's signal to stamp nothing.
 */
export function openPacketPrintSheet(
  win: Window | null,
  vehicle: PacketPrintVehicle,
  docs: PacketPrintDocument[],
): PacketPrintHandle | null {
  if (!win) return null;
  const safe = docs
    .map((d) => ({ ...d, url: safeDocumentUrl(d.url) }))
    .filter((d): d is PacketPrintDocument => !!d.url);
  if (safe.length === 0) return null;
  try {
    win.document.open();
    win.document.write(renderPacketPrintSheet(vehicle, safe));
    win.document.close();
  } catch {
    return null;
  }

  const printed = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(closedPoll);
      if (typeof window !== "undefined") window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== win) return;
      const data = e.data as { type?: string } | null;
      if (data && data.type === PACKET_PRINTED_MESSAGE) finish(true);
    };
    // The employee closing the tab is the honest "no paper" answer; there is no
    // other signal, so it is polled rather than waited on indefinitely.
    const closedPoll = setInterval(() => { if (win.closed) finish(false); }, 750);
    if (typeof window !== "undefined") window.addEventListener("message", onMessage);
    else finish(false);
  });

  return { documents: safe, printed };
}
