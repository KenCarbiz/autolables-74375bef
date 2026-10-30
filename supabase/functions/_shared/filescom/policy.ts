// Files.com inventory connector: the pure, network-free rules. Shared by the
// notify and admin edge functions and unit-tested under vitest.

export const FILESCOM_ORIGIN = "https://autocurb.files.com";
export const INBOUND_FOLDER = "prod/inventory/vauto/inbound";
export const ALLOWED_ACTIONS = new Set(["create", "update"]);
export const MAX_NOTIFY_BYTES = 16 * 1024;
export const MAX_CSV_BYTES = 25 * 1024 * 1024;

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}_inventory\.csv$/;

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Files.com X-Files-Signature-V2: HMAC-SHA256 over the exact raw POST body,
// keyed with the folder webhook verification token, as 64 lowercase hex chars
// with no prefix. No fallback to any older header.
export async function verifySignatureV2(secret: string | undefined | null, rawBody: Uint8Array, header: string | null): Promise<boolean> {
  if (!secret) return false;
  if (!header || !/^[0-9a-f]{64}$/.test(header)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, rawBody));
  return constantTimeEqual(expected, header);
}

export type PathCheck = { ok: true; path: string; fileName: string } | { ok: false; reason: string };

// Canonical Files.com API path: no leading slash, exactly one file directly
// inside the inbound folder, named *_inventory.csv.
export function canonicalInboundPath(input: unknown): PathCheck {
  if (typeof input !== "string" || input.length === 0 || input.length > 400) return { ok: false, reason: "path_invalid" };
  if (/[\u0000-\u001f\u007f\\%]/.test(input)) return { ok: false, reason: "path_invalid_chars" };
  const path = input.replace(/^\/+/, "");
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return { ok: false, reason: "path_traversal" };
  const folder = segments.slice(0, -1).join("/");
  const fileName = segments[segments.length - 1];
  if (folder !== INBOUND_FOLDER) return { ok: false, reason: "path_outside_inbound" };
  if (!FILE_NAME.test(fileName)) return { ok: false, reason: "path_not_inventory_csv" };
  return { ok: true, path, fileName };
}

export const encodeApiPath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

export type NotifyEvent = { action: string; path: string; destination: string | null; at: string | null; size: number | null };
export type NotifyParse = { ok: true; event: NotifyEvent } | { ok: false; reason: string };

export function parseNotifyBody(raw: Uint8Array): NotifyParse {
  if (raw.byteLength === 0 || raw.byteLength > MAX_NOTIFY_BYTES) return { ok: false, reason: "body_size" };
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return { ok: false, reason: "body_not_json" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "body_not_object" };
  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action.toLowerCase() : "";
  if (!ALLOWED_ACTIONS.has(action)) return { ok: false, reason: "action_not_allowed" };
  if (b.type !== undefined && b.type !== "file") return { ok: false, reason: "type_not_file" };
  const p = canonicalInboundPath(b.path);
  if (!p.ok) return { ok: false, reason: p.reason };
  const at = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : null;
  const sizeNum = typeof b.size === "number" ? b.size : typeof b.size === "string" && /^\d+$/.test(b.size) ? Number(b.size) : null;
  const size = sizeNum !== null && Number.isSafeInteger(sizeNum) && sizeNum >= 0 ? sizeNum : null;
  const destination = typeof b.destination === "string" ? b.destination.slice(0, 400) : null;
  return { ok: true, event: { action, path: p.path, destination, at, size } };
}

export type RemoteMeta = { size: number | null; mtime: string | null; checksum: string | null; sha256: string | null };

export function remoteMeta(obj: unknown): RemoteMeta {
  const o = (obj ?? {}) as Record<string, unknown>;
  const size = typeof o.size === "number" ? o.size : null;
  const mtime = typeof o.mtime === "string" ? o.mtime : null;
  const sha256 = typeof o.sha256 === "string" && /^[0-9a-f]{64}$/i.test(o.sha256) ? o.sha256.toLowerCase() : null;
  const checksum = sha256 ? `sha256:${sha256}` : typeof o.md5 === "string" && o.md5 ? `md5:${o.md5}` : typeof o.crc32 === "string" && o.crc32 ? `crc32:${o.crc32}` : null;
  return { size, mtime, checksum, sha256 };
}

// Fails closed: a version without size and mtime cannot be pinned.
export const hasVersion = (m: RemoteMeta): boolean => m.size !== null && m.mtime !== null;
export const sameVersion = (a: RemoteMeta, b: RemoteMeta): boolean =>
  hasVersion(a) && hasVersion(b) && a.size === b.size && a.mtime === b.mtime && a.checksum === b.checksum;

