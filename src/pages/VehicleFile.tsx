import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileText,
  FileUp,
  Gauge,
  Globe,
  PackageCheck,
  Printer,
  QrCode,
  ShieldCheck,
  Signature,
  Tag,
  Upload,
  Wrench,
} from "lucide-react";
import VehicleFileConnectedHero from "@/components/vehicle/VehicleFileConnectedHero";

type TabId = "overview" | "documents" | "addendum" | "labels" | "prep" | "sign";

type VehicleRow = {
  id: string;
  tenant_id: string | null;
  vin: string;
  slug: string | null;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  view_count: number | null;
  sticker_snapshot?: Record<string, unknown> | null;
  dealer_snapshot?: Record<string, unknown> | null;
  documents?: Array<{ name: string; url: string; type: string }> | null;
  photos?: string[] | null;
  hero_image_url?: string | null;
  prep_status?: { all_accessories_installed?: boolean; foreman_signed_at?: string } | null;
  recall_check?: Record<string, unknown> | null;
  recall_status?: string | null;
  recall_checked_at?: string | null;
  open_recall_count?: number | null;
  mc_attributes?: Record<string, unknown> | null;
  packet_modules?: Record<string, boolean> | null;
  created_at: string;
  updated_at: string;
};

type ReadyCheck = { label: string; ok: boolean; when?: string | null; blocks?: boolean };

const tabs: Array<{ id: TabId; label: string; icon: typeof Car }> = [
  { id: "overview", label: "Overview", icon: Car },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "addendum", label: "Addendum", icon: FileText },
  { id: "labels", label: "Labels", icon: Tag },
  { id: "prep", label: "Prep & Install", icon: Wrench },
  { id: "sign", label: "Customer Sign-Off", icon: Signature },
];

const buildChecks = (vehicle: VehicleRow): ReadyCheck[] => [
  { label: "Vehicle Created", ok: true, when: vehicle.created_at },
  { label: "VIN Decoded", ok: !!vehicle.ymm, when: vehicle.ymm ? vehicle.updated_at : null },
  { label: "Sticker Generated", ok: vehicle.status === "published", when: vehicle.published_at, blocks: true },
  { label: "Addendum Completed", ok: !!vehicle.sticker_snapshot && Object.keys(vehicle.sticker_snapshot || {}).length > 0, when: null, blocks: true },
  { label: "Customer Sign-Off", ok: vehicle.status === "published", when: null, blocks: true },
];

const readinessSummary = (vehicle: VehicleRow) => {
  const checks = buildChecks(vehicle);
  const done = checks.filter((check) => check.ok).length;
  const pct = Math.round((done / checks.length) * 100);
  return { checks, done, pct, remaining: checks.filter((check) => !check.ok) };
};

const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "pending";
const timeLabel = (value?: string | null) => value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const attr = (vehicle: VehicleRow, keys: string[], fallback = "—") => {
  const source = vehicle.mc_attributes || {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && `${value}`.trim()) return `${value}`;
  }
  return fallback;
};

