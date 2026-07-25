import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Car, CheckCircle2, Clock, FileText, Globe, History,
  Lock, MoreVertical, PlayCircle, QrCode, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useVinCommand, type PackageItem } from "@/hooks/useCommandCenter";
import {
  CommandCard, CommandStatCard, EmptyState, ErrorCard, LoadingCard, StatusPill,
  TimelineRail, VehicleIdentityStrip,
} from "@/components/command/CommandPrimitives";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

// /vin-command/:vehicleId — the single-VIN review surface. Everything shown is
// measured by useVinCommand; this file renders it and routes the operator to
// the next step. No status, count or completion is manufactured here.

const STATUS_LABEL: Record<PackageItem["status"], string> = {
  draft_created: "Draft Created",
  created: "Created",
  ready: "Ready",
  prefilled: "Prefilled",
  published: "Published",
  retry_required: "Retry Required",
  blocked: "Blocked",
  pending: "Pending",
};

// The comp fixes the reading order of the package. The hook owns the contents,
// so unrecognized rows keep their own order and are appended rather than lost.
const ITEM_ORDER = [
  "k-208", "ftc buyers guide", "buyers guide", "used addendum", "addendum",
  "used-car sticker", "used car sticker", "recall", "rear service qr",
  "key-tag qr", "key tag qr", "service get ready", "prep & vendors", "description",
];

const orderRank = (item: PackageItem) => {
  const hay = `${item.key} ${item.label}`.toLowerCase();
  const i = ITEM_ORDER.findIndex((k) => hay.includes(k));
  return i === -1 ? ITEM_ORDER.length : i;
};

const isQrItem = (item: PackageItem) => /qr|key.?tag/i.test(`${item.key} ${item.label}`);

const conditionLabel = (raw: string | null) => {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (/^cpo$/i.test(v)) return "CPO";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
};

const errorText = (e: unknown) => {
  if (typeof e === "string" && e) return e;
  if (e instanceof Error && e.message) return e.message;
  return "This vehicle's command center could not be loaded.";
};

const StatusCell = ({ status, label }: { status: PackageItem["status"]; label: string }) => {
  if (status === "blocked") {
    return (
      <span className="text-[12.5px] font-semibold text-red-600 inline-flex items-center gap-1.5">
        <XCircle className="w-4 h-4 shrink-0" /> {label}
      </span>
    );
  }
  if (status === "retry_required") {
    return (
      <span className="text-[12.5px] font-semibold text-amber-700 inline-flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 shrink-0" /> {label}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="text-[12.5px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
        <Clock className="w-4 h-4 shrink-0" /> {label}
      </span>
    );
  }
  return (
    <span className="text-[12.5px] font-semibold text-emerald-700 inline-flex items-center gap-1.5">
      <CheckCircle2 className="w-4 h-4 shrink-0" /> {label}
    </span>
  );
};

