import { describe, expect, it } from "vitest";
import {
  isSignedUrlUsable,
  resolveDealerAsset,
  resolvePublicAsset,
  signedUrlExpiryMs,
  SIGNED_URL_TTL_SECONDS,
  type DocumentAssetRow,
} from "./assets";

const row = (over: Partial<DocumentAssetRow> = {}): DocumentAssetRow => ({
  documentId: "doc-1",
  documentVersion: 1,
  documentStatus: "published",
  assetType: "pdf",
  storageBucket: "vehicle-docs",
  storagePath: "t/vehicles/v/factory-stickers/v1/sticker.pdf",
  mimeType: "application/pdf",
  checksum: "abc",
  ...over,
});

// A Supabase signed URL carries its expiry in the token's exp claim.
function signedUrl(expEpochSeconds: number): string {
  const payload = { url: "x", iat: 0, exp: expEpochSeconds };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://x.supabase.co/storage/v1/object/sign/vehicle-docs/a.pdf?token=header.${b64}.sig`;
}

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const DAYS = (n: number) => n * 24 * 60 * 60 * 1000;

describe("public asset resolution", () => {
  it("serves the highest published version", () => {
    const r = resolvePublicAsset(
      [row({ documentId: "d1", documentVersion: 1 }), row({ documentId: "d3", documentVersion: 3 })],
      "pdf",
    );
    expect(r.ok).toBe(true);
    expect(r.row?.documentId).toBe("d3");
  });

  it("never serves a draft or pending-approval version to the public", () => {
    for (const status of ["draft", "pending_approval", "rejected", "archived"]) {
      const r = resolvePublicAsset([row({ documentStatus: status })], "pdf");
      expect(r.ok, status).toBe(false);
      expect(r.row, status).toBeNull();
      expect(r.reason, status).toContain("no published version");
    }
  });

  it("never serves a superseded version even when it is the newest row", () => {
    const r = resolvePublicAsset(
      [
        row({ documentId: "old", documentVersion: 1, documentStatus: "published" }),
        row({ documentId: "new", documentVersion: 2, documentStatus: "superseded" }),
      ],
      "pdf",
    );
    expect(r.row?.documentId).toBe("old");
  });

  it("keeps a published draft-alongside scenario public-safe", () => {
    // Regeneration files v2 as a draft while v1 stays published; the
    // shopper must continue to see v1 and never v2.
    const r = resolvePublicAsset(
      [
        row({ documentId: "v1", documentVersion: 1, documentStatus: "published" }),
        row({ documentId: "v2", documentVersion: 2, documentStatus: "pending_approval" }),
      ],
      "pdf",
    );
    expect(r.ok).toBe(true);
    expect(r.row?.documentId).toBe("v1");
  });

  it("separates pdf and thumbnail assets", () => {
    const rows = [row({ assetType: "pdf" }), row({ assetType: "thumbnail", mimeType: "image/svg+xml" })];
    expect(resolvePublicAsset(rows, "thumbnail").row?.mimeType).toBe("image/svg+xml");
    expect(resolvePublicAsset(rows, "pdf").row?.mimeType).toBe("application/pdf");
  });

  it("reports a missing asset type distinctly from an unpublished document", () => {
    expect(resolvePublicAsset([row({ assetType: "pdf" })], "thumbnail").reason)
      .toContain("no thumbnail asset filed");
  });

  it("refuses a row with no storage coordinates", () => {
    expect(resolvePublicAsset([row({ storagePath: "" })], "pdf").ok).toBe(false);
    expect(resolvePublicAsset([row({ storageBucket: "" })], "pdf").ok).toBe(false);
  });

  it("returns nothing for an unknown vehicle", () => {
    expect(resolvePublicAsset([], "pdf").ok).toBe(false);
  });
});

describe("dealer asset resolution", () => {
  it("reaches drafts an authorized user is allowed to review", () => {
    const r = resolveDealerAsset([row({ documentStatus: "pending_approval" })], "pdf");
    expect(r.ok).toBe(true);
  });

  it("can target one specific prior version", () => {
    const rows = [
      row({ documentId: "v1", documentVersion: 1, documentStatus: "superseded" }),
      row({ documentId: "v2", documentVersion: 2, documentStatus: "published" }),
    ];
    expect(resolveDealerAsset(rows, "pdf", "v1").row?.documentId).toBe("v1");
    expect(resolveDealerAsset(rows, "pdf").row?.documentId).toBe("v2");
  });
});

describe("signed URL freshness", () => {
  it("reads the expiry out of a Supabase signed URL", () => {
    const exp = Math.floor(NOW / 1000) + 3600;
    expect(signedUrlExpiryMs(signedUrl(exp))).toBe(exp * 1000);
  });

  it("treats a URL that has already expired as unusable", () => {
    const url = signedUrl(Math.floor((NOW - DAYS(1)) / 1000));
    expect(isSignedUrlUsable(url, NOW)).toBe(false);
  });

  it("treats a seven-day URL as unusable at 7, 30 and 90 days — the failure this fixes", () => {
    // The old architecture stored exactly this URL as the permanent
    // location, which is why published vehicles broke after a week.
    const issued = NOW;
    const sevenDayUrl = signedUrl(Math.floor((issued + DAYS(7)) / 1000));
    expect(isSignedUrlUsable(sevenDayUrl, issued)).toBe(true);
    for (const day of [7, 30, 90]) {
      expect(isSignedUrlUsable(sevenDayUrl, issued + DAYS(day)), `day ${day}`).toBe(false);
    }
    // The durable reference still resolves at every one of those points,
    // so a fresh URL can always be minted without regenerating.
    for (const day of [7, 30, 90]) {
      const r = resolvePublicAsset([row()], "pdf");
      expect(r.ok, `day ${day}`).toBe(true);
      expect(r.row?.storagePath, `day ${day}`).toBe("t/vehicles/v/factory-stickers/v1/sticker.pdf");
    }
  });

  it("refreshes shortly before expiry rather than exactly at it", () => {
    const exp = Math.floor((NOW + 30_000) / 1000);
    expect(isSignedUrlUsable(signedUrl(exp), NOW)).toBe(false);
  });

  it("treats an unreadable or missing URL as expired rather than trusting it", () => {
    expect(isSignedUrlUsable(null, NOW)).toBe(false);
    expect(isSignedUrlUsable("", NOW)).toBe(false);
    expect(isSignedUrlUsable("https://x/y.pdf", NOW)).toBe(false);
    expect(isSignedUrlUsable("https://x/y.pdf?token=nonsense", NOW)).toBe(false);
    expect(signedUrlExpiryMs("https://x/y.pdf?token=a.b")).toBeNull();
  });

  it("mints short-lived credentials", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(3600);
    expect(SIGNED_URL_TTL_SECONDS).toBeGreaterThan(60);
  });
});
