import { Check } from "lucide-react";

export type WarrantyMode = "as_is" | "implied" | "dealer_warranty";
export type UsedVehicleLanguage = "en" | "es";

export type UsedVehicleDocumentData = {
  dealerName: string;
  dealerAddress: string;
  dealerPhone: string;
  buyerName: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  stock: string;
  mileage: string;
  salePrice: string;
  warrantyMode: WarrantyMode;
  language: UsedVehicleLanguage;
  warrantyDuration: string;
  warrantyMiles: string;
  warrantyPercent: string;
  systemsCovered: string[];
  serviceContractAvailable: boolean;
  manufacturerWarrantyApplies: boolean;
  manufacturerUsedVehicleWarrantyApplies: boolean;
  otherUsedVehicleWarrantyApplies: boolean;
  k208Notes: string;
};

export const DEFAULT_USED_VEHICLE_DOCUMENT_DATA: UsedVehicleDocumentData = {
  dealerName: "AutoLabels Demo Dealer",
  dealerAddress: "150 Weston Road, Hartford, CT 06120",
  dealerPhone: "",
  buyerName: "",
  year: "2024",
  make: "INFINITI",
  model: "QX60",
  vin: "5N1DL1FS1RC334921",
  stock: "I24082A",
  mileage: "18,426",
  salePrice: "42995",
  warrantyMode: "dealer_warranty",
  language: "en",
  warrantyDuration: "60 days",
  warrantyMiles: "3,000 miles",
  warrantyPercent: "100%",
  systemsCovered: ["Engine", "Transmission", "Drive axle", "Brakes", "Steering"],
  serviceContractAvailable: true,
  manufacturerWarrantyApplies: false,
  manufacturerUsedVehicleWarrantyApplies: false,
  otherUsedVehicleWarrantyApplies: false,
  k208Notes: "Dealer warranty coverage is subject to the final written warranty document and any lawful exclusions disclosed at sale.",
};

export const WARRANTY_SYSTEMS = [
  "Engine",
  "Transmission",
  "Drive axle",
  "Brakes",
  "Steering",
  "Electrical",
  "Cooling system",
  "Air conditioning",
  "Hybrid / EV components",
];

const money = (value: string) => Number(String(value || "").replace(/[^0-9.]/g, "")) || 0;

export function suggestedCtWarranty(price: string) {
  const amount = money(price);
  if (amount >= 5000) return { duration: "60 days", miles: "3,000 miles", label: "$5,000 or more" };
  if (amount >= 3000) return { duration: "30 days", miles: "1,500 miles", label: "$3,000 to $4,999" };
  return { duration: "No statutory minimum", miles: "N/A", label: "Under $3,000" };
}

const Box = ({ checked }: { checked: boolean }) => (
  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center border-2 border-black bg-white align-middle">
    {checked ? <Check className="h-4 w-4 stroke-[4]" /> : null}
  </span>
);

const FieldLine = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-[8px] font-black uppercase tracking-wide text-black/70">{label}</p>
    <p className="min-h-[22px] border-b border-black px-1 py-0.5 text-[11px] font-semibold text-black">{value || " "}</p>
  </div>
);

const ftcLabels = {
  en: {
    title: "BUYERS GUIDE",
    important: "IMPORTANT: Spoken promises are difficult to enforce. Ask the dealer to put all promises in writing. Keep this form.",
    warranties: "WARRANTIES FOR THIS VEHICLE:",
    asIs: "AS IS — NO DEALER WARRANTY",
    asIsBody: "THE DEALER DOES NOT PROVIDE A WARRANTY FOR ANY REPAIRS AFTER SALE. YOU WILL PAY ALL COSTS FOR ANY REPAIRS.",
    implied: "IMPLIED WARRANTIES ONLY",
    impliedBody: "The dealer makes no warranties, express or implied, except for implied warranties under applicable state law.",
    dealerWarranty: "DEALER WARRANTY",
    dealerWarrantyBody: "The dealer will pay the stated percentage of labor and parts for the covered systems that fail during the warranty period.",
    systems: "SYSTEMS COVERED",
    duration: "Warranty Duration",
    percent: "Percentage of Cost Covered",
    service: "SERVICE CONTRACT",
    serviceBody: "A service contract may be available at an extra charge. Ask for details about coverage, deductible, price, and exclusions.",
    prepurchase: "PRE-PURCHASE INSPECTION: Ask the dealer if you may have this vehicle inspected by your mechanic either on or off the lot.",
  },
  es: {
    title: "GUÍA DEL COMPRADOR",
    important: "IMPORTANTE: Las promesas verbales son difíciles de hacer cumplir. Pida al concesionario que ponga todas las promesas por escrito. Conserve este formulario.",
    warranties: "GARANTÍAS PARA ESTE VEHÍCULO:",
    asIs: "TAL COMO ESTÁ — SIN GARANTÍA DEL CONCESIONARIO",
    asIsBody: "EL CONCESIONARIO NO OFRECE GARANTÍA PARA REPARACIONES DESPUÉS DE LA VENTA. USTED PAGARÁ TODOS LOS COSTOS DE CUALQUIER REPARACIÓN.",
    implied: "SOLO GARANTÍAS IMPLÍCITAS",
    impliedBody: "El concesionario no ofrece garantías expresas o implícitas, excepto las garantías implícitas bajo la ley aplicable.",
    dealerWarranty: "GARANTÍA DEL CONCESIONARIO",
    dealerWarrantyBody: "El concesionario pagará el porcentaje indicado de mano de obra y piezas para los sistemas cubiertos que fallen durante el período de garantía.",
    systems: "SISTEMAS CUBIERTOS",
    duration: "Duración de la Garantía",
    percent: "Porcentaje del Costo Cubierto",
    service: "CONTRATO DE SERVICIO",
    serviceBody: "Puede estar disponible un contrato de servicio por un cargo adicional. Pida detalles sobre cobertura, deducible, precio y exclusiones.",
    prepurchase: "INSPECCIÓN PREVIA A LA COMPRA: Pregunte al concesionario si puede hacer inspeccionar este vehículo por su mecánico dentro o fuera del lote.",
  },
} as const;

