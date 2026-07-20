// ──────────────────────────────────────────────────────────────────────
// Return-to-passport contract.
//
// A Vehicle Passport V3 action (See My Price, Reserve, Trade, Test Drive,
// Contact, Documents, Verification) opens the EXISTING, working V2 destination
// page at /v/:slug/:section — it is not re-implemented as a drawer. So the
// customer can get back to where they started, the V3 CTA carries a validated
// `returnTo` pointing at the originating passport URL (e.g. /v3/:slug, or the
// governed /v/:slug). The destination's "Back to Vehicle Passport" reads it and
// returns there instead of always dropping to /v/:slug.
//
// Only internal passport paths are accepted — never an external or
// protocol-relative URL — so the param can never drive an open redirect.
// ──────────────────────────────────────────────────────────────────────

const PASSPORT_PATH_RE = /^\/v3?\/[A-Za-z0-9._-]+$/; // /v/<slug> or /v3/<slug>

// A returnTo is safe only when it is a root-relative path to a known passport
// surface. Reject anything with a scheme, host, protocol-relative prefix, or
// path traversal.
export function isSafePassportReturnPath(p: string | null | undefined): p is string {
  if (!p || typeof p !== "string") return false;
  if (!p.startsWith("/")) return false;   // must be root-relative
  if (p.startsWith("//")) return false;   // protocol-relative → reject
  if (p.includes("\\") || p.includes("://") || p.includes("..")) return false;
  const path = p.split("?")[0].split("#")[0];
  return PASSPORT_PATH_RE.test(path);
}

// Build the destination URL a V3 CTA navigates to. `originPath` is the current
// passport URL (useLocation().pathname); it is carried as returnTo only when it
// is a safe passport path. Preserves preview mode.
export function buildPassportActionPath(
  slug: string,
  section: string,
  originPath?: string | null,
  preview?: boolean,
): string {
  const params = new URLSearchParams();
  if (isSafePassportReturnPath(originPath)) params.set("returnTo", originPath);
  if (preview) params.set("preview", "1");
  const q = params.toString();
  return `/v/${slug}/${section}${q ? `?${q}` : ""}`;
}

// Build a FORWARD navigation between V2 destination pages (e.g. Reserve → Trade)
// that PRESERVES the originating passport returnTo carried in the current URL, so
// a multi-hop journey (V3 → Reserve → Trade → Back) still returns to the V3
// origin instead of dropping to /v/:slug after the first hop.
export function passportForwardPath(
  slug: string,
  section: string,
  search: string,
  preview: boolean,
): string {
  const rt = new URLSearchParams(search || "").get("returnTo");
  const params = new URLSearchParams();
  if (isSafePassportReturnPath(rt)) params.set("returnTo", rt);
  if (preview) params.set("preview", "1");
  const q = params.toString();
  return `/v/${slug}/${section}${q ? `?${q}` : ""}`;
}

// Resolve where a destination page's "Back to Vehicle Passport" should go.
// Honors a validated returnTo (so a V3-originated visit returns to V3); falls
// back to the canonical /v/:slug. Preserves preview mode in the fallback and,
// when the returnTo carries none, appends it.
export function resolvePassportBack(
  search: string,
  fallbackSlug: string,
  preview: boolean,
): string {
  const rt = new URLSearchParams(search || "").get("returnTo");
  if (isSafePassportReturnPath(rt)) {
    if (preview && !/[?&]preview=1(?:&|$)/.test(rt)) {
      return `${rt}${rt.includes("?") ? "&" : "?"}preview=1`;
    }
    return rt;
  }
  return `/v/${fallbackSlug}${preview ? "?preview=1" : ""}`;
}
