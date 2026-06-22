import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  Car,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  FileText,
  Gauge,
  HeartHandshake,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  loadPassportDeliverySettings,
  requestPassportDocumentDelivery,
  trackPassportTradeValueClicked,
  type PassportDeliverySettings,
  type PassportVehicleContext,
} from "@/lib/passport/passportDocumentDelivery";
import {
  trackCustomerCtaClicked,
  trackCustomerEngagement,
  trackDocumentOpened,
  trackPacketOpened,
  trackPassportOpened,
} from "@/lib/engagement/customerEngagement";

type PassportDocument = {
  id?: string | null;
  type: string;
  title: string;
  description: string;
  status?: "available" | "missing" | "signed" | "verified";
  url?: string | null;
};

type PassportDealer = {
  name?: string | null;
  phone?: string | null;
  textPhone?: string | null;
  address?: string | null;
  website?: string | null;
};

type PassportVehicle = PassportVehicleContext & {
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  price?: string | number | null;
  mileage?: string | number | null;
  heroImageUrl?: string | null;
  dealer?: PassportDealer;
  documents?: PassportDocument[];
  warrantyLabel?: string | null;
  reconSummary?: string | null;
  historySummary?: string | null;
};

type AutoLabelsPassportExperienceProps = {
  vehicle: PassportVehicle;
  settings?: PassportDeliverySettings | null;
};

type IconComponent = typeof ShieldCheck;

const money = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "Contact dealer";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return String(value);
};

const miles = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "Mileage pending";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return `${numeric.toLocaleString()} miles`;
  return String(value);
};

const vehicleTitle = (vehicle: PassportVehicle) =>
  [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Vehicle Passport";

const statusTone = (status?: PassportDocument["status"]) => {
  if (status === "missing") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "signed" || status === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
};

const defaultDocuments: PassportDocument[] = [
  { type: "ftc_buyers_guide", title: "FTC Buyers Guide", description: "Review warranty terms and buyer protection information.", status: "available" },
  { type: "ct_k208", title: "Connecticut K208", description: "Review Connecticut used-vehicle warranty disclosure details.", status: "available" },
  { type: "window_sticker", title: "Original Window Sticker", description: "See factory equipment, options, and MSRP where available.", status: "available" },
  { type: "service_recon", title: "Service & Recon", description: "See available inspection, repair, and recon evidence.", status: "available" },
];

const TrustBadgeRow = ({ vehicle }: { vehicle: PassportVehicle }) => {
  const badges = [
    { label: "Verified VIN", icon: BadgeCheck, show: !!vehicle.vin },
    { label: "Buyer Guide", icon: FileCheck2, show: true },
    { label: "Warranty Info", icon: ShieldCheck, show: true },
    { label: "Trade Value", icon: HeartHandshake, show: true },
  ].filter((badge) => badge.show);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {badges.map(({ label, icon: Icon }) => (
        <div key={label} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white shadow-sm backdrop-blur">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
      ))}
    </div>
  );
};

const HeroStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/15 bg-white/10 p-4 shadow-xl shadow-black/10 backdrop-blur">
    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/55">{label}</div>
    <div className="mt-1 text-lg font-black text-white">{value}</div>
  </div>
);

const ConfidenceScore = ({ score = 93 }: { score?: number }) => (
  <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-5 text-white shadow-2xl shadow-black/20 backdrop-blur-xl">
    <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-emerald-400/20 blur-2xl" />
    <div className="relative flex items-center gap-4">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-[10px] border-emerald-400 bg-slate-950/60">
        <div className="text-center">
          <div className="text-3xl font-black leading-none">{score}</div>
          <div className="text-[10px] font-bold text-white/50">/100</div>
        </div>
      </div>
      <div>
        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-200"><Star className="h-3 w-3" /> Excellent</div>
        <h2 className="mt-2 text-xl font-black leading-tight">Confidence at a glance</h2>
        <p className="mt-1 text-sm leading-relaxed text-white/70">A quick read on vehicle facts, available disclosures, dealer proof, and Passport readiness.</p>
      </div>
    </div>
  </div>
);

