import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useDealerScraper } from "@/hooks/useDealerScraper";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import Logo from "@/components/brand/Logo";
import { toast } from "sonner";
import {
  Sparkles,
  Building2,
  Building,
  Users2,
  Crown,
  ChevronRight,
  Check,
  Globe,
  ArrowRight,
  ArrowLeft,
  Store,
  MapPin,
  Phone,
  Mail,
  Image as ImageIcon,
} from "lucide-react";

type StructureType = "single" | "single_secondary" | "multi_location" | "dealer_group" | "enterprise";
type BdcType = "none" | "single" | "multi_location" | "ai_bdc";
type PlanTier = "starter" | "standard" | "pro" | "enterprise";

interface OnboardingData {
  // Step 1: AI website autofill
  websiteUrl: string;

  // Step 2: Dealership info
  dealerName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;

  // Inventory feed / website verification
  dmsProvider: string;
  newInventoryUrl: string;
  usedInventoryUrl: string;

  // Step 3: Structure
  structure: StructureType;

  // Step 4: BDC
  bdcType: BdcType;

  // Step 5: Billing
  planTier: PlanTier;
}

const INITIAL: OnboardingData = {
  websiteUrl: "",
  dealerName: "",
  tagline: "",
  logoUrl: "",
  primaryColor: "#192f54",
  address: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  email: "",
  dmsProvider: "",
  newInventoryUrl: "",
  usedInventoryUrl: "",
  structure: "single",
  bdcType: "none",
  planTier: "standard",
};

