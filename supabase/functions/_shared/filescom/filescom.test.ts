import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertConnectorWrite, authorizePlatformAdmin, canonicalInboundPath, intakeStatus, isSafeDownloadUrl,
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
  it("download URLs: public https only, no IPs, credentials or odd ports", () => {
    expect(isSafeDownloadUrl("https://s3.amazonaws.com/bucket/obj?sig=1")).toBe(true);
    expect(isSafeDownloadUrl("http://s3.amazonaws.com/x")).toBe(false);
    expect(isSafeDownloadUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeDownloadUrl("https://[::1]/x")).toBe(false);
    expect(isSafeDownloadUrl("https://localhost/x")).toBe(false);
    expect(isSafeDownloadUrl("https://user:pw@example.com/x")).toBe(false);
    expect(isSafeDownloadUrl("https://example.com:8443/x")).toBe(false);
    expect(isSafeDownloadUrl("file:///etc/passwd")).toBe(false);
  });
  it("detects an overwrite between the two metadata reads", () => {
    expect(sameVersion({ size: 10, mtime: "a", checksum: "md5:1" }, { size: 10, mtime: "a", checksum: "md5:1" })).toBe(true);
    expect(sameVersion({ size: 10, mtime: "a", checksum: "md5:1" }, { size: 10, mtime: "b", checksum: "md5:1" })).toBe(false);
    expect(sameVersion({ size: 10, mtime: "a", checksum: "md5:1" }, { size: 11, mtime: "a", checksum: "md5:2" })).toBe(false);
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

describe("download path", () => {
  it("streams via file_contents on the allowlisted origin with redirects refused", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/files-inventory-admin/index.ts", "utf8");
    expect(src).toMatch(/file_contents\//);
    expect(src).not.toMatch(/download_uri/);
    expect(src).not.toMatch(/redirect: "manual"|redirect: "follow"/);
  });
});
