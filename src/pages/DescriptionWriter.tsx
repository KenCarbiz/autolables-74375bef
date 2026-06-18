import { useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useVinDecode } from "@/hooks/useVinDecode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  Globe,
  Target,
  FileText,
  ChevronDown,
  Car,
  Gauge,
  Type,
} from "lucide-react";

type Platform = "website" | "vauto" | "autotrader" | "cargurus" | "carscom" | "facebook" | "custom";
type Tone = "professional" | "luxury" | "value" | "sporty" | "family";

interface PlatformConfig {
  name: string;
  maxChars: number;
  notes: string;
}

const PLATFORMS: Record<Platform, PlatformConfig> = {
  website: { name: "Dealer Website (VDP)", maxChars: 5000, notes: "No hard limit — optimized for SEO" },
  vauto: { name: "vAuto / Provision", maxChars: 4000, notes: "Standard syndication limit" },
  autotrader: { name: "AutoTrader", maxChars: 4000, notes: "Description field limit" },
  cargurus: { name: "CarGurus", maxChars: 3000, notes: "Shorter descriptions perform better" },
  carscom: { name: "Cars.com", maxChars: 4000, notes: "Standard listing description" },
  facebook: { name: "Facebook Marketplace", maxChars: 1000, notes: "Keep concise for mobile" },
  custom: { name: "Custom", maxChars: 4000, notes: "Set your own limit" },
};

