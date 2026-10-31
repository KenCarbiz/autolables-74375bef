import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Building2, Car, FileCheck, FileLock, FileSearch,
  FileText, FileX, KeyRound, Layers, Lock, Package, Printer, QrCode,
  Search, Tag,
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

const DOC_PAGE_W = 816;
const DOC_PAGE_H = 1056;
const THUMB_W = 180;

const DocThumb = ({ href, children }: { href?: string; children: React.ReactNode }) => {
  const remote = href && /^https:\/\//i.test(href) ? href : null;
  const isImage = remote ? /\.(png|jpe?g|webp|gif)(\?|$)/i.test(remote) : false;
  const scale = THUMB_W / DOC_PAGE_W;
  return (
    <div className="relative mx-auto aspect-[8.5/11] w-full max-w-[180px] overflow-hidden rounded-[4px] border border-adm-border bg-white shadow-sm">
      {remote && isImage ? (
        <img src={remote} alt="" className="h-full w-full object-cover object-top" />
      ) : remote ? (
        <iframe title="Document preview" src={`${remote}#toolbar=0&navpanes=0&view=FitH`} tabIndex={-1} aria-hidden="true" loading="lazy"
          className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
          style={{ width: DOC_PAGE_W, height: DOC_PAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }} />
      ) : children}
    </div>
  );
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
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; row: DocRow; trigger: HTMLElement } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const seeded = useRef<string | null>(null);

  useEffect(() => {
    if (!data || seeded.current === data.vehicle.id) return;
    seeded.current = data.vehicle.id;
    setPicked(new Set(data.documents.filter((d) => d.kind === "doc" && d.printStatus.label !== "Blocked").map((d) => d.id)));
  }, [data]);

  const runPrint = async (which: "packet" | "stock") => {
    setBusy(which);
    try {
      const res = which === "packet" ? await printCompletePacket(Array.from(picked)) : await printByStock();
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
          description="Select documents, review, and print for a vehicle."
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
      : picked.size === 0
        ? "Select at least one document to print."
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
  );
  const previewDoc = documents.find((d) => d.id === selectedDoc) ?? documents[0] ?? null;

  return shell(
    <>
      <DegradedNotice degraded={degraded} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <p className="mb-1 text-[13px] leading-[18px] font-semibold text-adm-ink">Vehicle</p>
          <div className="flex min-h-[44px] items-center gap-2 rounded-[6px] border border-adm-border bg-adm-surface px-3">
            <Search className="h-5 w-5 shrink-0 text-adm-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[14px] leading-[20px] text-adm-ink">
              <span className="font-semibold">{vehicleLine}</span>
              {vehicleMeta ? <span className="text-adm-muted">{`  ·  ${vehicleMeta}`}</span> : null}
            </span>
            <Link to="/inventory" aria-label="Change vehicle" title="Change vehicle" className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-adm-muted hover:bg-adm-workspace hover:text-adm-ink">
              <ChevronDown className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[13px] leading-[18px] font-semibold text-adm-ink">Printer profile</p>
          <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] leading-[20px]">
            <span className="truncate text-adm-ink">Browser print dialog</span>
            <Link to="/admin/documents/print-calibration" className="shrink-0 font-semibold text-adm-primary hover:underline">Manage</Link>
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
            <>
            <Panel flush>
              <WorkTable className="[&_th]:px-2 [&_td]:px-2" caption="Documents for this vehicle" minWidth={700}>
                <thead>
                  <tr>
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all documents for the print bundle"
                        checked={documents.some((d) => d.kind === "doc") && documents.filter((d) => d.kind === "doc").every((d) => picked.has(d.id))}
                        onChange={(e) => setPicked(e.target.checked ? new Set(documents.filter((d) => d.kind === "doc").map((d) => d.id)) : new Set())}
                        className="h-4 w-4 accent-[#2457D6]"
                      />
                    </Th>
                    <Th>Document</Th>
                    <Th>Version</Th>
                    <Th className="whitespace-nowrap">Internal status</Th>
                    <Th>Visibility</Th>
                    <Th className="whitespace-nowrap">Print status</Th>
                    <Th align="right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => {
                    const versionNote = d.isCurrent ? null : d.internalStatus.label === "Draft" ? "Draft" : null;
                    const reprinting = busyRow?.id === d.id && busyRow.kind === "reprint";
                    const generating = busyRow?.id === d.id && busyRow.kind === "generate";
                    return (
                      <tr key={d.id} className={`h-12 cursor-pointer ${previewDoc?.id === d.id ? "bg-adm-selected" : "hover:bg-adm-workspace"}`} onClick={() => setSelectedDoc(d.id)}>
                        <Td className="w-10" >
                          <input
                            type="checkbox"
                            aria-label={`Select ${d.label} for the print bundle`}
                            checked={picked.has(d.id)}
                            disabled={d.kind !== "doc"}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })}
                            className="h-4 w-4 accent-[#2457D6]"
                          />
                        </Td>
                        <Td className="max-w-[190px]">
                          <span className="inline-flex max-w-full items-center gap-2">
                            <span className="truncate text-[14px] font-semibold text-adm-ink">{d.label}</span>
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className="font-semibold">{d.version}</span>
                          {versionNote ? <span className="ml-1.5 text-[12px] text-adm-muted">{versionNote}</span> : null}
                        </Td>
                        <Td><StatusText tone={productTone(d.internalStatus.tone)}>{d.internalStatus.label}</StatusText></Td>
                        <Td className="text-adm-muted whitespace-nowrap">{d.passportVisibility.label}</Td>
                        <Td><StatusText tone={productTone(d.printStatus.tone)} className="!bg-transparent !px-0">{d.printStatus.label}</StatusText></Td>
                        <Td align="right">
                          <span className="inline-flex items-center justify-end gap-1">
                            {d.reprintCopy != null ? (
                              <CommandAction
                                variant="link"
                                className="!min-h-0"
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
                                className="!min-h-0"
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
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </WorkTable>
            </Panel>
            <div className="flex flex-col gap-3 px-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[13px] leading-[18px] text-adm-muted">
                {picked.size} of {docCount} documents selected · {counts.ready} ready · {counts.blocked} blocked · {counts.customerVisible} shown in the Passport
                {passportHref ? <> · <a href={passportHref} target="_blank" rel="noreferrer" className="font-semibold text-adm-primary hover:underline">Open Passport view</a></> : null}
              </p>
              <div className="flex shrink-0 sm:w-[220px]">{printAction}</div>
            </div>
            </>
          )
        }
        aside={
          <>
            <Panel title="Preview">
              {previewDoc ? (
                <div className="flex flex-col gap-3">
                  <DocThumb href={previewDoc.href}>
                    <div className="flex h-full flex-col justify-between p-4 text-left">
                      <div>
                        <p className="text-[11px] leading-[16px] text-adm-muted">{vehicleLine}</p>
                        <p className="mt-1 text-[15px] leading-[20px] font-bold text-adm-ink">{previewDoc.label}</p>
                        <p className="text-[12px] leading-[18px] text-adm-muted">{previewDoc.version}</p>
                      </div>
                      <p className="text-[11px] leading-[16px] text-adm-muted">{vehicle.vin}</p>
                    </div>
                  </DocThumb>
                  {docCount > 1 && (
                    <div className="flex items-center justify-center gap-3 text-[13px] leading-[18px] text-adm-muted">
                      <button type="button" aria-label="Previous document" className="grid h-8 w-8 place-items-center rounded-[6px] border border-adm-border hover:bg-adm-workspace" onClick={() => setSelectedDoc(documents[(documents.indexOf(previewDoc) - 1 + docCount) % docCount].id)}>
                        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <span className="tabular-nums">{documents.indexOf(previewDoc) + 1} of {docCount}</span>
                      <button type="button" aria-label="Next document" className="grid h-8 w-8 place-items-center rounded-[6px] border border-adm-border hover:bg-adm-workspace" onClick={() => setSelectedDoc(documents[(documents.indexOf(previewDoc) + 1) % docCount].id)}>
                        <ChevronRight className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 text-[13px] leading-[18px]">
                    <span className="min-w-0 truncate text-adm-muted">{previewDoc.internalStatus.label} · {previewDoc.passportVisibility.label}</span>
                    {previewDoc.href && (previewDoc.href.startsWith("/")
                      ? <Link to={previewDoc.href} className="shrink-0 font-semibold text-adm-primary hover:underline">Open document</Link>
                      : <a href={previewDoc.href} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-adm-primary hover:underline">Open document</a>)}
                  </div>
                </div>
              ) : (
                <p className="text-[14px] leading-[20px] text-adm-muted">Select a document to preview it.</p>
              )}
            </Panel>

            <Panel title="Print bundle">
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
  );
}
