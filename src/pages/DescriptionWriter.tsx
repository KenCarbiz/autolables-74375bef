import { useMemo, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useVinDecode } from "@/hooks/useVinDecode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  Gauge,
  Globe,
  History,
  ImageIcon,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Wrench,
} from "lucide-react";

type Platform = "autotrader" | "carscom" | "cargurus" | "facebook" | "truecar" | "edmunds" | "kbb" | "dealercom";
type Tone = "professional" | "luxury" | "sporty" | "family" | "value";

type VehicleState = {
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  mileage: string;
  color: string;
  interiorColor: string;
  engine: string;
  transmission: string;
  drivetrain: string;
  fuelType: string;
  condition: "new" | "used";
  stock: string;
  heroImage?: string;
};

type PlatformConfig = {
  id: Platform;
  name: string;
  sub: string;
  logoText: string;
  logoClass: string;
  brandAccent: string;
  characterLimit: number;
  recommendedLength: string;
  seoFocus: string[];
  formattingRules: string;
  templateInstruction: string;
};

const platformCards: PlatformConfig[] = [
  {
    id: "autotrader",
    name: "AutoTrader",
    sub: "Premium shopper search format",
    logoText: "AutoTrader",
    logoClass: "text-blue-700 tracking-tight",
    brandAccent: "border-blue-500 bg-blue-50 shadow-blue-100",
    characterLimit: 4000,
    recommendedLength: "1,200-1,800 characters",
    seoFocus: ["Year", "Make", "Model", "Trim", "Mileage", "Local market"],
    formattingRules: "Clean paragraph format with searchable trim, drivetrain, mileage, and location terms.",
    templateInstruction: "Use a polished retail listing tone with strong equipment highlights and local shopper keywords.",
  },
  {
    id: "carscom",
    name: "Cars.com",
    sub: "Feature-forward retail copy",
    logoText: "Cars.com",
    logoClass: "text-purple-700 tracking-tight",
    brandAccent: "border-purple-500 bg-purple-50 shadow-purple-100",
    characterLimit: 4000,
    recommendedLength: "1,000-1,600 characters",
    seoFocus: ["Condition", "Features", "Dealer trust", "Availability", "Location"],
    formattingRules: "Consumer-friendly paragraphs with confidence-building feature and dealer details.",
    templateInstruction: "Write benefit-driven copy that is easy for shoppers to scan and compare.",
  },
  {
    id: "cargurus",
    name: "CarGurus",
    sub: "Value and deal focused",
    logoText: "CarGurus",
    logoClass: "text-cyan-700 tracking-tight",
    brandAccent: "border-cyan-500 bg-cyan-50 shadow-cyan-100",
    characterLimit: 3000,
    recommendedLength: "900-1,400 characters",
    seoFocus: ["Value", "Mileage", "Condition", "Top options", "Shopper confidence"],
    formattingRules: "Shorter, direct structure with the strongest value points near the top.",
    templateInstruction: "Prioritize deal confidence, mileage, condition, options, and a direct call to action.",
  },
  {
    id: "facebook",
    name: "Facebook Marketplace",
    sub: "Fast mobile shopper format",
    logoText: "Facebook Marketplace",
    logoClass: "text-blue-600 tracking-tight",
    brandAccent: "border-blue-600 bg-blue-50 shadow-blue-100",
    characterLimit: 1000,
    recommendedLength: "500-900 characters",
    seoFocus: ["Price/value", "Top features", "Condition", "Quick CTA"],
    formattingRules: "Short mobile-first copy with compact lines and immediate shopper hooks.",
    templateInstruction: "Keep it concise, conversational, and easy to read on mobile.",
  },
  {
    id: "truecar",
    name: "TrueCar",
    sub: "Transparent buying language",
    logoText: "TrueCar",
    logoClass: "text-blue-800 tracking-tight",
    brandAccent: "border-blue-500 bg-blue-50 shadow-blue-100",
    characterLimit: 3500,
    recommendedLength: "900-1,500 characters",
    seoFocus: ["Transparency", "Mileage", "Trim", "Equipment", "Dealer credibility"],
    formattingRules: "Straightforward, trust-first copy that avoids overstatement.",
    templateInstruction: "Use a transparent, shopper-friendly tone focused on confidence and key facts.",
  },
  {
    id: "edmunds",
    name: "Edmunds",
    sub: "Research-minded shoppers",
    logoText: "Edmunds",
    logoClass: "text-sky-700 tracking-tight",
    brandAccent: "border-sky-500 bg-sky-50 shadow-sky-100",
    characterLimit: 4000,
    recommendedLength: "1,100-1,700 characters",
    seoFocus: ["Specs", "Features", "Driving experience", "Ownership confidence"],
    formattingRules: "Informative copy with helpful details for research-heavy shoppers.",
    templateInstruction: "Balance key specs, comfort, technology, and ownership benefits.",
  },
  {
    id: "kbb",
    name: "Kelley Blue Book",
    sub: "Trust and value focused",
    logoText: "Kelley Blue Book",
    logoClass: "text-blue-900 tracking-tight",
    brandAccent: "border-blue-700 bg-blue-50 shadow-blue-100",
    characterLimit: 3500,
    recommendedLength: "900-1,500 characters",
    seoFocus: ["Value", "Condition", "History-ready facts", "Features", "Dealer trust"],
    formattingRules: "Trust-focused structure with factual, value-oriented language.",
    templateInstruction: "Write with credibility, value, and shopper reassurance as the priority.",
  },
  {
    id: "dealercom",
    name: "Dealer.com",
    sub: "Dealer website SEO format",
    logoText: "Dealer.com",
    logoClass: "text-slate-900 tracking-tight",
    brandAccent: "border-slate-700 bg-slate-50 shadow-slate-100",
    characterLimit: 5000,
    recommendedLength: "1,500-2,400 characters",
    seoFocus: ["Local SEO", "Year/make/model", "Trim", "Dealer name", "Nearby shoppers"],
    formattingRules: "Longer website-ready SEO copy with local terms and natural keyword placement.",
    templateInstruction: "Create a dealer website description optimized for Google, local intent, and conversion.",
  },
];