export function FtcBuyersGuideDocument({ data }: { data: UsedVehicleDocumentData }) {
  const L = ftcLabels[data.language];
  return (
    <article className="mx-auto min-h-[11in] w-[7.25in] bg-white text-black shadow-xl print:shadow-none" aria-label="FTC Buyers Guide">
      <div className="border-4 border-black">
        <header className="border-b-4 border-black bg-black px-4 py-3 text-center text-white">
          <h1 className="text-3xl font-black tracking-wide">{L.title}</h1>
        </header>
        <section className="border-b-2 border-black px-4 py-2">
          <p className="text-[10px] font-black leading-snug">{L.important}</p>
        </section>
        <section className="grid grid-cols-4 gap-2 border-b-2 border-black px-4 py-3">
          <FieldLine label="Vehicle Make" value={data.make} />
          <FieldLine label="Model" value={data.model} />
          <FieldLine label="Year" value={data.year} />
          <FieldLine label="Stock No." value={data.stock} />
          <div className="col-span-2"><FieldLine label="VIN Number" value={data.vin} /></div>
          <FieldLine label="Mileage" value={data.mileage} />
          <FieldLine label="Price" value={data.salePrice ? `$${money(data.salePrice).toLocaleString()}` : ""} />
        </section>
        <section className="border-b-2 border-black bg-black/10 px-4 py-2">
          <p className="text-sm font-black">{L.warranties}</p>
        </section>
        <section className="space-y-3 px-4 py-4">
          <div className="rounded border-2 border-black p-3">
            <div className="flex items-start gap-2">
              <Box checked={data.warrantyMode === "as_is"} />
              <div>
                <h2 className="text-sm font-black">{L.asIs}</h2>
                <p className="mt-1 text-[10px] font-semibold leading-snug">{L.asIsBody}</p>
              </div>
            </div>
          </div>
          <div className="rounded border-2 border-black p-3">
            <div className="flex items-start gap-2">
              <Box checked={data.warrantyMode === "implied"} />
              <div>
                <h2 className="text-sm font-black">{L.implied}</h2>
                <p className="mt-1 text-[10px] leading-snug">{L.impliedBody}</p>
              </div>
            </div>
          </div>
          <div className="rounded border-2 border-black p-3">
            <div className="flex items-start gap-2">
              <Box checked={data.warrantyMode === "dealer_warranty"} />
              <div className="flex-1">
                <h2 className="text-sm font-black">{L.dealerWarranty}</h2>
                <p className="mt-1 text-[10px] leading-snug">{L.dealerWarrantyBody}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <FieldLine label={L.duration} value={`${data.warrantyDuration} / ${data.warrantyMiles}`} />
                  <FieldLine label={L.percent} value={data.warrantyPercent} />
                </div>
                <div className="mt-3">
                  <p className="text-[9px] font-black uppercase">{L.systems}</p>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                    {WARRANTY_SYSTEMS.map((system) => (
                      <div key={system} className="flex items-center gap-1.5 text-[9px] font-semibold"><Box checked={data.systemsCovered.includes(system)} /> {system}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded border border-black p-3">
            <div className="flex items-start gap-2">
              <Box checked={data.serviceContractAvailable} />
              <div>
                <h2 className="text-sm font-black">{L.service}</h2>
                <p className="mt-1 text-[10px] leading-snug">{L.serviceBody}</p>
              </div>
            </div>
          </div>
          <p className="border-t-2 border-black pt-3 text-[10px] font-black leading-snug">{L.prepurchase}</p>
        </section>
        <section className="grid grid-cols-2 gap-3 border-t-2 border-black px-4 py-3">
          <FieldLine label="Dealer Name" value={data.dealerName} />
          <FieldLine label="Dealer Address" value={data.dealerAddress} />
        </section>
      </div>
    </article>
  );
}

export function ConnecticutK208Document({ data }: { data: UsedVehicleDocumentData }) {
  const suggested = suggestedCtWarranty(data.salePrice);
  return (
    <article className="mx-auto min-h-[11in] w-[8.5in] bg-white p-8 text-black shadow-xl print:shadow-none" aria-label="Connecticut K208 Used Vehicle Warranty Disclosure">
      <div className="border-2 border-black p-6">
        <header className="border-b-2 border-black pb-4 text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em]">Connecticut Used Vehicle Warranty Disclosure</p>
          <h1 className="mt-1 text-2xl font-black">K208 Warranty Worksheet</h1>
          <p className="mt-2 text-[10px] leading-snug">Use this worksheet to disclose the used-vehicle warranty terms presented to the buyer. Verify final wording and applicability against dealership counsel and current Connecticut requirements.</p>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3">
          <FieldLine label="Dealer" value={data.dealerName} />
          <FieldLine label="Dealer Phone" value={data.dealerPhone} />
          <div className="col-span-2"><FieldLine label="Dealer Address" value={data.dealerAddress} /></div>
          <FieldLine label="Buyer" value={data.buyerName} />
          <FieldLine label="Stock" value={data.stock} />
        </section>

        <section className="mt-5 rounded border-2 border-black p-4">
          <p className="text-sm font-black uppercase">Vehicle</p>
          <div className="mt-3 grid grid-cols-5 gap-3">
            <FieldLine label="Year" value={data.year} />
            <FieldLine label="Make" value={data.make} />
            <FieldLine label="Model" value={data.model} />
            <FieldLine label="Mileage" value={data.mileage} />
            <FieldLine label="Sale Price" value={data.salePrice ? `$${money(data.salePrice).toLocaleString()}` : ""} />
            <div className="col-span-5"><FieldLine label="VIN" value={data.vin} /></div>
          </div>
        </section>

        <section className="mt-5 rounded border-2 border-black p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase">Warranty Disclosure</p>
              <p className="mt-1 text-[10px] leading-snug">Suggested Connecticut tier from sale price: <strong>{suggested.label}</strong> · {suggested.duration} / {suggested.miles}</p>
            </div>
            <div className="rounded border border-black px-3 py-2 text-center">
              <p className="text-[9px] font-black uppercase">Selected</p>
              <p className="text-xs font-bold">{data.warrantyMode === "dealer_warranty" ? "Dealer Warranty" : data.warrantyMode === "implied" ? "Implied Only" : "As Is"}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <FieldLine label="Warranty Term" value={data.warrantyDuration} />
            <FieldLine label="Mileage Limit" value={data.warrantyMiles} />
            <FieldLine label="Dealer Pays" value={data.warrantyPercent} />
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-black uppercase">Systems Covered</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {WARRANTY_SYSTEMS.map((system) => (
                <div key={system} className="flex items-center gap-2 rounded border border-black px-2 py-1.5 text-[10px] font-semibold"><Box checked={data.systemsCovered.includes(system)} /> {system}</div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-[10px] font-semibold">
            <div className="flex items-center gap-2"><Box checked={data.manufacturerWarrantyApplies} /> Manufacturer warranty still applies</div>
            <div className="flex items-center gap-2"><Box checked={data.manufacturerUsedVehicleWarrantyApplies} /> Manufacturer used-vehicle warranty applies</div>
            <div className="flex items-center gap-2"><Box checked={data.otherUsedVehicleWarrantyApplies} /> Other used-vehicle warranty applies</div>
            <div className="flex items-center gap-2"><Box checked={data.serviceContractAvailable} /> Service contract offered separately</div>
          </div>
        </section>

        <section className="mt-5 rounded border-2 border-black p-4">
          <p className="text-sm font-black uppercase">Acknowledgment</p>
          <p className="mt-2 text-[11px] leading-relaxed">Buyer acknowledges receiving the used-vehicle warranty disclosure and understands the warranty terms shown above. This disclosure should match the final sales documents and any separate written warranty provided by the dealer.</p>
          <p className="mt-3 min-h-[48px] border border-black p-2 text-[10px] leading-snug">{data.k208Notes}</p>
          <div className="mt-6 grid grid-cols-2 gap-8">
            <FieldLine label="Buyer Signature / Date" value="" />
            <FieldLine label="Dealer Representative / Date" value="" />
          </div>
        </section>
      </div>
    </article>
  );
}
