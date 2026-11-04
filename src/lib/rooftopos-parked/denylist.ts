// Fields that inbound evidence must NEVER carry or write. Evidence lives in its own
// projection; AutoCurb's appraised ACV, offer/pricing and lead/CRM fields stay authoritative.

export const PROTECTED_PRICING_FIELDS = [
  "acv_value", "acv", "appraised_acv", "offered_price", "offer_price", "current_offer",
  "estimated_offer_high", "estimated_offer_low", "estimated_offer", "final_offer",
  "price_agreed", "purchase_price", "check_amount", "payoff_amount", "progress_status",
  "appraisal_finalized", "appraisal_finalized_at", "appraisal_finalized_by",
] as const;

export const PROTECTED_CRM_FIELDS = [
  "name", "first_name", "last_name", "full_name", "email", "phone", "phone_e164",
  "address", "address_street", "address_city", "address_state", "address_zip", "zip",
  "dl_number", "drivers_license", "dob", "date_of_birth", "ssn",
  "customer_id", "lead_id", "submission_id", "token", "assigned_rep_email",
  "sms_opt_in", "dnc", "consent", "lead_source", "cosigner_name", "cosigner_email", "cosigner_phone",
] as const;

const DENY = new Set<string>([...PROTECTED_PRICING_FIELDS, ...PROTECTED_CRM_FIELDS]);

/** Returns every denied key path found anywhere in the object. */
export function findProtectedKeys(obj: unknown, path = ""): string[] {
  const hits: string[] = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => hits.push(...findProtectedKeys(v, `${path}[${i}]`)));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (DENY.has(k.toLowerCase())) hits.push(p);
      hits.push(...findProtectedKeys(v, p));
    }
  }
  return hits;
}

export class ProtectedFieldError extends Error {
  constructor(public fields: string[]) {
    super(`protected_field_write_denied: ${fields.join(",")}`);
  }
}

export function assertNoProtectedWrite(patch: unknown): void {
  const hits = findProtectedKeys(patch);
  if (hits.length) throw new ProtectedFieldError(hits);
}