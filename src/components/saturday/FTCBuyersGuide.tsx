// FTC Buyers Guide renderer foundation.
// This component renders a print-ready Buyers Guide-style warranty document for used vehicles.
// Production note: compare against current official FTC English/Spanish PDF art before launch.
// The FTC Used Car Rule generally uses the Buyers Guide nationwide, with Maine/Wisconsin handled
// through similar state disclosure rules.

export type FTCBuyersGuideVersion = "as_is_no_dealer_warranty" | "implied_warranties_only";
export type FTCWarrantyType = "none" | "limited" | "full";
export type FTCBuyersGuideLanguage = "english" | "spanish";

export type FTCWarrantyCoverageLine = {
  system: string;
  duration: string;
};

export type FTCBuyersGuideVehicle = {
  year: string | number;
  make: string;
  model: string;
  vin: string;
  stock?: string;
};

export type FTCBuyersGuideDealer = {
  name: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  contactNameOrPosition?: string;
  contactPhone?: string;
};

export type FTCBuyersGuideBuyer = {
  name?: string;
  signatureDate?: string;
};

export type FTCBuyersGuideData = {
  language: FTCBuyersGuideLanguage;
  version: FTCBuyersGuideVersion;
  warrantyType: FTCWarrantyType;
  vehicle: FTCBuyersGuideVehicle;
  dealer: FTCBuyersGuideDealer;
  buyer?: FTCBuyersGuideBuyer;
  partsCoveragePercent?: number;
  laborCoveragePercent?: number;
  deductibleDisclosure?: string;
  warrantyCoverageLines?: FTCWarrantyCoverageLine[];
  manufacturerWarrantyStillApplies?: boolean;
  serviceContractAvailable?: boolean;
  systemsWarningText?: string;
  signatureAcknowledgmentEnabled?: boolean;
  stateLawNotes?: string[];
};

type Props = {
  data: FTCBuyersGuideData;
  className?: string;
};

const DEFAULT_SYSTEMS = [
  "Frame & Body",
  "Engine",
  "Transmission",
  "Drive Axle",
  "Cooling System",
  "Electrical System",
  "Fuel System",
  "Air Conditioning",
  "Brakes",
  "Suspension",
  "Steering System",
  "Accessories",
];

const normalizePercent = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "____";
  return `${Math.max(0, Math.min(100, Math.round(value)))}`;
};

export const buildDefaultFTCBuyersGuideData = (input: Partial<FTCBuyersGuideData> & Pick<FTCBuyersGuideData, "vehicle" | "dealer">): FTCBuyersGuideData => ({
  language: "english",
  version: "as_is_no_dealer_warranty",
  warrantyType: "none",
  partsCoveragePercent: 0,
  laborCoveragePercent: 0,
  warrantyCoverageLines: [],
  serviceContractAvailable: false,
  manufacturerWarrantyStillApplies: false,
  signatureAcknowledgmentEnabled: true,
  ...input,
});

export const resolveFTCBuyersGuideVersion = (input: {
  saleState?: string;
  asIsAllowed?: boolean;
  dealerOffersWrittenWarranty?: boolean;
  stateRequiresWarranty?: boolean;
}): FTCBuyersGuideVersion => {
  if (input.dealerOffersWrittenWarranty || input.stateRequiresWarranty) return "implied_warranties_only";
  if (input.asIsAllowed === false) return "implied_warranties_only";
  return "as_is_no_dealer_warranty";
};

export const resolveFTCWarrantyType = (input: {
  dealerOffersWrittenWarranty?: boolean;
  fullWarranty?: boolean;
  stateRequiresWarranty?: boolean;
}): FTCWarrantyType => {
  if (!input.dealerOffersWrittenWarranty && !input.stateRequiresWarranty) return "none";
  return input.fullWarranty ? "full" : "limited";
};

function CheckBox({ checked, label, children }: { checked?: boolean; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border-2 border-black text-[12px] font-black leading-none">{checked ? "X" : ""}</div>
      <div className="min-w-0">
        <div className="text-[12px] font-black uppercase leading-tight">{label}</div>
        {children ? <div className="mt-0.5 text-[9px] font-semibold leading-tight">{children}</div> : null}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="border-b border-black px-1 pb-0.5">
      <div className="text-[7px] font-black uppercase leading-none">{label}</div>
      <div className="min-h-[17px] pt-0.5 text-[11px] font-bold uppercase leading-tight">{value || ""}</div>
    </div>
  );
}

