// inventory_sync_runs.id is a uuid; staff read and quote the first eight hex
// digits, which is enough to find a run in the ledger.
export function formatSyncRunId(id: string | null | undefined): string {
  const hex = `${id ?? ""}`.replace(/[^0-9a-f]/gi, "");
  if (!hex) return "—";
  return `Run ${hex.slice(0, 8).toUpperCase()}`;
}
