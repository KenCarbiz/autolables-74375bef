import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Car, CheckCircle2, Clock, FileText, Globe, History,
  Lock, PlayCircle, QrCode, XCircle, type LucideIcon,
} from "lucide-react";
import { useVinCommand, type PackageItem } from "@/hooks/useCommandCenter";
import {
  ACTION_GROUP, capabilityDenialReason, capabilityForHref, CommandAction,
  CommandCallout, CommandCapabilityProvider, CommandCard, commandRowMenuItems, CommandKebab,
  CommandMenu, CommandStatCard, copyWithToast, DegradedNotice, EmptyState, ErrorCard,
  formatCommandDate, formatCommandDateTime, formatCommandTime, LoadingCard, StatusPill,
  TimelineRail, TONE_TEXT, useCommandNavigate, VehicleIdentityStrip,
} from "@/components/command/CommandPrimitives";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { dealerRoleHome, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import {
  isExceptionState, isFinishedState, isProducedState,
} from "@/lib/commandCenter/packageState";
import { cn } from "@/lib/utils";

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

// §3 gives every non-exception status one green check. §2 then split "produced"
// from "finished", so a package of ten rows drew nine green checks under a header
// reading "8 / 10" — the same row said done and not-done in one line. The check
// stays (it is not an exception), but a produced-not-finished row wears the muted
// neutral treatment instead of the emerald one, giving three tiers: finished,
// produced, outstanding. The tiers are derived from the SAME predicates the
// counter uses, so the picture and the header cannot drift apart again.
const statusTier = (status: PackageItem["status"]): { Icon: LucideIcon; className: string } => {
  if (isExceptionState(status)) {
    return status === "blocked"
      ? { Icon: XCircle, className: cn("font-semibold", TONE_TEXT.red) }
      : { Icon: AlertTriangle, className: cn("font-semibold", TONE_TEXT.amber) };
  }
  if (isFinishedState(status)) return { Icon: CheckCircle2, className: cn("font-semibold", TONE_TEXT.emerald) };
  if (isProducedState(status)) return { Icon: CheckCircle2, className: "font-medium text-muted-foreground" };
  return { Icon: Clock, className: "font-medium text-muted-foreground" };
};

const StatusCell = ({ status, label }: { status: PackageItem["status"]; label: string }) => {
  const { Icon, className } = statusTier(status);
  return (
    <span className={cn("text-[12.5px] inline-flex items-center gap-1.5", className)}>
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> {label}
    </span>
  );
};

export default function VinCommandCenter() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const go = useCommandNavigate();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const canView = hasDealerCapability(member?.role, "can_view_inventory", isAdmin);
  // Nothing is fetched for a role that cannot see inventory — the gate is the
  // query, not just the render. The id stays in scope while entitlements settle
  // so the loader is not handed a fresh id after its first commit, which would
  // read as "vehicle not found" for one frame.
  const { data, loading, error, errorDetail, notFound, degraded, reload } = useVinCommand(
    entLoading || canView ? vehicleId : undefined,
  );

  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [menu, setMenu] = useState<{ key: string; item: PackageItem; trigger: HTMLElement } | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const timeline = data?.timeline ?? [];
  const items = data?.packageItems ?? [];
  const canExpandTimeline = timeline.length > COLLAPSED_TIMELINE;
  const shownTimeline = showAllHistory ? timeline : timeline.slice(0, COLLAPSED_TIMELINE);
  const toggleHistory = () => {
    setShowAllHistory((v) => !v);
    railRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // The header actions only exist when there is a vehicle behind them. Rendering
  // them in the shell put a live "How it works" and a History button reading
  // "All recorded activity for this VIN is already shown" above a permission
  // denial card, to a user who had been shown nothing. The two siblings render
  // title-only headers in those states; this one now does too.
  const headerActions = (
    <>
      <CommandAction
        Icon={PlayCircle}
        hasPopup="dialog"
        expanded={showHowItWorks}
        onClick={() => setShowHowItWorks(true)}>
        How it works
      </CommandAction>
      {/* The rail is capped at six entries, so this only has work to do when
          there are more than six; with fewer it says so instead of
          toggling nothing. */}
      <CommandAction
        Icon={History}
        expanded={showAllHistory}
        disabledReason={canExpandTimeline ? null : "All recorded activity for this VIN is already shown."}
        onClick={toggleHistory}>
        History
      </CommandAction>

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

  // The title block is the same mobile-only convention the two siblings use, and
  // the actions row is its own row rather than the title's flex partner — as a
  // partner it rendered an empty `mb-4` strip on desktop in every state that has
  // no actions. The AI-generated-content footer is NOT here: it describes the
  // package table, and the shell also renders the denial card, the "pick a
  // vehicle" card and the skeleton, none of which show generated content.
  const shell = (children: React.ReactNode, actions?: React.ReactNode) => (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
        <div className="min-w-0 lg:hidden mb-4">
          <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground leading-none">
            VIN Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything created automatically. Review exceptions and authorize the next step.
          </p>
        </div>
        {actions ? <div className={cn(ACTION_GROUP, "justify-end mb-4")}>{actions}</div> : null}
        {children}
      </div>
    </CommandCapabilityProvider>
  );

  const contentFooter = (
    <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
      <Lock className="w-4 h-4" aria-hidden="true" /> AI-generated content. Always review for accuracy.
    </p>
  );

  // The skeleton mirrors the served layout at every breakpoint so the swap to
  // real content never shifts the page — including the header-actions row, which
  // otherwise appeared with the data and pushed everything below it down.
  const skeletonActions = (
    <>
      <div className="h-11 w-36 rounded-xl bg-muted animate-pulse" aria-hidden="true" />
      <div className="h-11 w-28 rounded-xl bg-muted animate-pulse" aria-hidden="true" />
    </>
  );

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

  // Empty-state buttons are cross-page CTAs like any other, so they route
  // through CommandAction and are disabled with the same stated reason when the
  // role cannot follow them. "Back to Home" targets the role's OWN home rather
  // than /dashboard, so a role without can_view_dashboard is never left in a
  // card whose only two controls are both dead.
  const homeAction = (
    <CommandAction href={dealerRoleHome(member?.role, isAdmin)}>Back to Home</CommandAction>
  );

  const pickVehicleAction = (
    <>
      <CommandAction
        variant="primary"
        capability="can_view_inventory"
        href="/inventory"
        TrailingIcon={ArrowRight}>
        Go to Inventory
      </CommandAction>
      {homeAction}
    </>
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
    return shell(skeleton, skeletonActions);
  }

  if (!vehicleId) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Pick a vehicle to open its command center"
        detail="The VIN Command Center covers one vehicle at a time. Choose one from Inventory to see its automated package."
        action={pickVehicleAction}
      />,
    );
  }

  if (error) {
    return shell(<ErrorCard message={error} detail={errorDetail} onRetry={reload} />);
  }

  if (loading) {
    return shell(skeleton, skeletonActions);
  }

  // A vehicle that is not in this tenant is its own state — never the red error card.
  if (notFound) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Vehicle not found"
        detail="This vehicle is not in your inventory, or it was removed. Pick another vehicle from Inventory."
        action={pickVehicleAction}
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
  const intakeDate = formatCommandDate(vehicle.intakeCompletedAt);
  const automationPct = counts.automationTotal > 0
    ? `${Math.round((counts.automationDone / counts.automationTotal) * 100)}%`
    : undefined;
  // RECORDED DEVIATION from §3, which specifies a bare "92%" here. Produced-but-
  // unfinished rows are the whole reason done < total, and they are exactly what
  // X1's third visual tier draws as a muted check; without this line the header
  // reads "8 / 10 · 80%" over nine checks with nothing saying why. The deviation
  // exists to disclose X1, and is dropped whenever produced === done.
  const automationSub = automationPct == null
    ? undefined
    : counts.automationProduced > counts.automationDone
      ? `${automationPct} · ${counts.automationProduced} of ${counts.automationTotal} created`
      : automationPct;

  return shell(
    <>
      <DegradedNotice degraded={degraded} className="mb-4" />

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
            value: intakeDate,
            sub: formatCommandTime(vehicle.intakeCompletedAt),
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
          sub={automationSub}
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
            {/* buildVinPackageItems emits a fixed 8 rows (10 for used), so there
                is no empty case to render here. */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[720px]">
                <thead>
                  <tr className="text-[11.5px] font-semibold text-muted-foreground border-b border-border">
                    <th scope="col" className="px-3 py-2.5">Item</th>
                    <th scope="col" className="px-3 py-2.5">Status</th>
                    <th scope="col" className="px-3 py-2.5">Details</th>
                    <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
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
                              href={item.href}
                              capability={capabilityForHref(item.href)}
                              disabledReason={item.href ? null : "There is nothing to open for this item yet."}>
                              View
                            </CommandAction>
                            <CommandKebab
                              label={`More actions for ${item.label}`}
                              expanded={menu?.key === item.key}
                              onOpen={(trigger) =>
                                setMenu((m) => (m?.key === item.key ? null : { key: item.key, item, trigger }))
                              }
                            />
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
                href={`/print-center/${vehicleId}`}>
                View Full Package
              </CommandAction>
            </div>
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
                      href={readiness.blocking.href ?? `/vehicle-file/${vehicleId}`}
                      capability={capabilityForHref(readiness.blocking.href ?? `/vehicle-file/${vehicleId}`)}>
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
              href={`/get-ready-command/${vehicleId}`}>
              Review &amp; Authorize Get Ready
            </CommandAction>
          </CommandCard>

          <CommandCard title="VIN Timeline">
            {/* TimelineRail renders the rail's own empty line — the one-line
                empty form every list on the three surfaces uses. */}
            <TimelineRail entries={shownTimeline.map((e) => ({ ...e, at: formatCommandDateTime(e.at) }))} />
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
          items={commandRowMenuItems({ href: menu.item.href, vin: vehicle.vin, go })}
        />
      )}
      {contentFooter}
    </>,
    headerActions,
  );
}
