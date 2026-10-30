import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertConnectorWrite, authorizePlatformAdmin, canonicalInboundPath, intakeStatus, approvalDecision, checkDownloadedContent, downloadFileContents, FILESCOM_ORIGIN,
  parseNotifyBody, sameVersion, sha256Hex, verifySignatureV2,
} from "./policy";
import { parseCsv } from "./csv";
import { VAUTO_HEADERS, compareIdentity, parseMoney, runDryRun } from "./dryRun";

const enc = (s: string) => new TextEncoder().encode(s);
const SECRET = "test-verification-token";
const sign = (body: string) => createHmac("sha256", SECRET).update(Buffer.from(body, "utf8")).digest("hex");
const BODY = '{"action":"update","path":"prod/inventory/vauto/inbound/MP15395_inventory.csv","at":"2026-10-30T12:00:00Z","type":"file","size":1234}';

describe("X-Files-Signature-V2", () => {
  it("accepts the HMAC-SHA256 of the exact raw bytes", async () => {
    expect(await verifySignatureV2(SECRET, enc(BODY), sign(BODY))).toBe(true);
  });
  it("rejects when one body byte differs (re-serialised JSON)", async () => {
    const reformatted = JSON.stringify(JSON.parse(BODY), null, 1);
    expect(await verifySignatureV2(SECRET, enc(reformatted), sign(BODY))).toBe(false);
  });
  it("rejects wrong secret, missing, uppercase, prefixed and short signatures", async () => {
    const good = sign(BODY);
    expect(await verifySignatureV2("other", enc(BODY), good)).toBe(false);
    expect(await verifySignatureV2(SECRET, enc(BODY), null)).toBe(false);
    expect(await verifySignatureV2(SECRET, enc(BODY), good.toUpperCase())).toBe(false);
    expect(await verifySignatureV2(SECRET, enc(BODY), `sha256=${good}`)).toBe(false);
    expect(await verifySignatureV2(SECRET, enc(BODY), good.slice(0, 63))).toBe(false);
    expect(await verifySignatureV2("", enc(BODY), good)).toBe(false);
  });
  it("dedup digest is stable for identical bytes and differs for any change", async () => {
    expect(await sha256Hex(enc(BODY))).toBe(await sha256Hex(enc(BODY)));
    expect(await sha256Hex(enc(BODY))).not.toBe(await sha256Hex(enc(BODY + " ")));
  });
});

describe("inbound path and payload policy", () => {
  it("canonicalises a leading slash and accepts the six known files", () => {
    for (const n of ["MP15395", "MP15396", "MP15397", "MP15398", "MP19635", "MP25214"]) {
      const r = canonicalInboundPath(`/prod/inventory/vauto/inbound/${n}_inventory.csv`);
      expect(r).toEqual({ ok: true, path: `prod/inventory/vauto/inbound/${n}_inventory.csv`, fileName: `${n}_inventory.csv` });
    }
  });
  it("rejects traversal, other folders, subfolders, encoded and non-csv paths", () => {
    expect(canonicalInboundPath("prod/inventory/vauto/inbound/../secret/MP1_inventory.csv").ok).toBe(false);
    expect(canonicalInboundPath("prod/inventory/vauto/outbound/MP1_inventory.csv").ok).toBe(false);
    expect(canonicalInboundPath("prod/inventory/vauto/inbound/sub/MP1_inventory.csv").ok).toBe(false);
    expect(canonicalInboundPath("prod/inventory/vauto/inbound/MP1%2F_inventory.csv").ok).toBe(false);
    expect(canonicalInboundPath("prod/inventory/vauto/inbound/MP1_inventory.csv.exe").ok).toBe(false);
    expect(canonicalInboundPath("prod/inventory/vauto/inbound/report.csv").ok).toBe(false);
    expect(canonicalInboundPath("prod//inventory/vauto/inbound/MP1_inventory.csv").ok).toBe(false);
  });
  it("only create and update file actions pass", () => {
    expect(parseNotifyBody(enc(BODY)).ok).toBe(true);
    expect(parseNotifyBody(enc(BODY.replace('"update"', '"delete"')))).toEqual({ ok: false, reason: "action_not_allowed" });
    expect(parseNotifyBody(enc(BODY.replace('"file"', '"directory"')))).toEqual({ ok: false, reason: "type_not_file" });
    expect(parseNotifyBody(enc("x".repeat(17000))).ok).toBe(false);
  });
  it("detects an overwrite between the two metadata reads", () => {
    expect(sameVersion({ size: 10, mtime: "a", checksum: "md5:1", sha256: null }, { size: 10, mtime: "a", checksum: "md5:1", sha256: null })).toBe(true);
    expect(sameVersion({ size: 10, mtime: "a", checksum: "md5:1", sha256: null }, { size: 10, mtime: "b", checksum: "md5:1", sha256: null })).toBe(false);
    expect(sameVersion({ size: 10, mtime: "a", checksum: "md5:1", sha256: null }, { size: 11, mtime: "a", checksum: "md5:2", sha256: null })).toBe(false);
  });
});

