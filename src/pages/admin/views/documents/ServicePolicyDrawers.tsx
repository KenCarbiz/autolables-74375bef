import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { AdminButton, InlineNote } from "@/components/admin/v2/primitives";
import { AdminIcon, DetailDrawer, PreviewOnlyNotice, StatusBadge } from "@/components/admin/v3/editor";
import { TITLE_LINK_DAYS, dollars, reconRoute, titleCadence, type TitlePolicy } from "@/lib/admin/servicePolicyModel";
import { INPUT_CLASS, FIELD_LABEL } from "./controls";

export function ReconRoutePreview({ open, onClose, threshold, approvers }: { open: boolean; onClose: () => void; threshold: number; approvers: string[] }) {
  const [raw, setRaw] = useState("");
  const amount = /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : null;
  const route = amount === null ? null : reconRoute(amount, threshold);
  const every = !(threshold > 0);
  return (
    <DetailDrawer open={open} onClose={onClose} title="Approval route preview" description="Type a line-item amount to see where it would route under the values on screen. Nothing is sent or saved.">
      <PreviewOnlyNotice>Each line item is judged on its own. There is no total repair-order limit.</PreviewOnlyNotice>
      <div>
        <label htmlFor="route-amount" className={FIELD_LABEL}>Line-item amount ($)</label>
        <input id="route-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} className={INPUT_CLASS} placeholder="Enter an amount" />
      </div>
      <div role="status" aria-live="polite" className="rounded-lg border border-adm-divider px-3.5 py-3 text-[14px] leading-[20px]">
        {route === null ? (
          <p className="text-adm-muted">{raw.trim() ? "Enter a number, for example 250." : "Enter an amount to see its route."}</p>
        ) : route === "auto" ? (
          <p><span className="font-semibold">{dollars(amount as number)}</span> is at or under {dollars(threshold)}, so it is approved automatically.</p>
        ) : every ? (
          <p><span className="font-semibold">{dollars(amount as number)}</span> routes to the used-car manager because every amount needs approval.</p>
        ) : (
          <p><span className="font-semibold">{dollars(amount as number)}</span> is over {dollars(threshold)}, so it routes to the used-car manager to approve or decline.</p>
        )}
      </div>
      <p className="text-[14px] leading-[20px]"><span className="text-adm-muted">Approvers: </span>{approvers.length ? approvers.join(", ") : "none named. The link goes to the dealership main contact email."}</p>
      <p className="text-[13px] leading-[18px] text-adm-muted">Amounts at exactly the limit are approved automatically. A limit of 0 sends every line item to the manager.</p>
    </DetailDrawer>
  );
}

export interface ProductOption {
  id: string;
  name: string;
  badge_type: string | null;
}

export function TaskPicker({ open, onClose, tasks, onToggle, disabled, fixtureProducts, fixtureActive }: { open: boolean; onClose: () => void; tasks: string[]; onToggle: (label: string) => void; disabled: boolean; fixtureProducts?: ProductOption[] | null; fixtureActive: boolean }) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [q, setQ] = useState("");
  const live = useQuery({
    queryKey: ["admin-v2", "service-task-products", tenantId],
    enabled: open && !fixtureActive && !!tenantId,
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await supabase.from("products").select("id, name, badge_type").eq("tenant_id", tenantId as string).eq("is_active", true).order("name").limit(200);
      if (error || !Array.isArray(data)) throw new Error("products");
      return data as ProductOption[];
    },
    staleTime: 60_000,
    retry: false,
  });
  const products = fixtureActive ? fixtureProducts : live.data;
  const failed = fixtureActive ? fixtureProducts === null : live.isError;
  const has = (label: string) => tasks.some((t) => t.toLowerCase() === label.toLowerCase());
  const shown = (products ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const known = new Set((products ?? []).map((p) => p.name.toLowerCase()));
  const orphan = tasks.filter((t) => !known.has(t.toLowerCase()));
  return (
    <DetailDrawer open={open} onClose={onClose} title="Task picker" description="Choose which Service Install tasks need a photo. The saved value is the task label.">
      <div>
        <label htmlFor="task-search" className={FIELD_LABEL}>Search tasks</label>
        <input id="task-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} className={INPUT_CLASS} placeholder="Search active products" />
      </div>
      {!fixtureActive && live.isLoading && <p role="status" className="text-[14px] text-adm-muted">Reading active products</p>}
      {failed && <InlineNote tone="neutral">The product list could not be read. Existing tasks below are unchanged; you can still type a label in the editor.</InlineNote>}
      {products && shown.length === 0 && <p className="text-[14px] text-adm-muted">{products.length === 0 ? "No active products. Installed products appear here once they are added." : "No product matches that search."}</p>}
      <ul className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5 min-h-[56px]">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] leading-[20px] font-semibold break-words">{p.name}</span>
              <span className="block text-[13px] leading-[18px] text-adm-muted break-all">ID {p.id}{p.badge_type ? ` . ${p.badge_type}` : ""}</span>
            </span>
            <AdminButton size="sm" aria-pressed={has(p.name)} aria-label={`${has(p.name) ? "Remove" : "Require"} photo proof for ${p.name}`} disabled={disabled} onClick={() => onToggle(p.name)} className="min-h-[44px] sm:min-h-[32px]">
              {has(p.name) ? "Required" : "Add"}
            </AdminButton>
          </li>
        ))}
      </ul>
      {orphan.length > 0 && products && (
        <div>
          <p className="text-[14px] leading-[20px] font-semibold">Labels with no matching active product</p>
          <ul className="mt-1 space-y-1">{orphan.map((t) => <li key={t} className="flex items-center gap-2 text-[14px]"><StatusBadge state="unknown" label="No match" />{t}</li>)}</ul>
          <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">These still apply to any Service Install task with this exact label.</p>
        </div>
      )}
    </DetailDrawer>
  );
}

