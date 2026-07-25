// ──────────────────────────────────────────────────────────────────────
// "Print Complete Vehicle Packet" has to put paper in somebody's hand before it
// stamps printed_at / print_count, because those two columns are the evidence a
// regulator reads as what was posted on the car, and `printed` has no
// mark_printed transition — so a false stamp is permanent. Writing the sheet
// into a window is not printing it: the employee can close the tab and the FTC
// Buyers Guide is left carrying print_count = 1 for paper that never existed,
// with "Reprinting is not available from this screen" forever after.
//
// So the sheet reports back, and the caller reports back to the sheet. Three
// facts each side has to be able to state, and each of them was previously
// collapsed into a different one:
//
//  1. WHICH documents reached the paper. `documents` is the post-allowlist set,
//     carrying each document's id, so the caller stamps that set and not the
//     one it handed in. The stamp loop used to filter the PRE-allowlist list,
//     so a pdf_url the sheet dropped was stamped anyway.
//  2. WHETHER the record was filed. The sheet used to say "Print record filed"
//     the instant the button was clicked — before the caller had written
//     anything, and even when `window.opener` was null so nothing was ever
//     told. It now waits for the caller's acknowledgement and reports what the
//     acknowledgement said.
//  3. WHETHER the employee is still there. `printed` used to resolve only on a
//     postMessage or on win.closed, so a sheet left open in a background tab
//     never settled: the caller's `finally` never ran and every later click
//     answered "A packet release is already in progress" for the rest of the
//     session. It is now bounded and cancellable.
//
// Two deliberate choices about the sheet's shape:
//
//  a. Documents are LINKS, not <iframe>s. Cross-origin PDFs embedded in an
//     iframe are not reliably paginated into the parent's window.print() in
//     Chrome — the likely real output was a stack of blank boxes — and that
//     behaviour cannot be verified without a real browser. Linking each
//     document is the only version that is certainly true.
//  b. Every URL is scheme-checked before it reaches an href. The sheet is
//     written into an about:blank window that INHERITS THE APP ORIGIN, so a
//     `javascript:` or `data:text/html` value in generated_documents.pdf_url
//     would execute in-origin. Escaping markup does not escape a scheme.
// ──────────────────────────────────────────────────────────────────────

export interface PacketPrintDocument {
  /** generated_documents.id — what the caller stamps, so the two sets are one. */
  id: string;
  label: string;
  version: string;
  url: string;
}

export interface PacketPrintVehicle {
  ymm: string;
  vin: string;
  stockNumber: string | null;
}

export type PacketPrintOutcome =
  /** A human confirmed in the sheet that the packet is on paper. */
  | "printed"
  /** The sheet was closed without that confirmation. */
  | "closed"
  /** Left open past the wait window — treated exactly like "closed". */
  | "abandoned"
  /** The caller gave up (the screen unmounted). */
  | "cancelled";

export interface PacketPrintHandle {
  /** The documents that survived the URL allowlist and reached the sheet. */
  documents: PacketPrintDocument[];
  printed: Promise<PacketPrintOutcome>;
  /** Tell the sheet whether the print record was filed, and what to say. */
  acknowledge(result: { ok: boolean; detail?: string }): void;
  /** Stop waiting. Resolves `printed` with "cancelled" if it has not settled. */
  cancel(): void;
}

export type PacketSheetFailure = "window_blocked" | "window_unwritable" | "no_printable_url";

export type PacketPrintResult =
  | { ok: true; handle: PacketPrintHandle }
  | { ok: false; reason: PacketSheetFailure };

export const PACKET_PRINTED_MESSAGE = "autolabels:packet-printed";
export const PACKET_FILED_MESSAGE = "autolabels:packet-filed";

