// The advertised-price crawler answers 503 with { paused: true, message } while
// it is paused for pricing verification (the deployed pause build, and the
// corrected crawler's execution switch). supabase-js reports a non-2xx answer
// as a FunctionsHttpError whose `context` is the Response; this reads the
// server's message from it so each button can show it as written.
export async function crawlPausedMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!ctx || typeof (ctx as Response).clone !== "function") return null;
  try {
    const body = await (ctx as Response).clone().json() as { paused?: unknown; message?: unknown };
    return body?.paused === true && typeof body.message === "string" ? body.message : null;
  } catch {
    return null;
  }
}
