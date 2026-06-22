import { Camera, Image, ShieldCheck, Sparkles } from "lucide-react";

type ProofPhoto = {
  photoUrl?: string | null;
  caption?: string | null;
  category?: string | null;
  stage?: "before" | "after" | "proof" | string | null;
  showOnPassport?: boolean;
};

type ProofGalleryVehicle = {
  proofPhotos?: ProofPhoto[];
  dealer?: { name?: string | null } | null;
};

const visiblePhotos = (vehicle: ProofGalleryVehicle) =>
  (vehicle.proofPhotos || []).filter((photo) => photo.showOnPassport !== false && !!photo.photoUrl);

export const hasCustomerBeforeAfterProofGallery = (vehicle: ProofGalleryVehicle) => visiblePhotos(vehicle).length > 0;

const stageLabel = (stage?: ProofPhoto["stage"]) => {
  if (stage === "before") return "Before";
  if (stage === "after") return "After";
  return "Proof";
};

export function CustomerBeforeAfterProofGallery({ vehicle }: { vehicle: ProofGalleryVehicle }) {
  const photos = visiblePhotos(vehicle);
  if (!photos.length) return null;

  const grouped = photos.reduce<Record<string, ProofPhoto[]>>((acc, photo) => {
    const key = photo.category || "Vehicle improvements";
    acc[key] = acc[key] || [];
    acc[key].push(photo);
    return acc;
  }, {});

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative bg-slate-950 p-6 text-white">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-blue-500/25 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 h-44 w-44 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-100">
              <Camera className="h-3.5 w-3.5" /> Vehicle Improvements
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Approved proof photos, organized for confidence.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              These images are shown only when the dealership chooses to publish customer-visible service or reconditioning photos.
            </p>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
                <p className="text-sm font-semibold leading-relaxed text-white/80">
                  Private shop photos and internal technician notes stay hidden unless approved for customer display.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
                    <Sparkles className="h-3.5 w-3.5" /> {category}
                  </div>
                  <h3 className="mt-2 text-lg font-black text-slate-950">Approved visual proof</h3>
                </div>
                <div className="rounded-xl bg-white p-2 text-slate-600"><Image className="h-5 w-5" /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((photo, index) => (
                  <figure key={`${photo.photoUrl}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="relative aspect-[4/3] bg-slate-100">
                      <img src={photo.photoUrl || ""} alt={photo.caption || category} className="h-full w-full object-cover" loading="lazy" />
                      <div className="absolute left-3 top-3 rounded-full bg-slate-950/80 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur">
                        {stageLabel(photo.stage)}
                      </div>
                    </div>
                    <figcaption className="p-3">
                      <p className="text-sm font-black text-slate-950">{photo.caption || "Dealer-approved proof photo"}</p>
                      <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">
                        Published by {vehicle.dealer?.name || "the selling dealer"} for customer review.
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
