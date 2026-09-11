/// <reference path="./signalhouse-sdk.d.ts" />
import { SignalHouseSDK } from "npm:@signalhousellc/sdk@1.0.66";

// ──────────────────────────────────────────────────────────────
// signalhouse · the SMS provider behind every outbound text.
//
// Secrets (Supabase → Edge Function secrets):
//   SIGNALHOUSE_API_KEY              service-user token, group-scoped
//   SIGNALHOUSE_FROM_NUMBER          sender on the ACTIVE 10DLC campaign
//   SIGNALHOUSE_API_BASE             optional, defaults to v2
//   SIGNALHOUSE_STATUS_CALLBACK_URL  optional, per-send delivery receipts
// ──────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://v2.signalhouse.io";

export type SignalHouseFailure =
  | "not_configured"
  | "invalid_recipient"
  | "invalid_message"
  | "send_failed"
  | "blocked";

export class SignalHouseError extends Error {
  readonly code: SignalHouseFailure;
  readonly status: number;

  constructor(code: SignalHouseFailure, message: string, status = 500) {
    super(message);
    this.name = "SignalHouseError";
    this.code = code;
    this.status = status;
  }
}

export interface SignalHouseSmsResult {
  provider: "signalhouse";
  messageId: string | null;
  enqueuedCount: number;
  blockedNumbers: string[];
}

// Signal House takes bare digits carrying the country code and no "+"
// (12025551234). An E.164 "+" prefix fails validation as a malformed number,
// so Twilio-shaped numbers cannot be handed over untouched.
export const toSignalHouseNumber = (
  raw: string,
  options: { allowShortCode?: boolean } = {},
): string | null => {
  const digits = (raw || "").replace(/\D/g, "");
  if (options.allowShortCode && digits.length >= 5 && digits.length <= 6) return digits;
  if (digits.length === 10) return `1${digits}`;
  if (digits.length >= 11) return digits;
  return null;
};

// deno-lint-ignore no-explicit-any
let sdk: any = null;

// deno-lint-ignore no-explicit-any
const client = (): any => {
  if (sdk) return sdk;
  const apiKey = Deno.env.get("SIGNALHOUSE_API_KEY");
  if (!apiKey) throw new SignalHouseError("not_configured", "SIGNALHOUSE_API_KEY is not set");
  sdk = new SignalHouseSDK({
    apiKey,
    baseUrl: Deno.env.get("SIGNALHOUSE_API_BASE") || DEFAULT_BASE_URL,
  });
  return sdk;
};

export const sendSignalHouseSms = async (
  to: string,
  body: string,
): Promise<SignalHouseSmsResult> => {
  const sender = toSignalHouseNumber(Deno.env.get("SIGNALHOUSE_FROM_NUMBER") || "", {
    allowShortCode: true,
  });
  if (!sender) throw new SignalHouseError("not_configured", "SIGNALHOUSE_FROM_NUMBER is not set");

  const recipient = toSignalHouseNumber(to);
  if (!recipient) throw new SignalHouseError("invalid_recipient", "Invalid phone number", 400);

  const messageBody = (body || "").trim();
  if (!messageBody) throw new SignalHouseError("invalid_message", "Empty message", 400);

  const statusCallbackUrl = Deno.env.get("SIGNALHOUSE_STATUS_CALLBACK_URL") || undefined;

  const res = await client().messages.sendSMS({
    senderPhoneNumber: sender,
    recipientPhoneNumbers: [recipient],
    messageBody,
    ...(statusCallbackUrl ? { statusCallbackUrl } : {}),
  });

  // The SDK resolves non-2xx into the envelope instead of throwing, so a
  // rejected send arrives here looking like a normal return value.
  if (!res?.success) {
    const detail = typeof res?.error === "string" ? res.error : JSON.stringify(res?.error ?? {});
    throw new SignalHouseError(
      "send_failed",
      `Signal House send failed: ${detail}`,
      Number(res?.status) || 502,
    );
  }

  const data = (res.data ?? {}) as Record<string, unknown>;
  const inserted = Array.isArray(data.insertedMessages)
    ? (data.insertedMessages as Record<string, unknown>[])
    : [];
  const enqueuedCount = Number(data.enqueuedCount ?? 0);
  const blockedNumbers = Array.isArray(data.dncBlockedNumbers)
    ? (data.dncBlockedNumbers as unknown[]).map(String)
    : [];

  // A moderation block or a campaign opt-out is not an API error: the send
  // returns 2xx with the recipient written to the log as FAILED. enqueuedCount
  // is the only field that says a message was accepted for delivery, so
  // treating the HTTP status as success reports a blocked campaign as working.
  if (enqueuedCount < 1) {
    const errorCode = inserted.find((m) => m?.errorCode)?.errorCode;
    const reason = errorCode === "OUT"
      ? "recipient has opted out of this campaign"
      : blockedNumbers.length > 0
      ? "recipient is on the Do Not Contact list"
      : "blocked before delivery";
    throw new SignalHouseError("blocked", `Signal House accepted 0 recipients: ${reason}`, 422);
  }

  const first = inserted[0] ?? {};
  const messageId = first.messageId ?? first.id ?? first._id ?? null;

  return {
    provider: "signalhouse",
    messageId: messageId ? String(messageId) : null,
    enqueuedCount,
    blockedNumbers,
  };
};
