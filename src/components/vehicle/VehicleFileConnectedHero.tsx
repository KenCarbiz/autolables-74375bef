import {
  ArrowLeft,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  Gauge,
  Globe,
  Printer,
} from "lucide-react";

type ReadySummary = {
  pct: number;
  remaining: Array<{ label: string }>;
};

type VehicleHeroData = {
  ymm: string | null;
  trim: string | null;
  condition: "new" | "used" | "cpo" | null;
  status: "draft" | "published" | "archived";
  vin: string;
  mileage: number | null;
  price: number | null;
  created_at: string;
  prep_status: { foreman_signed_at?: string } | null;
};

export function VehicleFileConnectedHero({
  vehicle,
  gallery,
  safeImg,
  ready,
  publicUrl,
  onBack,
  onPrevPhoto,
  onNextPhoto,
  onCopyLink,
  onLabels,
}: {
  vehicle: VehicleHeroData;
  gallery: string[];
  safeImg: number;
  ready: ReadySummary;
  publicUrl: string;
  onBack: () => void;
  onPrevPhoto: () => void;
  onNextPhoto: () => void;
  onCopyLink: () => void;
  onLabels: () => void;
}) {
  const published = vehicle.status === "published";

  return (
    <section>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-950">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Inventory
      </button>

      <div className="overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[330px_1fr_300px]">
          <div className="relative min-h-[210px] bg-slate-100 lg:min-h-[250px]">
            {gallery.length ? (
              <img src={gallery[safeImg]} alt={vehicle.ymm || "vehicle"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
                <Car className="h-16 w-16" strokeWidth={1.25} />
              </div>
            )}
            {gallery.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); onPrevPhoto(); }} aria-label="Previous photo" className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/65">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onNextPhoto(); }} aria-label="Next photo" className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/65">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2 py-1 text-xs font-black tabular-nums text-white">{safeImg + 1} / {gallery.length}</span>
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center border-t border-slate-100 p-5 lg:border-l lg:border-t-0 lg:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                vehicle.condition === "new" ? "bg-blue-50 text-blue-700" : vehicle.condition === "cpo" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-700"
              }`}>{vehicle.condition || "unknown"}</span>
              <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                vehicle.status === "published" ? "bg-emerald-50 text-emerald-700" : vehicle.status === "archived" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"
              }`}>{vehicle.status}</span>
              {vehicle.prep_status?.foreman_signed_at ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Prep signed</span> : null}
            </div>

            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 lg:text-4xl">
              {vehicle.ymm || "Vehicle needs VIN decode"}
              {vehicle.trim ? <span className="block text-2xl font-semibold text-slate-500 lg:inline lg:pl-2 lg:text-3xl">{vehicle.trim}</span> : null}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-slate-500">
              <span className="font-mono text-slate-700">VIN {vehicle.vin}</span>
              {typeof vehicle.mileage === "number" && <span className="inline-flex items-center gap-1"><Gauge className="h-4 w-4" /> {vehicle.mileage.toLocaleString()} mi</span>}
              {typeof vehicle.price === "number" && <span className="inline-flex items-center gap-1"><DollarSign className="h-4 w-4" /> ${vehicle.price.toLocaleString()}</span>}
              <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> Created {new Date(vehicle.created_at).toLocaleDateString()}</span>
            </div>

            <div className={`mt-5 rounded-2xl border p-3 ${published ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <ReadinessBubble pct={ready.pct} published={published} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-black ${published ? "text-emerald-900" : "text-amber-900"}`}>{published ? "Published Vehicle" : "Draft Vehicle"}</p>
                  <p className="text-xs font-semibold text-slate-600">
                    {published ? "Live on the shopper portal." : ready.remaining.length ? "This vehicle is not ready to publish" : "All set — ready for publishing."}
                  </p>
                </div>
                {!published && ready.remaining.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase text-amber-800">Missing:</span>
                    {ready.remaining.slice(0, 3).map((item) => (
                      <span key={item.label} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-amber-800 shadow-sm">
                        <CircleAlert className="h-3 w-3" /> {item.label.replace(" generated & published", "")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-3 border-t border-slate-100 bg-white p-5 lg:border-l lg:border-t-0">
            {published ? (
              <>
                <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700">
                  <ExternalLink className="h-4 w-4" /> View Customer Packet
                </a>
                <button onClick={onCopyLink} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50">
                  <Copy className="h-4 w-4" /> Copy Link
                </button>
              </>
            ) : (
              <>
                <button onClick={onLabels} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700">
                  <Printer className="h-4 w-4" /> Generate Sticker
                </button>
                <button onClick={onLabels} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50">
                  <Globe className="h-4 w-4" /> Publish to Shopper Portal
                </button>
                <button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 hover:bg-slate-50">
                  More actions
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReadinessBubble({ pct, published }: { pct: number; published: boolean }) {
  return (
    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 bg-white text-sm font-black ${published ? "border-emerald-500 text-emerald-900" : "border-amber-400 text-amber-900"}`}>
      {pct}%
    </div>
  );
}

export default VehicleFileConnectedHero;