describe("authorization and quarantine", () => {
  it("tenant admins without the platform role are denied; signed-out callers get 401", () => {
    expect(authorizePlatformAdmin({ userId: "u1", hasPlatformRole: false })).toEqual({ ok: false, status: 403 });
    expect(authorizePlatformAdmin({ userId: "u1", hasPlatformRole: null })).toEqual({ ok: false, status: 403 });
    expect(authorizePlatformAdmin({ userId: null, hasPlatformRole: true })).toEqual({ ok: false, status: 401 });
    expect(authorizePlatformAdmin({ userId: "u1", hasPlatformRole: true })).toEqual({ ok: true });
  });
  it("unmapped, pending and disabled files are quarantined, never dropped", () => {
    expect(intakeStatus(null)).toEqual({ status: "quarantined", reason: "unmapped" });
    expect(intakeStatus("pending")).toEqual({ status: "quarantined", reason: "binding_pending" });
    expect(intakeStatus("disabled")).toEqual({ status: "quarantined", reason: "binding_disabled" });
    expect(intakeStatus("approved")).toEqual({ status: "pending", reason: null });
  });
  it("phase 1 can only write connector tables", () => {
    expect(() => assertConnectorWrite("vehicle_listings")).toThrow("write_forbidden");
    expect(() => assertConnectorWrite("inventory_sync_runs")).toThrow("write_forbidden");
    expect(() => assertConnectorWrite("inventory_feed_runs")).not.toThrow();
  });
  it("the admin function writes vehicle_listings nowhere and calls no provider other than Files.com", () => {
    const src = readFileSync(resolve(__dirname, "../../files-inventory-admin/index.ts"), "utf8");
    expect(src).not.toMatch(/from\("vehicle_listings"\)\.(insert|update|upsert|delete)/);
    expect(src).not.toMatch(/marketcheck\.com|MARKETCHECK_API|marketcheck-|functions\.invoke/i);
    expect(src).not.toMatch(/x-dms-tenant/i);
    expect([...src.matchAll(/fetch\(/g)].length).toBe(2);
  });
});

describe("RFC 4180 parser", () => {
  it("handles BOM, CRLF, quoted commas, quotes, newlines and blank rows", () => {
    const r = parseCsv('\uFEFFa,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"line1\nline2",\r\n,,\r\n');
    expect(r.ok && r.headers).toEqual(["a", "b", "c"]);
    expect(r.ok && r.rows).toEqual([["1", "x, y", 'say "hi"'], ["2", "line1\nline2", ""]]);
  });
  it("rejects unterminated and stray quotes", () => {
    expect(parseCsv('a\n"open').ok).toBe(false);
    expect(parseCsv('a\nab"c"').ok).toBe(false);
  });
});

const H = [...VAUTO_HEADERS];
const row = (o: Record<string, string>) => H.map((h) => o[h] ?? "");
const ID = { DealerId: "MP15395_inventory", "Dealer Name": "George Harte INFINITI", "Dealer Address": "1 Main St", "Dealer City": "Wallingford", "Dealer Postal Code": "06492", "Dealer Region": "CT" };
const V1 = "JN1BJ1BW5RW123456", V2 = "5N1DL1FS8RC123457";

describe("dry run", () => {
  it("money distinguishes missing from zero", () => {
    expect(parseMoney("")).toEqual({ kind: "missing" });
    expect(parseMoney("0")).toEqual({ kind: "zero" });
    expect(parseMoney("$61,560")).toEqual({ kind: "amount", value: 61560 });
    expect(parseMoney("call").kind).toBe("invalid");
  });
  it("reports additions, price updates and absence candidates without calling them sold", () => {
    const rows = [row({ ...ID, VIN: V1, Price: "61560" }), row({ ...ID, VIN: V2, Price: "" })];
    const r = runDryRun(H, rows, [{ vin: V1, price: 62040 }, { vin: "1N4BL4BV0RN000001", price: 20000 }]);
    expect(r.outcome).toBe("passed");
    expect(r.counts).toMatchObject({ rows: 2, additions: 1, updates: 1, absenceCandidates: 1, priceMissing: 1, priceZero: 0 });
    expect(r.updates[0]).toEqual({ vin: V1, field: "price", from: 62040, to: 61560 });
    expect(r.additions[0].price).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/sold|retire/i);
  });
  it("rejects mixed dealer identity", () => {
    const r = runDryRun(H, [row({ ...ID, VIN: V1 }), row({ ...ID, "Dealer Name": "Other Store", VIN: V2 })], null);
    expect(r.outcome).toBe("rejected");
    expect(r.rejectReasons).toContain("mixed_dealer_identity");
    expect(r.identity).toBeNull();
  });
  it("rejects malformed VINs and conflicting duplicates; identical duplicates only warn", () => {
    const bad = runDryRun(H, [row({ ...ID, VIN: "JN1BJ1BW5RWI23456" }), row({ ...ID, VIN: V1, Price: "1" }), row({ ...ID, VIN: V1, Price: "2" })], null);
    expect(bad.errors.map((e) => e.code)).toEqual(["vin_malformed", "duplicate_vin_conflict"]);
    const same = runDryRun(H, [row({ ...ID, VIN: V1, Price: "1" }), row({ ...ID, VIN: V1, Price: "1" })], null);
    expect(same.outcome).toBe("passed");
    expect(same.counts.duplicateIdentical).toBe(1);
  });
  it("rejects a file missing required headers and gives no absence list when rejected", () => {
    const r = runDryRun(H.filter((h) => h !== "Price"), [], [{ vin: V1, price: 1 }]);
    expect(r.rejectReasons).toEqual(expect.arrayContaining(["missing_required_headers", "no_rows"]));
    expect(r.counts.absenceCandidates).toBeNull();
  });
  it("identity review flags a mismatched postal code and never auto-matches unknown fields", () => {
    const csv = runDryRun(H, [row({ ...ID, VIN: V1 })], null).identity;
    const bad = compareIdentity(csv, { name: "Harte Auto Group", rooftopName: "George Harte INFINITI", street: "1 Main St", postal: "06111", city: null, region: null });
    expect(bad.fields.postal).toBe("mismatch");
    expect(bad.verdict).toBe("mismatch");
    const partial = compareIdentity(csv, { name: "George Harte INFINITI", rooftopName: null, street: null, postal: null, city: null, region: null });
    expect(partial.verdict).toBe("incomplete");
  });
});