// An employee who walks away from the sheet must not hold the button hostage.
// Long enough to open and print half a dozen PDFs, short enough that the guard
// is not effectively permanent.
export const PACKET_SHEET_TIMEOUT_MS = 30 * 60 * 1000;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Allowlist, not denylist: anything that is not an ordinary web URL is dropped
// rather than rendered as a link. `data:` is rejected outright so that this and
// isSafeCommandHref answer "is this href safe" the same way — the two used to
// disagree about data:application/pdf, which is one fact with two rules.
export function safeDocumentUrl(raw: string): string | null {
  const url = (raw || "").trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
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
  .state { display: none; margin: 12px 0 0; font-size: 13px; font-weight: 600; }
  .state.pending { color: #334155; }
  .state.ok { color: #047857; }
  .state.bad { color: #B91C1C; }
</style></head><body><div class="wrap">
  <h1>${heading}</h1>
  <p class="sub">${sub}</p>
  <ol>${items}</ol>
  <div class="confirm">
    <p>Open and print each document above. Once the packet is on paper, confirm below — that is what files the print record against ${docs.length === 1 ? "this document" : "these documents"}. Closing this tab records nothing.</p>
    <button type="button" id="confirm">The packet printed — file the print record</button>
    <p class="state pending" id="pending">Filing the print record…</p>
    <p class="state ok" id="done">Print record filed. You can close this tab.</p>
    <p class="state bad" id="failed"></p>
  </div>
</div>
<script>
(function () {
  var PRINTED = ${JSON.stringify(PACKET_PRINTED_MESSAGE)};
  var FILED = ${JSON.stringify(PACKET_FILED_MESSAGE)};
  var btn = document.getElementById("confirm");
  var show = function (id, text) {
    var el = document.getElementById(id);
    if (text) el.textContent = text;
    el.style.display = "block";
  };
  var hide = function (id) { document.getElementById(id).style.display = "none"; };
  // The sheet never claims a record was filed on its own say-so: it says so
  // only when AutoLabels answers, and says what went wrong when it cannot ask.
  window.addEventListener("message", function (e) {
    if (e.source !== window.opener) return;
    var d = e.data || {};
    if (d.type !== FILED) return;
    hide("pending");
    if (d.ok) { show("done"); btn.textContent = "Print record filed"; }
    else { show("failed", d.detail || "The print record was not filed. Go back to AutoLabels and try again."); btn.disabled = false; btn.textContent = "The packet printed — file the print record"; }
  });
  btn.addEventListener("click", function () {
    if (!window.opener || window.opener.closed) {
      show("failed", "This tab lost its connection to AutoLabels, so nothing was recorded. Close it and release the packet again.");
      return;
    }
    try { window.opener.postMessage({ type: PRINTED }, window.origin); }
    catch (e) {
      show("failed", "This tab lost its connection to AutoLabels, so nothing was recorded. Close it and release the packet again.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Filing…";
    hide("failed");
    show("pending");
  });
})();
</script></body></html>`;
}

/**
 * Writes the sheet into an already-opened window. The three ways this fails are
 * three different things for the employee to do about it, so they are three
 * different answers rather than one null.
 */
export function openPacketPrintSheet(
  win: Window | null,
  vehicle: PacketPrintVehicle,
  docs: PacketPrintDocument[],
  timeoutMs: number = PACKET_SHEET_TIMEOUT_MS,
): PacketPrintResult {
  if (!win) return { ok: false, reason: "window_blocked" };
  const safe = docs
    .map((d) => ({ ...d, url: safeDocumentUrl(d.url) }))
    .filter((d): d is PacketPrintDocument => !!d.url);
  if (safe.length === 0) return { ok: false, reason: "no_printable_url" };
  try {
    win.document.open();
    win.document.write(renderPacketPrintSheet(vehicle, safe));
    win.document.close();
  } catch {
    return { ok: false, reason: "window_unwritable" };
  }

  let finish: (value: PacketPrintOutcome) => void = () => {};
  const printed = new Promise<PacketPrintOutcome>((resolve) => {
    let settled = false;
    const done = (value: PacketPrintOutcome) => {
      if (settled) return;
      settled = true;
      clearInterval(closedPoll);
      clearTimeout(giveUp);
      if (typeof window !== "undefined") window.removeEventListener("message", onMessage);
      resolve(value);
    };
    finish = done;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== win) return;
      const data = e.data as { type?: string } | null;
      if (data && data.type === PACKET_PRINTED_MESSAGE) done("printed");
    };
    // The employee closing the tab is the honest "no paper" answer; there is no
    // other signal, so it is polled. The timeout covers the tab they neither
    // confirmed nor closed.
    const closedPoll = setInterval(() => { if (win.closed) done("closed"); }, 750);
    const giveUp = setTimeout(() => done("abandoned"), timeoutMs);
    if (typeof window !== "undefined") window.addEventListener("message", onMessage);
    else done("closed");
  });

  return {
    ok: true,
    handle: {
      documents: safe,
      printed,
      acknowledge: (result) => {
        try {
          const target = win as unknown as { postMessage?: (m: unknown, o: string) => void };
          target.postMessage?.(
            { type: PACKET_FILED_MESSAGE, ok: result.ok, detail: result.detail },
            typeof window !== "undefined" ? window.location.origin : "*",
          );
        } catch { /* the sheet is gone; there is nobody to tell */ }
      },
      cancel: () => finish("cancelled"),
    },
  };
}
