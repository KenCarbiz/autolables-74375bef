import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Car, CheckCircle2, Clock, FileText, Globe, History,
  Lock, MoreVertical, PlayCircle, QrCode, XCircle,
} from "lucide-react";
import { useVinCommand, type PackageItem } from "@/hooks/useCommandCenter";
import {
  BTN_PRIMARY, BTN_SECONDARY, capabilityDenialReason, capabilityForHref, CommandAction,
  CommandCallout, CommandCapabilityProvider, CommandCard, CommandMenu, CommandStatCard, copyWithToast,
  EmptyState,
  ErrorCard, LoadingCard, StatusPill, TimelineRail, VehicleIdentityStrip,
} from "@/components/command/CommandPrimitives";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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

// The comp's reading order is the order the hook emits, so the rows are
// rendered as given. A local re-sort could only damage it: it matched on
// label text and dropped a new car's "Window Sticker" to the bottom.
const COLLAPSED_TIMELINE = 6;

const isQrItem = (item: PackageItem) => /qr|key.?tag/i.test(`${item.key} ${item.label}`);

const HOW_IT_WORKS_STEPS = [
  "At intake, AutoLabels builds the document package for the VIN — disclosures, stickers, QR tags and the description.",
  "This page lists what was produced and flags anything that needs a person. Green rows need no action.",
  "Authorize Get Ready once to release work assignments, then print the package and publish the customer Passport.",
];

