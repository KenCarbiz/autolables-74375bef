// Advertised-price evidence lives in the PRIVATE price-evidence bucket, so a
// row's screenshot_url is a bucket-relative path, not something a browser can
// open. It becomes viewable only through a signed URL minted under the
// caller's own session: the price_evidence_view policy on storage.objects
// (migration 20260618002000) is what decides whether this user may see this
// tenant's object, and that policy is only consulted when the mint runs as
// the user. A service-role mint would bypass it and have to re-implement the
// tenant check by hand.

export const PRICE_EVIDENCE_BUCKET = "price-evidence";
export const PRICE_EVIDENCE_TTL_SECONDS = 600;

export interface PriceEvidenceRow {
  screenshot_url: string | null | undefined;
  screenshot_bucket?: string | null;
}

export type PriceEvidenceReason = "signed" | "already_url" | "no_evidence" | "denied_or_missing";

export interface PriceEvidenceUrlResult {
  url: string | null;
  reason: PriceEvidenceReason;
  message?: string;
}

interface SignedUrlResponse {
  data: { signedUrl: string } | null;
  error: { message?: string } | null;
}

export interface EvidenceStorageClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<SignedUrlResponse>;
    };
  };
}

export interface SignPriceEvidenceOptions {
  ttlSeconds?: number;
}

// One fixed message for every failure: an unauthorised caller must not be
// able to tell a denied object from an absent one.
export const EVIDENCE_UNAVAILABLE_MESSAGE = "Evidence unavailable";

const isAbsoluteUrl = (v: string) => /^https?:\/\//i.test(v);

export const normalizeEvidencePath = (raw: string | null | undefined): string => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (isAbsoluteUrl(trimmed)) return trimmed;
  return trimmed.replace(/^\/+/, "");
};

export const signPriceEvidenceUrl = async (
  client: EvidenceStorageClient,
  row: PriceEvidenceRow,
  opts: SignPriceEvidenceOptions = {},
): Promise<PriceEvidenceUrlResult> => {
  const path = normalizeEvidencePath(row.screenshot_url);
  if (!path) return { url: null, reason: "no_evidence" };
  if (isAbsoluteUrl(path)) return { url: path, reason: "already_url" };

  const bucket = (row.screenshot_bucket ?? "").trim() || PRICE_EVIDENCE_BUCKET;
  const ttl = opts.ttlSeconds && opts.ttlSeconds > 0 ? Math.floor(opts.ttlSeconds) : PRICE_EVIDENCE_TTL_SECONDS;

  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, ttl);
    if (error || !data?.signedUrl) {
      return { url: null, reason: "denied_or_missing", message: EVIDENCE_UNAVAILABLE_MESSAGE };
    }
    return { url: data.signedUrl, reason: "signed" };
  } catch {
    return { url: null, reason: "denied_or_missing", message: EVIDENCE_UNAVAILABLE_MESSAGE };
  }
};
