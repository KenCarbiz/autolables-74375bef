import {
  authorize,
  verifyDelivery,
  type EnvelopeV2,
  type Registry,
  type SignedHeaders,
  type VerifiedDelivery,
} from "./core";
import { strictBody } from "./wire";

export const RTGIP2_INGRESS_ENABLED = false as const;
export const RTGIP2_OUTBOUND_ENABLED = false as const;
export const HEADER_NAMES = [
  "rtgip-protocol",
  "rtgip-key-id",
  "rtgip-signer",
  "rtgip-timestamp",
  "rtgip-nonce",
  "rtgip-scope",
  "rtgip-signature",
] as const;

export interface IdentityMapping {
  tenant_id: string;
  rooftop_id: string;
  source_app: string;
  source_store_id: string;
  instance_id: string;
  episode_id: string;
  vin: string;
  connection_id: string;
  status: "active" | "revoked";
  reviewed_ref: string;
}

/** No VIN/name inference: exactly one reviewed mapping must bind every identity. */
export function mappingFor(
  e: EnvelopeV2,
  connection: string,
  rows: readonly IdentityMapping[],
): IdentityMapping | null {
  const candidates = rows.filter(
    (r) =>
      r.tenant_id === e.tenant_id &&
      r.rooftop_id === e.rooftop_id &&
      r.source_app === e.source_app &&
      r.instance_id === e.vehicle.instance_id &&
      r.episode_id === e.vehicle.episode_id &&
      r.connection_id === connection,
  );
  const row = candidates[0];
  return candidates.length === 1 &&
    row?.status === "active" &&
    row.vin === e.vehicle.vin &&
    row.source_store_id.length > 0 &&
    row.reviewed_ref.length > 0
    ? row
    : null;
}

export function cleanHeaders(
  input: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const k = name.toLowerCase();
    if (!k.startsWith("rtgip-")) continue;
    if (!(HEADER_NAMES as readonly string[]).includes(k)) throw new Error("unknown_rtgip_header");
    if (
      k in out ||
      typeof value !== "string" ||
      value.includes(",") ||
      /[\r\n]/.test(value) ||
      value.includes(String.fromCharCode(0))
    )
      throw new Error("duplicate_or_invalid_header");
    out[k] = value;
  }
  if (HEADER_NAMES.some((k) => !out[k])) throw new Error("missing_headers");
  return out;
}

export type VerifiedAdmission = VerifiedDelivery & {
  canonical_body: string;
  nonce: string;
  timestamp: number;
  mapping: IdentityMapping;
};

/** Pure validation only. Durable nonce reservation happens in the admission transaction, never here. */
export async function verifyAdmission(
  input: Record<string, string | string[] | undefined>,
  bytes: Uint8Array,
  registry: Registry,
  mappings: readonly IdentityMapping[],
  nowSec: number,
): Promise<VerifiedAdmission> {
  const headers = cleanHeaders(input);
  const body = strictBody(bytes);
  const result = await verifyDelivery(headers, body, {
    registry,
    nowSec,
    expectedSigner: "source",
    nonces: { claim: async () => "claimed" },
  });
  if (!result.ok) throw new Error(result.reason);
  const e = result.delivery.envelope;
  const matching = registry.connections.filter(
    (c) =>
      c.source_app === e.source_app &&
      c.target_app === e.target_app &&
      c.tenant_id === e.tenant_id &&
      c.rooftop_ids.includes(e.rooftop_id) &&
      c.status === "active",
  );
  if (matching.length !== 1 || !authorize(e, registry).ok)
    throw new Error("ambiguous_or_unauthorized_connection");
  const mapping = mappingFor(e, result.delivery.connection_id, mappings);
  if (!mapping) throw new Error("ambiguous_or_unauthorized_mapping");
  const nonce = headers["rtgip-nonce"];
  if (!nonce) throw new Error("missing_nonce");
  return {
    ...result.delivery,
    canonical_body: body,
    nonce,
    timestamp: Number(headers["rtgip-timestamp"]),
    mapping,
  };
}

export function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((v, k) => {
    record[k] = v;
  });
  return record;
}

export type ForwardRequest = { headers: SignedHeaders; body: string };