const Onboarding = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { updateTenant, addStore, stores, updateStore, completeOnboarding, isEmbedded } = useTenant();
  const { updateSettings } = useDealerSettings();
  const { scrapeDealer, scraping, error: scrapeError } = useDealerScraper();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { tenant, profile, bootstrapTenant, reload: reloadEntitlements } = useEntitlements();

  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(INITIAL);
  const [scrapeSuccess, setScrapeSuccess] = useState(false);
  const [scrapePreview, setScrapePreview] = useState<Awaited<ReturnType<typeof scrapeDealer>> | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [prefilledFrom, setPrefilledFrom] = useState<"autocurb" | "profile" | null>(null);

  // ── Handoff token consumption. If the user was redirected here
  //    from autocurb.io with `?handoff=<token>`, trade it for a
  //    prefilled tenant + profile via the cross-app-handoff edge
  //    function. One-time use; the token is burned server-side.
  useEffect(() => {
    const handoff = searchParams.get("handoff");
    if (!handoff || handoffLoading) return;
    setHandoffLoading(true);
    (async () => {
      const { data: res, error } = await supabase.functions.invoke("cross-app-handoff", {
        body: { token: handoff, targetApp: "autolabels" },
      });
      if (error || !res?.consumed) {
        toast.error("Handoff link invalid or expired");
      } else {
        const p = res.profile;
        if (p) {
          setData(prev => ({
            ...prev,
            dealerName: p.display_name || prev.dealerName,
            tagline: p.tagline || prev.tagline,
            logoUrl: p.logo_url || prev.logoUrl,
            primaryColor: p.primary_color || prev.primaryColor,
            websiteUrl: p.website || prev.websiteUrl,
            phone: p.phone || prev.phone,
          }));
          setPrefilledFrom("autocurb");
          toast.success("Welcome from Autocurb \u2014 dealer profile pre-filled");
        }
        await reloadEntitlements();
      }
      // Clear the handoff param so a refresh doesn't re-consume it
      const next = new URLSearchParams(searchParams);
      next.delete("handoff");
      setSearchParams(next, { replace: true });
      setHandoffLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Profile prefill. If the user already has a tenant + onboarding
  //    profile (came from Autocurb, or is returning to finish setup),
  //    hydrate the form so they're not re-typing.
  useEffect(() => {
    if (!profile || prefilledFrom) return;
    setData(prev => ({
      ...prev,
      dealerName: profile.display_name || prev.dealerName,
      tagline: profile.tagline || prev.tagline,
      logoUrl: profile.logo_url || prev.logoUrl,
      primaryColor: profile.primary_color || prev.primaryColor,
      websiteUrl: profile.website || prev.websiteUrl,
      phone: profile.phone || prev.phone,
    }));
    setPrefilledFrom(profile.source === "autocurb" ? "autocurb" : "profile");
  }, [profile, prefilledFrom]);

  // Onboarding is now invite-only. Only users who (a) already have a
  // tenant (they were invited by an admin and the signup trigger
  // attached them to tenant_members), (b) arrived via an Autocurb
  // handoff token, or (c) hold the platform admin role can run the
  // wizard. Everyone else bounces to /dashboard, which renders the
  // NoTenantScreen "contact admin" message.
  useEffect(() => {
    if (authLoading || isEmbedded) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    const handoff = searchParams.get("handoff");
    // Allow: active handoff token, existing tenant, or admin role.
    if (handoff || tenant || isAdmin) return;
    // Otherwise send the user to the "not linked to a dealership" page
    // via the dashboard route, which runs EntitlementGate.
    navigate("/dashboard", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, isEmbedded, tenant, isAdmin]);

  // If running embedded, onboarding doesn't apply
  if (isEmbedded) {
    navigate("/dashboard");
    return null;
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const TOTAL_STEPS = 5;

  const update = <K extends keyof OnboardingData>(key: K, value: OnboardingData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
  };

  // Pull an existing dealership from Autocurb. The edge function looks the
  // signed-in user up by their account email (from the JWT) — there is no
  // email to type. On a match it bootstraps the tenant + profile +
  // entitlement locally, so we just reload and drop the dealer into the app.
  const handleAutocurbPull = async () => {
    setPullLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("autocurb-pull", {
        body: { app_slug: "autolabels" },
      });
      if (error) throw error;
      if ((res as { matched?: boolean })?.matched) {
        toast.success("Found your dealership on Autocurb — pulling your profile.");
        await reloadEntitlements();
        navigate("/dashboard");
      } else {
        toast.message("No matching Autocurb dealership for your sign-in email. Continue the quick setup below.");
      }
    } catch {
      toast.error("Couldn't reach Autocurb right now. Continue the setup below.");
    } finally {
      setPullLoading(false);
    }
  };

  const handleScrape = async () => {
    if (!data.websiteUrl.trim()) return;
    const result = await scrapeDealer(data.websiteUrl);
    if (result) {
      setScrapePreview(result);
      setScrapeSuccess(true);
      toast.success("Website scraped — review the preview below");
    }
  };

  const handleApplyScrape = () => {
    if (!scrapePreview) return;
    setData(prev => ({
      ...prev,
      dealerName: scrapePreview.name || prev.dealerName,
      tagline: scrapePreview.tagline || prev.tagline,
      logoUrl: scrapePreview.logo_url || prev.logoUrl,
      address: scrapePreview.address || prev.address,
      city: scrapePreview.city || prev.city,
      state: scrapePreview.state || prev.state,
      zip: scrapePreview.zip || prev.zip,
      phone: scrapePreview.phone || prev.phone,
      email: scrapePreview.email || prev.email,
    }));
    toast.success("Applied to dealership profile");
    next();
  };

  const handleDiscardScrape = () => {
    setScrapePreview(null);
    setScrapeSuccess(false);
  };

  const next = () => setStep(Math.min(step + 1, TOTAL_STEPS));
  const back = () => setStep(Math.max(step - 1, 1));

  const finish = async () => {
    // Persist tenant in local TenantContext (store switcher, branding)
    updateTenant({
      name: data.dealerName || "Your Dealership",
      logo_url: data.logoUrl,
      primary_color: data.primaryColor,
    });

    // Persist dealer identity + inventory/feed source into DealerSettings
    // (the store the addendum + price-integrity crawl read from).
    updateSettings({
      dealer_name: data.dealerName,
      dealer_tagline: data.tagline,
      dealer_address: data.address,
      dealer_city: data.city,
      dealer_state: data.state,
      dealer_zip: data.zip,
      dealer_phone: data.phone,
      dms_provider: data.dmsProvider,
      new_inventory_url: data.newInventoryUrl,
      used_inventory_url: data.usedInventoryUrl,
    });

    // Create or update the default store
    const existing = stores[0];
    if (existing) {
      updateStore(existing.id, {
        name: data.dealerName || existing.name,
        tagline: data.tagline,
        logo_url: data.logoUrl,
        primary_color: data.primaryColor,
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        phone: data.phone,
      });
    } else {
      addStore({
        tenant_id: "default",
        name: data.dealerName || "Your Dealership",
        slug: (data.dealerName || "default").toLowerCase().replace(/\s+/g, "-"),
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        phone: data.phone,
        logo_url: data.logoUrl,
        tagline: data.tagline,
        primary_color: data.primaryColor,
        is_active: true,
      });
    }

    // Persist to the shared Supabase model so sibling apps (Autocurb,
    // AutoFrame, AutoVideo) see the same profile. If the user is
    // signed in AND has no tenant yet, bootstrap one + a 14-day
    // autolabels trial. If the tenant already exists (came from
    // Autocurb), update the existing profile row.
    if (user) {
      try {
        let tenantId = tenant?.id;
        if (!tenantId) {
          const result = await bootstrapTenant({
            name: data.dealerName || "Your Dealership",
            source: "autolabels",
            app: "autolabels",
            tier: data.planTier || "sticker",
          });
          tenantId = result.tenantId || undefined;
        }
        if (tenantId) {
          await (supabase as any)
            .from("onboarding_profiles")
            .upsert(
              {
                tenant_id: tenantId,
                display_name: data.dealerName,
                tagline: data.tagline,
                primary_color: data.primaryColor,
                logo_url: data.logoUrl,
                website: data.websiteUrl,
                phone: data.phone,
                stores: stores.length
                  ? stores.map(s => ({
                      name: s.name, address: s.address, city: s.city,
                      state: s.state, zip: s.zip, phone: s.phone,
                      logo_url: s.logo_url, tagline: s.tagline,
                    }))
                  : [{
                      name: data.dealerName, address: data.address,
                      city: data.city, state: data.state, zip: data.zip,
                      phone: data.phone, logo_url: data.logoUrl,
                      tagline: data.tagline,
                    }],
                completed_at: new Date().toISOString(),
              },
              { onConflict: "tenant_id" }
            );
        }
      } catch (err) {
        console.error("finish() shared-profile sync failed", err);
      }
    }

    completeOnboarding();

    // Notify the Autocurb mothership of this direct-signup tenant so
    // the rest of the family can offer them additional apps. No-ops
    // if AUTOCURB_API_BASE / AUTOCURB_NOTIFY_SECRET aren't configured.
    if (tenant && tenant.source !== "autocurb" && !tenant.autocurb_tenant_id) {
      try {
        await supabase.functions.invoke("notify-autocurb", {
          body: { tenant_id: tenant.id },
        });
      } catch {
        // best-effort; ignore failures so the dealer still lands in the app
      }
    }

    // Wave 15.4 — family-invitation moment. The wizard used to
    // end with a flat "Welcome aboard" and dump the dealer at a
    // blank dashboard. Now we land them with a richer toast that
    // names the Autocurb family they just joined, plus a hint
    // about the AppSwitcher in the top bar. Same redirect.
    toast.success("Welcome to the Autocurb Family — AutoLabels is live", {
      description: "Find AutoFrame · AutoVideo · Autocurb in the app switcher (top bar).",
      duration: 7000,
    });
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top header */}
      <header className="bg-white border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo variant="full" size={32} />
          <div className="text-xs text-muted-foreground flex items-center gap-3">
            <span>Step {step} of {TOTAL_STEPS}</span>
            <span className="hidden sm:inline text-muted-foreground/60">·</span>
            <span className="hidden sm:inline">~{stepMinutes(step)} min</span>
          </div>
        </div>
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6">
          <span>Setup</span>
          <ChevronRight className="w-3 h-3" />
          <span>Dealer Onboarding</span>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{stepTitle(step)}</span>
        </div>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight font-display text-foreground">
            Set up your dealership
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            5 steps. ~5 minutes. You can save and return at any time.
          </p>
        </div>

        {prefilledFrom === "autocurb" && (
          <div className="mb-6 rounded-xl border border-[#1E90FF]/30 bg-[#1E90FF]/5 px-4 py-3 flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-[#1E90FF] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Welcome from Autocurb</p>
              <p className="text-[11px] text-muted-foreground">
                Your dealer profile is already on file. Skim through the steps to confirm, then activate.
              </p>
            </div>
          </div>
        )}
        {prefilledFrom === "profile" && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Profile pre-filled from previous setup</p>
              <p className="text-[11px] text-muted-foreground">
                Continuing where you left off.
              </p>
            </div>
          </div>
        )}

        {/* Step 1: AI Website Autofill */}
        {step === 1 && (
          <div className="space-y-5">
            {/* Already on Autocurb — pull the dealership instead of re-typing */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/30 dark:border-blue-900 p-5">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                <h3 className="text-sm font-bold text-foreground">Already on Autocurb?</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Pull your dealership profile, branding, locations, and plan straight from Autocurb — nothing to re-type.
                We match on your sign-in email ({user?.email || "your account email"}).
              </p>
              <button
                onClick={handleAutocurbPull}
                disabled={pullLoading}
                className="h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-2"
              >
                <Building2 className="w-4 h-4" />
                {pullLoading ? "Checking Autocurb…" : "Pull my dealership from Autocurb"}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or set up manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <Section
              icon={Sparkles}
              title="AI Website Auto-Fill"
              subtitle="Scrape the dealer's website to auto-populate branding, contact info, and locations. AutoLabels is the first app you're activating in the Autocurb Family — AutoFrame and AutoVideo can be added any time from the top-bar app switcher."
              purple
            >
              <button className="text-xs font-medium text-purple-600 hover:underline mb-3 inline-flex items-center gap-1">
                Open full questionnaire
                <ArrowRight className="w-3 h-3" />
              </button>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={data.websiteUrl}
                    onChange={(e) => update("websiteUrl", e.target.value)}
                    placeholder="e.g. citydjr.com"
                    className="w-full h-10 pl-10 pr-3 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <button
                onClick={handleScrape}
                disabled={scraping || !data.websiteUrl.trim()}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 h-11 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {scraping ? "Scraping..." : scrapeSuccess ? "Re-scrape" : "Scrape & Preview"}
              </button>
              {scrapeError && (
                <div className="mt-2 text-xs text-destructive bg-destructive/5 rounded-md px-3 py-2">
                  {scrapeError}
                </div>
              )}
            </Section>

            {/* Scrape preview card — review before applying */}
            {scrapePreview && (
              <div className="bg-white rounded-xl border-2 border-emerald-300 shadow-premium overflow-hidden">
                <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-3 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-emerald-900">Scraped Successfully</p>
                    <p className="text-xs text-emerald-700">Review what we found. Apply to populate the onboarding form.</p>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <PreviewField label="Dealer Name" value={scrapePreview.name} />
                    <PreviewField label="Phone" value={scrapePreview.phone} />
                    <PreviewField label="Email" value={scrapePreview.email} />
                    <PreviewField label="Address" value={scrapePreview.address} />
                    <PreviewField label="City" value={scrapePreview.city} />
                    <PreviewField label="State" value={scrapePreview.state} />
                    <PreviewField label="ZIP" value={scrapePreview.zip} />
                    <PreviewField label="Website" value={scrapePreview.website} />
                  </div>

                  {scrapePreview.tagline && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Tagline</p>
                      <p className="text-sm text-foreground italic">"{scrapePreview.tagline}"</p>
                    </div>
                  )}

                  {scrapePreview.logo_url && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Logo</p>
                      <div className="inline-block p-3 bg-muted rounded-md">
                        <img src={scrapePreview.logo_url} alt="Logo" className="h-12 object-contain" />
                      </div>
                    </div>
                  )}

                  {scrapePreview.oem_brands.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        OEM Brands Detected ({scrapePreview.oem_brands.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {scrapePreview.oem_brands.map(brand => (
                          <span
                            key={brand}
                            className="text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded"
                          >
                            {brand}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {scrapePreview.value_propositions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        Value Propositions
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {scrapePreview.value_propositions.map((v, i) => (
                          <span
                            key={i}
                            className="text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-border">
                    <button
                      onClick={handleApplyScrape}
                      className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                    >
                      <Check className="w-4 h-4" />
                      Apply & Continue
                    </button>
                    <button
                      onClick={handleDiscardScrape}
                      className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground bg-white rounded-lg border border-border px-4 py-3">
              <span>Prefer to enter details manually?</span>
              <button
                onClick={next}
                className="text-primary font-medium hover:underline"
              >
                Skip and continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Dealership details */}
        {step === 2 && (
          <div className="space-y-5">
            <Section icon={Store} title="Dealership Details" subtitle="Basic information about your dealership.">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Dealership Name"
                  value={data.dealerName}
                  onChange={v => update("dealerName", v)}
                  placeholder="e.g. Harte Auto Group"
                  required
                  colSpan={2}
                />
                <Field
                  label="Tagline"
                  value={data.tagline}
                  onChange={v => update("tagline", v)}
                  placeholder="e.g. Connecticut's Premier Family-Owned Dealer"
                  colSpan={2}
                />
                <Field
                  label="Logo URL"
                  value={data.logoUrl}
                  onChange={v => update("logoUrl", v)}
                  placeholder="https://..."
                  icon={ImageIcon}
                  colSpan={2}
                />
                <Field
                  label="Primary Color"
                  value={data.primaryColor}
                  onChange={v => update("primaryColor", v)}
                  placeholder="#192f54"
                  type="color"
                  colSpan={1}
                />
              </div>
              {data.logoUrl && (
                <div className="mt-3 p-3 bg-muted rounded-md flex items-center justify-center">
                  <img src={data.logoUrl} alt="Logo" className="h-10 object-contain" />
                </div>
              )}
            </Section>

            <Section icon={MapPin} title="Location" subtitle="Where is your primary dealership located?">
              <div className="grid grid-cols-6 gap-3">
                <Field
                  label="Street Address"
                  value={data.address}
                  onChange={v => update("address", v)}
                  placeholder="123 Main St"
                  colSpan={6}
                />
                <Field label="City" value={data.city} onChange={v => update("city", v)} colSpan={3} />
                <Field label="State" value={data.state} onChange={v => update("state", v)} placeholder="CT" colSpan={1} />
                <Field label="ZIP" value={data.zip} onChange={v => update("zip", v)} placeholder="06108" colSpan={2} />
              </div>
            </Section>

            <Section icon={Phone} title="Contact" subtitle="How customers reach you.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" value={data.phone} onChange={v => update("phone", formatPhone(v))} icon={Phone} placeholder="(555) 555-5555" />
                <Field label="Email" value={data.email} onChange={v => update("email", v)} icon={Mail} placeholder="contact@example.com" />
              </div>
            </Section>

            <Section icon={Globe} title="Inventory & pricing source" subtitle="Your DMS is the source of truth; your inventory websites let us verify advertised prices match the sticker.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="DMS Provider" value={data.dmsProvider} onChange={v => update("dmsProvider", v)} placeholder="CDK, Reynolds, Dealertrack, Tekion…" colSpan={2} />
                <Field label="New inventory website" value={data.newInventoryUrl} onChange={v => update("newInventoryUrl", v)} placeholder="https://yourdealer.com/inventory/new" />
                <Field label="Used inventory website" value={data.usedInventoryUrl} onChange={v => update("usedInventoryUrl", v)} placeholder="https://yourdealer.com/inventory/used" />
              </div>
            </Section>
          </div>
        )}

        {/* Step 3: Structure */}
        {step === 3 && (
          <Section title="How is this dealership structured?" subtitle="This determines routing, branding, and pricing. You can always adjust later." center>
            <div className="space-y-3 mt-2">
              <SelectionCard
                icon={Store}
                title="Single Store"
                subtitle="One rooftop, one brand."
                selected={data.structure === "single"}
                onClick={() => update("structure", "single")}
              />
              <SelectionCard
                icon={Building}
                title="Single Store + Secondary"
                subtitle="Primary dealership with a satellite location — buying center, used car lot, or standalone."
                selected={data.structure === "single_secondary"}
                onClick={() => update("structure", "single_secondary")}
              />
              <SelectionCard
                icon={Building2}
                title="Multi-Location"
                subtitle="Multiple stores under one brand with ZIP/OEM routing and per-store settings."
                selected={data.structure === "multi_location"}
                onClick={() => update("structure", "multi_location")}
              />
              <SelectionCard
                icon={Users2}
                title="Dealer Group"
                subtitle="Multiple brands & franchises with corporate identity, full routing, and brand matching."
                selected={data.structure === "dealer_group"}
                onClick={() => update("structure", "dealer_group")}
              />
              <SelectionCard
                icon={Crown}
                title="Enterprise"
                subtitle="11+ locations."
                badge={{ label: "Custom Pricing", color: "amber" }}
                selected={data.structure === "enterprise"}
                onClick={() => update("structure", "enterprise")}
              />
            </div>
          </Section>
        )}

        {/* Step 4: BDC */}
        {step === 4 && (
          <Section title="How does this dealership handle leads?" subtitle="This configures lead routing, notification rules, and follow-up automation." center>
            <div className="space-y-3 mt-2">
              <SelectionCard
                icon={Users2}
                title="No BDC"
                subtitle="No dedicated BDC team."
                selected={data.bdcType === "none"}
                onClick={() => update("bdcType", "none")}
              />
              <SelectionCard
                icon={Phone}
                title="Single BDC"
                subtitle="One centralized team handles all inbound leads across locations."
                selected={data.bdcType === "single"}
                onClick={() => update("bdcType", "single")}
              />
              <SelectionCard
                icon={Building2}
                title="Multi-Location BDC"
                subtitle="Each location has its own BDC team."
                selected={data.bdcType === "multi_location"}
                onClick={() => update("bdcType", "multi_location")}
              />
              <SelectionCard
                icon={Sparkles}
                title="AI BDC"
                badge={{ label: "Beta", color: "amber" }}
                subtitle="AI-powered lead handling with automated follow-ups and intelligent routing."
                selected={data.bdcType === "ai_bdc"}
                onClick={() => update("bdcType", "ai_bdc")}
              />
            </div>
          </Section>
        )}

        {/* Step 5: Plan */}
        {step === 5 && (
          <Section icon={Crown} title="Billing & Plan" subtitle="Choose a plan that fits your dealership size.">
            <div className="space-y-3 mt-2">
              <PlanCard
                tier="starter"
                name="Starter"
                price="$495/mo"
                description="Single store, up to 100 addendums/month."
                selected={data.planTier === "starter"}
                onClick={() => update("planTier", "starter")}
              />
              <PlanCard
                tier="standard"
                name="Standard"
                price="$1,995/mo"
                description="1–2 locations. Unlimited addendums, full compliance suite."
                recommended
                selected={data.planTier === "standard"}
                onClick={() => update("planTier", "standard")}
              />
              <PlanCard
                tier="pro"
                name="Pro"
                price="$3,495/mo"
                description="3–10 locations. Multi-store management, analytics, priority support."
                selected={data.planTier === "pro"}
                onClick={() => update("planTier", "pro")}
              />
              <PlanCard
                tier="enterprise"
                name="Enterprise"
                price="Custom"
                description="11+ locations. Dedicated account manager, DMS integrations, SLA."
                selected={data.planTier === "enterprise"}
                onClick={() => update("planTier", "enterprise")}
              />
            </div>
          </Section>
        )}

        {/* Nav buttons */}
        <div className="mt-8 flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={back}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}
          {step < TOTAL_STEPS ? (
            <button
              onClick={next}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={finish}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <Check className="w-4 h-4" />
              Complete Setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

function stepTitle(step: number): string {
  return ["AI Auto-Fill", "Details", "Structure", "Lead Handling", "Billing"][step - 1] || "";
}

function stepMinutes(step: number): number {
  return [1, 2, 1, 1, 1][step - 1] || 1;
}

const Section = ({
  icon: Icon,
  title,
  subtitle,
  children,
  purple,
  center,
}: {
  icon?: typeof Sparkles;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  purple?: boolean;
  center?: boolean;
}) => (
  <div className={`bg-card rounded-xl border border-border shadow-premium p-6 ${purple ? "border-purple-200 bg-purple-50/30" : ""}`}>
    <div className={`${center ? "text-center mb-6" : "mb-4"}`}>
      {Icon && (
        <div className={`${center ? "mx-auto" : ""} w-9 h-9 rounded-md ${purple ? "bg-purple-100 text-purple-600" : "bg-muted text-foreground"} flex items-center justify-center ${center ? "mb-3" : "mb-2"}`}>
          <Icon className="w-4 h-4" />
        </div>
      )}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  required,
  type = "text",
  colSpan = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: typeof Sparkles;
  required?: boolean;
  type?: string;
  colSpan?: number;
}) => {
  const colSpanClass: Record<number, string> = { 1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4", 5: "col-span-5", 6: "col-span-6" };
  return (
    <div className={colSpanClass[colSpan]}>
      <label className="block text-xs font-semibold text-foreground mb-1">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full h-10 ${Icon ? "pl-10" : "pl-3"} pr-3 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring`}
        />
      </div>
    </div>
  );
};

const SelectionCard = ({
  icon: Icon,
  title,
  subtitle,
  selected,
  onClick,
  badge,
}: {
  icon: typeof Sparkles;
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
  badge?: { label: string; color: "amber" | "blue" };
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
      selected ? "border-primary bg-primary/5 shadow-premium" : "border-border bg-card hover:border-border hover:bg-muted/30"
    }`}
  >
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
      <Icon className="w-5 h-5" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="font-semibold text-sm text-foreground">{title}</p>
        {badge && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
            badge.color === "amber" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
          }`}>
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
    {selected ? (
      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
        <Check className="w-3 h-3 text-primary-foreground" />
      </div>
    ) : (
      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    )}
  </button>
);

const PreviewField = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-sm text-foreground font-medium truncate">
      {value || <span className="text-muted-foreground italic font-normal">Not found</span>}
    </p>
  </div>
);

const PlanCard = ({
  name,
  price,
  description,
  selected,
  onClick,
  recommended,
}: {
  tier: PlanTier;
  name: string;
  price: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  recommended?: boolean;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left ${
      selected ? "border-primary bg-primary/5 shadow-premium" : "border-border bg-card hover:border-border hover:bg-muted/30"
    }`}
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="font-semibold text-sm text-foreground">{name}</p>
        {recommended && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
            Recommended
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
    <div className="text-right flex-shrink-0">
      <p className="text-sm font-semibold text-foreground">{price}</p>
      {selected && (
        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center mt-2 ml-auto">
          <Check className="w-3 h-3 text-primary-foreground" />
        </div>
      )}
    </div>
  </button>
);

export default Onboarding;