const StatusCell = ({ status, label }: { status: PackageItem["status"]; label: string }) => {
  if (status === "blocked") {
    return (
      <span className="text-[12.5px] font-semibold text-red-600 inline-flex items-center gap-1.5">
        <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {label}
      </span>
    );
  }
  if (status === "retry_required") {
    return (
      <span className="text-[12.5px] font-semibold text-amber-700 inline-flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {label}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="text-[12.5px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
        <Clock className="w-4 h-4 shrink-0" aria-hidden="true" /> {label}
      </span>
    );
  }
  return (
    <span className="text-[12.5px] font-semibold text-emerald-700 inline-flex items-center gap-1.5">
      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> {label}
    </span>
  );
};

export default function VinCommandCenter() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const canView = hasDealerCapability(member?.role, "can_view_inventory", isAdmin);
  // Nothing is fetched for a role that cannot see inventory — the gate is the
  // query, not just the render. The id stays in scope while entitlements settle
  // so the loader is not handed a fresh id after its first commit, which would
  // read as "vehicle not found" for one frame.
  const { data, loading, error, errorDetail, notFound, reload } = useVinCommand(
    entLoading || canView ? vehicleId : undefined,
  );

  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [menu, setMenu] = useState<{ key: string; item: PackageItem; trigger: HTMLElement } | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  // TimelineRail prints `at` verbatim, so the raw ISO string from audit_log has
  // to be humanized here or the rail reads 2026-07-25T13:45:12.482Z.
  const fmtAt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  };

  const timeline = data?.timeline ?? [];
  const items = data?.packageItems ?? [];
  const canExpandTimeline = timeline.length > COLLAPSED_TIMELINE;
  const shownTimeline = showAllHistory ? timeline : timeline.slice(0, COLLAPSED_TIMELINE);
  const toggleHistory = () => {
    setShowAllHistory((v) => !v);
    railRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openHref = (href: string) => {
    if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else navigate(href);
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
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <button
            type="button"
            onClick={() => setShowHowItWorks(true)}
            aria-haspopup="dialog"
            aria-expanded={showHowItWorks}
            className={BTN_SECONDARY}>
            <PlayCircle className="w-4 h-4" aria-hidden="true" /> How it works
          </button>
          {/* The rail is capped at six entries, so this only has work to do when
              there are more than six; with fewer it says so instead of
              toggling nothing. */}
          <CommandAction
            Icon={History}
            expanded={showAllHistory}
            disabledReason={canExpandTimeline ? null : "All recorded activity for this VIN is already shown"}
            onClick={toggleHistory}>
            History
          </CommandAction>
        </div>
      </div>

      {/* Overlay, not an inline panel: the explainer must never displace the
          vehicle strip or the stat cards below it. */}
      <Dialog open={showHowItWorks} onOpenChange={setShowHowItWorks}>
        <DialogContent className="rounded-2xl sm:rounded-2xl shadow-none [&>button]:min-h-[44px] [&>button]:min-w-[44px] [&>button]:grid [&>button]:place-items-center [&>button]:rounded-lg [&>button]:right-3 [&>button]:top-3">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-bold text-foreground">
              How this vehicle gets to market
            </DialogTitle>
            <DialogDescription className="text-[11.5px] text-muted-foreground">
              What AutoLabels does automatically, and where you step in.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2">
            {HOW_IT_WORKS_STEPS.map((line, i) => (
              <li key={line} className="flex gap-2 text-[12.5px] text-muted-foreground">
                <span className="w-5 h-5 shrink-0 grid place-items-center rounded-full border border-border text-[10.5px] font-bold text-foreground">
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );

  const shell = (children: React.ReactNode) => (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
        {header}
        {children}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Lock className="w-4 h-4" aria-hidden="true" /> AI-generated content. Always review for accuracy.
        </p>
      </div>
    </CommandCapabilityProvider>
  );

  // The skeleton mirrors the served layout at every breakpoint so the swap to
  // real content never shifts the page.
  const skeleton = (
    <>
      <div className="mb-4"><LoadingCard rows={2} /></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => <LoadingCard key={i} rows={1} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="order-2 lg:order-1 min-w-0"><LoadingCard rows={8} /></div>
        <div className="order-1 lg:order-2 w-full min-w-0 lg:w-[360px] space-y-4">
          <LoadingCard rows={3} />
          <LoadingCard rows={5} />
        </div>
      </div>
    </>
  );

  const inventoryAction = (
    <button type="button" onClick={() => navigate("/inventory")} className={BTN_PRIMARY}>
      Go to Inventory <ArrowRight className="w-4 h-4" aria-hidden="true" />
    </button>
  );

  const homeAction = (
    <button type="button" onClick={() => navigate("/dashboard")} className={BTN_SECONDARY}>
      Back to Home
    </button>
  );

  // One guard order across all three command surfaces: permission ->
  // entitlements loading -> no vehicleId -> error -> loading -> not found ->
  // no tenant. Everything after the permission check waits on `entLoading`, so
  // no state is ever shown and then swapped for the denial card.
  if (!entLoading && !canView) {
    return shell(
      <EmptyState
        Icon={Lock}
        title="You do not have access to the VIN Command Center"
        detail={capabilityDenialReason("can_view_inventory")}
        action={homeAction}
      />,
    );
  }

  if (entLoading) {
    return shell(skeleton);
  }

  if (!vehicleId) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Pick a vehicle to open its command center"
        detail="The VIN Command Center covers one vehicle at a time. Choose one from Inventory to see its automated package."
        action={inventoryAction}
      />,
    );
  }

  if (error) {
    return shell(<ErrorCard message={error} detail={errorDetail} onRetry={reload} />);
  }

  if (loading) {
    return shell(skeleton);
  }

  // A vehicle that is not in this tenant is its own state — never the red error card.
  if (notFound) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Vehicle not found"
        detail="This vehicle is not in your inventory, or it was removed. Pick another vehicle from Inventory."
        action={inventoryAction}
      />,
    );
  }

  if (!data) {
    return shell(
      <EmptyState
        Icon={Building2}
        title="Select a dealership to view this vehicle"
        detail="The VIN Command Center reads records for the dealership you are working in. Choose one to continue."
        action={homeAction}
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
      <div className="mb-4">
        <VehicleIdentityStrip
          imageUrl={vehicle.heroImageUrl}
          ymm={vehicle.ymm}
          trim={vehicle.trim}
          stockNumber={vehicle.stockNumber}
          vin={vehicle.vin}
          conditionLabel={vehicle.condition}
          meta={[{
            label: "Intake Completed",
            value: intakeAt
              ? intakeAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
              : "Not recorded",
            sub: intakeAt
              ? intakeAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
              : undefined,
          }]}
          onCopyVin={() => copyWithToast(vehicle.vin, "VIN")}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <CommandStatCard
          label="Automation Complete"
          Icon={CheckCircle2}
          tone="blue"
          value={
            <>
              {counts.automationDone}
              <span className="text-[12.5px] font-semibold text-muted-foreground"> / {counts.automationTotal}</span>
            </>
          }
          sub={automationPct}
        />
        <CommandStatCard
          label="Awaiting Authorization"
          Icon={Clock}
          tone="blue"
          value={counts.awaitingAuthorization == null ? "—" : counts.awaitingAuthorization}
          sub={counts.awaitingAuthorization == null ? undefined : "Ready to review"}
        />
        <CommandStatCard
          label="Exceptions"
          Icon={AlertTriangle}
          tone="amber"
          value={counts.exceptions}
          sub={counts.exceptions > 0 ? "Needs attention" : undefined}
        />
        <CommandStatCard
          label="Passport"
          Icon={Globe}
          tone="emerald"
          value={counts.passportPublished}
          sub={counts.passportPublished > 0 ? "Published" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        {/* Main column */}
        <div className="order-2 lg:order-1 min-w-0">
          <CommandCard title="Automated Intake Package">
            {items.length === 0 ? (
              <EmptyState
                Icon={FileText}
                title="Nothing has been created for this VIN yet"
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
                                <ItemIcon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
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
                                <CommandAction
                                  variant="link"
                                  capability={capabilityForHref(item.href)}
                                  disabledReason={item.href ? null : "Nothing to open for this item yet"}
                                  onClick={() => openHref(item.href as string)}>
                                  View
                                </CommandAction>
                                <button
                                  type="button"
                                  aria-label={`More actions for ${item.label}`}
                                  aria-haspopup="menu"
                                  aria-expanded={menu?.key === item.key}
                                  onClick={(e) => {
                                    const trigger = e.currentTarget;
                                    setMenu((m) => (m?.key === item.key ? null : { key: item.key, item, trigger }));
                                  }}
                                  className="w-11 h-11 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50">
                                  <MoreVertical className="w-4 h-4" aria-hidden="true" />
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
                  <CommandAction
                    capability="can_view_print_queue"
                    onClick={() => navigate(`/print-center/${vehicleId}`)}>
                    View Full Package
                  </CommandAction>
                </div>
              </>
            )}
          </CommandCard>
        </div>

        {/* Right rail */}
        <div ref={railRef} className="order-1 lg:order-2 w-full min-w-0 lg:w-[360px] space-y-4">
          <CommandCard title="Current Readiness">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] text-muted-foreground">State</span>
              <StatusPill tone={readiness.tone}>{readiness.state}</StatusPill>
            </div>

            {readiness.blocking && (
              <>
                <p className="text-[11.5px] font-semibold text-muted-foreground mt-3 mb-1.5">Blocking Issue</p>
                <CommandCallout
                  tone="amber"
                  Icon={AlertTriangle}
                  title={readiness.blocking.title}
                  action={
                    <CommandAction
                      variant="link"
                      capability={capabilityForHref(readiness.blocking.href)}
                      onClick={() => openHref(readiness.blocking?.href ?? `/vehicle-file/${vehicleId}`)}>
                      View Details
                    </CommandAction>
                  }>
                  {readiness.blocking.detail}
                </CommandCallout>
              </>
            )}

            <CommandAction
              variant="primary"
              capability="can_view_get_ready"
              className="mt-3 w-full"
              wrapperClassName="flex w-full"
              TrailingIcon={ArrowRight}
              onClick={() => navigate(`/get-ready-command/${vehicleId}`)}>
              Review &amp; Authorize Get Ready
            </CommandAction>
          </CommandCard>

          <CommandCard title="VIN Timeline">
            {/* TimelineRail renders the rail's own empty line, which is the
                right-rail empty-section convention on all three surfaces. */}
            <TimelineRail entries={shownTimeline.map((e) => ({ ...e, at: fmtAt(e.at) }))} />
            {canExpandTimeline && (
              <div className="mt-3 flex justify-center">
                <CommandAction variant="link" expanded={showAllHistory} onClick={toggleHistory}>
                  {showAllHistory ? "Show less" : `Show all ${timeline.length} events`}
                </CommandAction>
              </div>
            )}
          </CommandCard>
        </div>
      </div>

      {menu && (
        <CommandMenu
          trigger={menu.trigger}
          label={`Actions for ${menu.item.label}`}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.item.href
              ? [
                  { label: "Open", onSelect: () => openHref(menu.item.href as string) },
                  {
                    label: "Copy Link",
                    onSelect: () => copyWithToast(
                      /^https?:\/\//i.test(menu.item.href as string)
                        ? (menu.item.href as string)
                        : `${window.location.origin}${menu.item.href}`,
                      "Link",
                    ),
                  },
                ]
              : []),
            { label: "Copy VIN", onSelect: () => copyWithToast(vehicle.vin, "VIN") },
          ]}
        />
      )}
    </>,
  );
}