const VehicleStoryTimeline = ({ vehicle }: { vehicle: PassportVehicle }) => {
  const steps = [
    { title: "Verified", text: vehicle.vin ? `VIN ${vehicle.vin}` : "VIN ready for review", icon: BadgeCheck },
    { title: "Inspected", text: vehicle.reconSummary || "Service and recon proof available when attached", icon: Wrench },
    { title: "Protected", text: vehicle.warrantyLabel || "Buyer Guide and warranty disclosures ready", icon: ShieldCheck },
    { title: "Passport Ready", text: "Documents, trade value, and dealer contact in one place", icon: Sparkles },
  ];

  return (
    <section className="rounded-[2rem] border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700"><Timer className="h-3.5 w-3.5" /> Vehicle Story</div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground">From the lot to your decision</h2>
          <p className="mt-1 text-sm text-muted-foreground">A simple path through the proof that helps you understand this vehicle before you visit.</p>
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Transparent by design</p>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {steps.map(({ title, text, icon: Icon }, index) => (
          <div key={title} className="relative rounded-2xl border border-border bg-card p-4">
            {index < steps.length - 1 ? <div className="absolute left-8 top-12 hidden h-px w-full bg-border md:block" /> : null}
            <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white shadow-lg"><Icon className="h-5 w-5" /></div>
            <h3 className="mt-3 font-black text-foreground">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

const ConfidenceModule = ({ icon: Icon, title, text, action }: { icon: IconComponent; title: string; text: string; action?: () => void }) => (
  <button onClick={action} className="group rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
    <div className="flex items-start gap-3">
      <div className="rounded-xl bg-blue-50 p-2 text-blue-600"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black text-foreground">{title}</h3>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  </button>
);

const DocumentCard = ({ vehicle, doc }: { vehicle: PassportVehicle; doc: PassportDocument }) => {
  const open = async () => {
    await trackDocumentOpened({
      tenantId: vehicle.tenantId,
      storeId: vehicle.storeId,
      vehicleId: vehicle.vehicleId,
      vin: vehicle.vin,
      stock: vehicle.stock,
      packetId: vehicle.packetId,
      qrToken: vehicle.qrToken,
      source: "passport",
      documentType: doc.type,
      documentId: doc.id,
      documentTitle: doc.title,
    });
    if (doc.url) window.open(doc.url, "_blank", "noopener,noreferrer");
    else toast.info(`${doc.title} will open when connected to the document archive.`);
  };

  return (
    <button onClick={open} className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className={`rounded-xl border p-2 ${statusTone(doc.status)}`}><FileText className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-black text-foreground">{doc.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${statusTone(doc.status)}`}>{doc.status || "Available"}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{doc.description}</p>
        </div>
      </div>
    </button>
  );
};

const PassportLeadCaptureModal = ({ vehicle, settings, open, onClose }: { vehicle: PassportVehicle; settings?: PassportDeliverySettings | null; open: boolean; onClose: () => void }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  if (!open) return null;

  const effectiveSettings = settings || null;
  const requireName = effectiveSettings?.require_customer_name !== false;
  const requirePhone = !!effectiveSettings?.require_phone || !!effectiveSettings?.require_sms_verification;
  const smsRequired = !!effectiveSettings?.require_sms_verification;

  const submit = async () => {
    if (requireName && !name.trim()) return toast.error("Please enter your name");
    if (!email.trim()) return toast.error("Please enter your email");
    if (requirePhone && !phone.trim()) return toast.error("Please enter your mobile number");

    setLoading(true);
    try {
      const docs = vehicle.documents?.length ? vehicle.documents : defaultDocuments;
      const result = await requestPassportDocumentDelivery({
        tenantId: vehicle.tenantId,
        storeId: vehicle.storeId,
        vehicleId: vehicle.vehicleId,
        vin: vehicle.vin,
        stock: vehicle.stock,
        packetId: vehicle.packetId,
        qrToken: vehicle.qrToken,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        requestedDocuments: docs.map((doc) => ({ documentType: doc.type, documentId: doc.id, documentTitle: doc.title })),
        vehicleOfInterest: {
          title: vehicleTitle(vehicle),
          price: vehicle.price,
          mileage: vehicle.mileage,
          dealerName: vehicle.dealer?.name,
        },
      });
      setSent(true);
      toast.success(result.verificationRequired ? "Verification code sent" : "Your Passport is being emailed");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not request packet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl border border-border bg-background p-5 shadow-2xl sm:rounded-3xl">
        {!sent ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700"><Mail className="h-3.5 w-3.5" /> Send my Passport</div>
                <h2 className="mt-3 text-2xl font-black text-foreground">Take this vehicle story with you</h2>
                <p className="mt-1 text-sm text-muted-foreground">We will email the documents, warranty information, and vehicle details for {vehicleTitle(vehicle)}.</p>
              </div>
              <button onClick={onClose} className="rounded-full px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-muted">Close</button>
            </div>
            <div className="mt-5 space-y-3">
              {requireName && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-blue-400" />}
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-blue-400" />
              {requirePhone && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" type="tel" className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-blue-400" />}
              {smsRequired && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">This dealer requires a quick text verification before sending the Passport.</div>}
              <p className="text-xs text-muted-foreground">By requesting the Passport, you agree the dealer may contact you about this vehicle. Message/data rates may apply if text verification is enabled.</p>
              <button disabled={loading} onClick={submit} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60">
                {loading ? "Sending..." : smsRequired ? "Send verification code" : "Send my Passport"}
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-9 w-9" /></div>
            <h2 className="mt-4 text-2xl font-black text-foreground">Your Passport is on the way</h2>
            <p className="mt-2 text-sm text-muted-foreground">{smsRequired ? "Check your phone for a verification code. Once verified, the Passport will be emailed." : "Check your email for the vehicle packet. You can review it anytime before you visit."}</p>
            <button onClick={onClose} className="mt-6 h-11 rounded-xl bg-foreground px-6 text-sm font-black text-background">Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

const AutoLabelsPassportExperience = ({ vehicle, settings: providedSettings }: AutoLabelsPassportExperienceProps) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [settings, setSettings] = useState<PassportDeliverySettings | null | undefined>(providedSettings);

  const docs = useMemo(() => vehicle.documents?.length ? vehicle.documents : defaultDocuments, [vehicle.documents]);
  const title = vehicleTitle(vehicle);

  const openPacket = async () => {
    await trackPacketOpened({ tenantId: vehicle.tenantId, storeId: vehicle.storeId, vehicleId: vehicle.vehicleId, vin: vehicle.vin, stock: vehicle.stock, packetId: vehicle.packetId, qrToken: vehicle.qrToken, source: "passport" });
    if (!settings && vehicle.tenantId) setSettings(await loadPassportDeliverySettings(vehicle.tenantId));
    setModalOpen(true);
  };

  const tradeClick = async () => {
    await trackPassportTradeValueClicked(vehicle);
    const url = settings?.autocurb_trade_url;
    if (settings?.autocurb_trade_enabled && url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.info("Trade value handoff will open when AutoCurb is connected for this dealer.");
  };

  const contactClick = async (type: "call" | "text" | "directions") => {
    await trackCustomerEngagement({
      tenantId: vehicle.tenantId,
      storeId: vehicle.storeId,
      vehicleId: vehicle.vehicleId,
      vin: vehicle.vin,
      stock: vehicle.stock,
      packetId: vehicle.packetId,
      qrToken: vehicle.qrToken,
      source: "passport",
      surface: "vehicle_passport",
      eventType: type === "call" ? "call_clicked" : type === "text" ? "text_clicked" : "directions_clicked",
      metadata: { cta: type },
    });
  };

  useEffect(() => {
    trackPassportOpened({ tenantId: vehicle.tenantId, storeId: vehicle.storeId, vehicleId: vehicle.vehicleId, vin: vehicle.vin, stock: vehicle.stock, packetId: vehicle.packetId, qrToken: vehicle.qrToken });
  }, [vehicle.packetId, vehicle.qrToken, vehicle.stock, vehicle.storeId, vehicle.tenantId, vehicle.vehicleId, vehicle.vin]);

  return (
    <div className="min-h-screen bg-slate-950 pb-20 text-white sm:pb-0">
      <section className="relative overflow-hidden">
        {vehicle.heroImageUrl ? <img src={vehicle.heroImageUrl} alt={title} className="absolute inset-0 h-full w-full object-cover opacity-45" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,.35),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,.2),transparent_25%)]" />}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,.45),#020617_82%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 pb-10 pt-10 lg:grid-cols-[1.12fr_.88fr] lg:items-end lg:pb-14 lg:pt-14">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wider backdrop-blur"><Sparkles className="h-3.5 w-3.5" /> AutoLabels Passport</div>
            <h1 className="mt-5 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl lg:text-7xl">Every vehicle has a story. This Passport proves it.</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/75">Review the vehicle, disclosures, recon proof, warranty information, trade options, and dealer contact in one confidence-building place.</p>
            <div className="mt-6 rounded-[2rem] border border-white/15 bg-white/10 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/55">You are reviewing</div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <HeroStat label="Price" value={money(vehicle.price)} />
                <HeroStat label="Mileage" value={miles(vehicle.mileage)} />
                <HeroStat label="Stock" value={vehicle.stock || "Pending"} />
              </div>
            </div>
            <div className="mt-5"><TrustBadgeRow vehicle={vehicle} /></div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <button onClick={openPacket} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-slate-950 shadow-xl shadow-black/20"><Mail className="h-5 w-5" /> Send me this Passport</button>
              <button onClick={tradeClick} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-5 text-sm font-black text-white backdrop-blur hover:bg-white/15"><HeartHandshake className="h-5 w-5" /> Value my trade</button>
            </div>
          </div>
          <div className="space-y-4">
            <ConfidenceScore />
            <div className="rounded-[2rem] border border-white/15 bg-white/10 p-5 text-white shadow-2xl shadow-black/20 backdrop-blur-xl">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-white p-3 text-slate-950"><Car className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-black">Built for a better decision</h2>
                  <p className="mt-1 text-sm leading-relaxed text-white/70">Instead of hunting through paperwork, this Passport brings the important vehicle proof into one guided experience.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 text-foreground">
        <VehicleStoryTimeline vehicle={vehicle} />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ConfidenceModule icon={ShieldCheck} title="Buyer protection" text={vehicle.warrantyLabel || "Review warranty and buyer guide information in plain English."} />
          <ConfidenceModule icon={Wrench} title="Service & recon" text={vehicle.reconSummary || "See available inspection, service, and reconditioning proof."} />
          <ConfidenceModule icon={Gauge} title="Vehicle facts" text="VIN, mileage, equipment, and vehicle context in one place." />
          <ConfidenceModule icon={Award} title="Dealer confidence" text={vehicle.dealer?.name ? `A transparent packet from ${vehicle.dealer.name}.` : "A transparent packet from the store selling this vehicle."} />
        </section>

        <section className="rounded-3xl border border-border bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="text-xl font-black">Vehicle documents</h2><p className="text-sm text-muted-foreground">Open the paperwork that matters before you visit.</p></div>
            <FileCheck2 className="h-6 w-6 text-blue-600" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">{docs.map((doc) => <DocumentCard key={`${doc.type}-${doc.id || doc.title}`} vehicle={vehicle} doc={doc} />)}</div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <a onClick={() => contactClick("call")} href={vehicle.dealer?.phone ? `tel:${vehicle.dealer.phone}` : undefined} className="rounded-2xl border border-border bg-background p-4 shadow-sm"><Phone className="mb-3 h-5 w-5 text-blue-600" /><h3 className="font-black">Call dealer</h3><p className="mt-1 text-sm text-muted-foreground">Ask about this vehicle.</p></a>
          <a onClick={() => contactClick("text")} href={vehicle.dealer?.textPhone ? `sms:${vehicle.dealer.textPhone}` : undefined} className="rounded-2xl border border-border bg-background p-4 shadow-sm"><MessageCircle className="mb-3 h-5 w-5 text-blue-600" /><h3 className="font-black">Text dealer</h3><p className="mt-1 text-sm text-muted-foreground">Start a quick conversation.</p></a>
          <button onClick={() => contactClick("directions")} className="rounded-2xl border border-border bg-background p-4 text-left shadow-sm"><MapPin className="mb-3 h-5 w-5 text-blue-600" /><h3 className="font-black">Get directions</h3><p className="mt-1 text-sm text-muted-foreground">Visit the store.</p></button>
        </section>

        <section className="rounded-3xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
          <div className="flex items-start gap-3"><Timer className="mt-1 h-6 w-6" /><div><h2 className="text-xl font-black">Save this vehicle story</h2><p className="mt-1 text-sm">Email the Passport to yourself so you can review documents, warranty information, and trade value options anytime.</p><button onClick={openPacket} className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white">Send my Passport</button></div></div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur sm:hidden">
        <div className="grid grid-cols-3 gap-2">
          <button onClick={openPacket} className="rounded-xl bg-white px-3 py-3 text-xs font-black text-slate-950"><Mail className="mx-auto mb-1 h-4 w-4" /> Passport</button>
          <button onClick={tradeClick} className="rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-xs font-black text-white"><HeartHandshake className="mx-auto mb-1 h-4 w-4" /> Trade</button>
          <a onClick={() => contactClick("call")} href={vehicle.dealer?.phone ? `tel:${vehicle.dealer.phone}` : undefined} className="rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-center text-xs font-black text-white"><Phone className="mx-auto mb-1 h-4 w-4" /> Call</a>
        </div>
      </div>

      <PassportLeadCaptureModal vehicle={vehicle} settings={settings} open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
};

export default AutoLabelsPassportExperience;
