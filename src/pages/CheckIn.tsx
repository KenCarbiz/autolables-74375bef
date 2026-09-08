import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, ClipboardList, Car, ScanLine, ShieldCheck } from "lucide-react";
import VinBarcodeScanner from "@/components/scan/VinBarcodeScanner";
import { normalizeScannedVin } from "@/lib/vinScan";
import {
  useVinCheckIn, checkInHref, type CheckInDenial, type CheckInVehicle,
} from "@/hooks/useVinCheckIn";
import {
  BTN_PRIMARY, BTN_SECONDARY, EM_DASH, EmptyState, LoadingCard, StatusPill,
} from "@/components/command/CommandPrimitives";
import { roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";
import { cn } from "@/lib/utils";

// /check-in — the one surface a vendor, technician or detailer opens to start
// work on a car. They scan the Code 39 barcode on the driver's door jamb, or
// read the VIN plate through the windshield, and land on the work that is
// theirs on that vehicle.
//
// The scan only SELECTS the vehicle. Who may act on it is decided by
// resolve_vin_checkin from the signed-in session, because a VIN is public and
// proves nothing: it is printed on the door jamb of every car on the lot. The
// printed per-vehicle QR links keep working untouched for anyone already
// carrying one.

const WORK_TYPE: Record<string, string> = {
  accessory: "Accessory install",
  inspection: "Inspection",
  detail: "Detail",
  photo: "Photos",
  service: "Service work",
  other: "Vendor work",
};

const readNote = (trimmed: boolean, corrected: boolean): string | null => {
  if (trimmed && corrected) return "Read from a longer barcode payload, with I/O/Q read back as 1/0/0.";
  if (trimmed) return "The barcode carried more than the VIN; the extra characters were dropped.";
  if (corrected) return "I, O and Q were read back as the digits 1, 0 and 0.";
  return null;
};

export default function CheckIn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { resolve, resolving } = useVinCheckIn();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [denial, setDenial] = useState<CheckInDenial | null>(null);
  const [vehicle, setVehicle] = useState<CheckInVehicle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handoffDone = useRef(false);

  const submit = useCallback(async (raw: string, source: "barcode" | "typed") => {
    const read = normalizeScannedVin(raw, source);
    setVehicle(null);
    setDenial(null);
    if (!read.ok) {
      setNote(null);
      setReadError(read.message);
      return;
    }
    setReadError(null);
    setNote(readNote(read.trimmed, read.corrected));
    setTyped(read.vin);
    const outcome = await resolve(read.vin);
    if (outcome.ok) setVehicle(outcome.vehicle);
    else setDenial(outcome);
  }, [resolve]);

  // A scan handed over from anywhere else in the app arrives as ?vin=. It is
  // consumed once so a refresh doesn't silently re-resolve a stale car.
  const handoff = searchParams.get("vin");
  useEffect(() => {
    if (!handoff || handoffDone.current) return;
    handoffDone.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("vin");
    setSearchParams(next, { replace: true });
    void submit(handoff, "typed");
  }, [handoff, searchParams, setSearchParams, submit]);

  const rescan = () => {
    setVehicle(null);
    setDenial(null);
    setReadError(null);
    setNote(null);
    setTyped("");
    inputRef.current?.focus();
  };

  const ready = vehicle ? checkInHref(vehicle) : null;

  return (
    <div className="max-w-[720px] mx-auto p-4 md:p-6 space-y-5">
      {scannerOpen && (
        <VinBarcodeScanner
          onClose={() => setScannerOpen(false)}
          onDetected={(vin) => {
            setScannerOpen(false);
            void submit(vin, "barcode");
          }}
        />
      )}

      <header>
        <div className="flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-al-page font-display text-foreground">Check a vehicle in</h1>
        </div>
        <p className="text-al-body text-muted-foreground mt-0.5">
          Scan the barcode on the driver's door jamb, or read the VIN plate through the windshield.
          You are already signed in, so the work is recorded under your name.
        </p>
      </header>

      {!vehicle && (
        <section className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <button type="button" onClick={() => setScannerOpen(true)} className={cn(BTN_PRIMARY, "w-full")}>
            <Camera className="w-4 h-4" aria-hidden="true" /> Scan the VIN barcode
          </button>

          <div>
            <label htmlFor="checkin-vin" className="text-al-meta text-muted-foreground">
              Or type the VIN from the dashboard plate
            </label>
            <input
              id="checkin-vin"
              ref={inputRef}
              value={typed}
              maxLength={17}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="17-character VIN"
              onChange={(e) => {
                const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                setTyped(next);
                setReadError(null);
                if (next.length === 17) void submit(next, "typed");
              }}
              className="mt-1 w-full h-12 rounded-xl border-2 border-border bg-background px-4 text-center font-mono tracking-widest text-foreground outline-none focus:border-primary"
            />
            <p className="mt-1 text-al-meta text-muted-foreground tabular-nums">{typed.length}/17</p>
          </div>

          {readError && (
            <p role="alert" className="text-al-body text-amber-700 dark:text-amber-400">{readError}</p>
          )}
        </section>
      )}

      {resolving && <LoadingCard rows={2} />}

      {denial && !resolving && (
        <EmptyState
          Icon={Car}
          title="We can't open a check-in for that scan"
          detail={denial.message}
          action={
            <button type="button" onClick={rescan} className={BTN_SECONDARY}>
              Scan another VIN
            </button>
          }
        />
      )}

      {vehicle && !resolving && (
        <section className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-al-card text-foreground">{vehicle.ymm || "Vehicle"}</h2>
              <p className="text-al-meta text-muted-foreground font-mono">{vehicle.vin}</p>
              <p className="text-al-meta text-muted-foreground">
                Stock {vehicle.stockNumber || EM_DASH} · {vehicle.tenantName || "Your dealership"}
              </p>
            </div>
            <StatusPill tone={vehicle.mode === "vendor" ? "blue" : "emerald"}>
              {roleDisplayName(vehicle.role).toUpperCase()}
            </StatusPill>
          </div>

          {note && <p className="text-al-meta text-muted-foreground">{note}</p>}

          <p className="text-al-body text-muted-foreground">
            Check this is the car in front of you before you sign anything to it.
          </p>

          {vehicle.mode === "vendor" && (
            <div className="space-y-2">
              <h3 className="text-al-meta text-muted-foreground">Assigned to you on this vehicle</h3>
              {vehicle.assignments.map((a) => (
                <div key={`${a.record_id}:${a.item_id}`} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-al-body text-foreground">{a.label}</p>
                    <StatusPill tone={a.status === "complete" ? "emerald" : "slate"}>
                      {a.status === "complete" ? "COMPLETED" : "OPEN"}
                    </StatusPill>
                  </div>
                  <p className="text-al-meta text-muted-foreground">
                    {WORK_TYPE[a.category] ?? WORK_TYPE.other}
                    {a.notes ? ` · ${a.notes}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            {ready && (
              <Link to={ready} className={cn(BTN_PRIMARY, "w-full sm:w-auto")}>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" /> Start the check-in
              </Link>
            )}
            {vehicle.mode === "vendor" && (
              <Link to="/home/vendor" className={cn(BTN_PRIMARY, "w-full sm:w-auto")}>
                <ClipboardList className="w-4 h-4" aria-hidden="true" /> Open my work orders
              </Link>
            )}
            {vehicle.installToken && (
              <Link to={`/install/${vehicle.installToken}`} className={cn(BTN_SECONDARY, "w-full sm:w-auto")}>
                <Camera className="w-4 h-4" aria-hidden="true" /> Record an install proof
              </Link>
            )}
            <button type="button" onClick={rescan} className={cn(BTN_SECONDARY, "w-full sm:w-auto")}>
              Scan another VIN
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
