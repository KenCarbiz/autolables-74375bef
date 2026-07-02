import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Printer, ChevronLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useProducts } from "@/hooks/useProducts";
import { confirmPrintReady } from "@/lib/printReadiness";
import { packetVisible } from "@/lib/packetModules";
import AddendumLabel from "@/components/addendum-label/AddendumLabel";
import {
  type AddendumLabelData, splitProducts, programsToBenefits, isCompact, fmtDate,
} from "@/components/addendum-label/labelData";

// ──────────────────────────────────────────────────────────────
// /addendum-label/:id — the 4.5in x 11in self-aware addendum label
// for one inventory vehicle. Everything on the page is assembled from
// the tenant's settings and the vehicle_listings row: identity, price,
// products by disposition, dealer programs as benefits, and a QR to
// the exact vehicle passport. ?preview=1 renders the design-reference
// sample (Summit Motors Palisade) without touching any real record.
// ──────────────────────────────────────────────────────────────

interface ListingRow {
  id: string; vin: string; slug: string | null; ymm: string | null; trim: string | null;
  condition: string | null; price: number | null; stock_number?: string | null;
  mc_attributes?: Record<string, unknown> | null;
  packet_modules?: Record<string, boolean> | null;
}

const MODULE_LABELS: [string, string][] = [
  ["photos", "Photos"], ["warranty", "Warranty & Service"], ["recon", "Reconditioning"],
  ["documents", "Documents"], ["historyReport", "History Report"], ["marketValue", "Market Value"],
];

const SAMPLE: AddendumLabelData = {
  tenant: { name: "Summit Motors", logoUrl: "", addressLine: "1234 Auto Drive, Franklin, TN 37067", phone: "(615) 555-1234", website: "summitmotors.com" },
  vehicle: { year: "2023", make: "Hyundai", model: "Palisade", trim: "Limited", vin: "KM8R54HE5PU123456", stockNumber: "H231234", condition: "new", bodyStyle: "SUV", msrp: 46000, price: null },
  passportUrl: "https://autolabels.io/v/KM8R54HE5PU123456",
  passportModules: ["Photos", "Warranty & Service", "Documents"],
  installed: [
    { id: "s1", name: "Window Tint", subtitle: "Premium Ceramic", price: 499, iconKey: "window_tint", disclosureRequired: false },
    { id: "s2", name: "Paint Protection Film", subtitle: "Front Bumper & Hood", price: 999, iconKey: "paint_protection_film", disclosureRequired: false },
    { id: "s3", name: "Wheel Locks", subtitle: "Set of 4", price: 199, iconKey: "wheel_locks", disclosureRequired: false },
    { id: "s4", name: "All-Weather Floor Mats", subtitle: "Custom Fit", price: 299, iconKey: "floor_mats", disclosureRequired: false },
  ],
  benefits: [
    { id: "b1", name: "10 Year / 100,000 Mile Powertrain Warranty", iconKey: "powertrain_warranty", disclosureRequired: true },
    { id: "b2", name: "2 Years Scheduled Maintenance Plan", iconKey: "maintenance_plan", disclosureRequired: true },
    { id: "b3", name: "24/7 Roadside Assistance", iconKey: "roadside_assistance", disclosureRequired: false },
    { id: "b4", name: "5 Day / 300 Mile Exchange Policy", iconKey: "exchange_policy", disclosureRequired: true },
  ],
  upgrades: [
    { id: "u1", name: "Remote Start System", subtitle: "2-Way Remote Start", price: 799, iconKey: "remote_start", disclosureRequired: false },
    { id: "u2", name: "Ceramic Coating", subtitle: "Exterior Ceramic Protection", price: 1299, iconKey: "ceramic_coating", disclosureRequired: false },
    { id: "u3", name: "Roof Rack Cross Bars", subtitle: "Genuine OEM", price: 399, iconKey: "roof_rack", disclosureRequired: false },
  ],
  generatedDate: fmtDate(),
  compact: false,
};

