import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { describeAge } from "@/lib/admin/health";
import { POLICY_ACTION_TERMS, classifyHistoryAction } from "@/lib/admin/publishingPolicy";
import { AdminButton, AdminCard, AdminTable, EmptyState, InlineNote, SkeletonBlock, Td, Th } from "@/components/admin/v2/primitives";
import emptyList from "@/assets/admin-v2/artwork/empty-list.svg";

// Publishing > Change history: configuration and policy changes for this
// rooftop from audit_log, newest first, paginated. Provider and job events
// are not shown here; they live in Integrations > Activity.

export interface HistoryRow {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  user_email: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
}

export interface ChangeHistoryFixture {
  rows: HistoryRow[];
}

export const HISTORY_PAGE = 25;

export async function loadHistory(tenantId: string, page: number): Promise<{ rows: HistoryRow[]; more: boolean }> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from("audit_log")
    .select("id, action, entity_type, entity_id, user_email, created_at, details")
    .eq("store_id", tenantId)
    .or(POLICY_ACTION_TERMS.map((t) => `action.ilike.%${t}%`).join(","))
    .order("created_at", { ascending: false })
    .range(page * HISTORY_PAGE, page * HISTORY_PAGE + HISTORY_PAGE);
  if (error) throw new Error((error as { message?: string }).message ?? "history read failed");
  const fetched = (data as HistoryRow[] | null) ?? [];
  return { rows: fetched.slice(0, HISTORY_PAGE).filter((r) => classifyHistoryAction(r.action) === "policy"), more: fetched.length > HISTORY_PAGE };
}

const humanize = (s: string) => s.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const keysOf = (details: Record<string, unknown> | null): string => {
  const keys = details?.keys;
  return Array.isArray(keys) ? keys.map(String).join(", ") : "";
};

export default function ChangeHistoryView() {
  const fixture = useViewFixture<ChangeHistoryFixture>("change-history");
  const now = useAdminNow();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const q = useInfiniteQuery({
    queryKey: ["admin-v2", "publishing-history", tenantId],
    enabled: !fixture && !!tenantId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => loadHistory(tenantId as string, pageParam),
    getNextPageParam: (last, _pages, lastParam) => (last.more ? lastParam + 1 : undefined),
    staleTime: 30_000,
  });

  const rows = fixture ? fixture.rows : (q.data?.pages.flatMap((p) => p.rows) ?? []);
  const loading = !fixture && q.isLoading;

  return (
    <div className="space-y-4">
      <AdminCard title="Change history" description="Configuration and policy changes recorded for this rooftop. Provider and job events are in Integrations, Activity." flush>
        {loading ? (
          <div className="px-6 pb-6"><SkeletonBlock className="h-40 w-full" /></div>
        ) : !fixture && q.isError ? (
          <div className="px-6 pb-6"><InlineNote tone="danger" title="History could not be read">{(q.error as Error)?.message ?? "The audit log did not load."}</InlineNote></div>
        ) : rows.length === 0 ? (
          <div className="px-6 pb-6"><EmptyState artwork={emptyList} title="No policy changes recorded" detail="Changes applied through Review & Apply appear here with who made them and which rules moved." compact /></div>
        ) : (
          <>
            <AdminTable caption="Policy change history">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Change</Th>
                  <Th>Rules</Th>
                  <Th>Actor</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-adm-muted"><span title={new Date(r.created_at).toLocaleString()}>{describeAge(r.created_at, now)}</span></Td>
                    <Td>
                      <p className="font-semibold text-adm-ink">{humanize(r.action)}</p>
                      {r.entity_type && <p className="text-[12px] text-adm-muted">{r.entity_type}</p>}
                    </Td>
                    <Td className="text-[12px] text-adm-muted">{keysOf(r.details) || "Not recorded"}</Td>
                    <Td className="text-adm-muted">{r.user_email ?? "System"}</Td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
            {!fixture && (
              <div className="flex items-center justify-between px-6 py-3 text-[12px] text-adm-muted">
                <span>Showing {rows.length} change{rows.length === 1 ? "" : "s"}</span>
                {q.hasNextPage && <AdminButton size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Load more</AdminButton>}
              </div>
            )}
          </>
        )}
      </AdminCard>
    </div>
  );
}