export type ContentCheck = { ok: true } | { ok: false; reason: string };
export function checkDownloadedContent(before: RemoteMeta, after: RemoteMeta, byteLength: number, sha: string): ContentCheck {
  if (!hasVersion(before) || !hasVersion(after)) return { ok: false, reason: "remote_version_unavailable" };
  if (!sameVersion(before, after)) return { ok: false, reason: "file_changed_during_download" };
  if (before.size !== byteLength) return { ok: false, reason: "size_mismatch" };
  if (before.sha256 && before.sha256 !== sha) return { ok: false, reason: "sha256_mismatch" };
  return { ok: true };
}

export const fileContentsUrl = (path: string): string => `${FILESCOM_ORIGIN}/api/rest/v1/file_contents/${encodeApiPath(path)}`;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
// Single-stream download from the fixed origin only. Redirects are refused so
// the API key is never presented to another host.
export async function downloadFileContents(fetchFn: Fetch, key: string, path: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchFn(fileContentsUrl(path), { headers: { "X-FilesAPI-Key": key }, redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new Error("download_refused_or_timeout");
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Error(res.status === 401 || res.status === 403 ? "filescom_auth_failed" : "download_failed");
  }
  if (Number(res.headers.get("content-length") ?? "0") > MAX_CSV_BYTES) { await res.body?.cancel(); throw new Error("file_too_large"); }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CSV_BYTES) { await reader.cancel(); throw new Error("file_too_large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

export type ApprovalBinding = { id: string; status: BindingStatus; tenant_id: string | null; proposed_at: string | null };
export type ApprovalRun = { id: string; status: string; binding_id: string | null; tenant_id: string | null; content_sha256: string | null; remote_size: number | null; remote_mtime: string | null; report: unknown } | null;
export type ApprovalFile = { last_run_id: string | null; last_content_sha256: string | null; remote_size: number | null; remote_mtime: string | null } | null;
export type ApprovalDecision = { ok: true; review: unknown; acknowledged: boolean } | { ok: false; error: string };

// Approval is allowed only on a passed dry run of the current file version,
// against this exact proposal (id, tenant, proposed_at).
export function approvalDecision(b: ApprovalBinding | null, run: ApprovalRun, file: ApprovalFile, acknowledge: unknown): ApprovalDecision {
  if (!b || b.status !== "pending" || !b.tenant_id || !b.proposed_at) return { ok: false, error: "no_pending_binding" };
  if (!run || run.binding_id !== b.id || run.tenant_id !== b.tenant_id) return { ok: false, error: "dry_run_against_proposed_dealer_required" };
  const rep = (run.report ?? null) as { outcome?: unknown; identity?: unknown; identities?: unknown; bindingProposedAt?: unknown; identityReview?: { verdict?: unknown } | null } | null;
  if (run.status !== "passed" || !rep || rep.outcome !== "passed") return { ok: false, error: "dry_run_not_passed" };
  if (!rep.identity || rep.identities !== 1) return { ok: false, error: "dealer_identity_not_single" };
  if (rep.bindingProposedAt !== b.proposed_at) return { ok: false, error: "proposal_changed_since_dry_run" };
  if (!file || file.last_run_id !== run.id || !run.content_sha256 || file.last_content_sha256 !== run.content_sha256) return { ok: false, error: "file_changed_since_dry_run" };
  if (run.remote_size === null || run.remote_mtime === null || file.remote_size !== run.remote_size || file.remote_mtime !== run.remote_mtime) return { ok: false, error: "file_changed_since_dry_run" };
  const match = rep.identityReview?.verdict === "match";
  if (!match && acknowledge !== true) return { ok: false, error: "identity_not_confirmed" };
  return { ok: true, review: rep.identityReview ?? null, acknowledged: !match };
}

export type BindingStatus = "pending" | "approved" | "disabled" | null;

export function intakeStatus(binding: BindingStatus): { status: "pending" | "quarantined"; reason: string | null } {
  if (binding === "approved") return { status: "pending", reason: null };
  if (binding === null) return { status: "quarantined", reason: "unmapped" };
  return { status: "quarantined", reason: `binding_${binding}` };
}

// A tenant-level admin role is not platform authority. Only the global
// has_role(uid,'admin') answer, read server-side, admits the caller.
export function authorizePlatformAdmin(input: { userId: string | null; hasPlatformRole: boolean | null }): { ok: true } | { ok: false; status: 401 | 403 } {
  if (!input.userId) return { ok: false, status: 401 };
  if (input.hasPlatformRole !== true) return { ok: false, status: 403 };
  return { ok: true };
}

// Phase 1 writes only connector tables. Anything else is a programming error.
export const CONNECTOR_TABLES = new Set(["inventory_feed_bindings", "inventory_feed_files", "inventory_feed_events", "inventory_feed_runs"]);
export function assertConnectorWrite(table: string): void {
  if (!CONNECTOR_TABLES.has(table)) throw new Error(`write_forbidden:${table}`);
}
