import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { AuditLogEntry } from "@/types/tenant";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";

// ──────────────────────────────────────────────────────────────
// AuditContext — Supabase-only.
//
// Everything writes to public.audit_log (migration 20260417) and
// reads from it scoped to the current tenant. RLS enforces tenant
// isolation for authenticated users; platform admins see everything
// via the cross-tenant admin policies.
//
// localStorage was previously used as a client-side echo so the
// Dashboard activity feed had instant responsiveness. That
// fractured the compliance story — prod audit evidence cannot live
// only in one user's browser. We drop it; the in-memory entries
// array now hydrates from Supabase and optimistically prepends on
// write so the UI still feels snappy.
// ──────────────────────────────────────────────────────────────

interface AuditContextType {
  log: (entry: Omit<AuditLogEntry, "id" | "created_at" | "ip_address">) => void;
  entries: AuditLogEntry[];
  getByEntity: (entityType: string, entityId: string) => AuditLogEntry[];
  getByStore: (storeId: string) => AuditLogEntry[];
  exportCsv: (storeId?: string) => string;
  reload: () => Promise<void>;
  loading: boolean;
}

const AuditContext = createContext<AuditContextType | undefined>(undefined);

// Cap the in-memory recent-activity window. We don't need the full
// history client-side — the ComplianceCenter VIN lookup + cross-
// tenant Platform Audit tab already query the server directly.
const RECENT_LIMIT = 500;

export const AuditProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const userId = user?.id ?? null;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (!userId || !tenantId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await (supabase as any)
        .from("audit_log")
        .select("id, action, entity_type, entity_id, store_id, user_id, user_email, ip_address, user_agent, content_hash, details, created_at")
        // store_id holds the tenant id (text). The previous .or() included
        // a `details->>tenant_id` JSON arrow, which is invalid PostgREST
        // filter syntax inside .or() and 500'd the whole query.
        .eq("store_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);
      if (error) throw error;
      setEntries(((data as AuditLogEntry[]) || []).reverse());
    } catch {
      // Table missing or RLS blocks — stay empty. Compliance records
      // still land in Supabase via the direct inserts below; only the
      // Dashboard activity preview goes quiet.
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [userId, tenantId]);

  useEffect(() => {
    const k = `${userId ?? "anon"}:${tenantId ?? "none"}`;
    if (loadedKeyRef.current === k) return;
    loadedKeyRef.current = k;
    load();
  }, [userId, tenantId, load]);

  // Wave 14.6.1 — audit_log is too high-volume to wire to
  // realtime (every signing / listing / recall check writes to
  // it). Instead refresh on tab focus so a second device's
  // writes show up the next time this tab is foregrounded.
  // Throttled to a 5s gap so a quick alt-tab burst doesn't
  // stampede the query.
  useRefreshOnFocus({
    refresh: load,
    enabled: !!userId && !!tenantId,
  });

  const log = useCallback(
    (entry: Omit<AuditLogEntry, "id" | "created_at" | "ip_address">) => {
      // Optimistic local prepend for snappy UI. Supabase becomes the
      // system of record; we reconcile on next reload.
      const optimistic: AuditLogEntry = {
        ...entry,
        id: crypto.randomUUID(),
        ip_address: "",
        created_at: new Date().toISOString(),
      };
      setEntries((prev) => [optimistic, ...prev].slice(0, RECENT_LIMIT));

      // Persist to the real audit_log. Fire-and-forget: audit loss is
      // preferable to blocking the caller, but silent loss is worse —
      // so we reconcile any optimistic row that didn't land by
      // trusting the server's view of recent activity on reload.
      (supabase as any)
        .from("audit_log")
        .insert({
          action: entry.action,
          entity_type: entry.entity_type,
          entity_id: entry.entity_id,
          store_id: entry.store_id || tenantId || null,
          user_id: entry.user_id || userId || null,
          user_email: user?.email || null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          details: entry.details || {},
        })
        .then(() => undefined, () => undefined);
    },
    [tenantId, userId, user?.email]
  );

  const getByEntity = useCallback(
    (entityType: string, entityId: string) =>
      entries.filter((e) => e.entity_type === entityType && e.entity_id === entityId),
    [entries]
  );

  const getByStore = useCallback(
    (storeId: string) => entries.filter((e) => e.store_id === storeId),
    [entries]
  );

  const exportCsv = useCallback(
    (storeId?: string) => {
      const filtered = storeId ? entries.filter((e) => e.store_id === storeId) : entries;
      const header = "Timestamp,Action,Entity Type,Entity ID,User ID,User Email,IP,Details";
      const rows = filtered.map((e) =>
        [
          e.created_at,
          e.action,
          e.entity_type,
          e.entity_id,
          e.user_id || "",
          e.user_email || "",
          e.ip_address || "",
          JSON.stringify(e.details || {}).replace(/"/g, '""'),
        ]
          .map((v) => `"${String(v)}"`)
          .join(",")
      );
      return [header, ...rows].join("\n");
    },
    [entries]
  );

  const value = useMemo(
    () => ({ log, entries, getByEntity, getByStore, exportCsv, reload: load, loading }),
    [log, entries, getByEntity, getByStore, exportCsv, load, loading],
  );

  return (
    <AuditContext.Provider value={value}>
      {children}
    </AuditContext.Provider>
  );
};

export const useAudit = () => {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error("useAudit must be used within AuditProvider");
  return ctx;
};
