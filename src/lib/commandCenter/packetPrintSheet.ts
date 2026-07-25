// ──────────────────────────────────────────────────────────────────────
// "Print Complete Vehicle Packet" has to put paper in somebody's hand before it
// stamps printed_at / print_count, because those two columns are the evidence a
// regulator reads as what was posted on the car. Stamping them with no print
// step at all filed that evidence for paper that never existed — and because
// `printed` has no mark_printed transition, the release is one-shot, so the
// employee could never go back and actually print it.
//
// There is no server-side paper queue in this project (zebra_print_jobs is a ZPL
// label queue, not a letter printer), so the honest handoff is the one the rest
// of the app already uses: open the documents in the browser and let its print
// path take them. This module builds that sheet. The caller opens the window
// inside the click, before any await, so the browser still counts it as user
// activation, and stamps the lifecycle ONLY if the handoff succeeded.
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

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderPacketPrintSheet(
  vehicle: PacketPrintVehicle,
  docs: PacketPrintDocument[],
): string {
  const heading = esc(vehicle.ymm || vehicle.vin || "Vehicle packet");
  const sub = [vehicle.stockNumber ? `Stock ${vehicle.stockNumber}` : "", vehicle.vin ? `VIN ${vehicle.vin}` : ""]
    .filter(Boolean).map(esc).join(" · ");
  const items = docs.map((d, i) => `
      <section class="doc">
        <header>
          <h2>${i + 1}. ${esc(d.label)} <span class="ver">${esc(d.version)}</span></h2>
          <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a>
        </header>
        <iframe src="${esc(d.url)}" title="${esc(d.label)}" loading="lazy"></iframe>
      </section>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vehicle packet — ${heading}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: Inter, system-ui, Arial, sans-serif; color: #0F172A; background: #F8FAFC; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748B; font-size: 13px; margin: 0 0 16px; }
  .bar { position: sticky; top: 0; background: #F8FAFC; padding: 12px 0; border-bottom: 1px solid #E2E8F0; margin-bottom: 16px; }
  button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 12px; background: #2563EB; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  .note { color: #64748B; font-size: 12px; margin: 8px 0 0; }
  .doc { background: #fff; border: 1px solid #E2E8F0; border-radius: 16px; padding: 12px; margin-bottom: 16px; }
  .doc header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  h2 { font-size: 14px; margin: 0; }
  .ver { color: #64748B; font-weight: 500; }
  a { color: #2563EB; font-size: 13px; }
  iframe { width: 100%; height: 720px; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff; }
  @media print {
    body { background: #fff; }
    .bar, .note, .doc header a { display: none; }
    .doc { border: 0; padding: 0; break-after: page; }
    iframe { border: 0; height: auto; min-height: 90vh; }
  }
</style></head><body><div class="wrap">
  <h1>${heading}</h1>
  <p class="sub">${sub}</p>
  <div class="bar">
    <button type="button" onclick="window.print()">Print this packet</button>
    <p class="note">${docs.length} document${docs.length === 1 ? "" : "s"}. If a document does not render below, open it in its own tab and print it from there.</p>
  </div>
  ${items}
</div></body></html>`;
}

/**
 * Writes the sheet into an already-opened window. Returns false when the window
 * was blocked or unusable, which is the caller's signal to stamp nothing.
 */
export function openPacketPrintSheet(
  win: Window | null,
  vehicle: PacketPrintVehicle,
  docs: PacketPrintDocument[],
): boolean {
  if (!win || docs.length === 0) return false;
  try {
    win.document.open();
    win.document.write(renderPacketPrintSheet(vehicle, docs));
    win.document.close();
    return true;
  } catch {
    return false;
  }
}