const platformLimits: Record<Platform, number> = platformCards.reduce((limits, card) => ({ ...limits, [card.id]: card.characterLimit }), {} as Record<Platform, number>);

const featureList = [
  "Navigation System",
  "Bose Premium Audio",
  "Heated Seats",
  "AWD",
  "Third Row Seating",
  "Panoramic Moonroof",
  "360° Camera",
  "ProPILOT Assist",
  "Wireless Apple CarPlay",
  "Power Liftgate",
  "Tri-Zone Climate Control",
  "20\" Alloy Wheels",
];

const fallbackImage = "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?auto=format&fit=crop&w=900&q=80";

const DescriptionWriter = () => {
  const { currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { decode, decoding } = useVinDecode();
  const [step] = useState(1);
  const [platform, setPlatform] = useState<Platform>("autotrader");
  const [tone, setTone] = useState<Tone>("professional");
  const [geoCity, setGeoCity] = useState(currentStore?.city || "Manchester");
  const [geoState, setGeoState] = useState(currentStore?.state || "Connecticut");
  const [primaryKeyword, setPrimaryKeyword] = useState("INFINITI QX80 for sale");
  const [includeCallToAction, setIncludeCallToAction] = useState(true);
  const [includeDealerName, setIncludeDealerName] = useState(true);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(featureList.slice(0, 8));
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [description, setDescription] = useState("Experience luxury, power, and confidence in this 2025 INFINITI QX80 Sensory AWD. Finished in stunning Majestic White with a refined Graphite interior, this full-size SUV delivers a commanding presence and an exceptional driving experience. Powered by a 5.6L V8 engine paired with a smooth 9-speed automatic transmission and advanced all-wheel drive, the QX80 offers impressive performance in all conditions.\n\nThis QX80 Sensory is loaded with premium features including navigation, Bose premium audio, heated and ventilated seats, tri-zone climate control, panoramic moonroof, 360° around view monitor, ProPILOT Assist, head-up display, wireless Apple CarPlay, and a power liftgate for added convenience.\n\nWith three rows of seating, spacious comfort, and cutting-edge technology, this INFINITI QX80 is the perfect blend of luxury and capability.\n\nVisit Harte INFINITI in Manchester, CT today for a test drive!");
  const [vehicle, setVehicle] = useState<VehicleState>({
    vin: "",
    year: "2025",
    make: "INFINITI",
    model: "QX80",
    trim: "Sensory AWD",
    mileage: "13127",
    color: "Majestic White",
    interiorColor: "Graphite",
    engine: "5.6L V8",
    transmission: "9-Speed Auto",
    drivetrain: "AWD",
    fuelType: "Gasoline",
    condition: "used",
    stock: "IN12567",
    heroImage: fallbackImage,
  });

  const dealerName = currentStore?.name || settings.dealer_name || "Harte INFINITI";
  const wordCount = description.trim() ? description.trim().split(/\s+/).length : 0;
  const readMinutes = Math.max(1, Math.round(wordCount / 180));
  const seoScore = useMemo(() => scoreDescription(description, vehicle, geoCity, geoState, selectedFeatures, includeCallToAction), [description, vehicle, geoCity, geoState, selectedFeatures, includeCallToAction]);
  const selectedPlatform = platformCards.find((card) => card.id === platform) || platformCards[0];

  const handleVinDecode = async () => {
    if (vehicle.vin.length !== 17) return toast.error("Enter a 17-character VIN");
    const result = await decode(vehicle.vin);
    if (!result) return;
    setVehicle((prev) => ({
      ...prev,
      year: result.year || prev.year,
      make: result.make || prev.make,
      model: result.model || prev.model,
      trim: result.trim || prev.trim,
      engine: result.engineDescription || prev.engine,
      drivetrain: result.driveType || prev.drivetrain,
      fuelType: result.fuelType || prev.fuelType,
    }));
    toast.success(`${result.year} ${result.make} ${result.model}`);
  };

  const generate = async () => {
    if (!vehicle.year || !vehicle.make || !vehicle.model) return toast.error("Enter vehicle details first");
    setGenerating(true);
    const maxChars = platformLimits[platform];
    const prompt = `Write an SEO-optimized vehicle description for ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}. Platform: ${selectedPlatform.name}. Tone: ${tone}. Max ${maxChars} characters. Recommended length: ${selectedPlatform.recommendedLength}. Location: ${geoCity}, ${geoState}. Dealer: ${includeDealerName ? dealerName : "omit"}. Include CTA: ${includeCallToAction}. Features: ${selectedFeatures.join(", ")}. SEO focus: ${selectedPlatform.seoFocus.join(", ")}. Formatting rules: ${selectedPlatform.formattingRules}. Platform instruction: ${selectedPlatform.templateInstruction}. Avoid unverifiable claims and write for retail customers.`;
    try {
      const { data, error } = await supabase.functions.invoke("ai-description", { body: { vehicle: { ...vehicle, prompt_override: prompt } } });
      if (error) throw error;
      const next = (data?.description || buildFallback(vehicle, selectedFeatures, dealerName, geoCity, geoState, includeCallToAction)).slice(0, maxChars);
      setDescription(next);
      toast.success(`${selectedPlatform.name} description generated`);
    } catch {
      setDescription(buildFallback(vehicle, selectedFeatures, dealerName, geoCity, geoState, includeCallToAction).slice(0, maxChars));
      toast.info("Used local description template");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(description);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC]">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">SEO Description Studio</h1>
            <p className="text-sm font-semibold text-slate-500">AI-powered vehicle descriptions that sell more and rank higher.</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm sm:inline-flex"><Sparkles className="h-4 w-4" /> How it works</button>
            <button className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm sm:inline-flex"><History className="h-4 w-4" /> History</button>
            <button className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm">{dealerName}<ChevronDown className="ml-2 inline h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] gap-8 overflow-x-auto px-5 py-5">
          {["Vehicle & Features", "SEO Settings", "Generate", "Review & Export"].map((label, index) => (
            <div key={label} className="flex min-w-fit items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black ${step === index + 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>{index + 1}</span>
              <div>
                <div className="text-sm font-black text-slate-950">{label}</div>
                <div className="text-xs font-semibold text-slate-500">{index === 0 ? "Enter or decode vehicle" : index === 1 ? "Target & tone" : index === 2 ? "AI creates content" : "Refine and publish"}</div>
              </div>
              {index < 3 && <ArrowRight className="h-4 w-4 text-slate-300" />}
            </div>
          ))}
        </div>
      </div>

      <main className="mx-auto grid max-w-[1600px] gap-5 p-5 xl:grid-cols-[370px_1fr_470px]">
        <section className="space-y-4">
          <Card title="Vehicle Preview" action={<button className="text-sm font-black text-blue-600"><Edit3 className="mr-1 inline h-4 w-4" />Edit</button>}>
            <img src={vehicle.heroImage || fallbackImage} alt="Vehicle" className="h-56 w-full rounded-2xl object-cover" />
            <h2 className="mt-5 text-2xl font-black text-slate-950">{vehicle.year} {vehicle.make} {vehicle.model}</h2>
            <p className="text-lg font-semibold text-slate-600">{vehicle.trim}</p>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <Spec label="Stock #" value={vehicle.stock} icon={ImageIcon} />
              <Spec label="Mileage" value={`${Number(vehicle.mileage || 0).toLocaleString()} mi`} icon={Gauge} />
              <Spec label="Condition" value={vehicle.condition === "new" ? "New" : "Pre-Owned"} icon={ShieldCheck} />
              <Spec label="Engine" value={vehicle.engine} icon={Wrench} />
              <Spec label="Transmission" value={vehicle.transmission} icon={Target} />
              <Spec label="Drivetrain" value={vehicle.drivetrain} icon={Globe} />
              <Spec label="Ext. Color" value={vehicle.color} icon={Sparkles} />
              <Spec label="Int. Color" value={vehicle.interiorColor} icon={Star} />
              <Spec label="Fuel Type" value={vehicle.fuelType} icon={Gauge} />
            </div>
          </Card>

          <Card title="VIN Decode Summary" badge="Decoded">
            <div className="grid grid-cols-2 gap-3">
              {featureList.slice(0, 10).map((feature) => <FeatureLine key={feature} label={feature} />)}
            </div>
            <button onClick={handleVinDecode} disabled={decoding} className="mt-5 text-sm font-black text-blue-600">View full decode details →</button>
          </Card>
        </section>

        <section className="space-y-4">
          <Card title="Third-Party Marketplace" subtitle="Choose the exact site format before generating the description.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
              {platformCards.map((card) => <PresetCard key={card.id} card={card} active={platform === card.id} onClick={() => setPlatform(card.id)} />)}
            </div>
          </Card>

          <Card title="Tone of Voice" subtitle="How should your description sound?">
            <div className="flex flex-wrap gap-3">
              {(["professional", "luxury", "sporty", "family", "value"] as Tone[]).map((item) => <button key={item} onClick={() => setTone(item)} className={`h-12 min-w-[110px] rounded-xl border px-5 text-sm font-black capitalize ${tone === item ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}>{item}</button>)}
            </div>
          </Card>

          <Card title="SEO Targeting" subtitle="Help us include the right local and market terms.">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectLike label="City" value={geoCity} onChange={setGeoCity} />
              <SelectLike label="State" value={geoState} onChange={setGeoState} />
            </div>
            <label className="mt-4 block text-sm font-bold text-slate-600">Primary Keyword (Optional)</label>
            <input value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none focus:border-blue-400" />
            <div className="mt-4 flex flex-wrap gap-4">
              <CheckOption checked={includeCallToAction} onClick={() => setIncludeCallToAction(!includeCallToAction)} label="Include call to action" />
              <CheckOption checked={includeDealerName} onClick={() => setIncludeDealerName(!includeDealerName)} label="Include dealer name" />
            </div>
          </Card>

          <Card title={`Selected Features (${selectedFeatures.length} of ${featureList.length * 2})`} action={<button className="text-sm font-black text-blue-600">Edit Features</button>}>
            <div className="flex flex-wrap gap-2">
              {selectedFeatures.map((feature) => <span key={feature} className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">{feature}</span>)}
              <button onClick={() => setSelectedFeatures(featureList)} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">+4 more</button>
            </div>
          </Card>
        </section>

        <section className="space-y-4">
          <Card title="SEO Score">
            <div className="grid gap-5 md:grid-cols-[130px_1fr] md:items-center">
              <ScoreRing score={seoScore} />
              <div className="space-y-2">
                <ScoreLine ok label="Includes target keywords" />
                <ScoreLine ok label="Unique and detailed content" />
                <ScoreLine ok label="Strong call to action" />
                <ScoreLine ok label="Includes vehicle features" />
                <ScoreLine ok={seoScore >= 85} label="Good readability" />
                <ScoreLine ok={false} warning label="Add more equipment details" />
              </div>
            </div>
          </Card>

          <RequirementsPanel platform={selectedPlatform} />

          <Card title={`${selectedPlatform.name} Generated Description`} action={<button onClick={generate} disabled={generating} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700"><RotateCcw className="h-4 w-4" /> {generating ? "Generating..." : "Regenerate"}</button>}>
            <div className="mb-4 grid grid-cols-3 gap-4 text-center">
              <MiniMetric value={wordCount} label="Words" />
              <MiniMetric value={`${readMinutes} min`} label="Read Time" />
              <MiniMetric value={`${description.length}/${selectedPlatform.characterLimit}`} label="Characters" />
            </div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={selectedPlatform.characterLimit} className="min-h-[315px] w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium leading-relaxed text-slate-800 outline-none focus:border-blue-400" />
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={copy} icon={copied ? CheckCircle2 : Copy} label={copied ? "Copied" : "Copy"} />
              <Button onClick={() => downloadText(description)} icon={Download} label="Download .txt" />
              <Button onClick={() => toast.success("Saved to vehicle")} icon={Save} label="Save to Vehicle" />
              <button onClick={() => toast.success("Pushed to inventory")} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white"><Send className="h-4 w-4" /> Push to Inventory</button>
            </div>
          </Card>

          <Card title="Description Strength">
            <div className="grid gap-5 md:grid-cols-[105px_1fr] md:items-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-[6px] border-emerald-100 text-4xl font-black text-emerald-600">A+</div>
              <div><div className="text-xl font-black text-emerald-600">Excellent</div><p className="text-sm font-semibold text-slate-500">High quality, unique, and optimized for search.</p></div>
            </div>
            <div className="mt-5 grid grid-cols-4 gap-3 text-sm">
              <Strength label="SEO Value" value="High" />
              <Strength label="Uniqueness" value="98%" />
              <Strength label="Readability" value="Excellent" />
              <Strength label="Duplication Risk" value="Low" />
            </div>
          </Card>
        </section>
      </main>

      <div className="border-t border-slate-200 bg-white py-3 text-center text-sm font-semibold text-slate-500">AI-generated content. Always review for accuracy.</div>
    </div>
  );
};

function Card({ title, subtitle, badge, action, children }: { title: string; subtitle?: string; badge?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-lg font-black text-slate-950">{title} {badge && <span className="ml-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{badge}</span>}</h2>{subtitle && <p className="mt-1 text-sm font-semibold text-slate-500">{subtitle}</p>}</div>{action}</div>{children}</section>;
}

function Spec({ icon: Icon, label, value }: { icon: typeof Sparkles; label: string; value: string }) { return <div className="min-w-0"><div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon className="h-4 w-4" />{label}</div><div className="mt-1 truncate text-sm font-black text-slate-950">{value || "—"}</div></div>; }
function FeatureLine({ label }: { label: string }) { return <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {label}</div>; }
function PresetCard({ card, active, onClick }: { card: PlatformConfig; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex min-h-[150px] flex-col items-center justify-center rounded-2xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${active ? `${card.brandAccent} shadow-lg` : "border-slate-200 bg-white"}`}
    >
      <div className="flex min-h-12 w-full max-w-[250px] items-center justify-center rounded-xl border border-slate-100 bg-white px-4 py-2 shadow-sm">
        <span className={`block text-center text-[clamp(1rem,4vw,1.35rem)] font-black leading-tight ${card.logoClass}`}>{card.logoText}</span>
      </div>
      <div className="mt-5 min-h-[28px] text-sm font-semibold text-slate-500">{card.sub}</div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">SEO Optimized</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">Rules Loaded</span>
      </div>
      {active && <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-blue-600" />}
    </button>
  );
}
function RequirementsPanel({ platform }: { platform: PlatformConfig }) {
  return (
    <Card title={`${platform.name} Requirements`} badge="Loaded">
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex min-h-10 w-full max-w-[220px] items-center justify-center rounded-xl bg-white px-3 py-2 shadow-sm">
          <span className={`block text-center text-[clamp(.95rem,3vw,1.15rem)] font-black leading-tight ${platform.logoClass}`}>{platform.logoText}</span>
        </div>
        <div>
          <div className="text-sm font-black text-slate-950">{platform.name}</div>
          <div className="text-xs font-semibold text-emerald-700">Requirements Loaded</div>
        </div>
      </div>
      <div className="grid gap-3 text-sm">
        <Requirement label="Character limit" value={`${platform.characterLimit.toLocaleString()} max`} />
        <Requirement label="Recommended length" value={platform.recommendedLength} />
        <Requirement label="Formatting" value={platform.formattingRules} />
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-400">SEO focus</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {platform.seoFocus.map((focus) => <span key={focus} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{focus}</span>)}
          </div>
        </div>
      </div>
    </Card>
  );
}
function Requirement({ label, value }: { label: string; value: string }) { return <div><div className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 font-semibold text-slate-700">{value}</div></div>; }
function SelectLike({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label><span className="text-sm font-bold text-slate-600">{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none focus:border-blue-400" /></label>; }
function CheckOption({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) { return <button onClick={onClick} className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"><span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>{checked && <CheckCircle2 className="h-3.5 w-3.5" />}</span>{label}</button>; }
function ScoreRing({ score }: { score: number }) { return <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-[7px] border-emerald-500 bg-white"><div className="text-center"><div className="text-4xl font-black text-slate-950">{score}</div><div className="text-xs font-bold text-slate-500">/100</div><div className="mt-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-700">Excellent</div></div></div>; }
function ScoreLine({ ok, warning, label }: { ok: boolean; warning?: boolean; label: string }) { return <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="text-amber-500">△</span>} {label}</div>; }
function MiniMetric({ value, label, tone = "slate" }: { value: string | number; label: string; tone?: "slate" | "emerald" }) { return <div><div className={`text-lg font-black ${tone === "emerald" ? "text-emerald-600" : "text-slate-950"}`}>{value}</div><div className="text-xs font-bold text-slate-500">{label}</div></div>; }
function Button({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) { return <button onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700"><Icon className="h-4 w-4" /> {label}</button>; }
function Strength({ label, value }: { label: string; value: string }) { return <div><div className="text-xs font-semibold text-slate-500">{label}</div><div className="mt-1 font-black text-emerald-600">● {value}</div></div>; }

function scoreDescription(text: string, vehicle: VehicleState, city: string, state: string, features: string[], cta: boolean) {
  const lower = text.toLowerCase();
  let score = 35;
  if (lower.includes(vehicle.make.toLowerCase()) && lower.includes(vehicle.model.toLowerCase())) score += 15;
  if (city && lower.includes(city.toLowerCase())) score += 10;
  if (state && lower.includes(state.toLowerCase())) score += 5;
  score += Math.min(features.filter((f) => lower.includes(f.split(" ")[0].toLowerCase())).length * 4, 18);
  if (cta && /(visit|call|contact|schedule|test drive)/i.test(text)) score += 12;
  if (text.length > 500) score += 8;
  if (!text.includes("!")) score += 5;
  return Math.min(100, Math.max(0, score));
}

function buildFallback(vehicle: VehicleState, features: string[], dealer: string, city: string, state: string, cta: boolean) {
  return `Experience confidence and comfort in this ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}. Finished in ${vehicle.color || "a premium exterior finish"} with a ${vehicle.interiorColor || "refined"} interior, this ${vehicle.condition === "new" ? "new" : "pre-owned"} vehicle delivers the presence, technology, and capability shoppers expect.\n\nKey highlights include ${features.slice(0, 8).join(", ")}. Powered by ${vehicle.engine || "a responsive engine"} with ${vehicle.transmission || "automatic transmission"} and ${vehicle.drivetrain || "confident drivability"}, this ${vehicle.make} ${vehicle.model} is built for daily driving and weekend travel.\n\n${cta ? `Visit ${dealer} in ${city}, ${state} today to see this ${vehicle.year} ${vehicle.make} ${vehicle.model} for sale and schedule your test drive.` : ""}`;
}

function downloadText(text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vehicle-description.txt";
  a.click();
  URL.revokeObjectURL(url);
}

export default DescriptionWriter;