export default function FTCBuyersGuide({ data, className = "" }: Props) {
  const warrantyChecked = data.warrantyType === "limited" || data.warrantyType === "full";
  const asIsChecked = data.version === "as_is_no_dealer_warranty" && data.warrantyType === "none";
  const impliedChecked = data.version === "implied_warranties_only" && data.warrantyType === "none";
  const parts = normalizePercent(data.partsCoveragePercent);
  const labor = normalizePercent(data.laborCoveragePercent);
  const coverageLines = data.warrantyCoverageLines?.length ? data.warrantyCoverageLines : [{ system: "", duration: "" }, { system: "", duration: "" }, { system: "", duration: "" }, { system: "", duration: "" }];

  return (
    <section className={`bg-white text-black print:shadow-none ${className}`} style={{ width: "8.5in", minHeight: "11in", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div className="flex min-h-[11in] flex-col border-[3px] border-black p-[0.18in]">
        <header className="border-b-[3px] border-black pb-2 text-center">
          <div className="text-[34px] font-black uppercase leading-none tracking-tight">Buyers Guide</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.16em]">Important: Spoken promises are difficult to enforce. Ask the dealer to put all promises in writing.</div>
        </header>

        <section className="grid grid-cols-4 gap-2 border-b-[2px] border-black py-2">
          <Field label="Vehicle Make" value={data.vehicle.make} />
          <Field label="Model" value={data.vehicle.model} />
          <Field label="Year" value={data.vehicle.year} />
          <Field label="Stock Number" value={data.vehicle.stock} />
          <div className="col-span-4"><Field label="Vehicle Identification Number (VIN)" value={data.vehicle.vin} /></div>
        </section>

        <section className="grid grid-cols-[1fr_1fr] gap-3 border-b-[2px] border-black py-3">
          <div className="space-y-3">
            <div className="text-[18px] font-black uppercase leading-none">Warranties for this vehicle:</div>
            <CheckBox checked={asIsChecked} label="As Is - No Dealer Warranty">
              The dealer does not provide a warranty for any repairs after sale, unless state law provides otherwise.
            </CheckBox>
            <CheckBox checked={impliedChecked} label="Implied Warranties Only">
              The dealer does not make any specific promises to fix things that need repair when you buy the vehicle or afterward. But implied warranties under your state's laws may give you some rights to have the dealer take care of serious problems that were not apparent when you bought the vehicle.
            </CheckBox>
            <CheckBox checked={warrantyChecked} label="Warranty">
              {data.warrantyType === "full" ? "Full Warranty" : data.warrantyType === "limited" ? "Limited Warranty" : "Check if dealer or state warranty applies."}
            </CheckBox>

            {warrantyChecked ? (
              <div className="rounded-none border-2 border-black p-2">
                <div className="grid grid-cols-2 gap-2 text-[10px] font-black uppercase">
                  <div>Dealer will pay {parts}% of parts</div>
                  <div>Dealer will pay {labor}% of labor</div>
                </div>
                {data.deductibleDisclosure ? <div className="mt-1 text-[9px] font-bold">Deductible: {data.deductibleDisclosure}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-[18px] font-black uppercase leading-none">Systems Covered / Duration</div>
            <div className="grid grid-cols-[1fr_1fr] border-2 border-black text-[9px]">
              <div className="border-b border-r border-black p-1 font-black uppercase">System</div>
              <div className="border-b border-black p-1 font-black uppercase">Duration</div>
              {coverageLines.map((line, index) => (
                <div key={`${line.system}-${index}`} className="contents">
                  <div className="min-h-[26px] border-r border-t border-black p-1 font-bold uppercase">{line.system}</div>
                  <div className="min-h-[26px] border-t border-black p-1 font-bold uppercase">{line.duration}</div>
                </div>
              ))}
            </div>
            <CheckBox checked={data.manufacturerWarrantyStillApplies} label="Manufacturer's Warranty Still Applies">
              The manufacturer's original warranty has not expired on some components of the vehicle.
            </CheckBox>
            <CheckBox checked={data.serviceContractAvailable} label="Service Contract">
              A service contract may be available at an extra charge on this vehicle.
            </CheckBox>
          </div>
        </section>

        <section className="grid flex-1 grid-cols-[1.05fr_.95fr] gap-3 border-b-[2px] border-black py-3">
          <div>
            <div className="text-[16px] font-black uppercase">Major Defects That May Occur in Used Motor Vehicles</div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] font-bold uppercase leading-tight">
              {DEFAULT_SYSTEMS.map((system) => <div key={system} className="border-b border-black/50 pb-0.5">{system}</div>)}
            </div>
            <p className="mt-3 text-[8.5px] font-semibold leading-tight">{data.systemsWarningText || "Ask the dealer if your mechanic can inspect the vehicle on or off the lot. Get all promises in writing. Keep this guide after the sale."}</p>
          </div>
          <div className="space-y-2">
            <div className="text-[16px] font-black uppercase">Dealer Information</div>
            <div className="space-y-1 text-[10px] font-bold uppercase leading-tight">
              <div>{data.dealer.name}</div>
              <div>{data.dealer.address}</div>
              <div>{[data.dealer.city, data.dealer.state, data.dealer.zip].filter(Boolean).join(", ")}</div>
              <div>Contact: {data.dealer.contactNameOrPosition || ""}</div>
              <div>Phone: {data.dealer.contactPhone || ""}</div>
            </div>
            {data.stateLawNotes?.length ? (
              <div className="border-2 border-black p-2 text-[8px] font-bold leading-tight">
                <div className="text-[10px] font-black uppercase">State Law Notes</div>
                {data.stateLawNotes.map((note) => <div key={note} className="mt-1">• {note}</div>)}
              </div>
            ) : null}
          </div>
        </section>

        <footer className="pt-2">
          {data.signatureAcknowledgmentEnabled ? (
            <div className="grid grid-cols-[1fr_1fr] gap-3 text-[9px] font-bold">
              <div className="border-b-2 border-black pb-1">Buyer Name: {data.buyer?.name || ""}</div>
              <div className="border-b-2 border-black pb-1">Signature / Date: {data.buyer?.signatureDate || ""}</div>
              <div className="col-span-2 text-[8.5px] font-black uppercase">I hereby acknowledge receipt of the Buyers Guide at the closing of this sale.</div>
            </div>
          ) : null}
          <div className="mt-2 text-center text-[9px] font-black uppercase">Keep this Buyers Guide for reference after the sale.</div>
        </footer>
      </div>
    </section>
  );
}
