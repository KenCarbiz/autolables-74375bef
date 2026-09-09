import { describe, it, expect, vi } from "vitest";
import {
  EVIDENCE_UNAVAILABLE_MESSAGE,
  PRICE_EVIDENCE_BUCKET,
  PRICE_EVIDENCE_TTL_SECONDS,
  normalizeEvidencePath,
  signPriceEvidenceUrl,
  type EvidenceStorageClient,
} from "./priceEvidenceUrl";

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PATH = `${TENANT}/JN8AZ2NE0P9300001/1750000000000.png`;

interface FakeCall { bucket: string; path: string; ttl: number }

const fakeClient = (
  respond: (call: FakeCall) => { data: { signedUrl: string } | null; error: { message?: string } | null } | Error,
) => {
  const calls: FakeCall[] = [];
  const client: EvidenceStorageClient = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          const call = { bucket, path, ttl };
          calls.push(call);
          const r = respond(call);
          if (r instanceof Error) throw r;
          return r;
        },
      }),
    },
  };
  return { client, calls };
};

const ok = (call: FakeCall) => ({
  data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/${call.bucket}/${call.path}?token=abc` },
  error: null,
});

describe("signPriceEvidenceUrl", () => {
  it("mints a signed URL for the row's bucket and path with the default TTL", async () => {
    const { client, calls } = fakeClient(ok);
    const res = await signPriceEvidenceUrl(client, { screenshot_url: PATH, screenshot_bucket: "price-evidence" });
    expect(res.reason).toBe("signed");
    expect(res.url).toContain(`/price-evidence/${PATH}?token=`);
    expect(calls).toEqual([{ bucket: "price-evidence", path: PATH, ttl: PRICE_EVIDENCE_TTL_SECONDS }]);
    expect(PRICE_EVIDENCE_TTL_SECONDS).toBe(600);
  });

  it("honours an explicit TTL", async () => {
    const { client, calls } = fakeClient(ok);
    await signPriceEvidenceUrl(client, { screenshot_url: PATH }, { ttlSeconds: 60 });
    expect(calls[0].ttl).toBe(60);
  });

  it("defaults a legacy row with screenshot_bucket null to price-evidence", async () => {
    const { client, calls } = fakeClient(ok);
    await signPriceEvidenceUrl(client, { screenshot_url: PATH, screenshot_bucket: null });
    expect(calls[0].bucket).toBe(PRICE_EVIDENCE_BUCKET);
    const { client: c2, calls: calls2 } = fakeClient(ok);
    await signPriceEvidenceUrl(c2, { screenshot_url: PATH });
    expect(calls2[0].bucket).toBe("price-evidence");
  });

  it("uses a non-default bucket when the row names one", async () => {
    const { client, calls } = fakeClient(ok);
    await signPriceEvidenceUrl(client, { screenshot_url: PATH, screenshot_bucket: "price-evidence-archive" });
    expect(calls[0].bucket).toBe("price-evidence-archive");
  });

  it("strips a leading slash before signing", async () => {
    const { client, calls } = fakeClient(ok);
    await signPriceEvidenceUrl(client, { screenshot_url: `/${PATH}` });
    expect(calls[0].path).toBe(PATH);
    expect(normalizeEvidencePath(`///${PATH}`)).toBe(PATH);
  });

  it("passes an absolute URL through without touching storage", async () => {
    const { client, calls } = fakeClient(ok);
    const abs = "https://cdn.example.com/evidence/shot.png";
    const res = await signPriceEvidenceUrl(client, { screenshot_url: abs });
    expect(res).toEqual({ url: abs, reason: "already_url" });
    expect(calls).toHaveLength(0);
  });

  it("returns no_evidence for empty, blank, null and undefined paths", async () => {
    const { client, calls } = fakeClient(ok);
    for (const v of ["", "   ", null, undefined]) {
      expect(await signPriceEvidenceUrl(client, { screenshot_url: v })).toEqual({ url: null, reason: "no_evidence" });
    }
    expect(calls).toHaveLength(0);
  });

  it("collapses a storage error to denied_or_missing without revealing existence", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "Object not found" } }));
    const res = await signPriceEvidenceUrl(client, { screenshot_url: PATH });
    expect(res.url).toBeNull();
    expect(res.reason).toBe("denied_or_missing");
    expect(res.message).toBe(EVIDENCE_UNAVAILABLE_MESSAGE);
    expect(res.message).not.toMatch(/not found|exist|denied|forbidden|unauthori[sz]ed|permission/i);
  });

  it("returns the same shape whether the object is missing or merely hidden by RLS", async () => {
    const missing = await signPriceEvidenceUrl(
      fakeClient(() => ({ data: null, error: { message: "Object not found" } })).client,
      { screenshot_url: PATH },
    );
    const denied = await signPriceEvidenceUrl(
      fakeClient(() => ({ data: null, error: { message: "new row violates row-level security policy" } })).client,
      { screenshot_url: PATH },
    );
    expect(missing).toEqual(denied);
  });

  it("never throws when the client itself throws", async () => {
    const { client } = fakeClient(() => new Error("network down"));
    const res = await signPriceEvidenceUrl(client, { screenshot_url: PATH });
    expect(res).toEqual({ url: null, reason: "denied_or_missing", message: EVIDENCE_UNAVAILABLE_MESSAGE });
  });

  it("treats a success with no signedUrl as unavailable", async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    const res = await signPriceEvidenceUrl(client, { screenshot_url: PATH });
    expect(res.reason).toBe("denied_or_missing");
  });

  it("re-mints on every call so an expired link is never reused", async () => {
    const respond = vi.fn(ok);
    const { client, calls } = fakeClient(respond);
    const row = { screenshot_url: PATH };
    await signPriceEvidenceUrl(client, row);
    await signPriceEvidenceUrl(client, row);
    expect(respond).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
  });
});
