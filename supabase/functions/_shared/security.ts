// Shared server-side origin allowlist, redirect validation, and SSRF DNS guards.

const BASE_ALLOWED_ORIGINS = [
  "https://autolabels.io",
  "https://www.autolabels.io",
  "https://app.autolabels.io",
  "https://autolables.lovable.app",
  "https://autosticker.io",
  "https://www.autosticker.io",
  "https://marketpass.io",
  "https://www.marketpass.io",
  "https://autocurb.io",
  "https://www.autocurb.io",
  "https://app.autocurb.io",
  "https://id-preview--1a2a5abf-4218-480d-aac9-d7bd0d3cfb73.lovable.app",
];

export function getAllowedOrigins(): Set<string> {
  const set = new Set<string>(BASE_ALLOWED_ORIGINS);
  const envBase = (Deno.env.get("APP_BASE_URL") || "").trim();
  if (envBase) {
    try {
      const u = new URL(envBase);
      if (u.protocol === "https:") set.add(u.origin.toLowerCase());
    } catch { /* ignore invalid env */ }
  }
  return set;
}

export function resolveAllowedOrigin(
  candidates: Array<string | null | undefined>,
  fallback = "https://autolabels.io",
): string {
  const allowed = getAllowedOrigins();
  for (const raw of candidates) {
    if (!raw || typeof raw !== "string") continue;
    try {
      const u = new URL(raw.trim());
      if (u.protocol !== "https:") continue;
      const origin = u.origin.toLowerCase();
      if (allowed.has(origin)) return origin;
    } catch { /* skip */ }
  }
  return fallback;
}

export function isAllowedRedirectUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    return getAllowedOrigins().has(u.origin.toLowerCase());
  } catch {
    return false;
  }
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!clean) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
    const p = clean.split(".").map((n) => Number(n));
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (clean.includes(":")) {
    if (clean === "::" || clean === "::1") return true;
    if (clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd") || clean.startsWith("ff")) return true;
    const v4Mapped = clean.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (v4Mapped) return isPrivateOrReservedIp(v4Mapped[1]);
    return false;
  }
  return true;
}

export function normalizeDomainHost(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || !host.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function hostMatchesAllowedDomains(hostname: string, allowedDomains: Set<string>): boolean {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  if (!h || allowedDomains.size === 0) return false;
  for (const domain of allowedDomains) {
    if (h === domain || h.endsWith(`.${domain}`)) return true;
  }
  return false;
}

export async function assertSafePublicUrl(
  raw: string,
  allowedDomains: Set<string>,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "unsupported protocol" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials in URL not allowed" };
  }
  if (u.port && u.port !== "80" && u.port !== "443") {
    return { ok: false, reason: "non-standard port not allowed" };
  }
  const host = u.hostname.toLowerCase();
  if (!host || !host.includes(".") || isPrivateOrReservedIp(host)) {
    return { ok: false, reason: "blocked host" };
  }
  if (!hostMatchesAllowedDomains(host, allowedDomains)) {
    return { ok: false, reason: "host is not an authorized dealership domain" };
  }
  let resolvedAny = false;
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const addrs = await Deno.resolveDns(host, recordType);
      for (const ip of addrs) {
        resolvedAny = true;
        if (isPrivateOrReservedIp(ip)) {
          return { ok: false, reason: "host resolves to a private or reserved IP" };
        }
      }
    } catch {
      // Record type absent; check the other type.
    }
  }
  if (!resolvedAny) {
    return { ok: false, reason: "host could not be resolved" };
  }
  return { ok: true, url: u };
}