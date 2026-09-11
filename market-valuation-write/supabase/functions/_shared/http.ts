// ──────────────────────────────────────────────────────────────────────
// Shared HTTP helpers for edge functions.
//
// Consolidates the CORS policy, OPTIONS preflight, and JSON response builder
// that were copy-pasted across functions, so a CORS or response-shape change
// happens in exactly one place. The header allow-list is a superset of what
// individual functions declared (adds the cron header + methods); supersets
// are safe for browsers and server-to-server callers alike.
// ──────────────────────────────────────────────────────────────────────

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Returns a 204 preflight response for OPTIONS, otherwise null so the caller
// continues. Usage: `const pf = preflight(req); if (pf) return pf;`
export const preflight = (req: Request): Response | null =>
  req.method === "OPTIONS" ? new Response(null, { headers: cors }) : null;

export const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });

// Escape a value for safe interpolation into an HTML email/body. Dealer- and
// vehicle-supplied strings (names, YMM, free-text instructions, line items) must
// pass through this before landing in a template literal, or markup in that data
// is injected into the rendered email. Any value is accepted; null/undefined → "".
export const htmlEscape = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
