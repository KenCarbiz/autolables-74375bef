import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { getDeliveryTimeline } from "@/lib/inventoryNetwork/api";
import { useJobsData } from "@/pages/admin/views/integrations/JobsView";
import { Al97Frame, Banner, Card, KeyVals, Savebar, useFixtureCopy } from "@/components/admin/al97/al97ui";
import safePause from "@/assets/al97/safe-pause.svg";

// Connections & billing: what is configured, what work was observed and what
// delivery was proven, kept apart. Reads only (platform admins): billing
// events, entitlement sync audit rows, this account's entitlement, the crawl
// schedule, the jobs ledgers and the Files.com timeline. A manual entitlement
// is not billing proof, and no connection test or paid probe runs from here.

export type CrawlState = "paused" | "active" | "absent" | "unreadable";
export interface ConnectionsFacts {
  files: { arrivals: boolean; importMode: string | null; lastImport: string | null } | null;
  marketcheck: { scheduled: boolean | null; paused: boolean; lastOutcome: string | null } | null;
  billing: { entitlement: { status: string; planTier: string; override: boolean } | null; events: number | null; lastSync: string | null } | null;
  crawl: CrawlState | null;
}
export interface ConnectionsFixture extends ConnectionsFacts { account: string; store: string | null }

const BILLING_DIAGNOSTIC = "/platform-admin?tab=billing";
const words = (s: string) => s.replace(/_/g, " ");
const title = (s: string) => words(s).replace(/\b\w/g, (c) => c.toUpperCase());
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
const db = supabase as any;

interface Row { id: string; system: string; configured: string; work: string; state: { label: string; tone: string }; href: string }

export function connectionRows(f: ConnectionsFacts): Row[] {
  const unknown = { label: "Unknown", tone: "neutral" };
  const files = f.files;
  const mc = f.marketcheck;
  const b = f.billing;
  return [
    {
      id: "files", system: "Files.com", href: "/admin/integrations/files-com",
      configured: !files ? "Unknown" : files.arrivals ? "Metadata and arrivals recorded" : "No arrivals recorded",
      work: !files ? "Unknown" : files.lastImport ? `${files.importMode === "manual" ? "Manual import" : "Import"} ${files.lastImport}` : "None recorded",
      state: !files ? unknown : { label: "Worker needs verification", tone: "amber" },
    },
    {
      id: "marketcheck", system: "MarketCheck", href: ADMIN_CHILD_ROUTES.jobDetail("inventory_sync"),
      configured: !mc || mc.scheduled === null ? "Unknown" : mc.scheduled ? "Saved configuration" : "Not scheduled",
      work: !mc ? "Unknown" : mc.lastOutcome ? `Latest feed ${words(mc.lastOutcome)}` : "None recorded",
      state: !mc ? unknown : mc.paused ? { label: "Paused", tone: "neutral" } : { label: "Needs evidence", tone: "amber" },
    },
    {
      id: "billing", system: "Autocurb billing", href: BILLING_DIAGNOSTIC,
      configured: !b ? "Unknown" : b.entitlement ? `${title(b.entitlement.status)} ${b.entitlement.override ? "override" : "subscription"} entitlement`.replace(/^\w/, (c) => c.toUpperCase()) : "No entitlement",
      work: !b ? "Unknown" : b.lastSync ? `Entitlement sync ${day(b.lastSync)}` : "No handshake event",
      state: !b ? unknown : b.lastSync ? { label: "Handshake recorded", tone: "green" } : { label: "Not demonstrated", tone: "amber" },
    },
    { id: "messaging", system: "Email / SMS", href: ADMIN_CHILD_ROUTES.contactRouting, configured: "Feature switch only", work: "Captured delivery test required", state: { label: "Not verified", tone: "neutral" } },
  ];
}

const CRAWL: Record<CrawlState, { label: string; tone: string }> = {
  paused: { label: "Exists · paused", tone: "neutral" },
  active: { label: "Exists · active", tone: "blue" },
  absent: { label: "No schedule found", tone: "amber" },
  unreadable: { label: "Unreadable", tone: "neutral" },
};