export default function VinCommandCenter() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const { data, loading, error, reload } = useVinCommand(vehicleId);

  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number; item: PackageItem } | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onScroll = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  const items = useMemo(
    () => (data ? [...data.packageItems].sort((a, b) => orderRank(a) - orderRank(b)) : []),
    [data],
  );

  const canView = hasDealerCapability(member?.role, "can_view_inventory", isAdmin);
  const timeline = data?.timeline ?? [];
  const shownTimeline = showAllHistory ? timeline : timeline.slice(0, 6);

  const openHref = (href: string) => {
    if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else navigate(href);
  };

  const copyText = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`); }
    catch { toast.error("Clipboard unavailable"); }
  };

  const header = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        {/* AppShell renders the title in the desktop chrome, so the in-content
            copy is mobile-only — same convention as DescriptionOperations. */}
        <div className="min-w-0 lg:hidden">
          <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground leading-none">
            VIN Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything created automatically. Review exceptions and authorize the next step.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowHowItWorks((v) => !v)}
            aria-expanded={showHowItWorks}
            className="min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
            <PlayCircle className="w-4 h-4" /> How it works
          </button>
          <button
            onClick={() => {
              setShowAllHistory((v) => !v);
              railRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            disabled={timeline.length === 0}
            aria-expanded={showAllHistory}
            title={timeline.length === 0 ? "No activity has been recorded for this VIN yet" : undefined}
            className="min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5 disabled:opacity-50 disabled:hover:border-border">
            <History className="w-4 h-4" /> History
          </button>
        </div>
      </div>

      {showHowItWorks && (
        <div className="rounded-2xl border border-border bg-card p-4 mb-3">
          <h2 className="text-[13px] font-bold text-foreground mb-2">How this vehicle gets to market</h2>
          <ol className="space-y-1.5">
            {[
              "At intake, AutoLabels builds the document package for the VIN — disclosures, stickers, QR tags and the description.",
              "This page lists what was produced and flags anything that needs a person. Green rows need no action.",
              "Authorize Get Ready once to release work assignments, then print the package and publish the customer Passport.",
            ].map((line, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] text-muted-foreground">
                <span className="w-5 h-5 shrink-0 grid place-items-center rounded-full border border-border text-[10.5px] font-bold text-foreground">
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );

  const shell = (children: React.ReactNode) => (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      {header}
      {children}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Lock className="w-3.5 h-3.5" /> AI-generated content. Always review for accuracy.
      </p>
    </div>
  );

  if (!vehicleId) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Pick a vehicle to open its command center."
        detail="The VIN Command Center covers one vehicle at a time. Choose one from Inventory to see its automated package."
        action={
          <button
            onClick={() => navigate("/inventory")}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5">
            Go to Inventory <ArrowRight className="w-4 h-4" />
          </button>
        }
      />,
    );
  }

  if (!entLoading && !canView) {
    return shell(
      <EmptyState
        Icon={Lock}
        title="You do not have access to this vehicle's command center."
        detail="Your role cannot view inventory records. Ask an owner or manager to grant inventory access."
        action={
          <button
            onClick={() => navigate("/dashboard")}
            className="min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground">
            Back to Home
          </button>
        }
      />,
    );
  }

  if (error) {
    return shell(<ErrorCard message={errorText(error)} onRetry={reload} />);
  }

  if (loading || (!data && entLoading)) {
    return shell(
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="order-2 lg:order-1 min-w-0 space-y-3">
          <LoadingCard rows={3} />
          <LoadingCard rows={8} />
        </div>
        <div className="order-1 lg:order-2 lg:w-[360px] space-y-3">
          <LoadingCard rows={4} />
          <LoadingCard rows={5} />
        </div>
      </div>,
    );
  }

  if (!data) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Vehicle not found."
        detail="This vehicle is not in your inventory, or it was removed. Pick another vehicle from Inventory."
        action={
          <button
            onClick={() => navigate("/inventory")}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5">
            Go to Inventory <ArrowRight className="w-4 h-4" />
          </button>
        }
      />,
    );
  }

  const { vehicle, counts, readiness } = data;
  const intakeAt = vehicle.intakeCompletedAt ? new Date(vehicle.intakeCompletedAt) : null;
  const automationPct = counts.automationTotal > 0
    ? `${Math.round((counts.automationDone / counts.automationTotal) * 100)}%`
    : undefined;

  return shell(
    <>
      <div className="mb-3">
        <VehicleIdentityStrip
          imageUrl={vehicle.heroImageUrl}
          ymm={vehicle.ymm}
          trim={vehicle.trim}
          stockNumber={vehicle.stockNumber}
          vin={vehicle.vin}
          conditionLabel={conditionLabel(vehicle.condition)}
          meta={[{
            label: "Intake Completed",
            value: intakeAt
              ? intakeAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
              : "Not recorded",
            sub: intakeAt
              ? intakeAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : undefined,
          }]}
          onCopyVin={() => copyText(vehicle.vin, "VIN")}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <CommandStatCard
          label="Automation Complete"
          Icon={CheckCircle2}
          tone="blue"
          value={
            <>
              {counts.automationDone}
              <span className="text-[15px] font-semibold text-muted-foreground"> / {counts.automationTotal}</span>
            </>
          }
          sub={automationPct}
        />
        <CommandStatCard
          label="Awaiting Authorization"
          Icon={Clock}
          tone="blue"
          value={counts.awaitingAuthorization == null ? "—" : counts.awaitingAuthorization}
          sub="Ready to review"
        />
        <CommandStatCard
          label="Exceptions"
          Icon={AlertTriangle}
          tone="amber"
          value={counts.exceptions}
          sub={counts.exceptions > 0 ? "Needs attention" : "None open"}
        />
        <CommandStatCard
          label="Passport"
          Icon={Globe}
          tone="emerald"
          value={counts.passportPublished}
          sub={counts.passportPublished > 0 ? "Published" : "Not published"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        {/* Main column */}
        <div className="order-2 lg:order-1 min-w-0">
          <CommandCard title="Automated Intake Package">
            {items.length === 0 ? (
              <EmptyState
                Icon={FileText}
                title="Nothing has been created for this VIN yet."
                detail="Documents, labels and QR tags appear here as automation completes."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[720px]">
                    <thead>
                      <tr className="text-[11.5px] font-semibold text-muted-foreground border-b border-border">
                        <th className="px-3 py-2.5">Item</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Details</th>
                        <th className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((item) => {
                        const ItemIcon = isQrItem(item) ? QrCode : FileText;
                        return (
                          <tr key={item.key} className="hover:bg-primary/[0.025] transition-colors">
                            <td className="px-3 py-3">
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <ItemIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="text-[12.5px] font-semibold text-foreground">{item.label}</span>
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <StatusCell status={item.status} label={STATUS_LABEL[item.status] ?? item.status} />
                            </td>
                            <td className="px-3 py-3">
                              <span className="text-[12.5px] text-muted-foreground">{item.detail}</span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="inline-flex items-center gap-1 justify-end">
                                {item.href ? (
                                  <button
                                    onClick={() => openHref(item.href as string)}
                                    className="min-h-[44px] px-2 text-[12.5px] font-semibold text-blue-700 hover:underline">
                                    View
                                  </button>
                                ) : (
                                  <span className="px-2 text-[12.5px] text-muted-foreground" title="Nothing to open yet">—</span>
                                )}
                                <button
                                  aria-label={`More actions for ${item.label}`}
                                  aria-haspopup="menu"
                                  aria-expanded={menu?.key === item.key}
                                  onClick={(e) => {
                                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    // Flip above the trigger when the menu would run off
                                    // the bottom of the viewport.
                                    const MENU_H = 156;
                                    const below = window.innerHeight - r.bottom > MENU_H + 12;
                                    setMenu(menu?.key === item.key ? null : {
                                      key: item.key, x: r.right,
                                      y: below ? r.bottom + 4 : Math.max(8, r.top - MENU_H - 4),
                                      item,
                                    });
                                  }}
                                  className="w-11 h-11 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50">
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => navigate(`/print-center/${vehicleId}`)}
                    className="min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> View Full Package
                  </button>
                </div>
              </>
            )}
          </CommandCard>
        </div>

        {/* Right rail */}
        <div ref={railRef} className="order-1 lg:order-2 lg:w-[360px] space-y-3">
          <CommandCard title="Current Readiness">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] text-muted-foreground">State</span>
              <StatusPill tone={readiness.tone}>{readiness.state}</StatusPill>
            </div>

            {readiness.blocking && (
              <>
                <p className="text-[11.5px] font-semibold text-muted-foreground mt-3 mb-1.5">Blocking Issue</p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-bold text-amber-900">{readiness.blocking.title}</p>
                      <p className="text-[11.5px] text-amber-800 mt-0.5">{readiness.blocking.detail}</p>
                    </div>
                  </div>
                  {readiness.blocking.href && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => openHref(readiness.blocking!.href as string)}
                        className="min-h-[44px] px-1 text-[12px] font-semibold text-amber-900 hover:underline">
                        View Details
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <button
              onClick={() => navigate(`/get-ready-command/${vehicleId}`)}
              className="mt-3 w-full min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center justify-center gap-1.5">
              Review &amp; Authorize Get Ready <ArrowRight className="w-4 h-4" />
            </button>
          </CommandCard>

          <CommandCard title="VIN Timeline">
            {timeline.length === 0 ? (
              <EmptyState
                Icon={History}
                title="No activity recorded yet."
                detail="Every automated and manual step on this VIN is logged here."
              />
            ) : (
              <>
                <TimelineRail entries={shownTimeline} />
                {timeline.length > 6 && (
                  <button
                    onClick={() => setShowAllHistory((v) => !v)}
                    aria-expanded={showAllHistory}
                    className="mt-2 min-h-[44px] text-[12.5px] font-semibold text-blue-700 hover:underline">
                    {showAllHistory ? "Show recent activity" : `Show all ${timeline.length} events`}
                  </button>
                )}
              </>
            )}
          </CommandCard>
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} aria-hidden />
          <div role="menu" style={{ top: menu.y, left: Math.max(8, menu.x - 208) }}
            className="fixed z-40 w-52 rounded-xl border border-border bg-card shadow-lg p-1">
            {[
              ...(menu.item.href
                ? [
                    ["Open", () => openHref(menu.item.href as string)] as const,
                    ["Copy Link", () => copyText(
                      /^https?:\/\//i.test(menu.item.href as string)
                        ? (menu.item.href as string)
                        : `${window.location.origin}${menu.item.href}`,
                      "Link",
                    )] as const,
                  ]
                : []),
              ["Copy VIN", () => copyText(vehicle.vin, "VIN")] as const,
            ].map(([label, fn]) => (
              <button key={label} role="menuitem"
                onClick={() => { fn(); setMenu(null); }}
                className="w-full text-left min-h-[44px] px-3 rounded-lg text-[12.5px] font-medium text-foreground hover:bg-muted/60">
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </>,
  );
}