const M = (o: Partial<{ size: number | null; mtime: string | null; checksum: string | null; sha256: string | null }> = {}) => ({ size: 3, mtime: "t1", checksum: null, sha256: null, ...o });

describe("version and content checks", () => {
  it("rejects all-null metadata instead of treating it as the same version", () => {
    const n = M({ size: null, mtime: null });
    expect(sameVersion(n, n)).toBe(false);
    expect(checkDownloadedContent(n, n, 3, "x")).toEqual({ ok: false, reason: "remote_version_unavailable" });
  });
  it("rejects an overwrite, a size mismatch and a sha256 mismatch", () => {
    expect(checkDownloadedContent(M(), M({ mtime: "t2" }), 3, "x")).toEqual({ ok: false, reason: "file_changed_during_download" });
    expect(checkDownloadedContent(M(), M(), 4, "x")).toEqual({ ok: false, reason: "size_mismatch" });
    expect(checkDownloadedContent(M({ sha256: "a".repeat(64) }), M({ sha256: "a".repeat(64) }), 3, "b".repeat(64))).toEqual({ ok: false, reason: "sha256_mismatch" });
    expect(checkDownloadedContent(M({ sha256: "a".repeat(64) }), M({ sha256: "a".repeat(64) }), 3, "a".repeat(64))).toEqual({ ok: true });
  });
});

