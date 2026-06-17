import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Seo from "@/components/Seo";
import Logo from "@/components/brand/Logo";
import {
  ArrowRight,
  ShieldCheck,
  Scan,
  FileText,
  Signature,
  BarChart3,
  Sparkles,
  Check,
  AlertTriangle,
  Gavel,
  Eye,
  Building2,
  QrCode,
  ChevronDown,
  BadgeCheck,
  Tag,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";

// ──────────────────────────────────────────────────────────────
// Landing — Wave 35. Pre-launch / waitlist positioning.
// Every CTA is "Schedule a demo" (primary) or "Book a demo"
// (secondary). One card system across the whole page.
// Legal discipline: "FTC-aligned" (CARS Rule was vacated 1/2025),
// "documents" consent (never "guarantees compliance"),
// "tamper-EVIDENT" (never -proof). No fabricated dealer names,
// quotes, or dollar amounts.
// ──────────────────────────────────────────────────────────────

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const goWaitlist = () => navigate(user ? "/dashboard" : "/onboarding");
  const goDemo = () => navigate("/onboarding?intent=demo");

  return (
    <div className="bg-white text-slate-900 antialiased selection:bg-blue-100">
      <Seo
        title="AutoLabels — Window Stickers, Addendums & Compliance"
        description="One website pricing mistake can trigger an FTC investigation, a complaint, or a lawsuit. AutoLabels catches pricing and disclosure gaps before regulators do."
        path="/"
      />
      <Nav user={user} onWaitlist={goWaitlist} onNav={navigate} />
      <main>
        <Hero onWaitlist={goWaitlist} onDemo={goDemo} />
        <TrustBand />
        <Risk />
        <TakeThePowerBack onWaitlist={goWaitlist} />
        <HowItWorks />
        <Principles />
        <PowerGrid />
        <SocialProof />
        <PricingTeaser onWaitlist={goWaitlist} onDemo={goDemo} />
        <FAQ />
        <FinalCTA onWaitlist={goWaitlist} onDemo={goDemo} />
      </main>
      <Footer onNav={navigate} onWaitlist={goWaitlist} />
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Nav
// ──────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "The risk", href: "#risk" },
  { label: "Take back power", href: "#power" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

const Nav = ({
  user,
  onWaitlist,
  onNav,
}: {
  user: unknown;
  onWaitlist: () => void;
  onNav: (to: string) => void;
}) => (
  <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
      <button onClick={() => onNav("/")} aria-label="AutoLabels home" className="flex items-center">
        <Logo variant="full" size={34} />
      </button>
      <div className="hidden items-center gap-7 md:flex">
        {NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} className="text-sm text-slate-600 transition-colors hover:text-slate-900">
            {l.label}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {user ? (
          <button
            onClick={() => onNav("/dashboard")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
          >
            Open dashboard <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <>
            <button
              onClick={() => onNav("/login")}
              className="hidden h-9 items-center px-3 text-sm text-slate-600 hover:text-slate-900 md:inline-flex"
            >
              Sign in
            </button>
            <button
              onClick={onWaitlist}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#0B2041] px-4 text-sm font-medium text-white hover:bg-[#13315e]"
            >
              Schedule a demo <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  </nav>
);

// ──────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────

const Hero = ({ onDemo }: { onWaitlist: () => void; onDemo: () => void }) => (
  <section className="relative isolate overflow-hidden border-b border-slate-100 bg-white">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-32 -z-10 h-[620px] [mask-image:radial-gradient(60%_60%_at_55%_30%,#000_40%,transparent_85%)]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(55%_50%_at_60%_25%,rgba(37,99,235,0.12),transparent_70%)]" />
    </div>

    <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-2 lg:gap-12 lg:px-8 lg:pb-24 lg:pt-20">
      <div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live website-price monitoring · FTC §5 aligned
        </div>
        <h1 className="font-display text-[40px] font-black leading-[1.02] tracking-tighter text-slate-900 sm:text-6xl">
          The FTC doesn&rsquo;t care if it was an{" "}
          <span className="text-blue-600">accident.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
          One website pricing mistake can trigger an investigation, customer complaints, chargebacks,
          and a class action. AutoLabels continuously verifies your advertised prices, disclosures,
          addendums, and customer sign-offs &mdash; before they become problems.
        </p>
        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
          <button
            onClick={onDemo}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0B2041] px-6 text-sm font-semibold text-white hover:bg-[#13315e]"
          >
            Schedule a demo
            <ArrowRight className="h-4 w-4" />
          </button>
          <a
            href="#how"
            className="inline-flex h-12 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            See how it works
          </a>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <HeroCheck icon={ShieldCheck} label="Website price monitoring" />
          <HeroCheck icon={FileText} label="FTC-aligned addendums" />
          <HeroCheck icon={Signature} label="Customer digital signatures" />
          <HeroCheck icon={BadgeCheck} label="Legal audit trails" />
          <HeroCheck icon={Building2} label="50-state compliance" />
        </div>
      </div>

      <div className="relative">
        <ComplianceStatusCard />
      </div>
    </div>
  </section>
);

const HeroCheck = ({ icon: Icon, label }: { icon: IconType; label: string }) => (
  <div className="flex items-center gap-2.5 text-sm text-slate-700">
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#2563EB]">
      <Icon className="h-3.5 w-3.5" />
    </span>
    <span className="font-medium">{label}</span>
  </div>
);

// Live "mission control" compliance dashboard — green verified rows,
// then a website scan that surfaces a red advertised-price mismatch.
const ComplianceStatusCard = () => (
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_90px_-25px_rgba(15,23,42,0.28)]">
    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-slate-500" />
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Compliance status</span>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
      </span>
    </div>
    <div className="divide-y divide-slate-100">
      <StatusRow label="Website pricing" sub="142 VINs reconciled to lot price" />
      <StatusRow label="Required disclosures" sub="50-state engine · current rule set" />
      <StatusRow label="Doc fee compliance" sub="At or under state cap on every deal" />
      <StatusRow label="Customer acknowledgements" sub="Signed, hash-sealed, geo-stamped" />
    </div>
    <div className="border-t border-slate-100 bg-slate-50/40 px-5 pb-5 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Website scan</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          <AlertTriangle className="h-3 w-3" /> 3 issues detected
        </span>
      </div>
      <AlertRow tone="red" title="Advertised price mismatch" detail="VIN 1HGCM826… · Lot $34,991 vs Site $32,995" />
      <AlertRow tone="amber" title="Missing disclosure" detail="2019 F-150 · Buyers Guide not attached" />
      <AlertRow tone="amber" title="Third-party price drift" detail="Marketplace listing $1,400 below sticker" />
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Scan className="h-3.5 w-3.5 text-[#2563EB]" /> Auto-flagged 02:14 AM &mdash; before a customer did.
      </p>
    </div>
  </div>
);

const StatusRow = ({ label, sub }: { label: string; sub: string }) => (
  <div className="flex items-center justify-between px-5 py-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <p className="truncate text-xs text-slate-500">{sub}</p>
    </div>
    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Verified
    </span>
  </div>
);

const AlertRow = ({ tone, title, detail }: { tone: "red" | "amber"; title: string; detail: string }) => {
  const styles = tone === "red" ? "border-red-200 bg-red-50/70" : "border-amber-200 bg-amber-50/60";
  const dot = tone === "red" ? "bg-red-500" : "bg-amber-500";
  const titleColor = tone === "red" ? "text-red-800" : "text-amber-800";
  return (
    <div className={`mb-2 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${styles}`}>
      <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${titleColor}`}>{title}</p>
        <p className="truncate text-xs text-slate-600">{detail}</p>
      </div>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between text-slate-600">
    <span>{label}</span>
    <span className="font-semibold text-slate-900 tabular-nums">{value}</span>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Trust band
// ──────────────────────────────────────────────────────────────

const TrustBand = () => (
  <section className="border-b border-slate-100 bg-slate-50/60">
    <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
        Built around the frameworks your attorney already cites
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 text-center text-sm font-medium text-slate-700 sm:grid-cols-3 lg:grid-cols-6">
        <span>FTC §5</span>
        <span>16 CFR Part 455</span>
        <span>Monroney Act</span>
        <span>E-SIGN / UETA</span>
        <span>CA SB 766</span>
        <span>50-state DMV</span>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Risk — the cost of getting labels wrong. No fabricated dollars.
// ──────────────────────────────────────────────────────────────

const Risk = () => (
  <section id="risk" className="border-b border-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">The risk</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          One bad label can cost you the lot.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          Regulators, state AGs, and plaintiffs&rsquo; attorneys are actively comparing your
          advertised price to your deal jacket — and the consequences land on the dealership, not
          the ad agency that built the site.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4" id="power">
        <Card icon={Gavel} title="FTC enforcement">
          FTC Act §5 and 16 CFR Part 455 target undisclosed add-ons, bait pricing, and missing consent.
          Investigations begin with a website crawl, not a customer complaint.
        </Card>
        <Card icon={AlertTriangle} title="Advertised-price liability">
          Selling a vehicle for more than the advertised price exposes the dealer to refunds,
          rescission, and state UDAP penalties — even when the mismatch was a typo.
        </Card>
        <Card icon={Eye} title="State AG audits">
          California (SB 766, eff. Oct 2026), Massachusetts, New York, and Maryland have active
          dealer enforcement units that pull records on demand.
        </Card>
        <Card icon={ShieldCheck} title="Recall exposure">
          Federal law restricts the sale of vehicles under open recalls. NHTSA campaign data must
          be checked at the time of sale, not at intake.
        </Card>
      </div>

      <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-700">
          <strong className="text-slate-900">AutoLabels is the shield.</strong> Continuous price
          reconciliation, 50-state disclosure engine, signed customer acknowledgements, and a
          tamper-evident audit log — so the regulator sees a clean record, not a missing one.
        </p>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// How it works — four verbs, unified card system.
// ──────────────────────────────────────────────────────────────

const HowItWorks = () => (
  <section id="how" className="border-b border-slate-100 bg-slate-50/40">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">How it works</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          Four verbs. One platform.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          The product is built around four actions. That&rsquo;s it.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-2 lg:grid-cols-4">
        <NumberedCard
          num="01"
          icon={Scan}
          title="Decode"
          body="VIN to full factory build sheet in under 800ms via NHTSA. Auto-pull year, make, model, trim, and standard equipment."
        />
        <NumberedCard
          num="02"
          icon={FileText}
          title="Stick"
          body="Build a fully-compliant dealer addendum with products, pricing, FTC disclosures, and state-specific doc fees in under a minute."
        />
        <NumberedCard
          num="03"
          icon={Signature}
          title="Sign"
          body="Customer scans a QR, signs on their phone, and every action lands in your audit log. No paper, no chasing signatures."
        />
        <NumberedCard
          num="04"
          icon={BarChart3}
          title="Close"
          body="Every scan becomes a lead. Every addendum becomes data. See what's selling, what's stuck, and what's closing — live."
        />
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Principles — unified card system.
// ──────────────────────────────────────────────────────────────

const PRINCIPLES = [
  {
    num: "01",
    title: "Clear",
    body: "Every price, every fee, every disclosure — in plain English. No mouse-print, no hidden math.",
  },
  {
    num: "02",
    title: "Compliant",
    body: "FTC-aligned. State-by-state. Bilingual where required. The rules change; the platform updates.",
  },
  {
    num: "03",
    title: "Consistent",
    body: "Every sticker, addendum, and Buyers Guide off your lot looks the same and signs the same way.",
  },
];

const Principles = () => (
  <section className="border-b border-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">What we believe</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          Three principles
        </h2>
      </div>
      <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <NumberedCard key={p.num} num={p.num} title={p.title} body={p.body} />
        ))}
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Power grid — features, same card system.
// ──────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: ShieldCheck, title: "FTC-aligned engine", body: "California SB 766 disclosures, multi-language support, 2-year record retention — built in." },
  { icon: Scan, title: "VIN decode + scrape", body: "NHTSA free decode or Black Book live market pricing. Or paste a VDP URL and let us scrape it." },
  { icon: Sparkles, title: "Rules engine", body: "Auto-assign products by year, make, model, trim, body style, or mileage. Set once, apply forever." },
  { icon: Signature, title: "Digital signing", body: "Customer signs on their phone via QR. Every signature is cryptographically logged for audits." },
  { icon: FileText, title: "Buyers Guide", body: "FTC As-Is / Implied / Warranty guides in English + Spanish. Satisfies federal and state requirements." },
  { icon: BarChart3, title: "Live analytics", body: "Product acceptance rates, revenue per addendum, top hooks — every signal that matters." },
];

const PowerGrid = () => (
  <section className="border-b border-slate-100 bg-slate-50/40">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Under the hood</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          Power where you need it
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-700">
          Compliance-grade tools, premium UX, zero learning curve.
        </p>
      </div>
      <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title} icon={f.icon} title={f.title}>
            {f.body}
          </Card>
        ))}
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Take the power back — the pivot. Two pillars: provable add-on
// election and price integrity. Anchored at #power for the nav.
// ──────────────────────────────────────────────────────────────

const TakeThePowerBack = ({ onWaitlist }: { onWaitlist: () => void }) => (
  <section id="power" className="border-b border-slate-100 bg-white">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Take the power back</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          The FTC made you play defense.
          <br className="hidden sm:block" /> Take the power back.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-700">
          Scared of complaints, dealers stopped pitching add-ons and stopped putting a real price in
          writing. AutoLabels flips it: prove the customer chose it, prove you honored the price.
        </p>
      </div>

      <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-blue-200 bg-blue-50/50 p-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">For the dealer who sells it, not pre-installs it</p>
        <h3 className="mt-2 font-display text-2xl font-black tracking-tight text-slate-900">
          You sell exterior &amp; interior protection — and install it when the car is delivered.
        </h3>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          You did everything right. The customer wanted it, you sold it, you installed it. Then weeks
          later comes the call: <em>&ldquo;I never agreed to that,&rdquo;</em> or <em>&ldquo;your
          salesperson told me it was required.&rdquo;</em> Until now an honest dealer had no way to
          answer that — no pre-installed product to point to, just word against word in an
          FTC-hostile market.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          Now you have the receipt. Before delivery, the customer sees each product priced, sees it
          marked <strong>optional and not required to buy, lease, or finance</strong>, sees the
          benefit, initials it, and e-signs — captured with a tamper-evident hash, timestamp, IP, and
          the exact disclosures shown. When the buyer&rsquo;s-remorse call comes, you can prove the
          customer opted in.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {["Can you prove the customer opted in?", "Can you show it was never mandatory?", "Now you can."].map((c, i) => (
            <span key={c} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${i === 2 ? "bg-[#0B2041] text-white" : "bg-white text-slate-700 border border-slate-200"}`}>
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-5 lg:grid-cols-2">
        <PowerPillar
          icon={BadgeCheck}
          eyebrow="Profitable add-on election"
          title="Sell add-ons without fear."
          body="F&I is your most profitable revenue — and your most exposed. AutoLabels captures per-item, informed election: the customer sees each product's price, sees it's optional, sees the benefit, and signs. Every yes is provable."
          chips={["$2,534 avg F&I gross per vehicle", "Napleton: 83% charged without consent"]}
          punch="Every yes, provable."
        />
        <PowerPillar
          icon={Tag}
          eyebrow="Price integrity"
          title="Own your price. Prove you honored it."
          body="The FTC reframed your posted price as a binding commitment. AutoLabels locks one price across your site, the lot, and the desk, then seals a tamper-evident record that you honored it."
          chips={["97 dealer groups warned, Mar 2026", "Buyers pay ~$1,117 to skip the games"]}
          punch="Priced in ink, not pencil."
        />
      </div>

      <div className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-4 text-center">
        <p className="text-xs leading-relaxed text-slate-500">
          Tamper-evident, not tamper-proof. AutoLabels documents informed election and strengthens
          your position under FTC Act §5 &mdash; it does not guarantee the outcome of a dispute.
        </p>
        <button
          onClick={onWaitlist}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0B2041] px-6 text-sm font-semibold text-white hover:bg-[#13315e]"
        >
          Schedule a demo
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  </section>
);

const PowerPillar = ({
  icon: Icon,
  eyebrow,
  title,
  body,
  chips,
  punch,
}: {
  icon: IconType;
  eyebrow: string;
  title: string;
  body: string;
  chips: string[];
  punch: string;
}) => (
  <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-[#2563EB]">
      <Icon className="h-5 w-5" />
    </div>
    <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
    <h3 className="mt-1.5 font-display text-2xl font-black tracking-tight text-slate-900">{title}</h3>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">{body}</p>
    <div className="mt-5 flex flex-wrap gap-2">
      {chips.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> {c}
        </span>
      ))}
    </div>
    <p className="mt-6 border-t border-slate-100 pt-4 font-display text-base font-bold text-slate-900">{punch}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Social proof — placeholders clearly marked.
// ──────────────────────────────────────────────────────────────

const SocialProof = () => (
  <section className="border-b border-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Early access</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          Built with dealers, for dealers.
        </h2>
      </div>

      {/* Dealer logo strip — placeholders */}
      <div className="mx-auto mt-12 max-w-5xl">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
          Pilot dealer groups · logos to follow
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex h-14 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] font-medium uppercase tracking-wider text-slate-400"
            >
              Dealer logo
            </div>
          ))}
        </div>
      </div>

      {/* Testimonial placeholder + credential badge */}
      <div className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Pilot quote · placeholder
          </p>
          <blockquote className="mt-3 text-lg font-medium leading-relaxed text-slate-800">
            &ldquo;Dealer testimonial coming soon. We&rsquo;re onboarding pilot groups now &mdash;
            quotes will appear here once they&rsquo;re live and approved.&rdquo;
          </blockquote>
          <p className="mt-4 text-xs text-slate-500">— Pilot dealer, name pending approval</p>
        </div>
        <div className="flex flex-col justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0B2041] to-[#13315e] p-6 text-white shadow-sm">
          <ShieldCheck className="h-7 w-7 text-[#3BB4FF]" />
          <p className="mt-3 font-display text-lg font-bold tracking-tight">FTC-aligned</p>
          <p className="text-sm text-white/70">50-state disclosure engine</p>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">
            Compliance credential
          </p>
        </div>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Pricing teaser
// ──────────────────────────────────────────────────────────────

const TIERS = [
  { name: "Essential", body: "Single-store dealers. Stickers, addendums, signing, audit log." },
  { name: "Defense", body: "Adds website price monitoring, FTC §5 defense pack, and recall guard.", featured: true },
  { name: "Group", body: "Multi-rooftop. SSO, group analytics, custom rules, dedicated success." },
];

const PricingTeaser = ({
  onWaitlist,
  onDemo,
}: {
  onWaitlist: () => void;
  onDemo: () => void;
}) => (
  <section id="pricing" className="border-b border-slate-100 bg-slate-50/40">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Pricing</p>
        <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
          Three tiers. Early-access pricing.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Early dealers lock in launch pricing. Full pricing publishes at GA.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`rounded-2xl border bg-white p-6 shadow-sm ${
              t.featured ? "border-[#2563EB] ring-1 ring-[#2563EB]" : "border-slate-200"
            }`}
          >
            <h3 className="font-display text-xl font-bold tracking-tight text-slate-900">{t.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.body}</p>
            <div className="mt-5">
              {t.featured ? (
                <button
                  onClick={onWaitlist}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-[#0B2041] px-4 text-sm font-semibold text-white hover:bg-[#13315e]"
                >
                  Schedule a demo
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={onDemo}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Book a demo
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex justify-center">
        <button
          onClick={onWaitlist}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[#0B2041] px-6 text-sm font-semibold text-white hover:bg-[#13315e]"
        >
          See pricing &amp; book a demo
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// FAQ
// ──────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: "When does AutoLabels launch?",
    a: "We're in pilot now with select dealer groups. General availability rolls out through 2026. Early-access dealers get first access and locked-in early pricing.",
  },
  {
    q: "Is this FTC compliant?",
    a: "The FTC CARS Rule was vacated by the 5th Circuit in January 2025. We build to the underlying FTC §5 framework, 16 CFR Part 455, the Monroney Act, E-SIGN/UETA, and California SB 766 (eff. October 2026). AutoLabels documents your compliance posture — it does not provide legal advice.",
  },
  {
    q: "What does it replace?",
    a: "Your sticker printer, addendum builder, Buyers Guide template, and signing pad — plus the spreadsheet you use to reconcile site prices to lot prices.",
  },
  {
    q: "Do I need to swap my DMS?",
    a: "No. AutoLabels reads from your existing DMS / inventory feed and writes back signed deal jackets. We don't replace your DMS.",
  },
];

const FAQ = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="border-b border-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-20 lg:px-8">
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">FAQ</p>
          <h2 className="mt-3 font-display text-4xl font-black tracking-tighter text-slate-900 sm:text-5xl">
            Questions, answered.
          </h2>
        </div>
        <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {FAQS.map((f, i) => (
            <button
              key={i}
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full px-6 py-5 text-left transition-colors hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-base font-semibold text-slate-900">{f.q}</span>
                <ChevronDown
                  className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${
                    open === i ? "rotate-180" : ""
                  }`}
                />
              </div>
              {open === i && <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────────────────────
// Final CTA
// ──────────────────────────────────────────────────────────────

const FinalCTA = ({ onWaitlist, onDemo }: { onWaitlist: () => void; onDemo: () => void }) => (
  <section className="px-6 py-20 lg:px-8">
    <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B2041] via-[#13315e] to-[#0B2041] px-8 py-20 text-center text-white lg:px-16">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-[#3BB4FF]/25 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-[#2563EB]/25 blur-3xl" />
      </div>
      <div className="relative">
        <h2 className="font-display text-4xl font-black tracking-tighter sm:text-5xl">
          Schedule a demo.
        </h2>
        <p className="mt-5 text-lg text-white/70">Be first in line · Early-access pricing.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onWaitlist}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-950 hover:bg-white/90"
          >
            Schedule a demo
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={onDemo}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white hover:bg-white/10"
          >
            Book a demo
          </button>
        </div>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────

const Footer = ({ onNav, onWaitlist }: { onNav: (to: string) => void; onWaitlist: () => void }) => (
  <footer className="border-t border-slate-100 px-6 py-10 lg:px-8">
    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
      <Logo variant="full" size={24} />
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} className="hover:text-slate-900">
            {l.label}
          </a>
        ))}
        <button onClick={() => onNav("/login")} className="hover:text-slate-900">Sign in</button>
        <button
          onClick={onWaitlist}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0B2041] px-3 text-xs font-medium text-white hover:bg-[#13315e]"
        >
          Schedule a demo
        </button>
      </div>
      <p className="text-xs text-slate-500">
        © {new Date().getFullYear()} AutoLabels.io · Clear. Compliant. Consistent.
      </p>
    </div>
  </footer>
);

// ──────────────────────────────────────────────────────────────
// Unified card primitives — used across every section.
// ──────────────────────────────────────────────────────────────

type IconType = typeof Scan;

const Card = ({
  icon: Icon,
  title,
  children,
}: {
  icon: IconType;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-[#2563EB]">
      <Icon className="h-5 w-5" />
    </div>
    <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{children}</p>
  </div>
);

const NumberedCard = ({
  num,
  icon: Icon,
  title,
  body,
}: {
  num: string;
  icon?: IconType;
  title: string;
  body: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <div className="flex items-center justify-between">
      {Icon ? (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#3BB4FF] via-[#2563EB] to-[#0B2041] text-white">
          <Icon className="h-5 w-5" />
        </div>
      ) : (
        <Building2 className="h-5 w-5 text-slate-300" />
      )}
      <span className="font-display text-xs font-bold tabular-nums text-[#2563EB]">{num}</span>
    </div>
    <h3 className="mt-4 font-display text-xl font-bold tracking-tight text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
  </div>
);

export default Landing;
