import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Seo from "@/components/Seo";
import Logo from "@/components/brand/Logo";
import {
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Lock,
  FileCheck,
  TrendingUp,
  ChevronDown,
  Sparkles,
  Check,
  Building2,
  Globe,
  PenLine,
  ScanLine,
  Wrench,
  Scale,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Landing — Wave 33 redesign.
//
// Brief shift from Wave 32: dealers don't lie awake worried about
// "compliance" — they worry about FTC letters, AG complaints,
// consumer lawsuits, chargebacks, and a customer screenshotting a
// price mismatch. So the page leads with the reality, not the
// product noun. Vanta / Stripe / Apple tier: a hard-hitting
// two-column hero with a LIVE compliance-status dashboard on the
// right, a "what keeps dealers up at night" fear section, and a
// Risk -> Detection -> Correction -> Proof -> Defense story arc.
//
// Legal discipline is unchanged: tamper-EVIDENT (never -proof),
// presumptively valid under ESIGN/UETA, "documents" consent (never
// "guarantees compliance"), "FTC-aligned" (CARS Rule was vacated).
// ──────────────────────────────────────────────────────────────

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="bg-white text-slate-900 antialiased selection:bg-blue-100 selection:text-slate-900">
      <Nav user={user} onNav={navigate} />
      <Hero onPrimary={() => navigate(user ? "/dashboard" : "/onboarding")} />
      <TrustBand />
      <Reality />
      <UpAtNight />
      <StoryArc />
      <AppleMoment />
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
        <Logo variant="full" size={38} />
      </button>
      <div className="hidden items-center gap-8 md:flex">
        <a href="#risk" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">The risk</a>
        <a href="#platform" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">How it works</a>
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
              Schedule a demo <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  </nav>
);

// ──────────────────────────────────────────────────────────────
// Hero — two columns. Left: hard-hitting headline + the reality
// subhead + dual CTA + five-check proof row. Right: a live
// compliance-status dashboard that shows the nightmare being
// caught in real time. The dealer should think "that's my lot."
// ──────────────────────────────────────────────────────────────

