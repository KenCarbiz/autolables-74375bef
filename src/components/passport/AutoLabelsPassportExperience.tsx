import { useMemo, useState } from "react";
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

const ConfidenceModule = ({ icon: Icon, title, text, action }: { icon: typeof ShieldCheck; title: string; text: string; action?: () => void }) => (
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
      toast.success(result.verificationRequired ? "Verification code sent" : "Your packet is being emailed");
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
                <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700"><Mail className="h-3.5 w-3.5" /> Send my packet</div>
                <h2 className="mt-3 text-2xl font-black text-foreground">Email this vehicle packet</h2>
                <p className="mt-1 text-sm text-muted-foreground">We will send the documents and vehicle information for {vehicleTitle(vehicle)}.</p>
              </div>
              <button onClick={onClose} className="rounded-full px-3 py-1.5 text-sm font-bold text-muted-foreground hover:bg-muted">Close</button>
            </div>
            <div className="mt-5 space-y-3">
              {requireName && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-blue-400" />}
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-blue-400" />
              {requirePhone && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" type="tel" className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-blue-400" />}
              {smsRequired && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">This dealer requires a quick text verification before sending the packet.</div>}
              <p className="text-xs text-muted-foreground">By requesting the packet, you agree the dealer may contact you about this vehicle. Message/data rates may apply if text verification is enabled.</p>
              <button disabled={loading} onClick={submit} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60">
                {loading ? "Sending..." : smsRequired ? "Send verification code" : "Send my packet"}
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-9 w-9" /></div>
            <h2 className="mt-4 text-2xl font-black text-foreground">You're all set</h2>
            <p className="mt-2 text-sm text-muted-foreground">{smsRequired ? "Check your phone for a verification code. Once verified, the packet will be emailed." : "Your vehicle packet has been queued for email delivery."}</p>
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
    await trackCustomerCtaClicked({
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
    } as never);
  };

  useMemo(() => {
    trackPassportOpened({ tenantId: vehicle.tenantId, storeId: vehicle.storeId, vehicleId: vehicle.vehicleId, vin: vehicle.vin, stock: vehicle.stock, packetId: vehicle.packetId, qrToken: vehicle.qrToken });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.vehicleId, vehicle.vin, vehicle.stock]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <section className="relative overflow-hidden">
        {vehicle.heroImageUrl ? <img src={vehicle.heroImageUrl} alt={title} className="absolute inset-0 h-full w-full object-cover opacity-45" /> : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,.5),transparent_30%),linear-gradient(180deg,rgba(15,23,42,.55),#020617)]" />
        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-black backdrop-blur"><Sparkles className="h-3.5 w-3.5" /> AutoLabels Passport</div>
          <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">{title}</h1>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold text-white/90">
            <span>{money(vehicle.price)}</span><span>•</span><span>{miles(vehicle.mileage)}</span><span>•</span><span>Stock {vehicle.stock || "—"}</span>
          </div>
          <div className="mt-5"><TrustBadgeRow vehicle={vehicle} /></div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button onClick={openPacket} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-slate-950 shadow-xl shadow-black/20"><Mail className="h-5 w-5" /> Email me this packet</button>
            <button onClick={tradeClick} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-5 text-sm font-black text-white backdrop-blur hover:bg-white/15"><HeartHandshake className="h-5 w-5" /> Value my trade</button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-foreground">
        <section className="grid gap-3 sm:grid-cols-2">
          <ConfidenceModule icon={ShieldCheck} title="Buyer protection" text={vehicle.warrantyLabel || "Review warranty and buyer guide information in plain English."} />
          <ConfidenceModule icon={Wrench} title="Service & recon" text={vehicle.reconSummary || "See available inspection, service, and reconditioning proof."} />
          <ConfidenceModule icon={Gauge} title="Vehicle facts" text="VIN, mileage, equipment, and vehicle context in one place." />
          <ConfidenceModule icon={Award} title="Dealer confidence" text="A transparent packet from the store selling this vehicle." />
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
          <div className="flex items-start gap-3"><Timer className="mt-1 h-6 w-6" /><div><h2 className="text-xl font-black">Save this vehicle story</h2><p className="mt-1 text-sm">Email the packet to yourself so you can review documents, warranty information, and trade value options anytime.</p><button onClick={openPacket} className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white">Send my packet</button></div></div>
        </section>
      </main>

      <PassportLeadCaptureModal vehicle={vehicle} settings={settings} open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
};

export default AutoLabelsPassportExperience;