const DescriptionWriter = () => {
  const { currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { decode, decoding } = useVinDecode();

  const [vehicle, setVehicle] = useState({
    vin: "", year: "", make: "", model: "", trim: "",
    mileage: "", color: "", interiorColor: "", engine: "",
    transmission: "", drivetrain: "", fuelType: "", bodyStyle: "",
    price: "", condition: "used" as "new" | "used",
  });

  const [platform, setPlatform] = useState<Platform>("vauto");
  const [customMax, setCustomMax] = useState(4000);
  const [tone, setTone] = useState<Tone>("professional");
  const [geoCity, setGeoCity] = useState(currentStore?.city || "");
  const [geoState, setGeoState] = useState(currentStore?.state || "");
  const [dealerName] = useState(currentStore?.name || settings.dealer_name || "");
  const [includeCallToAction, setIncludeCallToAction] = useState(true);
  const [includeDealerName, setIncludeDealerName] = useState(true);

  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [history, setHistory] = useState<{ text: string; platform: string; score: number; createdAt: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem("desc_history") || "[]"); } catch { return []; }
  });

  const maxChars = platform === "custom" ? customMax : PLATFORMS[platform].maxChars;

  const handleVinDecode = async () => {
    if (vehicle.vin.length !== 17) return;
    const result = await decode(vehicle.vin);
    if (result) {
      setVehicle(prev => ({
        ...prev,
        year: result.year, make: result.make, model: result.model,
        trim: result.trim, bodyStyle: result.bodyStyle,
        drivetrain: result.driveType, fuelType: result.fuelType,
        engine: result.engineDescription,
      }));
      toast.success(`${result.year} ${result.make} ${result.model}`);
    }
  };

  const handleGenerate = async () => {
    if (!vehicle.year || !vehicle.make || !vehicle.model) {
      toast.error("Enter vehicle Year, Make, and Model first");
      return;
    }

    setGenerating(true);

    const prompt = `You are an expert automotive copywriter specializing in SEO-optimized vehicle descriptions for car dealerships. Write a vehicle listing description following these EXACT requirements:

PLATFORM: ${PLATFORMS[platform].name}
CHARACTER LIMIT: ${maxChars} characters maximum (STRICT — do not exceed)
TONE: ${tone}

VEHICLE DATA:
- Condition: ${vehicle.condition === "new" ? "Brand New" : "Pre-Owned"}
- Year: ${vehicle.year}
- Make: ${vehicle.make}
- Model: ${vehicle.model}
- Trim: ${vehicle.trim || "N/A"}
- Mileage: ${vehicle.mileage ? `${parseInt(vehicle.mileage).toLocaleString()} miles` : "N/A"}
- Exterior Color: ${vehicle.color || "N/A"}
- Interior Color: ${vehicle.interiorColor || "N/A"}
- Engine: ${vehicle.engine || "N/A"}
- Transmission: ${vehicle.transmission || "N/A"}
- Drivetrain: ${vehicle.drivetrain || "N/A"}
- Fuel Type: ${vehicle.fuelType || "N/A"}
- Body Style: ${vehicle.bodyStyle || "N/A"}
- Price: ${vehicle.price ? `$${parseInt(vehicle.price).toLocaleString()}` : "Contact for pricing"}
${includeDealerName ? `- Dealer: ${dealerName}` : ""}
${geoCity || geoState ? `- Location: ${[geoCity, geoState].filter(Boolean).join(", ")}` : ""}

SEO REQUIREMENTS:
1. Include the full Year Make Model in the first sentence
2. Include the city/state for local search geo-targeting
3. Use natural language — avoid keyword stuffing
4. Include 2-3 relevant long-tail search phrases naturally (e.g. "${vehicle.year} ${vehicle.make} ${vehicle.model} for sale in ${geoCity || "your city"}", "pre-owned ${vehicle.make} ${vehicle.model} near me")
5. Mention key features that buyers search for (safety, fuel economy, tech, space)
6. ${includeCallToAction ? `End with a call to action mentioning ${dealerName || "our dealership"}` : "No call to action needed"}

FORMAT RULES:
- ${maxChars <= 1000 ? "2 short paragraphs" : maxChars <= 3000 ? "3-4 paragraphs" : "4-5 paragraphs"}
- No exclamation marks
- No unverifiable claims ("best in class", "#1 dealer")
- No ALL CAPS words
- Factual and compelling
- Write for humans first, search engines second

Write the description now (${maxChars} char max):`;

    try {
      const { data, error } = await supabase.functions.invoke("ai-description", {
        body: {
          vehicle: { ...vehicle, prompt_override: prompt },
        },
      });

      if (error) throw new Error(error.message);
      if (data?.description) {
        const desc = data.description.slice(0, maxChars);
        setDescription(desc);
        setCharCount(desc.length);
        saveToHistory(desc);
      } else {
        throw new Error("No description returned");
      }
    } catch (err: any) {
      // Fallback to basic prompt
      toast.error("AI descriptions aren't enabled for your store yet. Contact AutoLabels support.");
      const fallback = buildFallback();
      setDescription(fallback);
      setCharCount(fallback.length);
    } finally {
      setGenerating(false);
    }
  };

  const buildFallback = (): string => {
    const ymm = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`.trim();
    const parts = [];
    parts.push(`This ${vehicle.condition === "new" ? "brand new" : "pre-owned"} ${ymm} is available ${geoCity ? `in ${geoCity}${geoState ? `, ${geoState}` : ""}` : "at our dealership"}.`);
    if (vehicle.mileage) parts.push(`With only ${parseInt(vehicle.mileage).toLocaleString()} miles on the odometer, this ${vehicle.make} ${vehicle.model} has plenty of life ahead.`);
    const specs = [vehicle.engine, vehicle.transmission, vehicle.drivetrain].filter(Boolean);
    if (specs.length) parts.push(`Equipped with ${specs.join(", ")}.`);
    if (vehicle.color) parts.push(`Finished in ${vehicle.color}${vehicle.interiorColor ? ` with a ${vehicle.interiorColor} interior` : ""}.`);
    if (includeCallToAction && dealerName) parts.push(`Contact ${dealerName} today to schedule a test drive.`);
    return parts.join(" ").slice(0, maxChars);
  };

  // SEO quality score (0-100)
  const seoScore = (() => {
    if (!description) return 0;
    let score = 0;
    const ymm = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.toLowerCase();
    const lower = description.toLowerCase();

    // Year Make Model in first 100 chars
    if (lower.slice(0, 100).includes(vehicle.year) && lower.slice(0, 100).includes(vehicle.make.toLowerCase())) score += 15;
    else if (lower.includes(ymm.split(" ").filter(Boolean).join(" "))) score += 8;

    // Geo city/state mention
    if (geoCity && lower.includes(geoCity.toLowerCase())) score += 12;
    if (geoState && lower.includes(geoState.toLowerCase())) score += 5;

    // Word count (200-400 optimal)
    const words = description.split(/\s+/).length;
    if (words >= 200 && words <= 500) score += 15;
    else if (words >= 100) score += 8;
    else score += 3;

    // Within character limit
    if (charCount <= maxChars) score += 10;

    // Has features buyers search for
    const featureWords = ["safety", "fuel", "mpg", "awd", "4wd", "leather", "sunroof", "bluetooth", "camera", "carplay", "heated", "warranty", "certified", "inspected"];
    const featureHits = featureWords.filter(w => lower.includes(w)).length;
    score += Math.min(featureHits * 3, 15);

    // No ALL CAPS words (penalty)
    if (/\b[A-Z]{4,}\b/.test(description)) score -= 5;

    // No exclamation marks
    if (!description.includes("!")) score += 5;

    // Has call to action
    if (lower.includes("contact") || lower.includes("call") || lower.includes("schedule") || lower.includes("visit")) score += 8;

    // Has natural long-tail phrases
    if (lower.includes("for sale") || lower.includes("near me") || lower.includes("best price")) score += 8;

    // Paragraphs (2+ is good)
    const paras = description.split(/\n\n+/).filter(p => p.trim().length > 20).length;
    if (paras >= 2) score += 7;

    return Math.min(Math.max(score, 0), 100);
  })();

  const seoGrade = seoScore >= 85 ? "A" : seoScore >= 70 ? "B" : seoScore >= 55 ? "C" : seoScore >= 40 ? "D" : "F";
  const seoColor = seoScore >= 85 ? "text-emerald-600" : seoScore >= 70 ? "text-blue-600" : seoScore >= 55 ? "text-amber-600" : "text-red-600";

  const saveToHistory = (text: string) => {
    const entry = { text, platform: PLATFORMS[platform].name, score: seoScore, createdAt: new Date().toISOString() };
    const updated = [entry, ...history].slice(0, 20);
    setHistory(updated);
    localStorage.setItem("desc_history", JSON.stringify(updated));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(description);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">SEO Description Writer</h1>
        <p className="text-xs text-muted-foreground mt-1">
          AI-powered, SEO + geo-optimized vehicle descriptions. Formatted for dealer websites, vAuto, AutoTrader, CarGurus, Cars.com, and Facebook.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: inputs */}
        <div className="space-y-4">
          <ConfigCard icon={Car} title="Vehicle">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={vehicle.vin} onChange={e => setVehicle({ ...vehicle, vin: e.target.value.toUpperCase() })} placeholder="VIN (17 chars)" className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm font-mono outline-none" />
                <button onClick={handleVinDecode} disabled={decoding || vehicle.vin.length !== 17} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40">{decoding ? "..." : "Decode"}</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={vehicle.condition} onChange={e => setVehicle({ ...vehicle, condition: e.target.value as "new" | "used" })} className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none">
                  <option value="used">Pre-Owned</option>
                  <option value="new">New</option>
                </select>
                <input value={vehicle.price} onChange={e => setVehicle({ ...vehicle, price: e.target.value })} placeholder="Price $" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <input value={vehicle.year} onChange={e => setVehicle({ ...vehicle, year: e.target.value })} placeholder="Year" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.make} onChange={e => setVehicle({ ...vehicle, make: e.target.value })} placeholder="Make" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.model} onChange={e => setVehicle({ ...vehicle, model: e.target.value })} placeholder="Model" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.trim} onChange={e => setVehicle({ ...vehicle, trim: e.target.value })} placeholder="Trim" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={vehicle.mileage} onChange={e => setVehicle({ ...vehicle, mileage: e.target.value })} placeholder="Mileage" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.color} onChange={e => setVehicle({ ...vehicle, color: e.target.value })} placeholder="Ext. Color" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.interiorColor} onChange={e => setVehicle({ ...vehicle, interiorColor: e.target.value })} placeholder="Int. Color" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={vehicle.engine} onChange={e => setVehicle({ ...vehicle, engine: e.target.value })} placeholder="Engine" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.transmission} onChange={e => setVehicle({ ...vehicle, transmission: e.target.value })} placeholder="Trans." className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.drivetrain} onChange={e => setVehicle({ ...vehicle, drivetrain: e.target.value })} placeholder="Drivetrain" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
            </div>
          </ConfigCard>

          <ConfigCard icon={Target} title="Platform & Limits">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Writing For</label>
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value as Platform)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none"
                >
                  {Object.entries(PLATFORMS).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.name} — {cfg.maxChars.toLocaleString()} chars</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">{PLATFORMS[platform].notes}</p>
              </div>
              {platform === "custom" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Max Characters</label>
                  <input type="number" value={customMax} onChange={e => setCustomMax(parseInt(e.target.value) || 4000)} className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                </div>
              )}
            </div>
          </ConfigCard>

          <ConfigCard icon={Type} title="Tone & Style">
            <div className="grid grid-cols-5 gap-1.5">
              {(["professional", "luxury", "value", "sporty", "family"] as Tone[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={`h-9 rounded-md text-[10px] font-medium border-2 capitalize transition-all ${
                    tone === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </ConfigCard>

          <ConfigCard icon={Globe} title="Geo Targeting">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">City</label>
                <input value={geoCity} onChange={e => setGeoCity(e.target.value)} placeholder="e.g. Hartford" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">State</label>
                <input value={geoState} onChange={e => setGeoState(e.target.value)} placeholder="e.g. CT" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={includeCallToAction} onChange={e => setIncludeCallToAction(e.target.checked)} className="rounded border-border" />
                Include call to action
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={includeDealerName} onChange={e => setIncludeDealerName(e.target.checked)} className="rounded border-border" />
                Include dealer name
              </label>
            </div>
          </ConfigCard>

          <button
            onClick={handleGenerate}
            disabled={generating || !vehicle.year || !vehicle.make || !vehicle.model}
            className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Sparkles className="w-4 h-4" />
            {generating ? "Writing SEO Description..." : "Generate Description"}
          </button>
        </div>

        {/* Right: output */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-foreground">Generated Description</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs tabular-nums font-medium ${charCount > maxChars ? "text-destructive" : "text-muted-foreground"}`}>
                  {charCount.toLocaleString()} / {maxChars.toLocaleString()}
                </span>
                {description && (
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:opacity-90"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
            </div>
            <div className="p-5">
              {!description ? (
                <div className="py-16 text-center">
                  <Sparkles className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No description yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Fill in the vehicle details and click Generate
                  </p>
                </div>
              ) : (
                <div>
                  <textarea
                    value={description}
                    onChange={e => { setDescription(e.target.value); setCharCount(e.target.value.length); }}
                    rows={16}
                    className="w-full px-0 py-0 bg-transparent text-sm text-foreground outline-none resize-y leading-relaxed"
                  />
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-medium hover:bg-muted disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Regenerate
                    </button>
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                    >
                      <Copy className="w-3 h-3" />
                      Copy to Clipboard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SEO Quality Score */}
          {description && (
            <div className="bg-card rounded-xl border border-border shadow-premium p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-foreground">SEO Quality Score</h4>
                <div className="flex items-center gap-2">
                  <span className={`text-3xl font-bold tabular-nums ${seoColor}`}>{seoScore}</span>
                  <span className={`text-lg font-bold ${seoColor}`}>{seoGrade}</span>
                </div>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    seoScore >= 85 ? "bg-emerald-500" : seoScore >= 70 ? "bg-blue-500" : seoScore >= 55 ? "bg-amber-500" : "bg-red-500"
                  }`}
                  style={{ width: `${seoScore}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
                <ScoreItem label="YMM in first sentence" ok={description.toLowerCase().slice(0, 100).includes(vehicle.year) && description.toLowerCase().slice(0, 100).includes(vehicle.make.toLowerCase())} />
                <ScoreItem label="Geo city mentioned" ok={!!geoCity && description.toLowerCase().includes(geoCity.toLowerCase())} />
                <ScoreItem label="Within char limit" ok={charCount <= maxChars} />
                <ScoreItem label="No exclamation marks" ok={!description.includes("!")} />
                <ScoreItem label="200+ words" ok={description.split(/\s+/).length >= 200} />
                <ScoreItem label="Has call to action" ok={/contact|call|schedule|visit/i.test(description)} />
                <ScoreItem label="Multiple paragraphs" ok={description.split(/\n\n+/).filter(p => p.trim().length > 20).length >= 2} />
                <ScoreItem label="Long-tail phrases" ok={/for sale|near me|best price/i.test(description)} />
              </div>
            </div>
          )}

          {/* Description History */}
          {history.length > 0 && (
            <div className="bg-card rounded-xl border border-border shadow-premium p-5">
              <h4 className="text-sm font-semibold text-foreground mb-3">Recent Descriptions ({history.length})</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.slice(0, 5).map((h, i) => (
                  <button
                    key={i}
                    onClick={() => { setDescription(h.text); setCharCount(h.text.length); }}
                    className="w-full text-left p-2 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-muted-foreground">{h.platform}</span>
                      <span className={`text-[10px] font-bold ${h.score >= 70 ? "text-emerald-600" : "text-amber-600"}`}>Score: {h.score}</span>
                    </div>
                    <p className="text-xs text-foreground line-clamp-2">{h.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SEO tips */}
          <div className="bg-card rounded-xl border border-border shadow-premium p-5">
            <h4 className="text-sm font-semibold text-foreground mb-3">SEO Best Practices</h4>
            <div className="space-y-2 text-xs text-muted-foreground">
              <Tip text="Year Make Model should appear in the first sentence" />
              <Tip text={`Include "${geoCity || "your city"}, ${geoState || "ST"}" for local search targeting`} />
              <Tip text="200-300 unique words minimum for Google to index the page" />
              <Tip text="Avoid manufacturer-copied descriptions — Google penalizes duplicate content" />
              <Tip text="Include features buyers search for: safety ratings, fuel economy, tech, cargo space" />
              <Tip text="Use natural phrases like 'for sale near me' and 'best price' organically" />
              <Tip text="Professional photos + unique description = 35% more VDP clicks" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ConfigCard = ({ icon: Icon, title, children }: { icon: typeof Car; title: string; children: React.ReactNode }) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-4">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
    {children}
  </div>
);

const ScoreItem = ({ label, ok }: { label: string; ok: boolean }) => (
  <div className="flex items-center gap-1.5">
    {ok ? <Check className="w-3 h-3 text-emerald-500" /> : <div className="w-3 h-3 rounded-full border border-muted-foreground/30" />}
    <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
  </div>
);

const Tip = ({ text }: { text: string }) => (
  <div className="flex items-start gap-2">
    <Check className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
    <span>{text}</span>
  </div>
);

export default DescriptionWriter;
