import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Logo from "@/components/brand/Logo";
import {
  ArrowRight,
  ShieldCheck,
  Eye,
  Lock,
  Activity,
  FileCheck,
  TrendingUp,
  ChevronDown,
  Sparkles,
  Check,
  Building2,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Landing — complete redesign (Wave 32).
//
// Brief: Stripe / Linear / Vanta tier marketing site. Outcome-led
// narrative, light surface, very large typography, generous
// whitespace. Lead with "AutoLabels protects your dealership" —
// not "AutoLabels creates addendums." The product is positioned
// as the compliance operating system, not a sticker tool.
//
// Audience reads in 15 seconds: dealer principals, GMs, GSMs,
// used/new car managers, compliance managers. Hero must answer
// "what is this, why do I need it" before any product noun
// (addendum / sticker / disclosure) appears.
// ──────────────────────────────────────────────────────────────

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="bg-white text-slate-900 antialiased selection:bg-blue-100 selection:text-slate-900">
      <Nav user={user} onNav={navigate} />
      <Hero onPrimary={() => navigate(user ? "/dashboard" : "/onboarding")} />
      <TrustBand />
      <Problem />
      <Pillars />
      <ProductShot />
      <DeepFeatures />
      <TrustAndSecurity />
      <Outcomes />
      <Pricing onSelect={() => navigate("/onboarding")} />
      <FAQ />
      <FinalCTA onPrimary={() => navigate(user ? "/dashboard" : "/onboarding")} />
      <Footer onNav={navigate} />
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Navigation — minimal, sticky, clean. One primary CTA on the
// right. Mobile collapses to a single "Book a demo" button.
// ──────────────────────────────────────────────────────────────

const Nav = ({ user, onNav }: { user: unknown; onNav: (to: string) => void }) => (
  <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
      <button onClick={() => onNav("/")} aria-label="AutoLabels home" className="flex items-center gap-2">
        <Logo variant="full" size={28} />
      </button>
      <div className="hidden items-center gap-8 md:flex">
        <a href="#platform" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Platform</a>
        <a href="#compliance" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Compliance</a>
        <a href="#pricing" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Pricing</a>
        <a href="#faq" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">FAQ</a>
      </div>
      <div className="flex items-center gap-2">
        {user ? (
          <button
            onClick={() => onNav("/dashboard")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Open dashboard <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <>
            <button
              onClick={() => onNav("/login")}
              className="hidden h-9 items-center px-3 text-sm text-slate-600 transition-colors hover:text-slate-900 md:inline-flex"
            >
              Sign in
            </button>
            <button
              onClick={() => onNav("/onboarding")}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Book a demo <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  </nav>
);

// ──────────────────────────────────────────────────────────────
// Hero — huge headline, single outcome sentence. No product
// noun yet. Soft radial gradient behind so the slab feels like
// a Linear / Stripe hero, not a flat marketing page.
// ──────────────────────────────────────────────────────────────

const Hero = ({ onPrimary }: { onPrimary: () => void }) => (
  <section className="relative isolate overflow-hidden">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[600px] [mask-image:radial-gradient(60%_60%_at_50%_30%,#000_40%,transparent_85%)]"
    >
      <div className="absolute inset-x-0 top-0 h-full bg-[radial-gradient(60%_50%_at_50%_30%,rgba(37,99,235,0.12),transparent_70%)]" />
    </div>

    <div className="mx-auto max-w-7xl px-6 pb-20 pt-24 lg:px-8 lg:pb-32 lg:pt-32">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          FTC §5 · CA SB 766 · 50-state ready
        </div>
        <h1 className="font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] text-slate-900 sm:text-6xl lg:text-7xl">
          The compliance layer
          <br />
          every dealership <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">should have.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          AutoLabels protects your dealership from FTC actions, advertised-price drift, and audit risk —
          on every vehicle, automatically. One platform turns regulatory exposure into a defensible
          paper trail you can produce in seconds.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={onPrimary}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md"
          >
            Book a 20-minute demo
            <ArrowRight className="h-4 w-4" />
          </button>
          <a
            href="#platform"
            className="inline-flex h-12 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-6 text-sm font-medium text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
          >
            See how it works
          </a>
        </div>
        <p className="mt-5 text-xs text-slate-500">
          No credit card · 14-day pilot · Setup in under an hour
        </p>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Trust band — light credibility line. No fake logos; instead
// the framework citations a compliance manager already trusts.
// ──────────────────────────────────────────────────────────────

const TrustBand = () => (
  <section className="border-y border-slate-100 bg-slate-50/50">
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
        Built around the frameworks your attorney already cites
      </p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-center text-sm font-medium text-slate-600 sm:grid-cols-3 lg:grid-cols-6">
        <span>FTC §5</span>
        <span>16 CFR Part 455</span>
        <span>Monroney Act</span>
        <span>E-SIGN Act</span>
        <span>CA SB 766</span>
        <span>50-state DMV</span>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Problem — quantified stakes. The 97-letter campaign is the
// single most concrete reason a dealer principal will book a
// demo today, so it leads the section.
// ──────────────────────────────────────────────────────────────

const Problem = () => (
  <section className="relative">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">The exposure</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          Every vehicle on your lot is a potential complaint.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          Federal enforcement, state DMV audits, and consumer disputes all share one weakness in
          common dealership operations: there's no defensible record of what was disclosed, when,
          and to whom.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-3">
        <Stat
          number="97"
          label="dealers received FTC warning letters in a single March 2026 sweep"
        />
        <Stat
          number="$50K+"
          label="typical exposure per non-compliant advertised-price dispute"
        />
        <Stat
          number="2 yrs"
          label="record retention required under CA SB 766 (effective Oct 2026)"
        />
      </div>

      <p className="mx-auto mt-12 max-w-2xl text-center text-sm text-slate-500">
        Sources: FTC enforcement actions Q1 2026 · CA Vehicle Code §11713.21 · 16 CFR Part 455
      </p>
    </div>
  </section>
);

const Stat = ({ number, label }: { number: string; label: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
    <p className="font-display text-5xl font-semibold tracking-[-0.03em] text-slate-900">{number}</p>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">{label}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Pillars — the four outcomes. Verify / Capture / Defend /
// Monitor. Reads as a single sentence the dealer can repeat
// to the next decision-maker in the building.
// ──────────────────────────────────────────────────────────────

const Pillars = () => (
  <section id="platform" className="relative bg-slate-50/60">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">The platform</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          Four pillars. One defensible record.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          AutoLabels closes the loop from the moment a vehicle hits the lot to the moment a
          regulator asks a question.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Pillar
          icon={Eye}
          title="Verify"
          body="Every sticker, every disclosure, every signature is checked against the rules in force the day the vehicle was listed."
        />
        <Pillar
          icon={FileCheck}
          title="Capture"
          body="Customer acknowledgments, installation photos, and price snapshots are captured in real time and timestamped on a tamper-evident chain."
        />
        <Pillar
          icon={ShieldCheck}
          title="Defend"
          body="One click produces an Audit-Defense Packet — a self-contained, SHA-256 anchored file you can hand to counsel, DMV, or the FTC."
        />
        <Pillar
          icon={Activity}
          title="Monitor"
          body="A nightly crawler watches your own ad pages for advertised-price drift and flags mismatches before a customer or a regulator does."
        />
      </div>
    </div>
  </section>
);

const Pillar = ({ icon: Icon, title, body }: { icon: typeof Eye; title: string; body: string }) => (
  <div className="group rounded-2xl border border-slate-200 bg-white p-7 transition-all hover:shadow-md">
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
      <Icon className="h-5 w-5" strokeWidth={2} />
    </div>
    <h3 className="mt-5 font-display text-lg font-semibold tracking-[-0.01em] text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Product shot — abstract product visual. No fake screenshot
// (it would feel cheap on a Linear-tier site); a stylised
// mock of the Audit-Defense Packet header instead.
// ──────────────────────────────────────────────────────────────

const ProductShot = () => (
  <section className="relative">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">The deliverable</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          When the letter arrives, you've already answered it.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          The Audit-Defense Packet is the artifact every other section of the platform produces in
          the background. One VIN, one click, one signed file.
        </p>
      </div>

      <div className="mx-auto mt-16 max-w-5xl">
        <div className="relative rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-2 shadow-[0_24px_80px_-20px_rgba(15,23,42,0.18)]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
              <span className="ml-3 text-xs text-slate-400">autolabels.io · Audit-Defense Packet · 5UXFG2C53JL00012</span>
            </div>
            <div className="grid gap-6 p-8 sm:grid-cols-3 sm:gap-8 sm:p-12">
              <PacketBlock label="Vehicle record" value="2024 Honda Pilot" caption="VIN ending 0012" />
              <PacketBlock label="Sold" value="Jun 02, 2026" caption="Signed at 14:08 PDT" />
              <PacketBlock label="Hash root" value="0x4e8a…b21f" caption="SHA-256 chain verified" />
              <PacketBlock label="Disclosures" value="14 / 14" caption="All checks passed" />
              <PacketBlock label="Signatures" value="3 captured" caption="Customer · F&I · Sales" />
              <PacketBlock label="Price drift" value="$0" caption="Sticker = advertised" />
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-8 py-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" /> Defensible record
              </span>
              <span className="text-slate-500">Generated in 0.8s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const PacketBlock = ({ label, value, caption }: { label: string; value: string; caption: string }) => (
  <div>
    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
    <p className="mt-1.5 font-display text-xl font-semibold tracking-[-0.01em] text-slate-900">{value}</p>
    <p className="mt-1 text-xs text-slate-500">{caption}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Deep features — three alternating-side blocks. Each one is
// outcome-led, then names the underlying capability second.
// ──────────────────────────────────────────────────────────────

const DeepFeatures = () => (
  <section id="compliance" className="bg-slate-50/60">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32 space-y-24">
      <FeatureBlock
        eyebrow="Advertised-price defense"
        title="Catch the mismatch before the regulator does."
        body="AutoLabels watches your own dealer site every night and reconciles every public listing against the price your sticker is committed to. When they drift, you get a flag — not a letter."
        bullets={[
          "Nightly crawl of dealer-website prices",
          "Tolerance gate ($50 default) flags drift before publish",
          "Two-year snapshot history per VIN — CA SB 766 ready",
        ]}
      />
      <FeatureBlock
        eyebrow="Tamper-evident sign-off"
        title="The signature your attorney will love."
        body="Every customer acknowledgment is hashed, timestamped, and chained. The result is an E-SIGN compliant record that survives a deposition — not a screenshot of a PDF."
        bullets={[
          "SHA-256 hash chain anchored at each signing",
          "Customer IP, user-agent, and consent text captured",
          "Bilingual disclosures for Spanish-conducted sales",
        ]}
        reverse
      />
      <FeatureBlock
        eyebrow="Pre-sale verification"
        title="Compliance enforced at the source."
        body="Vehicles cannot be listed until installed equipment is photographed and signed off. The platform refuses to publish a listing that would fail an audit, so your team can't accidentally create one."
        bullets={[
          "Foreman sign-off gate on every used vehicle",
          "Install-photo requirement on every added-equipment item",
          "NHTSA recall check on every publish · do-not-drive blocks shipping",
        ]}
      />
    </div>
  </section>
);

const FeatureBlock = ({
  eyebrow,
  title,
  body,
  bullets,
  reverse,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  reverse?: boolean;
}) => (
  <div className={`grid items-center gap-12 lg:grid-cols-2 lg:gap-16 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
    <div>
      <p className="text-sm font-medium uppercase tracking-[0.14em] text-blue-600">{eyebrow}</p>
      <h3 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-4xl">
        {title}
      </h3>
      <p className="mt-5 text-base leading-relaxed text-slate-600">{body}</p>
      <ul className="mt-6 space-y-2.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700">
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" strokeWidth={2.5} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
    <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 shadow-sm">
      <div className="absolute inset-0 [background-image:linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="absolute inset-8 rounded-2xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur" />
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Trust & security — Vanta-style trust strip. Specific
// guarantees, no fluff. Every line points at a real platform
// primitive shipped in this codebase.
// ──────────────────────────────────────────────────────────────

const TrustAndSecurity = () => (
  <section className="relative">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">Trust</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          The receipts a dealer principal can hand to counsel.
        </h2>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <TrustCard
          icon={Lock}
          title="Tenant-isolated by design"
          body="Row-level security enforces dealership boundaries at the database. One Supabase project, never one shared table."
        />
        <TrustCard
          icon={ShieldCheck}
          title="Tamper-evident records"
          body="Every signing produces a SHA-256 hash anchored to the prior signing — the chain root is what survives the deposition."
        />
        <TrustCard
          icon={TrendingUp}
          title="Two-year retention"
          body="Every advertised-price snapshot and signed disclosure is retained for the SB 766 window with one-click export."
        />
        <TrustCard
          icon={FileCheck}
          title="Audit-Defense Packet"
          body="A self-contained file — PDF + JSON + signatures + hash root — ready for counsel, DMV, or the FTC."
        />
        <TrustCard
          icon={Sparkles}
          title="50-state disclosure engine"
          body="State-by-state ruleset drives the disclosure text on every sticker, refreshed as the law moves."
        />
        <TrustCard
          icon={Building2}
          title="Multi-store, multi-rooftop"
          body="One tenant, many stores, scoped permissions per role — GMs see their store; compliance sees the group."
        />
      </div>
    </div>
  </section>
);

const TrustCard = ({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6">
    <Icon className="h-5 w-5 text-blue-600" strokeWidth={2} />
    <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Outcomes — what the dealer's day looks like 90 days in.
// ──────────────────────────────────────────────────────────────

const Outcomes = () => (
  <section className="border-y border-slate-100 bg-slate-900 text-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-400">90 days in</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-white sm:text-5xl">
          The dealer day, defended.
        </h2>
      </div>
      <div className="mx-auto mt-14 grid max-w-5xl gap-8 sm:grid-cols-3">
        <Outcome n="100%" label="Of sold vehicles have a signed, hash-anchored disclosure on file." />
        <Outcome n="0" label="Advertised-price mismatches reach customers without a flag." />
        <Outcome n="<5 min" label="From subpoena to packet handed to counsel — per VIN." />
      </div>
    </div>
  </section>
);

const Outcome = ({ n, label }: { n: string; label: string }) => (
  <div className="text-center">
    <p className="font-display text-6xl font-semibold tracking-[-0.03em] text-white">{n}</p>
    <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-slate-400">{label}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Pricing — three plans, single sentence each. No table.
// ──────────────────────────────────────────────────────────────

const Pricing = ({ onSelect }: { onSelect: () => void }) => (
  <section id="pricing" className="relative">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">Pricing</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          Priced as the line item your CFO already expects.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          One platform fee per rooftop · unlimited VINs · unlimited users · unlimited disclosures.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-3">
        <Plan
          name="Essential"
          price="$999"
          cadence="/ month · per rooftop"
          body="Compliant sticker, addendum, and customer sign-off on every vehicle."
          features={["Up to 200 VINs / mo", "50-state disclosure engine", "Customer e-signing", "Email support"]}
          cta="Start a pilot"
          onClick={onSelect}
        />
        <Plan
          name="Defense"
          price="$1,799"
          cadence="/ month · per rooftop"
          body="Adds the Audit-Defense Packet, advertised-price monitor, and recall blocker."
          features={["Everything in Essential", "Audit-Defense Packet", "Advertised-price drift alerts", "NHTSA recall hard-block", "Priority support"]}
          cta="Book a demo"
          onClick={onSelect}
          featured
        />
        <Plan
          name="Group"
          price="Custom"
          cadence="Multi-rooftop"
          body="Group reporting, store-scoped permissions, and a dedicated compliance partner."
          features={["Everything in Defense", "Multi-store reporting", "SSO + custom roles", "Named compliance contact"]}
          cta="Talk to sales"
          onClick={onSelect}
        />
      </div>
    </div>
  </section>
);

const Plan = ({
  name, price, cadence, body, features, cta, onClick, featured,
}: {
  name: string;
  price: string;
  cadence: string;
  body: string;
  features: string[];
  cta: string;
  onClick: () => void;
  featured?: boolean;
}) => (
  <div className={`relative flex flex-col rounded-3xl border p-7 ${
    featured
      ? "border-slate-900 bg-slate-900 text-white shadow-xl"
      : "border-slate-200 bg-white text-slate-900"
  }`}>
    {featured && (
      <span className="absolute -top-3 left-7 inline-flex items-center gap-1 rounded-full bg-blue-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
        Most chosen
      </span>
    )}
    <p className={`text-sm font-medium ${featured ? "text-blue-300" : "text-blue-600"}`}>{name}</p>
    <p className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em]">{price}</p>
    <p className={`mt-1 text-xs ${featured ? "text-slate-400" : "text-slate-500"}`}>{cadence}</p>
    <p className={`mt-4 text-sm leading-relaxed ${featured ? "text-slate-300" : "text-slate-600"}`}>{body}</p>
    <ul className="mt-5 flex-1 space-y-2 text-sm">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${featured ? "text-blue-400" : "text-blue-600"}`} strokeWidth={2.5} />
          <span className={featured ? "text-slate-200" : "text-slate-700"}>{f}</span>
        </li>
      ))}
    </ul>
    <button
      onClick={onClick}
      className={`mt-7 inline-flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-all ${
        featured
          ? "bg-white text-slate-900 hover:bg-slate-100"
          : "bg-slate-900 text-white hover:bg-slate-800"
      }`}
    >
      {cta} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  </div>
);

// ──────────────────────────────────────────────────────────────
// FAQ — short list, accordion. Five questions the dealer
// principal actually asks during a 20-minute demo.
// ──────────────────────────────────────────────────────────────

const FAQ = () => {
  const items = [
    {
      q: "How fast can we get a rooftop live?",
      a: "Under an hour. Sign in, paste your DMS feed (or import a CSV), choose your state pack, and start publishing. We don't require a deploy or IT involvement.",
    },
    {
      q: "What happens when a regulator sends us a letter?",
      a: "Open the VIN, click Defend, hand counsel the Audit-Defense Packet. It contains the full record — disclosures, hashes, customer signatures, install photos, advertised-price snapshots — in a self-contained file ready for production.",
    },
    {
      q: "Does AutoLabels replace my window-sticker provider?",
      a: "Yes. The compliant sticker + addendum + customer disclosure live in one platform with one source of truth. No more two-vendor reconciliation.",
    },
    {
      q: "How are advertised-price mismatches detected?",
      a: "A nightly crawler reads your own dealer-website listings and reconciles each one against the sticker price on file. Drift past the tolerance you set produces a flag — before publish, before customer, before regulator.",
    },
    {
      q: "Is my customer data isolated from other dealerships?",
      a: "Always. Row-level security enforces tenant boundaries at the database. There is no shared table any other dealership can see.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="bg-slate-50/60">
      <div className="mx-auto max-w-3xl px-6 py-24 lg:px-8 lg:py-32">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">Common questions</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          Asked by every dealer principal.
        </h2>
        <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
          {items.map((it, i) => (
            <button
              key={it.q}
              onClick={() => setOpen(open === i ? null : i)}
              className="block w-full py-6 text-left"
            >
              <div className="flex items-start justify-between gap-6">
                <h3 className="text-base font-medium text-slate-900">{it.q}</h3>
                <ChevronDown className={`mt-1 h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${open === i ? "rotate-180" : ""}`} />
              </div>
              {open === i && (
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{it.a}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────────────────────
// Final CTA — short, declarative, single button. No social
// proof, no testimonials. The page already made the case.
// ──────────────────────────────────────────────────────────────

const FinalCTA = ({ onPrimary }: { onPrimary: () => void }) => (
  <section className="relative isolate overflow-hidden">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_60%,rgba(37,99,235,0.08),transparent_70%)]"
    />
    <div className="mx-auto max-w-4xl px-6 py-24 text-center lg:px-8 lg:py-32">
      <h2 className="font-display text-5xl font-semibold tracking-[-0.025em] text-slate-900 sm:text-6xl">
        Stop hoping. Start defending.
      </h2>
      <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">
        20 minutes with our team. Walk out with a Defense plan tailored to your rooftop.
      </p>
      <div className="mt-9 flex justify-center">
        <button
          onClick={onPrimary}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-900 px-8 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md"
        >
          Book a demo
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Footer — minimal, tasteful. Family positioning at the bottom.
// ──────────────────────────────────────────────────────────────

const Footer = ({ onNav }: { onNav: (to: string) => void }) => (
  <footer className="border-t border-slate-100 bg-white">
    <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <div className="grid gap-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo variant="full" size={28} />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
            The compliance operating system for franchise and independent dealerships.
            An <span className="font-semibold text-slate-900">Autocurb</span> family product.
          </p>
        </div>
        <FooterCol
          title="Platform"
          items={[
            { label: "How it works", href: "#platform" },
            { label: "Compliance", href: "#compliance" },
            { label: "Pricing", href: "#pricing" },
            { label: "FAQ", href: "#faq" },
          ]}
        />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Account</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><button onClick={() => onNav("/login")} className="text-slate-600 hover:text-slate-900 transition-colors">Sign in</button></li>
            <li><button onClick={() => onNav("/onboarding")} className="text-slate-600 hover:text-slate-900 transition-colors">Book a demo</button></li>
            <li><button onClick={() => onNav("/about")} className="text-slate-600 hover:text-slate-900 transition-colors">About</button></li>
          </ul>
        </div>
      </div>
      <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-100 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
        <p>© {new Date().getFullYear()} AutoLabels.io · All rights reserved.</p>
        <p>
          AutoLabels is FTC-aligned and a 50-state disclosure engine. This site does not constitute
          legal advice — work with your dealer counsel.
        </p>
      </div>
    </div>
  </footer>
);

const FooterCol = ({ title, items }: { title: string; items: { label: string; href: string }[] }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
    <ul className="mt-4 space-y-2.5 text-sm">
      {items.map((it) => (
        <li key={it.label}>
          <a href={it.href} className="text-slate-600 hover:text-slate-900 transition-colors">{it.label}</a>
        </li>
      ))}
    </ul>
  </div>
);

export default Landing;
