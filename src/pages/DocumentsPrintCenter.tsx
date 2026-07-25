import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Car, FileCheck, FileLock, FileSearch,
  FileText, FileX, Gauge, KeyRound, Layers, Lock, Package, Printer, QrCode,
  RefreshCw, Rocket, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { dealerRoleHome, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { usePrintCenter, type DocRow } from "@/hooks/useCommandCenter";
import {
  capabilityDenialReason, CommandAction, CommandCallout,
  CommandCapabilityProvider, CommandCard, CommandKebab, CommandMenu, commandRowMenuItems,
  CommandStatCard, copyWithToast, DegradedNotice, EmptyState, ErrorCard, LoadingCard, StatusPill,
  useCommandNavigate, VehicleIdentityStrip,
} from "@/components/command/CommandPrimitives";

// /print-center/:vehicleId — one versioned document package for the vehicle,
// the printer, and the customer Passport. Every number and row comes from
// usePrintCenter; nothing here invents a document, a version, or a status.

const BUNDLE_ICON = (label: string) => {
  const l = label.toLowerCase();
  if (l.includes("qr")) return QrCode;
  if (l.includes("key")) return KeyRound;
  if (l.includes("addendum")) return Layers;
  if (l.includes("sticker") || l.includes("window")) return Tag;
  if (l.includes("paper") || l.includes("letter")) return FileText;
  return Package;
};

export default function DocumentsPrintCenter() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const go = useCommandNavigate();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const role = member?.role;
  const canView = hasDealerCapability(role, "can_view_print_queue", isAdmin);

  // The id stays in scope while entitlements settle so the loader is not handed
  // a fresh id after its first commit, which would read as "vehicle not found"
  // for one frame. The read is tenant-scoped either way; once the role is known
  // a denied one never queries again.
  const { data, loading, error, errorDetail, notFound, degraded, reload, printCompletePacket, printByStock, reprintDocument, generateDocument } = usePrintCenter(
    entLoading || canView ? vehicleId : undefined,
  );

  const [busy, setBusy] = useState<"packet" | "stock" | null>(null);
  // One in-flight row action at a time — the hook enforces it, this names it.
  const [busyRow, setBusyRow] = useState<{ id: string; kind: "reprint" | "generate" } | null>(null);
  const [menu, setMenu] = useState<{ id: string; row: DocRow; trigger: HTMLElement } | null>(null);

  const runPrint = async (which: "packet" | "stock") => {
    setBusy(which);
    try {
      const res = which === "packet" ? await printCompletePacket() : await printByStock();
      // Never claim a print job that the hook did not confirm.
      if (!res.ok) { toast.error(res.error || "Print job could not be created"); return; }
      // The packet opens a print sheet and only files the print record once the
      // employee confirms in that tab, so the past tense here is earned.
      toast.success(which === "packet"
        ? "Packet confirmed as printed — its documents are marked as printed"
        : "Stock label queued for printing");
    } finally {
      setBusy(null);
    }
  };

  const runReprint = async (row: DocRow) => {
    setBusyRow({ id: row.id, kind: "reprint" });
    try {
      const res = await reprintDocument(row.id);
      if (!res.ok) { toast.error(res.error || "The copy was not recorded"); return; }
      toast.success(`${row.label} reprinted — copy recorded`);
    } finally {
      setBusyRow(null);
    }
  };

  const runGenerate = async (row: DocRow) => {
    setBusyRow({ id: row.id, kind: "generate" });
    try {
      const res = await generateDocument(row.id);
      if (!res.ok) { toast.error(res.error || "The form could not be generated"); return; }
      toast.success(`${row.label} generated and filed`);
    } finally {
      setBusyRow(null);
    }
  };

  // AppShell renders the title in the desktop chrome, so the in-content copy is
  // mobile-only — same convention as DescriptionOperations.
  const header = (
    <div className="mb-4 lg:hidden">
      <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground leading-none">
        Documents &amp; Print Center
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        One versioned document package for the vehicle, printer, and customer Passport.
      </p>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
        {header}
        {children}
      </div>
    </CommandCapabilityProvider>
  );

  // The skeleton mirrors the served layout at every breakpoint so the swap to
  // real content never shifts the page.
  const skeleton = (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,560px)] gap-3 items-start mb-4">
        <LoadingCard rows={2} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <LoadingCard key={i} rows={1} />)}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="min-w-0"><LoadingCard rows={8} /></div>
        <div className="w-full min-w-0 lg:w-[320px] space-y-4">
          <LoadingCard rows={6} />
          <LoadingCard rows={4} />
        </div>
      </div>
    </>
  );

  // Empty-state buttons are cross-page CTAs like any other, so they route
  // through CommandAction and are disabled with the same stated reason when the
  // role cannot follow them. "Back to Home" targets the role's OWN home, so the
  // card is never all dead controls.
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
        title="You do not have access to the Documents & Print Center"
        detail={capabilityDenialReason("can_view_print_queue")}
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
        title="Pick a vehicle to open its print center"
        detail="Documents, print bundles, and Passport visibility are tracked per vehicle. Choose one from Inventory."
        action={pickVehicleAction}
      />,
    );
  }

  if (error) return shell(<ErrorCard message={error} detail={errorDetail} onRetry={reload} />);

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
        action={pickVehicleAction}
      />,
    );
  }

  if (!data) {
    return shell(
      <EmptyState
        Icon={Building2}
        title="Select a dealership to view this vehicle"
        detail="The Documents & Print Center reads records for the dealership you are working in. Choose one to continue."
        action={homeAction}
      />,
    );
  }

  const { vehicle, counts, documents, bundle, bundleNote, packetBlockedReason,
    passportPreview, passportHref } = data;
  const docCount = documents.length;
  // The hook computes four distinct reasons the packet can release nothing —
  // already printed, live on the Passport, no print-ready file, not approved.
  // Substituting one sentence for all four told a vehicle whose packet had
  // already been released that its documents were never produced.
  // The packet resolves only when the employee confirms in the print tab (or
  // closes it), so "busy" here can last as long as they take.
  const packetReason = busy === "packet"
    ? "Waiting for the print confirmation in the packet tab."
    : busy
      ? "A print job is already running."
      : packetBlockedReason;
  // The two conditions printByStock itself refuses on, quoted from the same
  // guards, so the button is dead here instead of returning a red toast.
  const stockReason = busy
    ? "A print job is already running."
    : !vehicle.stockNumber
      ? "This vehicle has no stock number, so a stock label cannot be printed."
      : !vehicle.vin
        ? "This vehicle has no VIN, so a stock label cannot be printed."
        : null;

  return shell(
    <>
      <DegradedNotice degraded={degraded} className="mb-4" />

      {/* Vehicle identity + the four accent-topped counters, one row on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,560px)] gap-3 items-start mb-4">
        <VehicleIdentityStrip
          imageUrl={vehicle.heroImageUrl}
          ymm={vehicle.ymm}
          trim={vehicle.trim}
          stockNumber={vehicle.stockNumber}
          vin={vehicle.vin}
          conditionLabel={vehicle.condition}
          meta={[{
            label: "Mileage",
            value: vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : null,
          }]}
          onCopyVin={() => copyWithToast(vehicle.vin, "VIN")}
          action={
            /* The three command surfaces are one set, and each carries a door
               to both siblings — VIN Command Center has no nav row by §6, and
               Print to Get Ready for the same vehicle used to cost two hops
               through it. */
            <>
              <CommandAction
                Icon={Gauge}
                capability="can_view_inventory"
                href={`/vin-command/${vehicle.id}`}>
                VIN Command Center
              </CommandAction>
              <CommandAction
                Icon={Rocket}
                capability="can_view_get_ready"
                href={`/get-ready-command/${vehicle.id}`}>
                Get Ready Command
              </CommandAction>
            </>
          }
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CommandStatCard label="Ready" value={counts.ready} Icon={FileCheck} tone="emerald" accentTop />
          <CommandStatCard label="Blocked" value={counts.blocked} Icon={FileX} tone="red" accentTop />
          <CommandStatCard label="Customer Visible" value={counts.customerVisible} Icon={FileSearch} tone="blue" accentTop />
          <CommandStatCard label="Internal Only" value={counts.internalOnly} Icon={FileLock} tone="violet" accentTop />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        {/* Documents table. With no rows the EmptyState IS the card — nested
            inside CommandCard it drew a bordered card inside a bordered card. */}
        {docCount === 0 ? (
          <EmptyState
            Icon={FileText}
            title="No documents have been generated yet"
            detail="Window stickers, addendums, guides, and QR items appear here as they are generated for this vehicle."
          />
        ) : (
          <CommandCard title="Documents">
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[860px]">
                  <thead>
                    <tr className="text-[11.5px] font-semibold text-muted-foreground border-b border-border">
                      <th scope="col" className="px-3 py-2.5">Document</th>
                      <th scope="col" className="px-3 py-2.5">Current Version</th>
                      <th scope="col" className="px-3 py-2.5">Internal Status</th>
                      <th scope="col" className="px-3 py-2.5">Passport Visibility</th>
                      <th scope="col" className="px-3 py-2.5">Print Status</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {documents.map((d) => {
                      const RowIcon = d.kind === "qr" ? QrCode : FileText;
                      // A non-current row is not automatically a draft — it can be
                      // superseded or archived — so only label what the status says.
                      const versionNote = d.isCurrent
                        ? "Current"
                        : d.internalStatus.label === "Draft" ? "Draft" : null;
                      return (
                        <tr key={d.id} className="hover:bg-primary/[0.025] transition-colors">
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <RowIcon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                              <span className="text-[12.5px] font-semibold text-foreground truncate">{d.label}</span>
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="text-[12.5px] font-bold text-foreground">{d.version}</span>
                            {versionNote ? (
                              <span className="text-[11.5px] text-muted-foreground ml-1.5">{versionNote}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            <StatusPill tone={d.internalStatus.tone}>{d.internalStatus.label}</StatusPill>
                          </td>
                          <td className="px-3 py-3">
                            <StatusPill tone={d.passportVisibility.tone}>{d.passportVisibility.label}</StatusPill>
                          </td>
                          <td className="px-3 py-3">
                            <StatusPill tone={d.printStatus.tone}>{d.printStatus.label}</StatusPill>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className="inline-flex items-center gap-1 justify-end">
                              {/* Reprint follows the same confirm-at-the-printer
                                  pattern as the packet: nothing is recorded
                                  until the sheet reports paper. */}
                              {d.reprintCopy != null && (
                                <CommandAction
                                  variant="link"
                                  capability="can_print"
                                  Icon={Printer}
                                  busy={busyRow?.id === d.id && busyRow.kind === "reprint"}
                                  disabledReason={
                                    busyRow?.id === d.id && busyRow.kind === "reprint"
                                      ? "Waiting for the print confirmation in the reprint tab."
                                      : busyRow ? "Another document action is already running." : null
                                  }
                                  onClick={() => runReprint(d)}>
                                  Reprint (copy {d.reprintCopy})
                                </CommandAction>
                              )}
                              {(d.generateKind || d.generateBlockedReason) && (
                                <CommandAction
                                  variant="link"
                                  capability="can_create_documents"
                                  Icon={RefreshCw}
                                  busy={busyRow?.id === d.id && busyRow.kind === "generate"}
                                  disabledReason={
                                    d.generateBlockedReason
                                      ? d.generateBlockedReason
                                      : busyRow?.id === d.id && busyRow.kind === "generate"
                                        ? "The form is being generated."
                                        : busyRow ? "Another document action is already running." : null
                                  }
                                  onClick={() => runGenerate(d)}>
                                  Generate
                                </CommandAction>
                              )}
                              <CommandKebab
                                label={`More actions for ${d.label}`}
                                expanded={menu?.id === d.id}
                                onOpen={(trigger) =>
                                  setMenu((m) => (m?.id === d.id ? null : { id: d.id, row: d, trigger }))
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
              <p className="text-[11.5px] text-muted-foreground mt-3">
                Showing 1 to {docCount} of {docCount} documents
              </p>
            </>
          </CommandCard>
        )}

        {/* Right rail */}
        <div className="w-full min-w-0 lg:w-[320px] space-y-4">
          <CommandCard
            title="Vehicle Print Bundle"
            subtitle="Media prepared for this vehicle. The packet button releases the paper groups.">
            {/* Five fixed media groups; a group with nothing in it reads "0 docs"
                rather than dropping out, so the rail has no empty state. Two of
                the five are physical media the packet button never touches, and
                the rail said all five were "included in the complete vehicle
                packet" — so each line now says which it is. */}
            <ul className="divide-y divide-border/70">
              {bundle.map((b) => {
                const Icon = BUNDLE_ICON(b.label);
                return (
                  <li key={b.label} className="flex items-center gap-2.5 py-2.5">
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 self-start" aria-hidden="true" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] text-foreground truncate">{b.label}</span>
                      {!b.releasedByPacket && (
                        <span className="block text-[10.5px] text-muted-foreground">
                          Printed separately — the packet button does not release this.
                        </span>
                      )}
                    </span>
                    <span className="text-[11.5px] text-muted-foreground whitespace-nowrap self-start mt-0.5">
                      {b.count} {b.unit}
                    </span>
                  </li>
                );
              })}
            </ul>

            {bundleNote && (
              <CommandCallout tone="amber" Icon={AlertTriangle} className="mt-3">
                {bundleNote}
              </CommandCallout>
            )}

            {/* CommandAction publishes aria-busy and its own live region, and
                announces the same sentence it states as the disabled reason. */}
            <div className="mt-3 space-y-2">
              <CommandAction
                variant="primary"
                capability="can_print"
                Icon={Printer}
                busy={busy === "packet"}
                disabledReason={packetReason}
                className="w-full"
                wrapperClassName="flex w-full"
                onClick={() => runPrint("packet")}>
                Print Complete Vehicle Packet
              </CommandAction>
              <CommandAction
                capability="can_print"
                Icon={Printer}
                busy={busy === "stock"}
                disabledReason={stockReason}
                className="w-full"
                wrapperClassName="flex w-full"
                onClick={() => runPrint("stock")}>
                Print by Stock
              </CommandAction>
            </div>
          </CommandCard>

          <CommandCard
            title="Passport Preview"
            subtitle="Documents visible to the customer in their Passport.">
            {passportPreview.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground py-2">
                No documents are shared to the customer Passport yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {passportPreview.map((p) => (
                  <li key={`${p.label}-${p.version}`} className="flex items-center gap-2.5 py-2.5">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    <span className="text-[12.5px] text-foreground flex-1 min-w-0 truncate">{p.label}</span>
                    <span className="text-[11.5px] text-muted-foreground whitespace-nowrap">{p.version}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 pt-3 border-t border-border">
              <CommandAction
                newTab
                href={passportHref ?? undefined}
                disabledReason={passportHref ? null : "This vehicle has no published Passport yet."}
                className="w-full"
                wrapperClassName="flex w-full">
                Open Passport View
              </CommandAction>
            </div>
          </CommandCard>
        </div>
      </div>

      {menu && (
        <CommandMenu
          trigger={menu.trigger}
          label={`Actions for ${menu.row.label}`}
          onClose={() => setMenu(null)}
          items={commandRowMenuItems({ href: menu.row.href, vin: vehicle.vin, go })}
        />
      )}
    </>,
  );
}
