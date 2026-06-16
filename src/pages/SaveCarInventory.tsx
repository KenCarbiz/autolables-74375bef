import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useVinDecode } from "@/hooks/useVinDecode";
import { useFactoryData, NhtsaMsrpData } from "@/hooks/useFactoryData";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { useInventory } from "@/hooks/useInventory";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { emptyK208, K208_INSPECTION_CATEGORIES } from "@/data/ctK208Form";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Car,
  Check,
  ScanLine,
  Save,
  FileText,
  Shield,
  QrCode,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ClipboardCheck,
  X,
} from "lucide-react";
import type { VehicleFile } from "@/types/vehicleFile";

const SaveCarInventory = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { log } = useAudit();
  const { decode, decoding, error: vinError } = useVinDecode();
  const { fetchFactoryData, loading: factoryLoading } = useFactoryData();
  const vehicleFiles = useVehicleFiles(currentStore?.id || "");
  const inventory = useInventory(currentStore?.id || "");

  const vinRef = useRef<HTMLInputElement>(null);

  // Form state
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [stockNumber, setStockNumber] = useState("");
  const [condition, setCondition] = useState<"new" | "used">("used");
  const [color, setColor] = useState("");
  const [price, setPrice] = useState("");

  // Decoded vehicle data
  const [decoded, setDecoded] = useState<{
    ymm: string; year: string; make: string; model: string;
    trim: string; bodyStyle: string; driveType: string;
    fuelType: string; engineDescription: string;
  } | null>(null);
  const [factoryData, setFactoryData] = useState<NhtsaMsrpData | null>(null);
  const [showEquipment, setShowEquipment] = useState(false);

  // FTC Buyers Guide
  const [buyersGuideType, setBuyersGuideType] = useState<"as-is" | "implied" | "warranty">("as-is");
  const [warrantyDuration, setWarrantyDuration] = useState("30 days or 1,000 miles");
  const [warrantyPercent, setWarrantyPercent] = useState("50");

  // K-208 (CT only)
  const isConnecticut = (currentStore?.state || settings.doc_fee_state || "").toUpperCase() === "CT";
  const [k208Items, setK208Items] = useState<Record<string, "pass" | "fail" | "na" | "">>({});

  // Result state
  const [savedFile, setSavedFile] = useState<VehicleFile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { vinRef.current?.focus(); }, []);

  // Auto-decode when VIN reaches 17 chars
  useEffect(() => {
    const cleaned = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
    if (cleaned.length === 17 && !decoded && !decoding) {
      handleDecode(cleaned);
    }
  }, [vin]);

  const handleDecode = async (vinValue?: string) => {
    const v = vinValue || vin.trim().toUpperCase();
    if (v.length !== 17) { toast.error("VIN must be exactly 17 characters"); return; }
    const result = await decode(v);
    if (!result) return;
    setDecoded(result);
    toast.success(`${result.year} ${result.make} ${result.model}`);
    const factory = await fetchFactoryData(v);
    if (factory) setFactoryData(factory);
  };

  const handleSave = async () => {
    if (!decoded) { toast.error("Decode a VIN first"); return; }
    if (!stockNumber.trim()) { toast.error("Stock number is required"); return; }
    setSaving(true);

    try {
      // 1. Create the VehicleFile (VIN-specific permanent record)
      const file = await vehicleFiles.getOrCreateFile({
        vin: vin.trim().toUpperCase(),
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        stock_number: stockNumber.trim(),
        condition,
        mileage: parseInt(mileage) || 0,
        msrp: factoryData?.baseMsrp ? parseInt(factoryData.baseMsrp) : 0,
        factory_equipment: factoryData?.standardEquipment || [],
        created_by: user?.id || "unknown",
      });
      if (!file) {
        toast.error("Couldn't create vehicle file");
        setSaving(false);
        return;
      }

      // 2. Also add to inventory list
      inventory.addVehicle({
        store_id: currentStore?.id || "",
        vin: vin.trim().toUpperCase(),
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        stock_number: stockNumber.trim(),
        mileage: parseInt(mileage) || 0,
        condition,
        color_exterior: color,
        color_interior: "",
        body_style: decoded.bodyStyle || "",
        transmission: "",
        drive_type: decoded.driveType || "",
        fuel_type: decoded.fuelType || "",
        engine: decoded.engineDescription || "",
        price: parseFloat(price) || 0,
        msrp: factoryData?.baseMsrp ? parseInt(factoryData.baseMsrp) : 0,
        description: "",
        image_url: "",
        source_url: "",
        status: "in_stock",
        addendum_id: file.id,
      });

      // 3. Attach FTC Buyers Guide to the vehicle file
      await vehicleFiles.attachDocument(file.id, {
        type: "ftc_buyers_guide",
        label: "FTC Used Car Buyers Guide",
        data: {
          guide_type: condition === "used" ? buyersGuideType : "warranty",
          language: "en",
          warranty_duration: buyersGuideType === "warranty" ? warrantyDuration : null,
          warranty_percentage: buyersGuideType === "warranty" ? warrantyPercent : null,
          vehicle_vin: vin.trim().toUpperCase(),
          vehicle_ymm: `${decoded.year} ${decoded.make} ${decoded.model}`,
          dealer_name: settings.dealer_name || currentStore?.name || "",
          dealer_state: currentStore?.state || settings.doc_fee_state || "",
          created_at: new Date().toISOString(),
        },
        created_by: user?.id || "unknown",
      });

      // 4. If CT, attach K-208 inspection form
      if (isConnecticut && condition === "used") {
        await vehicleFiles.attachDocument(file.id, {
          type: "k208",
          label: "CT K-208 Vehicle Inspection",
          data: {
            ...emptyK208,
            vehicleYear: decoded.year,
            vehicleMake: decoded.make,
            vehicleModel: decoded.model,
            vehicleBodyStyle: decoded.bodyStyle || "",
            vehicleVin: vin.trim().toUpperCase(),
            vehicleColor: color,
            vehicleMileage: mileage,
            dealerName: settings.dealer_name || currentStore?.name || "",
            dealerPhone: currentStore?.phone || "",
            dealerAddress: currentStore?.address || "",
            dealerCity: currentStore?.city || "",
            dealerState: currentStore?.state || "CT",
            dealerZip: currentStore?.zip || "",
            inspectionItems: k208Items,
            inspectionDate: new Date().toISOString().split("T")[0],
          },
          created_by: user?.id || "unknown",
        });
      }

      // 5. Audit log
      if (user) {
        log({
          store_id: currentStore?.id || "",
          user_id: user.id,
          action: "inventory_imported",
          entity_type: "vehicle_file",
          entity_id: file.id,
          details: {
            vin: vin.trim().toUpperCase(),
            ymm: `${decoded.year} ${decoded.make} ${decoded.model}`,
            stock: stockNumber,
            condition,
            has_k208: isConnecticut && condition === "used",
            has_buyers_guide: true,
            source: "save_car_inventory",
          },
        });
      }

      setSavedFile(file);
      toast.success("Vehicle saved to inventory with compliance docs!");
    } catch (err) {
      toast.error("Failed to save vehicle");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const dealSigningUrl = savedFile
    ? `${window.location.origin}/deal/${savedFile.deal_qr_token}`
    : "";

  const resetForm = () => {
    setVin(""); setMileage(""); setStockNumber(""); setColor(""); setPrice("");
    setDecoded(null); setFactoryData(null); setShowEquipment(false);
    setBuyersGuideType("as-is"); setK208Items({});
    setSavedFile(null); setCondition("used");
    vinRef.current?.focus();
  };

  // ── RENDER: Success state after save ──
  if (savedFile) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-20 topbar-navy text-white">
          <div className="flex items-center justify-between h-14 px-4">
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5" />
              <p className="text-sm font-semibold">Vehicle Saved</p>
            </div>
            <button onClick={() => navigate("/admin?tab=files")} className="p-2 rounded-md hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="max-w-lg mx-auto p-4 space-y-4">
          {/* Vehicle info */}
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-3">
              <Check className="w-7 h-7 text-white" />
            </div>
            <p className="text-xl font-bold text-emerald-900">
              {savedFile.year} {savedFile.make} {savedFile.model}
            </p>
            <p className="text-sm text-emerald-700 mt-1">
              VIN: {savedFile.vin} | Stock #{savedFile.stock_number}
            </p>
          </div>

          {/* Attached docs summary */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Attached Documents</h3>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <Shield className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-900">FTC Used Car Buyers Guide</p>
                <p className="text-xs text-blue-700">
                  {buyersGuideType === "as-is" ? "As-Is / No Warranty" : buyersGuideType === "implied" ? "Implied Warranty" : "Full Warranty"}
                </p>
              </div>
            </div>
            {isConnecticut && condition === "used" && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <ClipboardCheck className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">CT K-208 Inspection Form</p>
                  <p className="text-xs text-amber-700">Required per CGS 14-62(g)</p>
                </div>
              </div>
            )}
          </div>

          {/* QR Code for deal signing */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5 text-center space-y-4">
            <h3 className="text-sm font-bold text-foreground flex items-center justify-center gap-2">
              <QrCode className="w-4 h-4" />
              Deal Signing QR Code
            </h3>
            <p className="text-xs text-muted-foreground">
              When this car is sold, scan this QR code to open the deal file.
              Customer, co-buyer, and dealer sign right from the phone or tablet.
            </p>
            <div className="inline-block p-4 bg-white rounded-xl border-2 border-border">
              <QRCodeSVG value={dealSigningUrl} size={200} level="H" />
            </div>
            <p className="text-[10px] text-muted-foreground break-all">{dealSigningUrl}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(dealSigningUrl); toast.success("Link copied!"); }}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              Copy signing link
            </button>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={() => window.print()}
              className="w-full h-12 rounded-xl border-2 border-primary text-primary font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/5"
            >
              <FileText className="w-4 h-4" />
              Print QR Code Label
            </button>
            <button
              onClick={resetForm}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2"
            >
              <Car className="w-4 h-4" />
              Add Another Vehicle
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Main form ──
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 topbar-navy text-white">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <Car className="w-5 h-5" />
            <div>
              <p className="text-sm font-semibold leading-tight">Add to Inventory</p>
              <p className="text-[10px] text-white/60">{currentStore?.name || "Your Dealership"}</p>
            </div>
          </div>
          <button onClick={() => navigate("/admin?tab=files")} className="p-2 rounded-md hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* VIN Input */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <ScanLine className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-foreground">Scan or Enter VIN</h2>
          </div>
          <input
            ref={vinRef}
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/gi, ""))}
            placeholder="Scan barcode or type 17-char VIN"
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
              <button onClick={() => handleDecode()} className="text-xs font-semibold text-blue-600 hover:underline">
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
        </div>

        {/* Decoded Vehicle Info */}
        {decoded && (
          <>
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden animate-in slide-in-from-bottom-2">
              <div className="bg-primary text-primary-foreground px-5 py-4">
                <div className="flex items-center gap-2">
                  <Car className="w-5 h-5" />
                  <div>
                    <p className="text-lg font-bold tracking-tight">{decoded.year} {decoded.make} {decoded.model}</p>
                    {decoded.trim && <p className="text-xs text-primary-foreground/70">{decoded.trim}</p>}
                  </div>
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
                    </div>
                  )}
                </div>
              )}

              {/* Vehicle details form */}
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Condition</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setCondition("new")}
                      className={`h-11 rounded-lg text-sm font-semibold border-2 transition-all ${
                        condition === "new" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
                      }`}
                    >New</button>
                    <button
                      onClick={() => setCondition("used")}
                      className={`h-11 rounded-lg text-sm font-semibold border-2 transition-all ${
                        condition === "used" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
                      }`}
                    >Used / CPO</button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Stock Number *</label>
                  <input
                    value={stockNumber}
                    onChange={(e) => setStockNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. H12345"
                    className="w-full h-12 px-4 rounded-lg border-2 border-border bg-background text-base font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Mileage</label>
                  <input
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder={condition === "new" ? "e.g. 12" : "e.g. 45230"}
                    inputMode="numeric"
                    className="w-full h-12 px-4 rounded-lg border-2 border-border bg-background text-base font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Color</label>
                    <input
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="e.g. White"
                      className="w-full h-12 px-4 rounded-lg border-2 border-border bg-background text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Price</label>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="e.g. 24995"
                      inputMode="decimal"
                      className="w-full h-12 px-4 rounded-lg border-2 border-border bg-background text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* FTC Buyers Guide section */}
            {condition === "used" && (
              <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-bold text-foreground">FTC Used Car Buyers Guide</h3>
                </div>
                <p className="text-xs text-muted-foreground">Federal law requires a Buyers Guide on every used vehicle. Select the warranty status.</p>
                <div className="space-y-2">
                  {(["as-is", "implied", "warranty"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setBuyersGuideType(t)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                        buyersGuideType === t ? "border-blue-500 bg-blue-50/50" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        buyersGuideType === t ? "border-blue-500 bg-blue-500" : "border-border"
                      }`}>
                        {buyersGuideType === t && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {t === "as-is" ? "As-Is / No Warranty" : t === "implied" ? "Implied Warranty Only" : "Warranty"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {t === "as-is"
                            ? "Vehicle sold with no warranty. Buyer pays all repair costs."
                            : t === "implied"
                            ? "State law implied warranties apply."
                            : "Dealer provides warranty coverage."}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                {buyersGuideType === "warranty" && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1 block">Duration</label>
                      <input
                        value={warrantyDuration}
                        onChange={(e) => setWarrantyDuration(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1 block">Dealer Pays %</label>
                      <input
                        value={warrantyPercent}
                        onChange={(e) => setWarrantyPercent(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* K-208 Inspection (CT only, used only) */}
            {isConnecticut && condition === "used" && (
              <div className="bg-card rounded-xl border border-amber-200 shadow-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-foreground">CT K-208 Vehicle Inspection</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Required per CGS 14-62(g). $500 fine if not completed before retail sale.
                  You can complete the full inspection later from the vehicle file.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800 font-medium">
                    K-208 form will be auto-attached to this vehicle's deal file.
                    {K208_INSPECTION_CATEGORIES.length} inspection categories with{" "}
                    {K208_INSPECTION_CATEGORIES.reduce((sum, c) => sum + c.items.length, 0)} items.
                  </p>
                </div>
              </div>
            )}

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving || !decoded || !stockNumber.trim()}
              className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Save to Inventory & Generate QR
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SaveCarInventory;
