// GENERATED — do not edit.
// Mirror of src/lib/market/providerTransport.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { ProviderAttemptOutcome } from "./freshness.ts";
export interface ProviderHttpResponse {
    status: number;
    json: () => Promise<unknown>;
}
export type ProviderFetch = (url: string, init?: {
    signal?: AbortSignal;
}) => Promise<ProviderHttpResponse>;
export interface ProviderCallResult {
    outcome: ProviderAttemptOutcome;
    status: number | null;
    body: unknown;
    attempts: number;
}
export function classifyProviderStatus(status: number): ProviderAttemptOutcome {
    if (status >= 200 && status < 300)
        return "succeeded";
    if (status === 401)
        return "auth_failed";
    if (status === 403)
        return "not_entitled";
    if (status === 429)
        return "rate_limited";
    if (status >= 500)
        return "server_error";
    if (status >= 400)
        return "request_rejected";
    return "server_error";
}
export const TRANSIENT_STATUSES: ProviderAttemptOutcome[] = [
    "timeout",
    "rate_limited",
    "server_error",
    "network_error",
];
const timeoutSignal = (ms: number): AbortSignal | undefined => {
    try {
        return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(ms)
            : undefined;
    }
    catch {
        return undefined;
    }
};
export async function callProviderOnce(url: string, fetchImpl: ProviderFetch, timeoutMs: number): Promise<ProviderCallResult> {
    let attempts = 0;
    try {
        attempts = 1;
        const res = await fetchImpl(url, { signal: timeoutSignal(timeoutMs) });
        const outcome = classifyProviderStatus(res.status);
        if (outcome !== "succeeded") {
            return { outcome, status: res.status, body: null, attempts };
        }
        const body = await res.json().catch(() => null);
        return { outcome: "succeeded", status: res.status, body, attempts };
    }
    catch (e) {
        const name = String((e as Error)?.name ?? e);
        const isTimeout = name.includes("Timeout") || name.includes("Abort");
        return {
            outcome: isTimeout ? "timeout" : "network_error",
            status: null,
            body: null,
            attempts,
        };
    }
}
export function failureReason(outcome: ProviderAttemptOutcome, status: number | null): string {
    return status == null ? outcome : `${outcome}_${status}`;
}
