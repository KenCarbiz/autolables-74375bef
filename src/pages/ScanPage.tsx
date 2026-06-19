import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useVinDecode } from "@/hooks/useVinDecode";
import { useFactoryData, NhtsaMsrpData } from "@/hooks/useFactoryData";
import { useVinQueue } from "@/hooks/useVinQueue";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAudit } from "@/contexts/AuditContext";
import { useGpsTracking } from "@/hooks/useGpsTracking";
import { usePhotoCapture } from "@/hooks/usePhotoCapture";
import { useVideoWalkaround } from "@/hooks/useVideoWalkaround";
import { useDealJacket } from "@/hooks/useDealJacket";
import { toast } from "sonner";
import {
  ScanLine,
  Car,
  Check,
  Plus,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  List,
  Sparkles,
  X,
  MapPin,
  Camera,
} from "lucide-react";
import VinBarcodeScanner from "@/components/scan/VinBarcodeScanner";

const ScanPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentStore } = useTenant();
  const { log } = useAudit();
  const { decode, decoding, error: vinError } = useVinDecode();
  const { fetchFactoryData, loading: factoryLoading, error: factoryError } = useFactoryData();
  const { queue, addToQueue } = useVinQueue();
  const { pinLocation } = useGpsTracking();
  const { addPhoto } = usePhotoCapture();
  const { addVideo } = useVideoWalkaround();
  const { createJacket } = useDealJacket();

  const vinRef = useRef<HTMLInputElement>(null);
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [stockNumber, setStockNumber] = useState("");
  const [condition, setCondition] = useState<"new" | "used" | null>(null);
  const [notes, setNotes] = useState("");
  // Camera-first on mobile, type-first on desktop. Tapping Scan on a phone is a
  // physical capture action, so open the camera immediately — but on a laptop a
  // surprise webcam prompt is wrong, so default there to the manual VIN field.
  // Gate on a touch-PRIMARY pointer (phone/tablet) plus an available camera.
  const [scannerOpen, setScannerOpen] = useState(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
    return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
  });

  // Decoded data
  const [decoded, setDecoded] = useState<{
    ymm: string;
    year: string;
    make: string;
    model: string;
    trim: string;
    bodyStyle: string;
    driveType: string;
    fuelType: string;
    engineDescription: string;
  } | null>(null);
  const [factoryData, setFactoryData] = useState<NhtsaMsrpData | null>(null);
  const [showEquipment, setShowEquipment] = useState(false);
  const [added, setAdded] = useState(false);

  // Focus the VIN field whenever the camera isn't up (no camera, or the user
  // closed the scanner) so manual entry is ready without an extra tap.
  useEffect(() => {
    if (!scannerOpen) vinRef.current?.focus();
  }, [scannerOpen]);

  // Auto-decode when VIN reaches 17 chars
  useEffect(() => {
    const cleaned = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
    if (cleaned.length === 17 && !decoded && !decoding) {
      handleDecode(cleaned);
    }
  }, [vin]);

  const handleDecode = async (vinValue?: string) => {
    const v = vinValue || vin.trim().toUpperCase();
    if (v.length !== 17) {
      toast.error("VIN must be exactly 17 characters");
      return;
    }

    // Decode basic YMM
    const result = await decode(v);
    if (!result) return;

    setDecoded(result);
    toast.success(`${result.year} ${result.make} ${result.model}`);

    // Auto-fetch factory data (NHTSA extended)
    const factory = await fetchFactoryData(v);
    if (factory) {
      setFactoryData(factory);
    }
  };

  const handleAddToQueue = async () => {
    if (!decoded) {
      toast.error("Decode a VIN first");
      return;
    }
    if (!condition) {
      toast.error("Pick New or Pre-owned first");
      return;
    }

    // Supabase-backed. decoded_data + condition live on the row,
    // not in a localStorage side-car, so any device in the tenant
    // sees the queue the moment the lot scanner pushes it.
    const saved = await addToQueue(vin.trim().toUpperCase(), stockNumber, mileage, {
      notes,
      condition,
      decoded_data: { decoded, factoryData },
    });

    if (!saved) {
      toast.error("Couldn't save to the queue");
      return;
    }

    // Log the scan
    if (user) {
      log({
        store_id: currentStore?.id || "",
        user_id: user.id,
        action: "inventory_imported",
        entity_type: "vin_scan",
        entity_id: vin.trim().toUpperCase(),
        details: {
          ymm: decoded.ymm,
          stock: stockNumber,
          mileage,
          condition,
          source: "mobile_scan",
        },
      });
    }

    // Auto-pin GPS location when scanning on the lot
    if (user) {
      pinLocation(vin.trim().toUpperCase(), user.id).catch(() => {});
    }

    setAdded(true);
    toast.success("Added to print queue!");

    // Auto-reset after 2 seconds for next scan
    setTimeout(() => {
      resetForm();
    }, 2000);
  };

  const resetForm = () => {
    setVin("");
    setMileage("");
    setStockNumber("");
    setNotes("");
    setDecoded(null);
    setFactoryData(null);
    setShowEquipment(false);
    setAdded(false);
    setCondition(null);
    vinRef.current?.focus();
  };

  const queueCount = queue.filter(q => q.status === "queued").length;

  return (
    <div className="min-h-screen bg-background">
      <h1 className="sr-only">Scan a VIN</h1>
      {/* Camera scanner overlay — mounts on top of the whole page when
          the user taps Open camera. Closes itself on a valid 17-char
          VIN detection and auto-decodes via the input's existing effect. */}
      {scannerOpen && (
        <VinBarcodeScanner
          onClose={() => setScannerOpen(false)}
          onDetected={(detected) => {
            setScannerOpen(false);
            setVin(detected);
            // useEffect watching `vin` will fire handleDecode once the
            // 17-char threshold is met.
          }}
        />
      )}
      {/* Mobile header */}
      <header className="sticky top-0 z-20 topbar-navy text-white">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5" />
            <div>
              <p className="text-sm font-semibold leading-tight">Lot Scanner</p>
              <p className="text-[10px] text-white/60">{currentStore?.name || "Your Dealership"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/admin?tab=queue")}
              className="relative inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-white/10 text-sm font-medium"
            >
              <List className="w-4 h-4" />
              Queue
              {queueCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-500 text-[10px] font-bold text-slate-900 flex items-center justify-center">
                  {queueCount}
                </span>
              )}
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="p-2 rounded-md hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Success state */}
        {added && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-6 text-center animate-in fade-in">
            <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-white" />
            </div>
            <p className="text-lg font-semibold text-emerald-900">Added to Print Queue</p>
            <p className="text-sm text-emerald-700 mt-1">
              {decoded?.ymm} · Stock #{stockNumber || "—"}
            </p>
            <p className="text-xs text-emerald-600 mt-3">Next vehicle loading...</p>
          </div>
        )}

        {!added && (
          <>
            {/* VIN Input — big, prominent */}
            <div className="bg-card rounded-xl border border-border shadow-premium p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-semibold text-foreground">Scan or Enter VIN</h2>
                </div>
                <button
                  onClick={() => setScannerOpen(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-bold shadow-premium hover:brightness-110 transition-all"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Open camera
                </button>
              </div>
              <input
                ref={vinRef}
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, ""))}
                placeholder="Tap Open camera or type 17-char VIN"
                maxLength={17}
                autoComplete="off"
                autoCapitalize="characters"
                className="w-full h-14 px-4 rounded-lg border-2 border-border bg-background text-lg font-mono font-bold text-foreground text-center tracking-widest outline-none focus:border-primary focus:ring-2 focus:ring-ring transition-all"
              />
              <div className="flex items-center justify-between mt-2">
                <span className={`text-xs tabular-nums ${vin.length === 17 ? "text-emerald-600 font-semibold" : "text-muted-foreground"}`}>
                  {vin.length}/17 characters
                </span>
                {vin.length === 17 && !decoded && !decoding && (
                  <button
                    onClick={() => handleDecode()}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Decode manually
                  </button>
                )}
              </div>
              {(decoding || factoryLoading) && (
                <div className="mt-3 flex items-center gap-2 text-xs text-blue-600">
                  <div className="w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                  {decoding ? "Decoding VIN..." : "Pulling factory data..."}
                </div>
              )}
              {vinError && <p className="mt-2 text-xs text-destructive">{vinError}</p>}
              {factoryError && <p className="mt-2 text-xs text-destructive">{factoryError}</p>}
            </div>

            {/* Decoded Vehicle Info */}
            {decoded && (
              <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden animate-in slide-in-from-bottom-2">
                <div className="bg-primary text-primary-foreground px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Car className="w-5 h-5" />
                    <div>
                      <p className="text-lg font-bold tracking-tight">{decoded.year} {decoded.make} {decoded.model}</p>
                      {decoded.trim && <p className="text-xs text-primary-foreground/70">{decoded.trim}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {decoded.bodyStyle && <InfoPill label={decoded.bodyStyle} />}
                    {decoded.driveType && <InfoPill label={decoded.driveType} />}
                    {decoded.fuelType && <InfoPill label={decoded.fuelType} />}
                    {decoded.engineDescription && <InfoPill label={decoded.engineDescription} />}
                  </div>
                </div>

                {/* Factory Equipment */}
                {factoryData && factoryData.standardEquipment.length > 0 && (
                  <div className="border-b border-border">
                    <button
                      onClick={() => setShowEquipment(!showEquipment)}
                      className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                        <span>Factory Equipment ({factoryData.standardEquipment.length})</span>
                      </div>
                      {showEquipment ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showEquipment && (
                      <div className="px-5 pb-4 space-y-1">
                        {factoryData.standardEquipment.map((eq, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground py-0.5">
                            <Check className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <span>{eq}</span>
                          </div>
                        ))}
                        {factoryData.baseMsrp && (
                          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-sm">
                            <span className="font-medium text-foreground">Base MSRP</span>
                            <span className="font-bold text-foreground">${parseInt(factoryData.baseMsrp).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 1 — required condition gate. The rest of the
                    form stays hidden until the user picks New or
                    Pre-owned, so every scanned VIN gets labelled with
                    its inventory bucket. */}
                {!condition && (
                  <div className="p-5 border-t border-border bg-muted/30">
                    <div className="text-center mb-4">
                      <p className="text-sm font-semibold text-foreground">Is this new or pre-owned inventory?</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Pick one to continue.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setCondition("new")}
                        className="h-16 rounded-lg border-2 border-border bg-card text-sm font-semibold text-foreground hover:border-primary hover:bg-muted transition-all"
                      >
                        New
                      </button>
                      <button
                        onClick={() => setCondition("used")}
                        className="h-16 rounded-lg border-2 border-border bg-card text-sm font-semibold text-foreground hover:border-primary hover:bg-muted transition-all"
                      >
                        Pre-owned
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2 — rest of the form, revealed once condition is set */}
                {condition && (
                <div className="p-5 space-y-4">
                  {/* Condition chip with Change link */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Condition</span>
                      <span className="inline-flex items-center text-xs font-semibold px-2 py-1 rounded-md bg-primary text-primary-foreground">
                        {condition === "new" ? "New" : "Pre-owned"}
                      </span>
                    </div>
                    <button
                      onClick={() => setCondition(null)}
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Change
                    </button>
                  </div>

                  {/* Mileage */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                      Mileage {condition === "new" && <span className="normal-case font-normal">(delivery miles)</span>}
                    </label>
                    <input
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder={condition === "new" ? "e.g. 12" : "e.g. 45230"}
                      inputMode="numeric"
                      className="w-full h-12 px-4 rounded-lg border-2 border-border bg-background text-base font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring transition-all"
                    />
                    {mileage && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {parseInt(mileage).toLocaleString()} miles
                      </p>
                    )}
                  </div>

                  {/* Stock Number */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Stock Number</label>
                    <input
                      value={stockNumber}
                      onChange={(e) => setStockNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. H12345"
                      autoCapitalize="characters"
                      className="w-full h-12 px-4 rounded-lg border-2 border-border bg-background text-base font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring transition-all"
                    />
                  </div>

                  {/* Notes (optional) */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                      Notes <span className="normal-case font-normal">(optional)</span>
                    </label>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Lot B Row 3, needs detail"
                      className="w-full h-11 px-4 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring transition-all"
                    />
                  </div>

                  {/* Add to Queue button */}
                  <button
                    onClick={handleAddToQueue}
                    className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    <Plus className="w-5 h-5" />
                    Add to Print Queue
                  </button>
                </div>
                )}
              </div>
            )}

            {/* Queue counter */}
            {queueCount > 0 && (
              <button
                onClick={() => navigate("/admin?tab=queue")}
                className="w-full bg-card rounded-xl border border-border shadow-premium p-4 flex items-center justify-between hover:bg-muted/50 transition-colors active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                    <List className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{queueCount} vehicles in queue</p>
                    <p className="text-xs text-muted-foreground">Tap to review & print</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            )}

            {/* Quick reset */}
            {decoded && (
              <button
                onClick={resetForm}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear & Scan Next
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const InfoPill = ({ label }: { label: string }) => (
  <span className="text-[10px] font-medium bg-white/15 px-2 py-0.5 rounded">
    {label}
  </span>
);

export default ScanPage;