export default function VehicleFile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") as TabId | null;
  const [tab, setTabState] = useState<TabId>(requestedTab && tabs.some((item) => item.id === requestedTab) ? requestedTab : "overview");
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);

  const setTab = (next: TabId) => {
    setTabState(next);
    const p = new URLSearchParams(params);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await (supabase as any).from("vehicle_listings").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setVehicle(data as VehicleRow);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const gallery = useMemo(() => {
    if (!vehicle) return [] as string[];
    const photos = vehicle.photos?.filter(Boolean) || [];
    if (photos.length) return photos;
    return vehicle.hero_image_url ? [vehicle.hero_image_url] : [];
  }, [vehicle]);

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" /></div>;
  }

  if (notFound || !vehicle) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <Car className="mx-auto h-10 w-10 text-slate-300" />
        <h2 className="mt-3 text-lg font-black text-slate-950">Vehicle not found</h2>
        <button onClick={() => navigate("/inventory")} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">Back to Inventory</button>
      </div>
    );
  }

  const ready = readinessSummary(vehicle);
  const safeImg = gallery.length ? Math.min(imgIdx, gallery.length - 1) : 0;
  const publicUrl = `${window.location.origin}/v/${vehicle.slug || vehicle.vin}`;
  const packetCount = [vehicle.documents?.length, vehicle.packet_modules ? Object.values(vehicle.packet_modules).filter(Boolean).length : 0, vehicle.status === "published" ? 1 : 0].reduce((sum, value) => sum + (Number(value) || 0), 0);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Shopper link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 pb-24 lg:p-6">
      <VehicleFileConnectedHero
        vehicle={vehicle}
        gallery={gallery}
        safeImg={safeImg}
        ready={ready}
        publicUrl={publicUrl}
        onBack={() => navigate("/inventory")}
        onPrevPhoto={() => setImgIdx((safeImg - 1 + gallery.length) % gallery.length)}
        onNextPhoto={() => setImgIdx((safeImg + 1) % gallery.length)}
        onCopyLink={copyLink}
        onLabels={() => setTab("labels")}
      />

      <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white/80 px-1 pb-0 backdrop-blur">
        {tabs.map(({ id: tabId, label, icon: Icon }) => {
          const active = tab === tabId;
          const count = tabId === "documents" ? vehicle.documents?.length || 0 : tabId === "addendum" ? 1 : tabId === "labels" ? 2 : undefined;
          return (
            <button key={tabId} onClick={() => setTab(tabId)} className={`relative inline-flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-black transition ${active ? "text-blue-700" : "text-slate-600 hover:text-slate-950"}`}>
              <Icon className="h-4 w-4" /> {label}
              {count ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span> : null}
              {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-blue-600" />}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_0.95fr]">
          <VehicleReadinessCard checks={ready.checks} pct={ready.pct} remaining={ready.remaining.length} />
          <ActivityFeedCard vehicle={vehicle} ready={ready} />
          <QuickActionsCard
            onSticker={() => setTab("labels")}
            onAddendum={() => setTab("addendum")}
            onDocs={() => setTab("documents")}
            onSign={() => setTab("sign")}
            onPortal={() => window.open(publicUrl, "_blank", "noopener")}
          />

          <VehicleInformationCard vehicle={vehicle} />
          <div className="grid gap-4">
            <RecallStatusCard vehicle={vehicle} />
            <PacketCompletenessCard pct={ready.pct} complete={packetCount} />
          </div>
          <ShopperPortalPreviewCard vehicle={vehicle} publicUrl={publicUrl} onCopy={copyLink} />
        </div>
      ) : (
        <TabPlaceholder tab={tab} vehicle={vehicle} publicUrl={publicUrl} />
      )}
    </div>
  );
}

function VehicleReadinessCard({ checks, pct, remaining }: { checks: ReadyCheck[]; pct: number; remaining: number }) {
  return (
    <Card title="Vehicle Readiness">
      <div className="grid gap-5 md:grid-cols-[170px_1fr] md:items-center">
        <div className="flex flex-col items-center justify-center">
          <div className="flex h-36 w-36 items-center justify-center rounded-full border-[10px] border-slate-100 text-center" style={{ borderRightColor: pct === 100 ? "#10B981" : "#F97316" }}>
            <div><div className="text-4xl font-black text-slate-950">{pct}%</div><div className={`text-sm font-black ${pct === 100 ? "text-emerald-600" : "text-red-600"}`}>{pct === 100 ? "Ready" : "Not Ready"}</div></div>
          </div>
        </div>
        <div className="space-y-3">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center gap-3 border-b border-slate-100 pb-2 last:border-0">
              {check.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <CircleAlert className={`h-5 w-5 ${check.blocks ? "text-red-500" : "text-amber-500"}`} />}
              <span className="flex-1 text-sm font-black text-slate-800">{check.label}</span>
              <span className={`text-xs font-semibold ${check.ok ? "text-slate-500" : check.blocks ? "text-red-500" : "text-slate-500"}`}>{check.ok ? dateLabel(check.when) : check.blocks ? "Not Started" : "In Progress"}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 text-sm font-black">
            <span className="text-red-500">{remaining} tasks remaining</span>
            <button className="text-blue-600">View all tasks →</button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ActivityFeedCard({ vehicle, ready }: { vehicle: VehicleRow; ready: ReturnType<typeof readinessSummary> }) {
  const items = [
    { label: "Vehicle created", detail: "by AutoLabels", time: vehicle.created_at, ok: true },
    { label: "VIN decoded", detail: vehicle.ymm || "Action required", time: vehicle.updated_at, ok: !!vehicle.ymm },
    { label: "Prep & install signed off", detail: vehicle.prep_status?.foreman_signed_at ? "Completed" : "Action required", time: vehicle.prep_status?.foreman_signed_at || null, ok: !!vehicle.prep_status?.foreman_signed_at },
    ...ready.remaining.slice(0, 2).map((item) => ({ label: item.label.toLowerCase().includes("sticker") ? "Sticker not generated" : `${item.label} missing`, detail: "Action required", time: null, ok: false })),
  ];
  return (
    <Card title="Activity Feed" action="View all">
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.ok ? <ShieldCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span>
            <div className="min-w-0 flex-1"><div className="text-sm font-black text-slate-950">{item.label}</div><div className="text-xs font-semibold text-slate-500">{item.detail}</div></div>
            <div className="text-xs font-semibold text-slate-500">{item.time ? timeLabel(item.time) : "—"}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function QuickActionsCard({ onSticker, onAddendum, onDocs, onSign, onPortal }: { onSticker: () => void; onAddendum: () => void; onDocs: () => void; onSign: () => void; onPortal: () => void }) {
  return (
    <Card title="Quick Actions">
      <div className="space-y-2">
        <ActionButton icon={Printer} label="Generate Sticker" onClick={onSticker} />
        <ActionButton icon={FileText} label="Create Addendum" onClick={onAddendum} />
        <ActionButton icon={Upload} label="Upload Documents" onClick={onDocs} />
        <ActionButton icon={Signature} label="Customer Sign-Off" onClick={onSign} />
        <ActionButton icon={Globe} label="Publish Vehicle" onClick={onSticker} />
        <ActionButton icon={ExternalLink} label="Open Shopper Portal" onClick={onPortal} />
      </div>
    </Card>
  );
}

function VehicleInformationCard({ vehicle }: { vehicle: VehicleRow }) {
  const options = ["Premium Package", "Luxe Package", "Tow Package", "Panoramic Roof", "Heated Seats"];
  return (
    <Card title="Vehicle Information" action="Edit">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <InfoLine label="Trim" value={vehicle.trim || "—"} />
          <InfoLine label="Engine" value={attr(vehicle, ["engine", "engine_description", "engine_type"], "—")} />
          <InfoLine label="Drivetrain" value={attr(vehicle, ["drivetrain", "drive_type"], "—")} />
          <InfoLine label="Exterior Color" value={attr(vehicle, ["exterior_color", "exterior"], "—")} />
          <InfoLine label="Interior Color" value={attr(vehicle, ["interior_color", "interior"], "—")} />
        </div>
        <div>
          <div className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">Packages & Options</div>
          <div className="space-y-3">
            {options.map((item) => <div key={item} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {item}</div>)}
          </div>
          <button className="mt-4 text-sm font-black text-blue-600">View all</button>
        </div>
      </div>
    </Card>
  );
}

function RecallStatusCard({ vehicle }: { vehicle: VehicleRow }) {
  const open = Number(vehicle.open_recall_count || 0);
  return (
    <Card title="Recall Status">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-full ${open > 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{open > 0 ? <CircleAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</span>
        <div><div className="font-black text-slate-950">{open > 0 ? `${open} active recall${open === 1 ? "" : "s"}` : "No active recalls"}</div><div className="text-sm font-semibold text-slate-500">Last checked: {dateLabel(vehicle.recall_checked_at || vehicle.updated_at)}</div></div>
      </div>
      <button className="mt-4 h-11 w-full rounded-xl border border-slate-200 text-sm font-black text-slate-700">Check for recalls</button>
    </Card>
  );
}

function PacketCompletenessCard({ pct, complete }: { pct: number; complete: number }) {
  return (
    <Card title="Packet Completeness">
      <div className="flex items-end justify-between"><div className="text-3xl font-black text-slate-950">{pct}%</div><div className="text-sm font-semibold text-slate-500">{complete} of 9 complete</div></div>
      <div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} /></div>
      <button className="mt-4 text-sm font-black text-blue-600">View details →</button>
    </Card>
  );
}

function ShopperPortalPreviewCard({ vehicle, publicUrl, onCopy }: { vehicle: VehicleRow; publicUrl: string; onCopy: () => void }) {
  const img = vehicle.hero_image_url || vehicle.photos?.[0] || "";
  return (
    <Card title="Shopper Portal Preview">
      <div className="grid gap-4 md:grid-cols-[1fr_140px]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-inner">{img ? <img src={img} alt="Shopper portal" className="h-28 w-full rounded-xl object-cover" /> : <div className="flex h-28 items-center justify-center text-slate-400"><Car className="h-10 w-10" /></div>}</div>
        <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-200 bg-white"><QrCode className="h-20 w-20 text-slate-950" /></div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700"><span className="truncate">{publicUrl}</span><button onClick={onCopy}><Copy className="h-4 w-4" /></button></div>
      <div className="mt-3 grid gap-3 md:grid-cols-2"><button className="h-11 rounded-xl border border-slate-200 text-sm font-black text-blue-600">Preview Page</button><a href={publicUrl} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center rounded-xl border border-slate-200 text-sm font-black text-blue-600">Open in Shopper Portal</a></div>
    </Card>
  );
}

function TabPlaceholder({ tab, vehicle, publicUrl }: { tab: TabId; vehicle: VehicleRow; publicUrl: string }) {
  const labels: Record<TabId, string> = { overview: "Overview", documents: "Documents", addendum: "Addendum", labels: "Labels", prep: "Prep & Install", sign: "Customer Sign-Off" };
  return (
    <Card title={labels[tab]}>
      <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
        <PackageCheck className="h-12 w-12 text-blue-600" />
        <h2 className="mt-3 text-xl font-black text-slate-950">{labels[tab]}</h2>
        <p className="mt-1 max-w-lg text-sm font-semibold text-slate-500">This workspace stays connected to {vehicle.ymm || vehicle.vin}. Use the quick actions above to generate, upload, approve, or publish this vehicle packet.</p>
        {tab === "sign" && <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">Open customer portal</a>}
      </div>
    </Card>
  );
}

function Card({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black text-slate-950">{title}</h2>{action && <button className="text-sm font-black text-blue-600">{action}</button>}</div>{children}</section>;
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Car; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50"><span className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-4 w-4" /></span>{label}</span><ChevronRight className="h-4 w-4 text-slate-400" /></button>;
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[120px_1fr] gap-4 text-sm"><span className="font-semibold text-slate-500">{label}</span><span className="font-black text-slate-800">{value}</span></div>;
}