const splitYmm = (ymm: string): { year: string; make: string; model: string } => {
  const parts = ymm.trim().split(/\s+/);
  if (/^\d{4}$/.test(parts[0] || "")) {
    const rest = parts.slice(1);
    // Two-word makes (Land Rover, Alfa Romeo) keep the model intact.
    const twoWord = /^(land|alfa|aston)$/i.test(rest[0] || "");
    const make = twoWord ? rest.slice(0, 2).join(" ") : rest[0] || "";
    return { year: parts[0], make, model: rest.slice(twoWord ? 2 : 1).join(" ") };
  }
  return { year: "", make: parts[0] || "", model: parts.slice(1).join(" ") };
};

const AddendumLabelPrint = () => {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const isPreview = params.has("preview");
  const navigate = useNavigate();
  const { currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { data: products } = useProducts();
  const [listing, setListing] = useState<ListingRow | null>(null);
  const [loading, setLoading] = useState(!isPreview);

  useEffect(() => {
    if (isPreview || !id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("vehicle_listings")
        .select("id, vin, slug, ymm, trim, condition, price, stock_number, mc_attributes, packet_modules")
        .eq("id", id)
        .maybeSingle();
      if (!cancelled) {
        if (error || !data) toast.error("Vehicle not found");
        setListing((data as unknown as ListingRow) ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isPreview]);

  const data: AddendumLabelData | null = useMemo(() => {
    if (isPreview) return SAMPLE;
    if (!listing) return null;
    const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
    const { year, make, model } = splitYmm(listing.ymm || "");
    const bodyStyle = String(mc.body_type || mc.body || "");
    const condition = (listing.condition || "used").toLowerCase();
    const { installed, upgrades } = splitProducts(products || [], settings.product_default_mode, bodyStyle, model);
    const benefits = programsToBenefits(settings.dealer_programs, condition);
    const addressLine = [settings.dealer_address, settings.dealer_city, settings.dealer_state, settings.dealer_zip].filter(Boolean).join(", ");
    const slugOrVin = listing.slug || listing.vin;
    return {
      tenant: {
        name: currentStore?.name || settings.dealer_name || "",
        logoUrl: settings.dealer_logo_url || "",
        addressLine,
        phone: settings.dealer_phone || "",
        website: (settings.new_inventory_url || settings.used_inventory_url || "").replace(/^https?:\/\//, "").split("/")[0],
      },
      vehicle: {
        year, make, model,
        trim: listing.trim || "",
        vin: listing.vin,
        stockNumber: listing.stock_number || String(mc.stock_no || ""),
        condition,
        bodyStyle,
        msrp: typeof mc.msrp === "number" ? mc.msrp : null,
        price: listing.price ?? null,
      },
      passportUrl: `${window.location.origin}/v/${encodeURIComponent(slugOrVin)}?src=qr`,
      passportModules: MODULE_LABELS.filter(([mid]) => packetVisible(listing, mid)).map(([, label]) => label).slice(0, 4),
      installed,
      benefits,
      upgrades,
      generatedDate: fmtDate(),
      compact: isCompact(installed, benefits, upgrades),
    };
  }, [isPreview, listing, products, settings, currentStore]);

  const doPrint = () => {
    if (!isPreview && !confirmPrintReady(settings, currentStore?.name, (blockers) => blockers.forEach((b) => toast.error(b.message)))) return;
    window.print();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Vehicle not found.</div>;

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{`
        @media print {
          @page { size: 4.5in 11in; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
          .addendum-label-wrap { margin: 0 !important; box-shadow: none !important; }
          .addendum-label { page-break-after: always; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-[13px] font-semibold text-[#2563EB] inline-flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Back</button>
        <p className="text-[13px] font-bold">Addendum Label · 4.5" x 11"{isPreview ? " · SAMPLE" : ""}</p>
        <div className="flex items-center gap-2">
          <button onClick={doPrint} className="h-9 px-4 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold inline-flex items-center gap-1.5"><Printer className="w-4 h-4" /> Print</button>
          <button onClick={doPrint} className="h-9 px-3 rounded-lg border border-slate-200 text-[13px] font-semibold inline-flex items-center gap-1.5" title="Use your browser's Save as PDF destination"><Download className="w-4 h-4" /> PDF</button>
        </div>
      </div>
      <div className="addendum-label-wrap mx-auto my-6 shadow-xl" style={{ width: "4.5in" }}>
        <AddendumLabel data={data} />
      </div>
    </div>
  );
};

export default AddendumLabelPrint;
