import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGroupAccess, loadFeedRows, readStoredSelection, resolveSelection, selectionKey, writeStoredSelection,
  type FeedRow, type GroupAccess, type GroupInventoryError,
} from "@/lib/inventoryScope/groupInventory";

/** The persisted choice only: per user and tenant, shared by every Inventory screen. null means the primary dealership only. */
export function useDealershipSelection(tenantId: string | undefined, userId: string | undefined) {
  const key = tenantId ? selectionKey(userId, tenantId) : null;
  const [stored, setStored] = useState<string[] | null>(() => (key ? readStoredSelection(key) : null));
  useEffect(() => { setStored(key ? readStoredSelection(key) : null); }, [key]);
  const select = useCallback((ids: string[] | null) => {
    setStored(ids);
    if (key) writeStoredSelection(key, ids);
  }, [key]);
  return { stored, select };
}

export type AccessState = GroupAccess | { status: "loading" } | { status: "error"; message: string };
export type FeedState = { status: "idle" | "loading" | "ready" } | { status: "error"; error: unknown };

/**
 * Dealership selection for the Inventory screens, shared by /inventory and
 * /inventory-v2 through one localStorage key per user and tenant. The default,
 * and the state when the access check is missing, denied or failing, is the
 * primary dealership only, which never reads a feed row.
 */
export function useGroupInventory(tenantId: string | undefined, userId: string | undefined) {
  const { stored, select } = useDealershipSelection(tenantId, userId);
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [feed, setFeed] = useState<FeedState>({ status: "idle" });
  const [feedRows, setFeedRows] = useState<FeedRow[]>([]);
  const [nonce, setNonce] = useState(0);
  const cache = useRef(new Map<string, FeedRow[]>());

  useEffect(() => {
    if (!tenantId) return;
    let on = true;
    setAccess({ status: "loading" });
    cache.current = new Map();
    fetchGroupAccess(tenantId).then(
      (a) => { if (on) setAccess(a); },
      (e: unknown) => { if (on) setAccess({ status: "error", message: e instanceof Error ? e.message : "access check failed" }); },
    );
    return () => { on = false; };
  }, [tenantId, nonce]);

  const stores = access.status === "allowed" ? access.stores : [];
  const resolved = useMemo(() => resolveSelection(stored, stores), [stored, access]); // eslint-disable-line react-hooks/exhaustive-deps
  const combined = access.status === "allowed" && !resolved.primaryOnly && resolved.ids.length > 0;
  const idsKey = resolved.ids.join(",");

  useEffect(() => {
    if (!tenantId || access.status !== "allowed" || !combined) { setFeed({ status: "idle" }); setFeedRows([]); return; }
    let on = true;
    setFeed({ status: "loading" });
    (async () => {
      const missing = resolved.ids.filter((id) => !cache.current.has(id));
      if (missing.length) {
        const rows = await loadFeedRows(tenantId, access, missing);
        for (const id of missing) cache.current.set(id, rows.filter((r) => r.store_id === id));
      }
      return resolved.ids.flatMap((id) => cache.current.get(id) ?? []);
    })().then(
      (rows) => { if (on) { setFeedRows(rows); setFeed({ status: "ready" }); } },
      (error: unknown) => { if (on) { setFeedRows([]); setFeed({ status: "error", error }); } },
    );
    return () => { on = false; };
  }, [tenantId, access, combined, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => { cache.current = new Map(); setNonce((n) => n + 1); }, []);

  return {
    access,
    stores,
    selectedIds: resolved.ids,
    primaryOnly: resolved.primaryOnly,
    combined,
    feed,
    feedRows,
    select,
    selectAll: () => select(stores.map((s) => s.storeId)),
    selectPrimaryOnly: () => select(null),
    retry,
    feedError: feed.status === "error" ? (feed.error as GroupInventoryError) : null,
  };
}
