import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, Car, ExternalLink, FileCheck, FileLock, FileSearch, FileText, FileX,
  KeyRound, Layers, Loader2, Lock, MoreVertical, Package, Printer, QrCode, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { usePrintCenter, type DocRow } from "@/hooks/useCommandCenter";
import {
  CommandCard, CommandStatCard, EmptyState, ErrorCard, LoadingCard, StatusPill, VehicleIdentityStrip,
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
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const role = member?.role;
  const canView = isAdmin
    || hasDealerCapability(role, "can_view_print_queue", isAdmin)
    || hasDealerCapability(role, "can_print", isAdmin);
  const canPrint = hasDealerCapability(role, "can_print", isAdmin);

  const { data, loading, error, reload, printCompletePacket, printByStock } = usePrintCenter(
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
      toast.success(which === "packet"
        ? "Complete vehicle packet queued for printing."
        : "Print by stock queued.");
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

  const Header = (
    <div className="mb-5">
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

  if (!canView) {
    return shell(
      <EmptyState
        Icon={Lock}
        title="You do not have access to the Print Center"
        detail="Printing and document packages require the print capability. Ask a manager to update your role."
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

  if (!vehicleId) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Pick a vehicle to open its print center"
        detail="Documents, print bundles, and Passport visibility are tracked per vehicle. Choose one from Inventory."
        action={
          <button
            onClick={() => navigate("/inventory")}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold">
            Go to Inventory
          </button>
        }
      />,
    );
  }

  if (loading) {
    return shell(
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="space-y-3">
          <LoadingCard rows={3} />
          <LoadingCard rows={8} />
        </div>
        <LoadingCard rows={6} />
      </div>,
    );
  }

  if (error) return shell(<ErrorCard message={error} onRetry={reload} />);

  if (!data) {
    return shell(
      <EmptyState
        Icon={Car}
        title="Vehicle not found"
        detail="This vehicle is not in your inventory, or it was removed. Pick another vehicle from Inventory."
        action={
          <button
            onClick={() => navigate("/inventory")}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold">
            Go to Inventory
          </button>
        }
      />,
    );
  }

  const { vehicle, counts, documents, bundle, bundleNote, passportPreview, passportHref } = data;
  const docCount = documents.length;

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
        <CommandCard title="Documents">
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
                      return (
                        <tr key={d.id} className="hover:bg-primary/[0.025] transition-colors">
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <RowIcon className="w-4 h-4 text-slate-500 shrink-0" />
                              <span className="text-[12.5px] font-medium text-foreground truncate">{d.label}</span>
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="text-[12.5px] font-bold text-foreground">{d.version}</span>
                            <span className="text-[11.5px] text-muted-foreground ml-1.5">
                              {d.isCurrent ? "Current" : "Draft"}
                            </span>
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
                Showing 1 to {docCount} of {docCount} document{docCount === 1 ? "" : "s"}
              </p>
            </>
          )}
        </CommandCard>

        {/* Right rail */}
        <div className="space-y-4">
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
                      <Icon className="w-4 h-4 text-slate-500 shrink-0" />
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
                className="w-full min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                {busy === "packet" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Print Complete Vehicle Packet
              </button>
              <button
                onClick={() => runPrint("stock")}
                disabled={!canPrint || busy !== null}
                title={!canPrint ? "Your role cannot send print jobs" : undefined}
                className="w-full min-h-[44px] px-4 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                {busy === "stock" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Print by Stock
              </button>
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
                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
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
