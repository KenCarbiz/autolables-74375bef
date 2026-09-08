import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshFiledDocumentUrl, freshFiledDocumentAssets, isSignedStorageUrl } from "./filedDocumentUrl";

// A factory sticker generated on Monday opened fine and, the following week,
// answered {"statusCode":"400","error":"InvalidJWT"} from the same button — the
// record still read PUBLISHED, so it looked like the document needed
// regenerating when the PDF had never moved out of storage.
//
// generated_documents.pdf_url is a seven-day signed URL. The shopper side
// already stopped trusting it; these hold the dealer side to the same rule.

// Build a Supabase-shaped signed URL whose token expires `sec` from now.
const signed = (sec: number, now = Date.now()) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + sec })).toString("base64url");
  return `https://x.supabase.co/storage/v1/object/sign/vehicle-docs/t/sticker.pdf?token=h.${payload}.s`;
};

describe("a filed document opens with a credential that is valid now", () => {
  it("re-signs an expired URL instead of handing over a dead link", async () => {
    const fetchAssets = vi.fn().mockResolvedValue({ pdf_url: signed(3600), preview_url: null });
    const url = await freshFiledDocumentUrl(fetchAssets, "doc-1", signed(-60));
    expect(fetchAssets).toHaveBeenCalledWith("doc-1");
    expect(url).not.toBe(signed(-60));
    expect(url).toContain("token=");
  });

  it("spends no round trip on a URL with real time left", async () => {
    const fresh = signed(3600);
    const fetchAssets = vi.fn();
    expect(await freshFiledDocumentUrl(fetchAssets, "doc-1", fresh)).toBe(fresh);
    expect(fetchAssets).not.toHaveBeenCalled();
  });

  it("re-signs a URL that is about to expire mid-view", async () => {
    // isSignedUrlUsable keeps a refresh margin: a link with 10 seconds left is
    // a dead link by the time a PDF finishes loading.
    const fetchAssets = vi.fn().mockResolvedValue({ pdf_url: signed(3600), preview_url: null });
    await freshFiledDocumentUrl(fetchAssets, "doc-1", signed(10));
    expect(fetchAssets).toHaveBeenCalled();
  });

  it("re-signs anything whose expiry cannot be read", async () => {
    const fetchAssets = vi.fn().mockResolvedValue({ pdf_url: signed(3600), preview_url: null });
    for (const cached of [null, "", "https://x/sticker.pdf", "https://x/sticker.pdf?token=nonsense"]) {
      fetchAssets.mockClear();
      await freshFiledDocumentUrl(fetchAssets, "doc-1", cached);
      expect(fetchAssets, `${JSON.stringify(cached)} must not be trusted`).toHaveBeenCalled();
    }
  });

  it("returns null rather than a link it knows is dead", async () => {
    const fetchAssets = vi.fn().mockRejectedValue(new Error("orchestrator down"));
    expect(await freshFiledDocumentUrl(fetchAssets, "doc-1", signed(-60))).toBeNull();
  });

  it("does not call out for a document that was never filed", async () => {
    const fetchAssets = vi.fn();
    expect(await freshFiledDocumentUrl(fetchAssets, null, null)).toBeNull();
    expect(fetchAssets).not.toHaveBeenCalled();
  });
});

describe("the thumbnail and the PDF come from one fetch", () => {
  it("returns both, so the card never links a thumbnail to a stale PDF", async () => {
    const fetchAssets = vi.fn().mockResolvedValue({ pdf_url: signed(3600), preview_url: signed(3600) });
    const a = await freshFiledDocumentAssets(fetchAssets, "doc-1", signed(-60));
    expect(fetchAssets).toHaveBeenCalledTimes(1);
    expect(a.pdf_url).toBeTruthy();
    expect(a.preview_url).toBeTruthy();
  });

  it("falls back to a still-valid cached URL when the orchestrator is unreachable", async () => {
    const fresh = signed(3600);
    const fetchAssets = vi.fn().mockRejectedValue(new Error("network"));
    expect((await freshFiledDocumentAssets(fetchAssets, "doc-1", fresh)).pdf_url).toBe(fresh);
  });

  it("does not fall back to an expired cached URL", async () => {
    const fetchAssets = vi.fn().mockRejectedValue(new Error("network"));
    expect((await freshFiledDocumentAssets(fetchAssets, "doc-1", signed(-60))).pdf_url).toBeNull();
  });
});

