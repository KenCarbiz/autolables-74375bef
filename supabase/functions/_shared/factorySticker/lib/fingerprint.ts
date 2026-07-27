// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/fingerprint.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { createHash } from "node:crypto";
import type { FactoryStickerData } from "./types.ts";

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number") return Number.isFinite(value as number) ? String(value) : "null";
  if (t === "boolean") return (value as boolean) ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== "function")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}

export function sha256HexSync(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// WebCrypto variant for Deno/browser reuse — identical output to sha256HexSync.
export async function sha256HexAsync(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const fingerprintPayload = (
  data: FactoryStickerData,
  templateVersion: string,
  rendererVersion: string,
  themeVersion: string,
  logoAssetVersion: string | undefined,
  passportUrl: string,
): string =>
  stableStringify({
    data,
    logoAssetVersion: logoAssetVersion ?? null,
    passportUrl,
    rendererVersion,
    templateVersion,
    themeVersion,
  });

export function generationFingerprint(
  data: FactoryStickerData,
  templateVersion: string,
  rendererVersion: string,
  themeVersion: string,
  logoAssetVersion: string | undefined,
  passportUrl: string,
): string {
  return sha256HexSync(
    fingerprintPayload(data, templateVersion, rendererVersion, themeVersion, logoAssetVersion, passportUrl),
  );
}

export async function generationFingerprintAsync(
  data: FactoryStickerData,
  templateVersion: string,
  rendererVersion: string,
  themeVersion: string,
  logoAssetVersion: string | undefined,
  passportUrl: string,
): Promise<string> {
  return sha256HexAsync(
    fingerprintPayload(data, templateVersion, rendererVersion, themeVersion, logoAssetVersion, passportUrl),
  );
}
