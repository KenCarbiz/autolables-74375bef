// ──────────────────────────────────────────────────────────────────────
// One rule for which generated_documents rows are the vehicle's live package,
// and which row is the CURRENT one of a given type.
//
// 20260724000000 consolidated the duplicate drafts every nightly sync had piled
// up, and its keeper is chosen by `(online_url IS NOT NULL) DESC, version DESC`
// — so the surviving row is routinely NOT the highest version number. Taking
// "highest version" over an unfiltered list therefore picked a superseded row:
// the VIN Command Center reported "v3 superseded" and linked a dead file while
// the Print Center, which filters first, showed v2 Ready. Same fact, two rules.
//
// `rejected` is deliberately NOT retired: it is a live exception the dealer has
// to act on, and both screens surface it as one.
// ──────────────────────────────────────────────────────────────────────

export const RETIRED_DOC_STATUSES: ReadonlySet<string> = new Set(["superseded", "archived"]);

export interface LifecycleDocument {
  document_type?: string | null;
  document_status?: string | null;
  version?: number | null;
}

export const isRetiredDocument = (d: LifecycleDocument): boolean =>
  RETIRED_DOC_STATUSES.has(String(d.document_status || ""));

export const liveDocuments = <T extends LifecycleDocument>(docs: T[]): T[] =>
  docs.filter((d) => !isRetiredDocument(d));

export const documentVersion = (d: LifecycleDocument): number => Number(d.version ?? 1);

/** The highest LIVE version of a type — the row both screens must agree on. */
export function currentDocumentOfType<T extends LifecycleDocument>(
  docs: T[],
  type: string,
): T | null {
  let best: T | null = null;
  for (const d of docs) {
    if (isRetiredDocument(d) || String(d.document_type || "") !== type) continue;
    if (!best || documentVersion(d) > documentVersion(best)) best = d;
  }
  return best;
}

/** type → highest live version, for the table's `Current` marker. */
export function currentVersionByType(docs: LifecycleDocument[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of docs) {
    if (isRetiredDocument(d)) continue;
    const t = String(d.document_type || "");
    const v = documentVersion(d);
    if (!out.has(t) || v > (out.get(t) as number)) out.set(t, v);
  }
  return out;
}
