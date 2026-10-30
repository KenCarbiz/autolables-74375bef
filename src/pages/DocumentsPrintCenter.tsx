import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Car, FileCheck, FileLock, FileSearch,
  FileText, FileX, Gauge, KeyRound, Layers, Lock, Package, Printer, QrCode,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader, Panel, WorkTable, Th, Td, StatusText } from "@/components/product";
import { DetailLayout, productTone } from "@/components/detail/parts";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { dealerRoleHome, hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { usePrintCenter, type DocRow } from "@/hooks/useCommandCenter";
import {
  capabilityDenialReason, CommandAction, CommandCallout,
  CommandCapabilityProvider, CommandKebab, CommandMenu, commandRowMenuItems,
  copyWithToast, DegradedNotice, EmptyState, ErrorCard, LoadingCard,
  useCommandNavigate,
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

  const shell = (children: React.ReactNode, actions?: React.ReactNode) => (
    <CommandCapabilityProvider role={member?.role} isAdmin={isAdmin}>
      <PageBody width="wide">
        <PageHeader
          title="Print Center"
          description="Review the versioned documents for a vehicle and print the bundle. Printing does not publish, approve or rewrite a stored document."
          actions={actions}
        />
        {children}
      </PageBody>
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

  const vehicleLine = [vehicle.ymm, vehicle.trim].filter(Boolean).join(" ") || "Vehicle";
  const vehicleMeta = [
    vehicle.stockNumber ? `Stock ${vehicle.stockNumber}` : null,
    vehicle.vin ? `VIN ${vehicle.vin}` : null,
    vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : null,
  ].filter(Boolean).join("  ·  ");

  const printAction = (
    <>
    <CommandAction Icon={Gauge} capability="can_view_inventory" href={`/vin-command/${vehicle.id}`}>VIN Command Center</CommandAction>
    <CommandAction
      variant="primary"
      capability="can_print"
      Icon={Printer}
      busy={busy === "packet"}
      disabledReason={packetReason}
      onClick={() => runPrint("packet")}>
      Print bundle
    </CommandAction>
    </>
  );

  return shell(
    <>
      <DegradedNotice degraded={degraded} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <p className="mb-1 text-[13px] leading-[18px] font-semibold text-adm-ink">Vehicle</p>
          <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-[6px] border border-adm-border bg-adm-surface px-3">
            <span className="min-w-0 truncate text-[14px] leading-[20px] text-adm-ink">
              <span className="font-semibold">{vehicleLine}</span>
              {vehicleMeta ? <span className="text-adm-muted">{`  ·  ${vehicleMeta}`}</span> : null}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[13px] leading-[18px] font-semibold text-adm-ink">Printer profile</p>
          <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] leading-[20px]">
            <span className="truncate text-adm-ink">Browser print dialog</span>
          </div>
        </div>
      </div>

      <DetailLayout
        main={
          docCount === 0 ? (
            <EmptyState
              Icon={FileText}
              title="No documents have been generated yet"
              detail="Window stickers, addendums, guides, and QR items appear here as they are generated for this vehicle."
            />
          ) : (
            <Panel flush>
              <WorkTable className="[&_th]:px-2 [&_td]:px-2" caption="Documents for this vehicle" minWidth={700}>
                <thead>
                  <tr>
                    <Th>Document</Th>
                    <Th>Version</Th>
                    <Th className="whitespace-nowrap">Internal status</Th>
                    <Th>Passport</Th>
                    <Th className="whitespace-nowrap">Print status</Th>
                    <Th align="right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => {
                    const RowIcon = d.kind === "qr" ? QrCode : FileText;
                    const versionNote = d.isCurrent ? null : d.internalStatus.label === "Draft" ? "Draft" : null;
                    const reprinting = busyRow?.id === d.id && busyRow.kind === "reprint";
                    const generating = busyRow?.id === d.id && busyRow.kind === "generate";
                    return (
                      <tr key={d.id} className="hover:bg-adm-workspace">
                        <Td className="max-w-[190px]">
                          <span className="inline-flex max-w-full items-center gap-2">
                            <RowIcon className="h-5 w-5 shrink-0 text-adm-muted" aria-hidden="true" />
                            <span className="truncate text-[14px] font-semibold text-adm-ink">{d.label}</span>
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className="font-semibold">{d.version}</span>
                          {versionNote ? <span className="ml-1.5 text-[12px] text-adm-muted">{versionNote}</span> : null}
                        </Td>
                        <Td><StatusText tone={productTone(d.internalStatus.tone)}>{d.internalStatus.label}</StatusText></Td>
                        <Td><StatusText tone={productTone(d.passportVisibility.tone)}>{d.passportVisibility.label}</StatusText></Td>
                        <Td><StatusText tone={productTone(d.printStatus.tone)}>{d.printStatus.label}</StatusText></Td>
                        <Td align="right">
                          <span className="inline-flex items-center justify-end gap-1">
                            {d.reprintCopy != null ? (
                              <CommandAction
                                variant="link"
                                capability="can_print"
                                busy={reprinting}
                                disabledReason={
                                  reprinting
                                    ? "Waiting for the print confirmation in the reprint tab."
                                    : busyRow ? "Another document action is already running." : null
                                }
                                onClick={() => runReprint(d)}>
                                Reprint
                              </CommandAction>
                            ) : (d.generateKind || d.generateBlockedReason) ? (
                              <CommandAction
                                variant="link"
                                capability="can_create_documents"
                                busy={generating}
                                disabledReason={
                                  d.generateBlockedReason
                                    ? d.generateBlockedReason
                                    : generating
                                      ? "The form is being generated."
                                      : busyRow ? "Another document action is already running." : null
                                }
                                onClick={() => runGenerate(d)}>
                                Generate
                              </CommandAction>
                            ) : null}
                            <CommandKebab
                              label={`More actions for ${d.label}`}
                              expanded={menu?.id === d.id}
                              onOpen={(trigger) =>
                                setMenu((m) => (m?.id === d.id ? null : { id: d.id, row: d, trigger }))
                              }
                            />
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </WorkTable>
              <p className="border-t border-adm-border px-4 py-3 text-[13px] leading-[18px] text-adm-muted">
                {docCount} documents · {counts.ready} ready · {counts.blocked} blocked · {counts.customerVisible} shown in the Passport
              </p>
            </Panel>
          )
        }
        aside={
          <>
            <Panel title="Preview" description="Documents visible to the customer in their Passport.">
              {passportPreview.length === 0 ? (
                <p className="text-[14px] leading-[20px] text-adm-muted">No documents are shared to the customer Passport yet.</p>
              ) : (
                <ul className="divide-y divide-adm-border">
                  {passportPreview.map((p) => (
                    <li key={`${p.label}-${p.version}`} className="flex items-center gap-2.5 py-2">
                      <FileText className="h-5 w-5 shrink-0 text-adm-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-adm-ink">{p.label}</span>
                      <span className="whitespace-nowrap text-[13px] text-adm-muted">{p.version}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 border-t border-adm-border pt-3">
                <CommandAction
                  newTab
                  href={passportHref ?? undefined}
                  disabledReason={passportHref ? null : "This vehicle has no published Passport yet."}
                  className="w-full"
                  wrapperClassName="flex w-full">
                  Open Passport View
                </CommandAction>
              </div>
            </Panel>

            <Panel title="Print bundle" description="Paper groups the bundle releases.">
              <ul className="divide-y divide-adm-border">
                {bundle.map((b) => {
                  const Icon = BUNDLE_ICON(b.label);
                  return (
                    <li key={b.label} className="flex items-center gap-2.5 py-2">
                      <Icon className="h-5 w-5 shrink-0 text-adm-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-adm-ink">{b.label}</span>
                        {!b.releasedByPacket && (
                          <span className="block text-[12px] text-adm-muted">Printed separately</span>
                        )}
                      </span>
                      <span className="whitespace-nowrap text-[13px] text-adm-muted">{b.count} {b.unit}</span>
                    </li>
                  );
                })}
              </ul>
              {bundleNote && (
                <CommandCallout tone="amber" Icon={AlertTriangle} className="mt-3">
                  {bundleNote}
                </CommandCallout>
              )}
              <div className="mt-3 flex flex-col gap-2">
                <CommandAction
                  variant="primary"
                  capability="can_print"
                  Icon={Printer}
                  busy={busy === "packet"}
                  disabledReason={packetReason}
                  className="w-full"
                  wrapperClassName="flex w-full"
                  onClick={() => runPrint("packet")}>
                  Print bundle
                </CommandAction>
                <CommandAction
                  capability="can_print"
                  Icon={Printer}
                  busy={busy === "stock"}
                  disabledReason={stockReason}
                  className="w-full"
                  wrapperClassName="flex w-full"
                  onClick={() => runPrint("stock")}>
                  Print by stock
                </CommandAction>
              </div>
            </Panel>
          </>
        }
      />

      {menu && (
        <CommandMenu
          trigger={menu.trigger}
          label={`Actions for ${menu.row.label}`}
          onClose={() => setMenu(null)}
          items={commandRowMenuItems({ href: menu.row.href, vin: vehicle.vin, go })}
        />
      )}
    </>,
    printAction,
  );
}
