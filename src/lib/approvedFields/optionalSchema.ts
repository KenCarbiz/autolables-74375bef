// The frontend can ship before 20261031000000_v2_approved_fields.sql is
// applied. Every read of a table, column or function that migration adds goes
// through readOptional as its own query, so a database without the migration
// answers "not available yet" instead of breaking the page's other reads.

export interface PgError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export type Optional<T> =
  | { status: "available"; data: T }
  | { status: "unavailable" }
  | { status: "error"; code: string | null; message: string };

const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]);

export function isSchemaUnavailable(err: PgError | null | undefined): boolean {
  if (!err) return false;
  if (err.code && MISSING_CODES.has(String(err.code))) return true;
  return /does not exist|could not find the (function|table|relation|column)|schema cache/i.test(err.message || "");
}

export function fromError(err: PgError): Optional<never> {
  if (isSchemaUnavailable(err)) return { status: "unavailable" };
  return { status: "error", code: err.code ? String(err.code) : null, message: err.message || "Request failed." };
}

export async function readOptional<R, T>(
  run: () => PromiseLike<{ data: R | null; error: PgError | null }>,
  map: (data: R | null) => T,
): Promise<Optional<T>> {
  try {
    const { data, error } = await run();
    if (error) return fromError(error);
    return { status: "available", data: map(data) };
  } catch (e) {
    const err = (e ?? {}) as PgError;
    return fromError({ code: err.code ?? null, message: err.message ?? String(e) });
  }
}

export const NOT_AVAILABLE_YET = "Not available yet";

export type WriteResult<R = undefined> =
  | { ok: true; data: R }
  | { ok: false; reason: "unavailable" | "not_authorized" | "invalid" | "error"; message: string };

export function writeFailure(err: PgError): Extract<WriteResult, { ok: false }> {
  if (isSchemaUnavailable(err)) return { ok: false, reason: "unavailable", message: NOT_AVAILABLE_YET };
  const code = err.code ? String(err.code) : "";
  if (code === "42501") return { ok: false, reason: "not_authorized", message: err.message || "Not authorized." };
  if (code === "22023" || code === "23514" || code === "P0002") {
    return { ok: false, reason: "invalid", message: err.message || "Invalid value." };
  }
  return { ok: false, reason: "error", message: err.message || "Request failed." };
}

export async function runWrite<R, T>(
  run: () => PromiseLike<{ data: R | null; error: PgError | null }>,
  map: (data: R | null) => T,
): Promise<WriteResult<T>> {
  try {
    const { data, error } = await run();
    if (error) return writeFailure(error);
    return { ok: true, data: map(data) };
  } catch (e) {
    const err = (e ?? {}) as PgError;
    return writeFailure({ code: err.code ?? null, message: err.message ?? String(e) });
  }
}