describe("only a credential is treated as a credential", () => {
  it("recognizes a signed storage URL", () => {
    expect(isSignedStorageUrl(signed(3600))).toBe(true);
    expect(isSignedStorageUrl(signed(-60))).toBe(true);
  });

  it("does not claim a data URL or a plain address is one", () => {
    // A window sticker and an addendum are filed as data URLs: there is no
    // storage object to re-sign, and withholding them would report a document
    // that opens today as unopenable.
    expect(isSignedStorageUrl("data:application/pdf;base64,JVBER")).toBe(false);
    expect(isSignedStorageUrl("https://files.test/monroney.pdf")).toBe(false);
    expect(isSignedStorageUrl(null)).toBe(false);
    expect(isSignedStorageUrl("")).toBe(false);
  });

  it("the Vehicle File list still opens a document that was never signed", () => {
    const section = readFileSync(join(__dirname, "../components/vehicle/GeneratedDocumentsSection.tsx"), "utf8");
    expect(section).toMatch(/isSignedStorageUrl\(stored\) \? null : stored/);
  });
});

describe("no admin surface links straight at the stored URL", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../", p), "utf8");

  it("the Vehicle File card mints its URLs", () => {
    const card = read("components/vehicle/FactoryStickerCard.tsx");
    expect(card).toMatch(/freshFiledDocumentAssets\(/);
    // The old shape: const fileUrl = doc?.pdf_url || doc?.online_url.
    expect(card).not.toMatch(/const fileUrl = doc\?\.pdf_url/);
  });

  it("the admin review table signs on click", () => {
    const panel = read("components/admin/FactoryStickerPanel.tsx");
    expect(panel).toMatch(/freshFiledDocumentUrl\(/);
    expect(panel).not.toMatch(/<a href=\{previewUrl\}/);
  });

  it("the sticker workspace signs its Download / Print buttons and its version list", () => {
    const page = read("pages/FactoryStickerWorkspace.tsx");
    expect(page).toMatch(/freshFiledDocumentUrl\(/);
    // The old shapes: a URL derived straight off the row at render time, and a
    // version-history link pointing at the stored credential.
    expect(page).not.toMatch(/const pdfUrl = currentDoc\?\.pdf_url/);
    expect(page).not.toMatch(/href=\{d\.pdf_url\}/);
  });

  it("the Vehicle File document list signs on open", () => {
    const section = read("components/vehicle/GeneratedDocumentsSection.tsx");
    expect(section).toMatch(/freshFiledDocumentUrl\(/);
    expect(section).not.toMatch(/const url = doc\.online_url \|\| doc\.pdf_url/);
  });

  it("the packet print sheet prints links minted at release time", () => {
    const hook = read("hooks/useCommandCenter.ts");
    expect(hook).toMatch(/printableDocumentUrl\(/);
    // The old shape: the stored credential copied straight onto the paper.
    expect(hook).not.toMatch(/url: String\(d\.pdf_url \|\| d\.png_url \|\| ""\)/);
    expect(hook).not.toMatch(/url: String\(doc\.pdf_url \|\| doc\.png_url \|\| ""\)/);
  });
});

describe("no shopper surface links straight at the stored URL", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../", p), "utf8");

  it("the classic document center re-mints every type that files an asset", () => {
    const page = read("pages/PublicDocuments.tsx");
    expect(page).toMatch(/freshPublishedAssetUrl\(/);
    expect(page).toMatch(/REMINTABLE_DOCUMENT_TYPES/);
  });
});

describe("the orchestrator can re-sign every filed document, not only stickers", () => {
  it("its document_assets action does not narrow to factory_sticker", () => {
    const fn = readFileSync(
      join(__dirname, "../../supabase/functions/factory-sticker-orchestrate/index.ts"),
      "utf8",
    );
    const action = fn.slice(fn.indexOf('if (action === "document_assets")'), fn.indexOf('if (action === "vehicle_truth")'));
    expect(action).toBeTruthy();
    // The Buyers Guide and the K-208 are filed in a bucket no browser client may
    // sign against, so this action is the only seam a dealer surface has for
    // re-minting them.
    expect(action).not.toMatch(/\.eq\("document_type", "factory_sticker"\)/);
    // Each asset is signed against its own row's bucket: the compliance PDFs live
    // in signed-archives while stickers live in vehicle-docs.
    expect(action).toMatch(/sign\(pdfRow\?\.storage_path \?\? snap\.storage_path, pdfRow\?\.storage_bucket\)/);
  });
});
