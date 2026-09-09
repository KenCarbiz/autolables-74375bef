// Which renderer key a run should spend.
//
// Two Firecrawl keys can be configured (FIRECRAWL_API_KEY_1 takes precedence
// over FIRECRAWL_API_KEY). On 2026-09-09 the preferred key belonged to a team
// whose balance read -11 while the other key's team held 1,316 credits, so
// every render since at least 2026-09-06 was refused at 402 and the dashboard
// the owner was reading showed a healthy balance. The provider's credit-usage
// endpoint is free to call; one GET per configured key at the start of a run
// picks the key that can actually pay, and the choice is recorded by env
// name. Key values never leave the function.

export const CREDIT_USAGE_ENDPOINT = "https://api.firecrawl.dev/v2/team/credit-usage";

export interface RenderKeyCandidate {
  env: string;
  key: string;
}

export interface CreditUsage {
  status: number | null;
  remaining: number | null;
  plan: number | null;
  periodEnd: string | null;
  error: string | null;
}

export interface RenderKeyChoice {
  env: string | null;
  remaining: number | null;
  reason: "only_key" | "most_credits" | "all_exhausted_kept_first" | "unknown_kept_first" | "none_configured";
  checked: Array<{ env: string; status: number | null; remaining: number | null; plan: number | null; period_end: string | null; error: string | null }>;
}

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export async function fetchCreditUsage(key: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 10_000): Promise<CreditUsage> {
  try {
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const res = await fetchImpl(CREDIT_USAGE_ENDPOINT, {
      headers: { "Authorization": `Bearer ${key}` },
      signal,
    });
    const text = await res.text();
    let parsed: { data?: { remainingCredits?: unknown; planCredits?: unknown; billingPeriodEnd?: unknown } } | null = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON answer: reported as an error below */ }
    const d = parsed?.data;
    const remaining = typeof d?.remainingCredits === "number" ? d.remainingCredits : null;
    const plan = typeof d?.planCredits === "number" ? d.planCredits : null;
    const periodEnd = typeof d?.billingPeriodEnd === "string" ? d.billingPeriodEnd : null;
    return {
      status: res.status,
      remaining,
      plan,
      periodEnd,
      error: res.status === 200 && remaining != null ? null : text.slice(0, 300),
    };
  } catch (e) {
    return { status: null, remaining: null, plan: null, periodEnd: null, error: String(e).slice(0, 300) };
  }
}

// Pure: given each candidate's reported balance, pick the one to spend.
// Highest positive balance wins; ties keep configuration order. When no key
// has a positive balance -- or nothing could be read -- the first configured
// key stays in use so a refusal is still attempted, recorded and labelled by
// the provider's own answer rather than assumed.
export function pickRenderKey(
  candidates: Array<{ env: string; remaining: number | null }>,
): { index: number; reason: RenderKeyChoice["reason"] } {
  if (candidates.length === 0) return { index: -1, reason: "none_configured" };
  if (candidates.length === 1) return { index: 0, reason: "only_key" };
  let best = -1;
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i].remaining;
    if (r == null || r <= 0) continue;
    if (best < 0 || r > (candidates[best].remaining as number)) best = i;
  }
  if (best >= 0) return { index: best, reason: "most_credits" };
  const anyRead = candidates.some((c) => c.remaining != null);
  return { index: 0, reason: anyRead ? "all_exhausted_kept_first" : "unknown_kept_first" };
}

export async function selectRenderKey(
  candidates: RenderKeyCandidate[],
  fetchImpl?: FetchLike,
): Promise<RenderKeyChoice & { key: string }> {
  if (candidates.length === 0) return { key: "", env: null, remaining: null, reason: "none_configured", checked: [] };
  if (candidates.length === 1) {
    return { key: candidates[0].key, env: candidates[0].env, remaining: null, reason: "only_key", checked: [] };
  }
  const usages = await Promise.all(candidates.map((c) => fetchCreditUsage(c.key, fetchImpl)));
  const checked = candidates.map((c, i) => ({
    env: c.env, status: usages[i].status, remaining: usages[i].remaining, plan: usages[i].plan,
    period_end: usages[i].periodEnd, error: usages[i].error,
  }));
  const pick = pickRenderKey(checked.map((c) => ({ env: c.env, remaining: c.remaining })));
  const chosen = candidates[pick.index];
  return { key: chosen.key, env: chosen.env, remaining: checked[pick.index].remaining, reason: pick.reason, checked };
}
