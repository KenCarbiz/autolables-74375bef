// Trusts a pg_cron or launch-dispatcher call by the database-held scheduler
// secret (migration 0019), verified through the function's own service
// client. A request without a well-formed secret never reaches the database.
export const SCHEDULER_SECRET_HEADER = "x-scheduler-secret";

export interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

export async function schedulerSecretValid(req: Request, db: RpcClient): Promise<boolean> {
  const secret = req.headers.get(SCHEDULER_SECRET_HEADER) ?? "";
  if (!/^[0-9a-f]{64}$/.test(secret)) return false;
  try {
    const { data, error } = await db.rpc("scheduler_secret_matches", { p_secret: secret });
    return !error && data === true;
  } catch {
    return false;
  }
}