export function TitleRequestPreview({ open, onClose, policy }: { open: boolean; onClose: () => void; policy: TitlePolicy }) {
  const c = titleCadence(policy);
  const who = policy.title_round_robin && c.recipients.length > 1 ? `${c.recipients[0]} first, then each next request goes to the next person` : c.recipients.length ? c.recipients.slice(0, 3).join(", ") : "the dealership main contact email";
  return (
    <DetailDrawer open={open} onClose={onClose} title="Title request preview" description="What the office receives for a vehicle with no title or MCO on file.">
      <PreviewOnlyNotice>This is a preview built from the values on screen. It sends nothing, creates no upload link and contacts no one.</PreviewOnlyNotice>
      <dl className="rounded-lg border border-adm-divider px-3.5 divide-y divide-adm-divider text-[14px] leading-[20px]">
        <div className="py-2.5"><dt className="text-adm-muted">To</dt><dd className="font-medium break-words">{who}</dd></div>
        <div className="py-2.5"><dt className="text-adm-muted">Subject</dt><dd className="font-medium">Upload the title or MCO for the vehicle (year, make, model and stock number)</dd></div>
        <div className="py-2.5"><dt className="text-adm-muted">Contains</dt><dd>A private upload link and QR code for this vehicle. The link expires {TITLE_LINK_DAYS} days after it is created.</dd></div>
        <div className="py-2.5"><dt className="text-adm-muted">Reminders</dt><dd>{c.frequency}. {policy.title_reminders_enabled ? c.next : ""}</dd></div>
        <div className="py-2.5"><dt className="text-adm-muted">Stops</dt><dd>{c.stop}</dd></div>
      </dl>
      {c.setupIssue && <InlineNote tone="warning">{c.setupIssue}</InlineNote>}
      <p className="text-[13px] leading-[18px] text-adm-muted">Uploads go into the private vehicle file under the existing access grants.</p>
    </DetailDrawer>
  );
}

export interface ReminderRow {
  id: string;
  vin: string;
  at: string;
}

export function ReminderHistory({ open, onClose, fixtureRows, fixtureActive }: { open: boolean; onClose: () => void; fixtureRows?: ReminderRow[] | null; fixtureActive: boolean }) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const live = useQuery({
    queryKey: ["admin-v2", "title-reminder-history", tenantId],
    enabled: open && !fixtureActive && !!tenantId,
    queryFn: async (): Promise<ReminderRow[]> => {
      const { data, error } = await supabase.from("audit_log").select("id, entity_id, created_at").eq("store_id", tenantId as string).eq("action", "title_request_emailed").order("created_at", { ascending: false }).limit(25);
      if (error || !Array.isArray(data)) throw new Error("audit");
      return data.map((r) => ({ id: r.id, vin: r.entity_id, at: r.created_at }));
    },
    staleTime: 60_000,
    retry: false,
  });
  const rows = fixtureActive ? fixtureRows : live.data;
  const unavailable = fixtureActive ? fixtureRows === null || fixtureRows === undefined : live.isError;
  return (
    <DetailDrawer open={open} onClose={onClose} title="Reminder history" description="Requests the office was emailed, read from the activity log. Newest first, up to 25.">
      {!fixtureActive && live.isLoading && <p role="status" className="text-[14px] text-adm-muted">Reading the activity log</p>}
      {unavailable && !live.isLoading && <InlineNote tone="neutral">Reminder history is unavailable because the activity log could not be read. No reminder is implied either way.</InlineNote>}
      {rows && rows.length === 0 && <p className="text-[14px] text-adm-muted">No title request email is recorded yet.</p>}
      {rows && rows.length > 0 && (
        <ol className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[14px] leading-[20px]">
              <AdminIcon name="mail" className="text-adm-muted" />
              <span className="min-w-0 flex-1"><span className="block font-medium break-all">VIN {r.vin}</span><span className="block text-[13px] text-adm-muted">{new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[13px] leading-[18px] text-adm-muted">Reminders for a vehicle stop when its title or MCO is received. This list is read only.</p>
    </DetailDrawer>
  );
}

