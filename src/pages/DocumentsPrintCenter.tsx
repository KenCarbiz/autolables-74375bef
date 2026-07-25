import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Building2, Car, ExternalLink, FileCheck, FileLock, FileSearch,
  FileText, FileX, KeyRound, Layers, Loader2, Lock, MoreVertical, Package, Printer, QrCode, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { usePrintCenter, type DocRow } from "@/hooks/useCommandCenter";
import {
  BTN_PRIMARY, BTN_SECONDARY, CommandCard, CommandStatCard, EmptyState, ErrorCard, LoadingCard,
  StatusPill, VehicleIdentityStrip,
} from "@/components/command/CommandPrimitives";
import { cn } from "@/lib/utils";

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
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member, loading: entLoading } = useEntitlements();
  const role = member?.role;
  const canView = isAdmin
    || hasDealerCapability(role, "can_view_print_queue", isAdmin)
    || hasDealerCapability(role, "can_print", isAdmin);
  const canPrint = hasDealerCapability(role, "can_print", isAdmin);

  const { data, loading, error, notFound, reload, printCompletePacket, printByStock } = usePrintCenter(
    canView ? vehicleId : undefined,
  );

  const [busy, setBusy] = useState<"packet" | "stock" | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; row: DocRow } | null>(null);

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

  const runPrint = async (which: "packet" | "stock") => {
    setBusy(which);
    try {
      const res = which === "packet" ? await printCompletePacket() : await printByStock();
      // Never claim a print job that the hook did not confirm.
      if (!res.ok) { toast.error(res.error || "The print job could not be created."); return; }
      // The packet action transitions the eligible documents to printed and logs
      // the release; it does not enqueue a printer job, so it must not say so.
      toast.success(which === "packet"
        ? "Packet released. Its print-ready documents are marked as printed."
        : "Stock label queued for printing.");
    } finally {
      setBusy(null);
    }
  };

  const openPassport = () => {
    if (!data?.passportHref) return;
    window.open(data.passportHref, "_blank", "noopener,noreferrer");
  };

  const copyVin = () => {
    if (!data?.vehicle.vin) return;
    navigator.clipboard.writeText(data.vehicle.vin)
      .then(() => toast.success("VIN copied"), () => toast.error("Clipboard unavailable"));
  };

  // AppShell renders the title in the desktop chrome, so the in-content copy is
  // mobile-only — same convention as DescriptionOperations.
  const Header = (
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
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      {Header}
      {children}
    </div>
  );

  // The role only arrives once entitlements resolve, so gating before that would
  // flash "no access" at every authorized user on first paint.
  if (!entLoading && !canView) {
    return shell(
      <EmptyState
        Icon={Lock}
        title="You do not have access to the Print Center"
        detail="Printing and document packages require the print capability. Ask a manager to update your role."
        action={
          <button onClick={() => navigate("/dashboard")} className={BTN_SECONDARY}>
            Back to Home
          </button>
        }
      />,
    );
  }

  if (!vehicleId) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Pick a vehicle to open its print center"
        detail="Documents, print bundles, and Passport visibility are tracked per vehicle. Choose one from Inventory."
        action={
          <button onClick={() => navigate("/inventory")} className={BTN_PRIMARY}>
            Go to Inventory <ArrowRight className="w-4 h-4" />
          </button>
        }
      />,
    );
  }

  if (error) return shell(<ErrorCard message={error} onRetry={reload} />);

  if (loading || (!data && entLoading)) {
    return shell(
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="min-w-0 space-y-3">
          <LoadingCard rows={3} />
          <LoadingCard rows={8} />
        </div>
        <div className="w-full min-w-0 lg:w-[320px] space-y-4">
          <LoadingCard rows={6} />
          <LoadingCard rows={4} />
        </div>
      </div>,
    );
  }

  if (notFound) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Vehicle not found"
        detail="This vehicle is not in your inventory, or it was removed. Pick another vehicle from Inventory."
        action={
          <button onClick={() => navigate("/inventory")} className={BTN_PRIMARY}>
            Go to Inventory <ArrowRight className="w-4 h-4" />
          </button>
        }
      />,
    );
  }

  if (!data) {
    return shell(
      <EmptyState
        Icon={Building2}
        title="Select a dealership to view this vehicle"
        detail="The print center reads documents for the dealership you are working in. Choose one to continue."
        action={
          <button onClick={() => navigate("/dashboard")} className={BTN_SECONDARY}>
            Back to Home
          </button>
        }
      />,
    );
  }

  const { vehicle, counts, documents, bundle, bundleNote, passportPreview, passportHref } = data;
  const docCount = documents.length;
  const printBlockedReason = !canPrint
    ? "Your role cannot send print jobs. Ask a manager for the print capability."
    : bundle.length === 0
      ? "Nothing is in this vehicle's print bundle yet, so the complete packet cannot be released."
      : null;

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      {Header}

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
            value: vehicle.mileage != null ? `${vehicle.mileage.toLocaleString()} mi` : "—",
          }]}
          onCopyVin={copyVin}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CommandStatCard label="Ready" value={counts.ready} Icon={FileCheck} tone="emerald" accentTop />
          <CommandStatCard label="Blocked" value={counts.blocked} Icon={FileX} tone="red" accentTop />
          <CommandStatCard label="Customer Visible" value={counts.customerVisible} Icon={FileSearch} tone="blue" accentTop />
          <CommandStatCard label="Internal Only" value={counts.internalOnly} Icon={FileLock} tone="violet" accentTop />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        {/* Documents table */}
        <CommandCard>
          {docCount === 0 ? (
            <EmptyState
              Icon={FileText}
              title="No documents yet"
              detail="Window stickers, addendums, guides, and QR items appear here as they are generated for this vehicle."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[860px]">
                  <thead>
                    <tr className="text-[11.5px] font-semibold text-muted-foreground border-b border-border">
                      <th className="px-3 py-2.5">Document</th>
                      <th className="px-3 py-2.5">Current Version</th>
                      <th className="px-3 py-2.5">Internal Status</th>
                      <th className="px-3 py-2.5">Passport Visibility</th>
                      <th className="px-3 py-2.5">Print Status</th>
                      <th className="px-3 py-2.5 text-right">Action</th>
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
                              <RowIcon className="w-4 h-4 text-muted-foreground shrink-0" />
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
                            <button
                              aria-label={`More actions for ${d.label}`}
                              aria-haspopup="menu"
                              aria-expanded={menu?.id === d.id}
                              disabled={!d.href}
                              title={d.href ? undefined : "No file available for this document yet"}
                              onClick={(e) => {
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const MENU_H = 108;
                                const below = window.innerHeight - r.bottom > MENU_H + 12;
                                setMenu(menu?.id === d.id ? null : {
                                  id: d.id, x: r.right,
                                  y: below ? r.bottom + 4 : Math.max(8, r.top - MENU_H - 4),
                                  row: d,
                                });
                              }}
                              className="w-11 h-11 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:hover:bg-transparent">
                              <MoreVertical className="w-4 h-4" />
                            </button>
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
          )}
        </CommandCard>

        {/* Right rail */}
        <div className="w-full min-w-0 lg:w-[320px] space-y-4">
          <CommandCard
            title="Vehicle Print Bundle"
            subtitle="Media groups included in the complete vehicle packet.">
            {bundle.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                No printable media groups for this vehicle yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {bundle.map((b) => {
                  const Icon = BUNDLE_ICON(b.label);
                  return (
                    <li key={b.label} className="flex items-center gap-2.5 py-2.5">
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-[12.5px] text-foreground flex-1 min-w-0 truncate">{b.label}</span>
                      <span className="text-[11.5px] text-muted-foreground whitespace-nowrap">
                        {b.count} {b.unit}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {bundleNote && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mt-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-amber-900">{bundleNote}</p>
              </div>
            )}

            <div className="mt-3 space-y-2">
              <button
                onClick={() => runPrint("packet")}
                disabled={!canPrint || busy !== null || bundle.length === 0}
                title={!canPrint ? "Your role cannot send print jobs"
                  : bundle.length === 0 ? "Nothing in this vehicle's print bundle yet" : undefined}
                className={cn(BTN_PRIMARY, "w-full")}>
                {busy === "packet" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Print Complete Vehicle Packet
              </button>
              <button
                onClick={() => runPrint("stock")}
                disabled={!canPrint || busy !== null}
                title={!canPrint ? "Your role cannot send print jobs" : undefined}
                className={cn(BTN_SECONDARY, "w-full")}>
                {busy === "stock" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Print by Stock
              </button>
              {/* The shared button recipe disables pointer events, so a disabled
                  reason has to be stated in the layout rather than a tooltip. */}
              {printBlockedReason ? (
                <p className="text-[11px] text-muted-foreground">{printBlockedReason}</p>
              ) : null}
            </div>
          </CommandCard>

          <CommandCard
            title="Passport Preview"
            subtitle="Documents visible to the customer in their Passport.">
            {passportPreview.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                No documents are shared to the customer Passport yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {passportPreview.map((p) => (
                  <li key={`${p.label}-${p.version}`} className="flex items-center gap-2.5 py-2.5">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-[12.5px] text-foreground flex-1 min-w-0 truncate">{p.label}</span>
                    <span className="text-[11.5px] text-muted-foreground whitespace-nowrap">{p.version}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 pt-3 border-t border-border">
              <button
                onClick={openPassport}
                disabled={!passportHref}
                title={passportHref ? undefined : "This vehicle has no published Passport yet"}
                className="w-full min-h-[44px] px-3 rounded-xl text-[12.5px] font-semibold text-blue-600 inline-flex items-center justify-center gap-1.5 hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-transparent">
                Open Passport View <ExternalLink className="w-4 h-4" />
              </button>
              {!passportHref ? (
                <p className="text-[11px] text-muted-foreground text-center mt-1">
                  This vehicle has no published Passport yet.
                </p>
              ) : null}
            </div>
          </CommandCard>
        </div>
      </div>

      {menu && menu.row.href && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} aria-hidden />
          <div role="menu" style={{ top: menu.y, left: Math.max(8, menu.x - 208) }}
            className="fixed z-40 w-52 rounded-xl border border-border bg-card shadow-lg p-1">
            <button role="menuitem"
              onClick={() => { window.open(menu.row.href, "_blank", "noopener,noreferrer"); setMenu(null); }}
              className="w-full text-left min-h-[44px] px-3 rounded-lg text-[12.5px] font-medium text-foreground hover:bg-muted/60">
              Open Document
            </button>
            <button role="menuitem"
              onClick={() => {
                const href = menu.row.href;
                setMenu(null);
                if (!href) return;
                navigator.clipboard.writeText(new URL(href, window.location.origin).toString())
                  .then(() => toast.success("Link copied"), () => toast.error("Clipboard unavailable"));
              }}
              className="w-full text-left min-h-[44px] px-3 rounded-lg text-[12.5px] font-medium text-foreground hover:bg-muted/60">
              Copy Document Link
            </button>
          </div>
        </>
      )}
    </div>
  );
}