describe("single-stream download", () => {
  const P = "prod/inventory/vauto/inbound/MP15395_inventory.csv";
  it("calls only the fixed origin file_contents URL with redirects refused", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const out = await downloadFileContents(async (url, init) => { calls.push({ url, init }); return new Response("a,b"); }, "k", P);
    expect(new TextDecoder().decode(out)).toBe("a,b");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FILESCOM_ORIGIN}/api/rest/v1/file_contents/${P}`);
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.signal).toBeDefined();
  });
  it("fails closed when the fetch refuses a redirect, and on non-200", async () => {
    await expect(downloadFileContents(async () => { throw new TypeError("redirect"); }, "k", P)).rejects.toThrow("download_refused_or_timeout");
    await expect(downloadFileContents(async () => new Response("", { status: 302 }), "k", P)).rejects.toThrow("download_failed");
    await expect(downloadFileContents(async () => new Response("", { status: 403 }), "k", P)).rejects.toThrow("filescom_auth_failed");
  });
});

describe("binding approval", () => {
  const b = { id: "b1", status: "pending" as const, tenant_id: "t1", proposed_at: "p1" };
  const passed = { outcome: "passed", identity: { dealerId: "x" }, identities: 1, bindingProposedAt: "p1", identityReview: { verdict: "match" } };
  const run = { id: "r1", status: "passed", binding_id: "b1", tenant_id: "t1", content_sha256: "s", remote_size: 3, remote_mtime: "t1", report: passed };
  const file = { last_run_id: "r1", last_content_sha256: "s", remote_size: 3, remote_mtime: "t1" };
  it("approves a passed dry run of the current version for this exact proposal", () => {
    expect(approvalDecision(b, run, file, false)).toMatchObject({ ok: true, acknowledged: false });
  });
  it("refuses rejected or failed runs even with the identity box ticked", () => {
    expect(approvalDecision(b, { ...run, status: "rejected", report: { ...passed, outcome: "rejected" } }, file, true)).toEqual({ ok: false, error: "dry_run_not_passed" });
    expect(approvalDecision(b, { ...run, status: "failed" }, file, true)).toEqual({ ok: false, error: "dry_run_not_passed" });
    expect(approvalDecision(b, { ...run, report: { ...passed, identities: 2 } }, file, true)).toEqual({ ok: false, error: "dealer_identity_not_single" });
  });
  it("refuses a stale proposal, another tenant, or a changed file", () => {
    expect(approvalDecision({ ...b, proposed_at: "p2" }, run, file, true)).toEqual({ ok: false, error: "proposal_changed_since_dry_run" });
    expect(approvalDecision({ ...b, tenant_id: "t2" }, run, file, true)).toEqual({ ok: false, error: "dry_run_against_proposed_dealer_required" });
    expect(approvalDecision(b, run, { ...file, remote_mtime: "t9" }, true)).toEqual({ ok: false, error: "file_changed_since_dry_run" });
    expect(approvalDecision(b, run, { ...file, last_content_sha256: "other" }, true)).toEqual({ ok: false, error: "file_changed_since_dry_run" });
    expect(approvalDecision(b, run, { ...file, last_run_id: "r0" }, true)).toEqual({ ok: false, error: "file_changed_since_dry_run" });
  });
  it("needs explicit acknowledgement when identity does not match", () => {
    const r = { ...run, report: { ...passed, identityReview: { verdict: "mismatch" } } };
    expect(approvalDecision(b, r, file, false)).toEqual({ ok: false, error: "identity_not_confirmed" });
    expect(approvalDecision(b, r, file, true)).toMatchObject({ ok: true, acknowledged: true });
  });
});

describe("admin handler source guards", () => {
  const src = readFileSync(resolve(__dirname, "../../files-inventory-admin/index.ts"), "utf8");
  it("approval CAS pins id, status, tenant and proposed_at, and checks every connector write", () => {
    expect(src).toMatch(/\.eq\("id", b!\.id\)\.eq\("status", "pending"\)\.eq\("tenant_id", b!\.tenant_id!\)\.eq\("proposed_at", b!\.proposed_at!\)/);
    const unchecked = src.split("\n").filter((l) => /^\s*await write\(/.test(l));
    expect(unchecked).toEqual([]);
    expect(src).not.toMatch(/download_uri|redirect: "(manual|follow)"/);
    expect(src).not.toMatch(/from\("vehicle_listings"\)\.(insert|update|upsert|delete)/);
  });
});

describe("mixed dealer identity", () => {
  it("rejects same dealer id and name with a different address", () => {
    const row = (vin: string, addr: string) => VAUTO_HEADERS.map((h) => h === "VIN" ? vin : h === "DealerId" ? "MP1_inventory" : h === "Dealer Name" ? "Harte" : h === "Dealer Address" ? addr : h === "Price" ? "100" : "x");
    const r = runDryRun([...VAUTO_HEADERS], [row("1HGCM82633A004352", "1 A St"), row("1HGCM82633A004353", "2 B St")], null);
    expect(r.outcome).toBe("rejected");
    expect(r.rejectReasons).toContain("mixed_dealer_identity");
  });
});