function useLiveFacts(enabled: boolean): ConnectionsFacts {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const jobs = useJobsData();
  const billing = useQuery({
    queryKey: ["admin-v2", "connections", "billing", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const [ev, sync, ent] = await Promise.all([
        db.from("billing_events").select("id", { count: "exact", head: true }),
        db.from("audit_log").select("created_at").eq("action", "entitlements_synced").eq("entity_id", tenantId).order("created_at", { ascending: false }).limit(1),
        db.from("app_entitlements").select("status, plan_tier, stripe_subscription_id").eq("tenant_id", tenantId).eq("app_slug", "autolabels").maybeSingle(),
      ]);
      if (ev.error || sync.error || ent.error) throw new Error((ev.error ?? sync.error ?? ent.error).message);
      const e = ent.data as { status: string; plan_tier: string; stripe_subscription_id: string | null } | null;
      return {
        entitlement: e ? { status: e.status, planTier: e.plan_tier, override: !e.stripe_subscription_id } : null,
        events: ev.count ?? null,
        lastSync: ((sync.data as Array<{ created_at: string }> | null) ?? [])[0]?.created_at ?? null,
      };
    },
  });
  const crawl = useQuery({
    queryKey: ["admin-v2", "connections", "crawl-schedule"],
    enabled,
    queryFn: async (): Promise<CrawlState> => {
      const { data, error } = await db.rpc("get_crawl_advertised_prices_schedule");
      if (error) return "unreadable";
      const row = Array.isArray(data) ? data[0] : data;
      return !row || !row.cron_expression ? "absent" : row.active ? "active" : "paused";
    },
  });
  const timeline = useQuery({ queryKey: ["inv-net", "deliveries"], queryFn: () => getDeliveryTimeline(50), enabled, staleTime: 60_000 });
  const t = timeline.data;
  const imports = t ? [...t.filescom_runs].filter((r) => r.kind === "import").sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)) : [];
  const inv = jobs.rows.find((r) => r.spec.id === "inventory_sync") ?? null;
  const cron = inv && jobs.data && inv.spec.cronName in jobs.data.status.cron ? jobs.data.status.cron[inv.spec.cronName] : "unavailable";
  return {
    files: t ? { arrivals: t.filescom_runs.length > 0, importMode: t.timing.find((x) => x.integration === "filescom_inventory")?.import_mode ?? null, lastImport: imports[0]?.status ?? null } : null,
    marketcheck: inv && jobs.data ? { scheduled: cron === "unavailable" ? null : !!cron, paused: inv.verdict.state === "disabled", lastOutcome: inv.lastOutcome } : null,
    billing: billing.data ?? null,
    crawl: crawl.data ?? null,
  };
}

export default function ConnectionsBillingPage() {
  const fx = useViewFixture<ConnectionsFixture>("al97-connections");
  const { isAdmin } = useAuth();
  const { tenant, currentStore } = useTenant();
  const copy = useFixtureCopy();
  const live = useLiveFacts(!fx && isAdmin);
  const f: ConnectionsFacts = fx ?? live;
  const scopeLabel = { account: fx?.account ?? tenant?.name ?? "This account", store: fx ? fx.store : currentStore?.name ?? null };
  const rows = connectionRows(f);
  const b = f.billing;
  const ent = b?.entitlement ?? null;

  const banner = !b
    ? <Banner tone="amber" icon="warning" title="Billing handshake could not be read" detail={isAdmin || fx ? "The billing reads did not answer. Nothing is shown as connected because the read failed." : "Billing and connection evidence is readable by platform administrators only."} />
    : b.lastSync
      ? <Banner tone="blue" icon="info" title="Billing handshake recorded" detail="An entitlement-sync event is recorded for this account. Delivery to other systems is still verified separately." />
      : <Banner tone="amber" icon="warning" title="Billing handshake is not demonstrated" detail={`${ent?.override ? "Manual active entitlements exist, but no" : "No"} Stripe or entitlement-sync event is recorded.`} />;

  const main = (
    <div className="work">
      {banner}
      <Card id="cb-systems" title="Connected systems">
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">System</th><th scope="col">Configured</th><th scope="col">Last verified work</th><th scope="col">State</th><th scope="col"><span className="sr-only">Inspect</span></th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{r.system}</td><td>{r.configured}</td><td>{r.work}</td><td><span className={`chip ${r.state.tone}`}>{r.state.label}</span></td><td><Link to={r.href} aria-label={`Inspect ${r.system}`}>Inspect</Link></td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <div className="split">
        <div><div>
          <Card id="cb-authority" title="Billing authority">
            <KeyVals rows={[
              ["Authority", "Autocurb webhook"],
              ["AutoLabels Stripe listener", "Shadow event ledger"],
              [copy("billing.entitlementLabel", "Account entitlement"), !b ? "Unknown" : ent ? `${title(ent.status)} ${title(ent.planTier)}` : "None"],
              ["Last handshake success", !b ? "Unknown" : b.lastSync ? day(b.lastSync) : "None recorded"],
            ]} />
          </Card>
        </div></div>
        <div><div>
          <Card id="cb-scheduler" title="Scheduler state">
            <KeyVals rows={[
              ["Advertised-price crawl", f.crawl ? <span className={`chip ${CRAWL[f.crawl].tone}`}>{CRAWL[f.crawl].label}</span> : <span className="chip">Unknown</span>],
              ["Absent schedule", "Different from paused"],
              ["Changing state", "Separate reviewed operation"],
            ]} />
            <img className="art" src={safePause} alt="" />
          </Card>
        </div></div>
      </div>
      <Savebar title="No active connection tests run" detail="Display secret presence only. Never render secret values or request paid probes automatically."
        action={<Link to={BILLING_DIAGNOSTIC} className="btn">View test plan</Link>} />
    </div>
  );
  return <Al97Frame crumb="Connections & billing" title="Connections & billing" subtitle="Configuration, observed activity and proven delivery are separate." scopeLabel={scopeLabel} main={main} />;
}
