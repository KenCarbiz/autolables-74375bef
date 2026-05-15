import { useNavigate } from "react-router-dom";
import Logo from "@/components/brand/Logo";
import Seo from "@/components/Seo";
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  BarChart3,
  Sparkles,
  Scan,
  FileText,
  Signature,
  Check,
  Play,
} from "lucide-react";
import { AUTOCURB_BRAND } from "@/data/autocurbBrand";

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-background">
      <Seo
        title="About AutoLabels.io — Decode, Stick, Sign, Close"
        description="How AutoLabels.io powers every dealer sticker, addendum, and Buyers Guide. Four verbs, one platform — decode, stick, sign, close."
        path="/about"
      />
      {/* ─────────── Top Nav ─────────── */}
      <nav className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <Logo variant="full" size={28} />
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/brand")}
              className="hidden md:inline-flex text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Brand
            </button>
            <button
              onClick={() => navigate("/login")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </button>
            <button
              onClick={() => navigate("/onboarding")}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </nav>

      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden shimmer-hero text-white py-28 px-6 lg:px-8">
        {/* Background glows — extra cyan punch */}
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-[#3BB4FF]/25 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-[#1E90FF]/20 blur-3xl" />

        <div className="relative max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 text-xs font-medium mb-6">
            <Sparkles className="w-3 h-3 text-[#3BB4FF]" />
            <span>The dealer label platform</span>
          </div>

          <h1 className="text-6xl lg:text-8xl font-black tracking-tighter font-display leading-none">
            Clear.
            <br />
            Compliant.
            <br />
            <span className="bg-gradient-to-r from-[#3BB4FF] via-[#1E90FF] to-[#3BB4FF] bg-clip-text text-transparent italic">
              Consistent.
            </span>
          </h1>

          <p className="text-lg lg:text-xl text-white/60 mt-8 max-w-2xl mx-auto">
            Every sticker, addendum, and Buyers Guide that leaves your lot — perfectly priced,
            fully disclosed, and ready to sign. Scan a VIN, build a label, capture a lead, close the deal.
          </p>

          <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={() => navigate("/onboarding")}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-md bg-white text-slate-950 text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              Start free trial
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-md border border-white/20 bg-white/5 text-white text-sm font-semibold hover:bg-white/10 transition-colors"
            >
              <Play className="w-4 h-4" />
              See a demo
            </button>
          </div>

          <div className="mt-12 flex items-center justify-center gap-6 text-xs text-white/40 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-400" />
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-400" />
              CARS Act compliant
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-400" />
              Set up in 5 minutes
            </span>
          </div>
        </div>
      </section>

      {/* ─────────── Four Verbs ─────────── */}
      <section className="py-24 px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[11px] font-bold uppercase tracking-label text-blue-600">How it works</p>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tighter font-display mt-2">
              Four verbs. One platform.
            </h2>
            <p className="text-base text-muted-foreground mt-4 max-w-xl mx-auto">
              The product is built around four actions. That's it.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            <VerbCard
              num="01"
              icon={Scan}
              verb="Decode"
              body="VIN to full factory build sheet in under 800ms via the NHTSA database. Auto-pull year, make, model, trim, and standard equipment."
            />
            <VerbCard
              num="02"
              icon={FileText}
              verb="Stick"
              body="Build a fully-compliant dealer addendum with products, pricing, FTC disclosures, and state-specific doc fees in under a minute."
            />
            <VerbCard
              num="03"
              icon={Signature}
              verb="Sign"
              body="Customer scans a QR, signs on their phone, and every action lands in your audit log. No paper, no chasing signatures."
            />
            <VerbCard
              num="04"
              icon={BarChart3}
              verb="Close"
              body="Every scan becomes a lead. Every addendum becomes data. See what's selling, what's stuck, and what's closing — live."
            />
          </div>
        </div>
      </section>

      {/* ─────────── Principles ─────────── */}
      <section className="py-24 px-6 lg:px-8 bg-muted/30 border-y border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[11px] font-bold uppercase tracking-label text-blue-600">What we believe</p>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tighter font-display mt-2">
              Three principles
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {AUTOCURB_BRAND.principles.map((p) => (
              <div
                key={p.number}
                className="bg-card rounded-2xl border border-border shadow-premium p-8"
              >
                <p className="text-xs font-bold text-blue-600 tabular-nums">{p.number}</p>
                <h3 className="text-2xl font-bold tracking-tight font-display text-foreground mt-2">
                  {p.title}
                </h3>
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Feature grid ─────────── */}
      <section className="py-24 px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[11px] font-bold uppercase tracking-label text-blue-600">Under the hood</p>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tighter font-display mt-2">
              Power where you need it
            </h2>
            <p className="text-base text-muted-foreground mt-4 max-w-xl mx-auto">
              Compliance-grade tools, premium UX, zero learning curve.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <Feature
              icon={ShieldCheck}
              title="CARS Act ready"
              body="California SB 766 disclosures, multi-language support, 2-year record retention — built in."
            />
            <Feature
              icon={Zap}
              title="VIN decode + scrape"
              body="NHTSA free decode or Black Book live market pricing. Or paste a VDP URL and let us scrape it."
            />
            <Feature
              icon={Sparkles}
              title="Rules engine"
              body="Auto-assign products by year, make, model, trim, body style, or mileage. Set it once, apply forever."
            />
            <Feature
              icon={Signature}
              title="Digital signing"
              body="Customer signs on their phone via QR. Every signature is cryptographically logged for audits."
            />
            <Feature
              icon={FileText}
              title="Buyers Guide"
              body="FTC As-Is / Implied / Warranty guides in English + Spanish. Satisfies federal and state requirements."
            />
            <Feature
              icon={BarChart3}
              title="Live analytics"
              body="Product acceptance rates, revenue per addendum, top hooks — every signal that matters."
            />
          </div>
        </div>
      </section>

      {/* ─────────── CTA ─────────── */}
      <section className="py-24 px-6 lg:px-8">
        <div className="max-w-4xl mx-auto shimmer-hero rounded-3xl px-8 lg:px-16 py-20 text-center text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-[#3BB4FF]/25 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-[#1E90FF]/20 blur-3xl" />

          <div className="relative">
            <h2 className="text-4xl lg:text-5xl font-black tracking-tighter font-display leading-none">
              Ready to label your lot
              <br />
              the right way?
            </h2>
            <p className="text-lg text-white/60 mt-6">
              Set up in 5 minutes. No credit card required. Cancel anytime.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={() => navigate("/onboarding")}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-md bg-white text-slate-950 text-sm font-semibold hover:bg-white/90 transition-colors"
              >
                Start free trial
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate("/brand")}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-md border border-white/20 bg-white/5 text-white text-sm font-semibold hover:bg-white/10 transition-colors"
              >
                Brand guidelines
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-border py-10 px-6 lg:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Logo variant="full" size={24} />
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AutoLabels.io · Clear. Compliant. Consistent.
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <button onClick={() => navigate("/brand")} className="hover:text-foreground">Brand</button>
            <button onClick={() => navigate("/login")} className="hover:text-foreground">Sign in</button>
          </div>
        </div>
      </footer>
    </div>
  );
};

const VerbCard = ({
  num,
  icon: Icon,
  verb,
  body,
}: {
  num: string;
  icon: typeof Scan;
  verb: string;
  body: string;
}) => (
  <div className="bg-card rounded-2xl border border-border shadow-premium p-6 hover:shadow-premium-md transition-shadow">
    <div className="flex items-center justify-between mb-4">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#3BB4FF] via-[#1E90FF] to-[#0066CC] flex items-center justify-center">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <p className="text-xs font-bold text-[#1E90FF] tabular-nums">{num}</p>
    </div>
    <h3 className="text-2xl font-bold tracking-tight font-display text-foreground">{verb}</h3>
    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{body}</p>
  </div>
);

const Feature = ({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Scan;
  title: string;
  body: string;
}) => (
  <div className="p-6">
    <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center mb-4">
      <Icon className="w-4 h-4 text-blue-600" />
    </div>
    <h3 className="text-base font-semibold text-foreground">{title}</h3>
    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
  </div>
);

export default About;