const Hero = ({ onPrimary }: { onPrimary: () => void }) => (
  <section className="relative isolate overflow-hidden">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[700px] [mask-image:radial-gradient(70%_60%_at_50%_30%,#000_40%,transparent_85%)]"
    >
      <div className="absolute inset-x-0 top-0 h-full bg-[radial-gradient(60%_50%_at_60%_25%,rgba(37,99,235,0.12),transparent_70%)]" />
    </div>

    <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-20 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:pb-28 lg:pt-24">
      {/* Left — copy */}
      <div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live website-price monitoring · FTC §5 aligned
        </div>
        <h1 className="font-display text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] text-slate-900 sm:text-5xl lg:text-6xl">
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
            onClick={onPrimary}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md"
          >
            Schedule a demo
            <ArrowRight className="h-4 w-4" />
          </button>
          <a
            href="#platform"
            className="inline-flex h-12 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-6 text-sm font-medium text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
          >
            See how it works
          </a>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <HeroCheck icon={Globe} label="Website price monitoring" />
          <HeroCheck icon={FileCheck} label="FTC-aligned addendums" />
          <HeroCheck icon={PenLine} label="Customer digital signatures" />
          <HeroCheck icon={ShieldCheck} label="Legal audit trails" />
          <HeroCheck icon={Building2} label="50-state compliance" />
        </div>
      </div>

      {/* Right — live compliance dashboard */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-tr from-blue-100/40 via-transparent to-emerald-100/30 blur-2xl"
        />
        <ComplianceStatusCard />
      </div>
    </div>
  </section>
);

const HeroCheck = ({ icon: Icon, label }: { icon: typeof Globe; label: string }) => (
  <div className="flex items-center gap-2.5 text-sm text-slate-700">
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
    </span>
    <span className="font-medium">{label}</span>
  </div>
);

// ──────────────────────────────────────────────────────────────
// ComplianceStatusCard — the Vanta-style "mission control" panel.
// Green verified rows build the calm, then a live website scan
// surfaces a red advertised-price mismatch. This is the single
// most persuasive object on the page: the dealer sees their own
// nightmare get caught before a customer or a regulator finds it.
// ──────────────────────────────────────────────────────────────

const ComplianceStatusCard = () => (
  <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_90px_-25px_rgba(15,23,42,0.28)]">
    {/* Title bar */}
    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-3.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-slate-500" />
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Compliance status</span>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live
      </span>
    </div>

    {/* Verified rows */}
    <div className="divide-y divide-slate-100">
      <StatusRow label="Website pricing" sub="142 VINs reconciled to lot price" state="ok" />
      <StatusRow label="Required disclosures" sub="50-state engine · current rule set" state="ok" />
      <StatusRow label="Doc fee compliance" sub="At or under state cap on every deal" state="ok" />
      <StatusRow label="Customer acknowledgements" sub="Signed, hash-sealed, geo-stamped" state="ok" />
    </div>

    {/* Live website scan with a flagged mismatch */}
    <div className="border-t border-slate-100 bg-slate-50/40 px-5 pb-5 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Website scan</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          3 issues detected
        </span>
      </div>
      <AlertRow
        tone="red"
        title="Advertised price mismatch"
        detail="VIN 1HGCM826… · Lot $34,991 vs Site $32,995"
      />
      <AlertRow
        tone="amber"
        title="Missing disclosure"
        detail="2019 F-150 · Buyers Guide not attached"
      />
      <AlertRow
        tone="amber"
        title="Third-party price drift"
        detail="Marketplace listing $1,400 below sticker"
      />
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <ScanLine className="h-3.5 w-3.5 text-blue-600" />
        Auto-flagged 02:14 AM &mdash; before a customer did.
      </p>
    </div>
  </div>
);

const StatusRow = ({ label, sub, state }: { label: string; sub: string; state: "ok" }) => (
  <div className="flex items-center justify-between px-5 py-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <p className="truncate text-xs text-slate-500">{sub}</p>
    </div>
    <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
      Verified
    </span>
  </div>
);

const AlertRow = ({ tone, title, detail }: { tone: "red" | "amber"; title: string; detail: string }) => {
  const styles =
    tone === "red"
      ? "border-red-200 bg-red-50/70"
      : "border-amber-200 bg-amber-50/60";
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

// ──────────────────────────────────────────────────────────────
// Trust band — the frameworks a compliance manager already cites.
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
        <span>E-SIGN / UETA</span>
        <span>CA CARS Act</span>
        <span>50-state DMV</span>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Reality — the FTC is already looking. Verified, sourced stakes.
// ──────────────────────────────────────────────────────────────

const Reality = () => (
  <section id="risk" className="relative">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">The reality</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          The FTC is already crawling dealer websites.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          This isn&rsquo;t a someday risk. Regulators, state AGs, and plaintiffs&rsquo; attorneys are
          actively comparing your advertised price to your deal jacket &mdash; right now.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-6 sm:grid-cols-3">
        <Stat number="97" label="dealer groups the FTC warned in March 2026 for advertising one price, then charging another" />
        <Stat number="$1.5M–$10M" label="refunds and penalties in recent FTC cases against dealers who didn't honor advertised prices" />
        <Stat number="Oct 2026" label="California's CARS Act takes effect: up-front total pricing, no-benefit add-on ban, 24-month records" />
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
        Sources: FTC press release, Mar 13 2026 · FTC v. Napleton ($10M, 2022), Passport ($3.38M, 2022),
        Bronx Honda ($1.5M, 2020) · CA SB 766, Chapter 354, Statutes of 2025
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
// UpAtNight — the fears, named plainly. Each card is the dealer's
// actual nightmare and its consequence. Closes with the promise.
// ──────────────────────────────────────────────────────────────

const UpAtNight = () => (
  <section className="bg-slate-900 text-slate-100">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-400">What keeps dealers up at night</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-white sm:text-5xl">
          It&rsquo;s never the deal you remember.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-400">
          It&rsquo;s the one nobody caught &mdash; a number that didn&rsquo;t match, a form that
          didn&rsquo;t print, a signature you can&rsquo;t produce.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Nightmare title="Website price doesn't match the deal jacket" consequence="The customer screenshots it." />
        <Nightmare title="A required disclosure is missing" consequence="A complaint gets filed." />
        <Nightmare title="The wrong addendum prints" consequence="Audit exposure." />
        <Nightmare title="No proof the customer acknowledged" consequence="Your word against theirs." />
        <Nightmare title="An incentive price displays wrong" consequence="An FTC pricing issue." />
        <Nightmare title="A third-party site drifts off your price" consequence="Nobody noticed. Until now." />
      </div>

      <div className="mx-auto mt-14 flex max-w-2xl items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center">
        <ShieldCheck className="h-5 w-5 flex-shrink-0 text-emerald-400" />
        <p className="text-base font-medium text-white sm:text-lg">
          AutoLabels catches every one &mdash; automatically, on every vehicle.
        </p>
      </div>
    </div>
  </section>
);

const Nightmare = ({ title, consequence }: { title: string; consequence: string }) => (
  <div className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/20 hover:bg-white/[0.06]">
    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
      <AlertTriangle className="h-4 w-4" strokeWidth={2} />
    </div>
    <h3 className="mt-4 text-base font-semibold leading-snug text-white">{title}</h3>
    <p className="mt-2 text-sm font-medium text-red-300/90">{consequence}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// StoryArc — the real narrative: Risk -> Detection -> Correction
// -> Proof -> Defense. Replaces the old "four pillars" framing.
// ──────────────────────────────────────────────────────────────

const StoryArc = () => (
  <section id="platform" className="relative bg-slate-50/60">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-blue-600">How it works</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-5xl">
          From exposure to defended &mdash; on every VIN.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          AutoLabels runs the same loop on every vehicle, so a non-compliant deal can&rsquo;t quietly
          slip through to a customer.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-5">
        <StoryStep n="01" icon={AlertTriangle} title="Risk" body="Every VIN, price, and disclosure on your lot is potential exposure." />
        <StoryStep n="02" icon={ScanLine} title="Detection" body="We crawl your sites nightly and check every sticker against the rules in force that day." />
        <StoryStep n="03" icon={Wrench} title="Correction" body="Drift is flagged to you with the fix — before publish, before the customer." />
        <StoryStep n="04" icon={FileCheck} title="Proof" body="The customer signs; we capture a tamper-evident, geo-stamped record of what they saw." />
        <StoryStep n="05" icon={Scale} title="Defense" body="One click produces the Audit-Defense Packet for counsel, the DMV, or the FTC." />
      </div>
    </div>
  </section>
);

const StoryStep = ({ n, icon: Icon, title, body }: { n: string; icon: typeof ScanLine; title: string; body: string }) => (
  <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <span className="absolute right-5 top-5 font-display text-xs font-bold tracking-[0.12em] text-slate-300">{n}</span>
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
      <Icon className="h-5 w-5" strokeWidth={2} />
    </div>
    <h3 className="mt-5 font-display text-lg font-semibold tracking-[-0.01em] text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// AppleMoment — one beautiful screen. "Compliance. Verified."
// over the Audit-Defense Packet. Minimal copy, maximal object.
// ──────────────────────────────────────────────────────────────

const AppleMoment = () => (
  <section className="relative">
    <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-5xl font-semibold tracking-[-0.03em] text-slate-900 sm:text-6xl">
          Compliance. <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">Verified.</span>
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          When the letter arrives, you&rsquo;ve already answered it. One VIN, one click, one signed
          file &mdash; the record every other section of the platform produces in the background.
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
              <PacketBlock label="Sold" value="Jun 02, 2026" caption="Signed 14:08 PDT · Glendale, CA" />
              <PacketBlock label="Hash root" value="0x4e8a…b21f" caption="SHA-256 chain · geo-stamped" />
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
        eyebrow="Advertised-price match"
        title="Your sticker and your ad agree — or you hear about it first."
        body="The FTC's March 2026 letters went to 97 dealer groups who advertised one price and charged another. AutoLabels crawls your own listings every night and reconciles each one against the price on the sticker. Drift gets flagged to you — not mailed to you by a regulator."
        bullets={[
          "Nightly crawl of your dealer-website and marketplace prices",
          "Tolerance gate flags any mismatch before the customer sees it",
          "Two-year price-snapshot history per VIN — CA CARS Act ready",
        ]}
      />
      <FeatureBlock
        eyebrow="Signed, geo-stamped sign-off"
        title="The customer signs the deal was fair — and it sticks."
        body="At delivery, the customer signs a plain-language disclosure that the price matched, the add-ons were optional, and nothing was hidden. Each signature is captured with IP, approximate location, device, consent text, and time, then SHA-256 hashed into a tamper-evident chain. It is the contemporaneous, presumptively-valid record under ESIGN and UETA that documents informed consent — the evidence courts actually rely on when a signature is challenged."
        bullets={[
          "Signed at the point of sale on the customer's own device",
          "IP, location, device, consent text, and timestamp captured",
          "SHA-256 hash chain — tamper-evident, self-authenticating record",
          "Bilingual disclosures for Spanish-conducted sales (16 CFR 455)",
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
          body="Every signing produces a SHA-256 hash anchored to the prior signing, stamped with IP, approximate location, and time — the chain root is what survives the deposition."
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
// FAQ — short list, accordion. The questions a dealer principal
// actually asks during a 20-minute demo.
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
      a: "Yes — and it does the part they don't. Every other sticker tool stops at the printout: a label in the window, then it walks away. AutoLabels prints the compliant sticker, addendum, and Buyers Guide, then captures the customer's signed sign-off, checks the price against your online ad, and seals the whole deal in one defensible record. One source of truth, no two-vendor reconciliation.",
    },
    {
      q: "How are advertised-price mismatches detected?",
      a: "A nightly crawler reads your own dealer-website listings and reconciles each one against the sticker price on file. Drift past the tolerance you set produces a flag — before publish, before customer, before regulator.",
    },
    {
      q: "Does a signed disclosure guarantee we're FTC-compliant?",
      a: "No tool can promise that — and be skeptical of any that does. The FTC is explicit that a signature alone is not a safe harbor, and compliance depends on how you actually sell. What AutoLabels gives you is the contemporaneous, tamper-evident evidence that you disclosed clearly and the customer acknowledged it: a record that is presumptively valid under ESIGN and UETA and designed to strengthen your position under FTC Act Section 5 if a deal is ever questioned. Compliance is how you sell; we make it provable.",
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
// Final CTA — the emotional close. The reaction we want is
// "I'd rather have this than not have it."
// ──────────────────────────────────────────────────────────────

const FinalCTA = ({ onPrimary }: { onPrimary: () => void }) => (
  <section className="relative isolate overflow-hidden">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_60%,rgba(37,99,235,0.08),transparent_70%)]"
    />
    <div className="mx-auto max-w-4xl px-6 py-24 text-center lg:px-8 lg:py-32">
      <div className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h2 className="font-display text-4xl font-semibold tracking-[-0.025em] text-slate-900 sm:text-6xl">
        If the FTC came knocking tomorrow,
        <br className="hidden sm:block" />
        would you rather have this &mdash; or not?
      </h2>
      <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">
        20 minutes with our team. Walk out with a Defense plan tailored to your rooftop.
      </p>
      <div className="mt-9 flex justify-center">
        <button
          onClick={onPrimary}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-900 px-8 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md"
        >
          Schedule a demo
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
          <Logo variant="full" size={38} />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
            The compliance operating system for franchise and independent dealerships.
            An <span className="font-semibold text-slate-900">Autocurb</span> family product.
          </p>
        </div>
        <FooterCol
          title="Platform"
          items={[
            { label: "The risk", href: "#risk" },
            { label: "How it works", href: "#platform" },
            { label: "Pricing", href: "#pricing" },
            { label: "FAQ", href: "#faq" },
          ]}
        />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Account</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><button onClick={() => onNav("/login")} className="text-slate-600 hover:text-slate-900 transition-colors">Sign in</button></li>
            <li><button onClick={() => onNav("/onboarding")} className="text-slate-600 hover:text-slate-900 transition-colors">Schedule a demo</button></li>
            <li><button onClick={() => onNav("/about")} className="text-slate-600 hover:text-slate-900 transition-colors">About</button></li>
          </ul>
        </div>
      </div>
      <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-100 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
        <p>© {new Date().getFullYear()} AutoLabels.io · All rights reserved.</p>
        <p>
          AutoLabels is FTC-aligned and a 50-state disclosure engine. It captures and preserves an
          evidentiary record; it does not provide legal advice or guarantee the outcome of any
          dispute. Work with your dealer counsel.
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
