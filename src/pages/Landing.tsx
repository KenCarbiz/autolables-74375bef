import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Seo from "@/components/Seo";
import Logo from "@/components/brand/Logo";
import LandingIcon from "@/components/brand/LandingIcon";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowRight,
  ShieldCheck,
  Scan,
  FileText,
  BarChart3,
  Sparkles,
  Check,
  AlertTriangle,
  Gavel,
  QrCode,
  ChevronDown,
  BadgeCheck,
  Tag,
  CheckCircle2,
  Lock,
  Palette,
  Menu,
  X,
  Zap,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// Landing — Wave 35. Pre-launch / waitlist positioning.
// Every CTA is "Request Early Access" (matches the /waitlist form verb)
// (secondary). One card system across the whole page.
// Legal discipline: "FTC-aligned" (CARS Rule was vacated 1/2025),
// "documents" consent (never "guarantees compliance"),
// "tamper-EVIDENT" (never -proof). No fabricated dealer names,
// quotes, or dollar amounts.
// ──────────────────────────────────────────────────────────────

// The most convincing demo is the real customer artifact — the sample
// Vehicle Passport rendered with placeholder data (no signup required).
const DEMO_TO = "/v/demo?preview=1";

// Landing icon system — final locked SVGs committed in /public (blue gradient
// tile, white glyph, transparent canvas). Rendered bare via LandingIcon: the
// tile is baked into the SVG, so no wrapper box or background is ever added.
const landingIcons = {
  ftcEnforcement: "/ftc_enforcement_gavel_shield_icon_transparent.svg",
  advertisedPriceLiability: "/advertised_price_liability_icon_transparent.svg",
  stateAgAudits: "/state_ag_audit_icon_transparent.svg",
  recallExposure: "/recall_exposure_alert_icon_transparent.svg",

  sellAddonsWithoutFear: "/sell_addons_without_fear_icon_transparent.svg",
  ownYourPrice: "/own_your_price_icon_transparent.svg",
  signedProof: "/sign_signature_icon_transparent.svg",
  auditDefenseFile: "/audit_defense_file_icon_transparent.svg",

  decode: "/decode_vin_scan_icon_transparent.svg",
  stick: "/stick_label_icon_transparent.svg",
  sign: "/sign_signature_icon_transparent.svg",
  close: "/close_sales_intelligence_icon_transparent.svg",

  vehicleArrives: "/vehicle_arrives_scan_icon_transparent.svg",
  getReadyQueues: "/get_ready_queue_icon_transparent.svg",
  installersProveWork: "/verified_camera_icon_transparent.svg",
  foremanSignsOff: "/foreman_signoff_icon_transparent.svg",
  rightStickerGoesOut: "/right_sticker_goes_out_icon_transparent.svg",

  websitePriceMonitoring: "/website_price_monitoring_icon_transparent.svg",
  windowStickersVehiclePassports: "/window_stickers_vehicle_passports_icon_transparent.svg",
  tamperEvidentAuditTrail: "/tamper_evident_audit_trail_icon_transparent.svg",
  ftcAlignedAddendums: "/ftc_aligned_addendums_icon_transparent.svg",
  customerDigitalSignatures: "/customer_digital_signatures_icon_transparent.svg",
  fiftyStateDisclosureEngine: "/fifty_state_disclosure_engine_icon_transparent.svg",
};


const Landing = () => {
  const { user } = useAuth();
  // Real anchors (not JS buttons) so /waitlist is crawlable, middle-clickable,
  // and announced as a link. Logged-in dealers go straight to the dashboard.
  const waitTo = user ? "/dashboard" : "/waitlist";

  return (
    <div className="bg-white text-slate-900 antialiased selection:bg-blue-100">
      <Seo
        title="AutoLabels — Window Stickers, Addendums & Compliance"
        description="One website pricing mistake can trigger an FTC investigation, a complaint, or a lawsuit. AutoLabels catches pricing and disclosure gaps before regulators do."
        path="/"
      />
      <Nav user={user} waitTo={waitTo} />
      <main>
        <Hero waitTo={waitTo} />
        <WhyNow />
        <TrustBand />
        <Risk />
        <TakeThePowerBack waitTo={waitTo} />
        <HowItWorks />
        <StickerStudioGallery />
        <VehiclePassportSection waitTo={waitTo} />
        <WhereWeFit />
        <SocialProof />
        <FAQ />
        <PricingTeaser waitTo={waitTo} />
        <FinalCTA waitTo={waitTo} />
      </main>
      <Footer waitTo={waitTo} />
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Nav
// ──────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "The risk", href: "#risk" },
  { label: "Take the power back", href: "#power" },
  { label: "How it works", href: "#how" },
  { label: "Compare", href: "#compare" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

// Link row needs ~1150px to fit; below xl a hamburger sheet carries the
// section links and Sign in so tablets and phones always have navigation.
const Nav = ({ user, waitTo }: { user: unknown; waitTo: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="AutoLabels home" className="flex shrink-0 items-center">
          <span className="sm:hidden"><Logo variant="full" size={24} /></span>
          <span className="hidden sm:inline-flex"><Logo variant="full" size={34} /></span>
        </Link>
        <div className="hidden items-center gap-7 xl:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="whitespace-nowrap text-sm text-slate-600 transition-colors hover:text-slate-900">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Open dashboard <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden h-9 items-center px-3 text-sm text-slate-600 hover:text-slate-900 xl:inline-flex"
              >
                Sign in
              </Link>
              <Link
                to={waitTo}
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#2563EB] px-2.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] sm:px-4 sm:text-sm"
              >
                <span className="hidden sm:inline">Request Early Access</span>
                <span className="sm:hidden">Early access</span>
                <ArrowRight className="hidden h-3.5 w-3.5 sm:inline" />
              </Link>
              <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label={open ? "Close menu" : "Open menu"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50 xl:hidden"
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-white px-6 pb-4 pt-2 xl:hidden">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900">
              {l.label}
            </a>
          ))}
          <Link to="/login" className="block py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900">
            Sign in
          </Link>
        </div>
      )}
    </nav>
  );
};

// ──────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────

const Hero = ({ waitTo }: { waitTo: string }) => (
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
          FTC warned 97 dealer groups &mdash; March 2026
        </div>
        <h1 className="font-barlow-condensed text-[44px] font-extrabold uppercase leading-[0.98] tracking-[0.01em] text-slate-900 sm:text-7xl">
          The field is level.{" "}
          <span className="text-blue-600">Now you win on trust.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
          The FTC ended the pricing games &mdash; every store has to advertise straight now. That is
          your opening. AutoLabels gives every vehicle a branded QR Vehicle Passport that answers a
          shopper&rsquo;s questions before they ask, keeps them in your ecosystem, and turns every scan
          into insight your team can act on &mdash; while one tamper-evident record per VIN, from
          website price to signature, keeps you covered.
        </p>
        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
          <Link
            to={waitTo}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[#2563EB] px-6 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            Request Early Access
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#how"
            className="inline-flex h-12 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            See how it works
          </a>
        </div>
        <p className="mt-3 text-xs text-slate-500">Free to join · no card required · locks early-access pricing.</p>
        <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <HeroCheck iconSrc={landingIcons.websitePriceMonitoring} label="Website price monitoring" />
          <HeroCheck iconSrc={landingIcons.ftcAlignedAddendums} label="FTC-aligned addendums" />
          <HeroCheck iconSrc={landingIcons.windowStickersVehiclePassports} label="Window stickers + Vehicle Passports" />
          <HeroCheck iconSrc={landingIcons.customerDigitalSignatures} label="Customer digital signatures" />
          <HeroCheck iconSrc={landingIcons.tamperEvidentAuditTrail} label="Tamper-evident audit trail" />
          <HeroCheck iconSrc={landingIcons.fiftyStateDisclosureEngine} label="50-state disclosure engine" />
        </div>
      </div>

      <div className="relative">
        <HeroVisual />
      </div>
    </div>
  </section>
);

const HeroCheck = ({ iconSrc, label }: { iconSrc: string; label: string }) => (
  <div className="flex items-center gap-3 text-sm text-slate-700">
    <LandingIcon src={iconSrc} alt={label} className="h-14 w-14" />
    <span className="font-medium">{label}</span>
  </div>
);

// Per-VIN tamper-evident "defense file" — the hero proof. Leads with the hard
// price gate (signing blocked on mismatch), shows the captured evidence, keeps
// a single "caught before a customer did" beat, and seals with a real
// content-hash footer so the card reads as a legal evidence record, not a
// generic status board.
const ComplianceStatusCard = () => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white ring-1 ring-slate-900/[0.04] shadow-[0_2px_4px_-1px_rgba(15,23,42,0.06),0_20px_40px_-12px_rgba(15,23,42,0.16),0_40px_90px_-30px_rgba(11,32,65,0.28)]">
    {/* Faint ledger grid so the card reads as an evidence document, not chrome. */}
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:linear-gradient(to_bottom,#000,transparent_88%)]"
    />
    <div className="relative z-10">
      <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 pb-3.5 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0B2041] text-white shadow-sm ring-1 ring-white/10">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="leading-none">
              <p className="font-display text-[13px] font-black tracking-tight text-slate-900">VIN defense file</p>
              <p className="mt-1 font-mono text-[10px] tracking-tight text-slate-500">REC-2026-0617 · 142 VINs sealed</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-100/80">
        <StatusRow label="Advertised price locked to all-in" sub="Signing blocked until the price matches" chip="Enforced" tone="navy" />
        <StatusRow label="Disclosures signed &amp; hash-sealed" sub="E-sign consent · IP · UTC time" mono="sha-256" chip="Sealed" />
        <StatusRow label="Installer proof, per pre-installed item" sub="Sign-off + install photo on file" chip="Verified" />
        <StatusRow label="Website price screenshot on file" sub="Timestamped at the pre-signature re-check" chip="Captured" />
      </div>

      <div className="border-t border-slate-100 bg-slate-50/40 px-5 pb-5 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Website scan · exceptions</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200/70">
            <AlertTriangle className="h-3 w-3" /> Caught &amp; held
          </span>
        </div>
        <AlertRow tone="red" title="Advertised price mismatch — held" detail="VIN 1HGCM826… · Lot $34,991 vs Site $32,995" />
        <AlertRow tone="amber" title="Missing disclosure — flagged" detail="2019 F-150 · Buyers Guide not attached" />
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Scan className="h-3.5 w-3.5 text-[#2563EB]" /> Nightly price sync flagged this 02:14 AM &mdash; before a customer did.
        </p>

        {/* Tamper-evident seal — the trust payload. Mirrors the stored content hash. */}
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50 text-[#0B2041] ring-1 ring-slate-200">
              <Lock className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                Record sealed
                <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide text-emerald-700">tamper-evident</span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">sha256:9f2a1c4e…7b30 · 02:14 UTC</p>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[10.5px] text-slate-500">Any change to any document changes this hash.</p>
      </div>
    </div>
  </div>
);

// The second hero pillar: the complete, auto-built vehicle file the scraper
// produces from the dealer's inventory feed — factory options, fuel economy,
// one-owner / clean-title flags, days-on-market, and live market position,
// all sticker-ready with zero data entry.
const VehicleFileCard = () => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white ring-1 ring-slate-900/[0.04] shadow-[0_2px_4px_-1px_rgba(15,23,42,0.06),0_20px_40px_-12px_rgba(15,23,42,0.16),0_40px_90px_-30px_rgba(11,32,65,0.28)]">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:linear-gradient(to_bottom,#000,transparent_88%)]"
    />
    <div className="relative z-10">
      <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 pb-3.5 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0B2041] text-white shadow-sm ring-1 ring-white/10">
              <BadgeCheck className="h-4 w-4" />
            </span>
            <div className="leading-none">
              <p className="font-display text-[13px] font-black tracking-tight text-slate-900">Vehicle file</p>
              <p className="mt-1 font-mono text-[10px] tracking-tight text-slate-500">VIN &hellip;331335 &middot; auto-built from your feed</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Synced
          </span>
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[15px] font-semibold tracking-tight text-slate-900">2027 INFINITI QX60 LUXE</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Deep Emerald &middot; Graphite leather</p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="font-mono text-[15px] font-semibold tracking-tight text-slate-900 tabular-nums">$58,835</p>
            <p className="text-[10px] font-semibold text-emerald-700">$2,444 below market</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {["One owner", "Clean title", "No open recalls"].map((b) => (
            <span key={b} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> {b}
            </span>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <FileStat label="Market position" value="Good Deal" tone="emerald" />
          <FileStat label="Days on market" value="12 days" />
          <FileStat label="Fuel economy" value="20 / 26 mpg" />
          <FileStat label="MSRP" value="$62,335" />
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/40 px-3.5 py-3">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Factory options &middot; decoded</p>
          <div className="flex flex-wrap gap-1.5">
            {["Premium Pkg", "Heated Seats", "Bose Audio", "360 Camera", "ProPILOT Assist"].map((o) => (
              <span key={o} className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-slate-700">{o}</span>
            ))}
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-[#2563EB]">+17 more</span>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-[#2563EB]" /> Sticker-ready in seconds &mdash; every field pulled from your inventory feed.
        </p>
      </div>
    </div>
  </div>
);

const FileStat = ({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-0.5 text-[13px] font-bold tabular-nums ${tone === "emerald" ? "text-emerald-700" : "text-slate-900"}`}>{value}</p>
  </div>
);

// Two-pillar hero visual: the compliance defense file and the auto-built
// vehicle file, on a slow auto-advance that pauses on hover or manual select.
const HERO_VIEWS = [
  { id: "compliance", label: "Compliance file" },
  { id: "vehicle", label: "Vehicle file" },
];
const HeroVisual = () => {
  const [view, setView] = useState(0);
  // Auto-advance stops permanently after a manual selection, pauses on
  // hover/focus, and never runs for reduced-motion users.
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!auto || paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setView((v) => (v + 1) % HERO_VIEWS.length), 7000);
    return () => clearInterval(t);
  }, [auto, paused]);
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div role="group" aria-label="Hero example toggle" className="mb-3 inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
        {HERO_VIEWS.map((hv, i) => (
          <button
            key={hv.id}
            aria-pressed={i === view}
            onClick={() => { setView(i); setAuto(false); }}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${i === view ? "bg-[#0B2041] text-white" : "text-slate-500 hover:text-slate-800"}`}
          >
            {hv.label}
          </button>
        ))}
      </div>
      {/* Both cards stay mounted in one grid cell so the container sizes to
          the tallest card — the 7s swap can never shift the page (CLS 0). */}
      <div className="grid">
        <div className={`col-start-1 row-start-1 ${view === 0 ? "" : "invisible"}`} aria-hidden={view !== 0}><ComplianceStatusCard /></div>
        <div className={`col-start-1 row-start-1 ${view === 1 ? "" : "invisible"}`} aria-hidden={view !== 1}><VehicleFileCard /></div>
      </div>
    </div>
  );
};

const StatusRow = ({
  label, sub, mono, chip = "Verified", tone = "emerald",
}: { label: string; sub: string; mono?: string; chip?: string; tone?: "emerald" | "navy" }) => {
  const rail = tone === "navy" ? "bg-[#2563EB]" : "bg-emerald-400/70";
  const chipCls = tone === "navy"
    ? "border-[#2563EB]/30 bg-blue-50 text-[#1d4ed8]"
    : "border-emerald-200 bg-emerald-50/60 text-emerald-700";
  return (
    <div className="relative flex items-center justify-between py-3 pl-5 pr-5">
      <span aria-hidden className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full ${rail}`} />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-tight text-slate-900">{label}</p>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500">
          {sub}
          {mono && <span className="ml-1.5 font-mono text-[10px] text-slate-500">{mono}</span>}
        </p>
      </div>
      <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${chipCls}`}>
        {tone === "navy" ? <Lock className="h-3 w-3" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {chip}
      </span>
    </div>
  );
};

const AlertRow = ({ tone, title, detail }: { tone: "red" | "amber"; title: string; detail: string }) => {
  const c = tone === "red"
    ? { rail: "bg-red-500", border: "border-red-200", bg: "bg-red-50/60", title: "text-red-900" }
    : { rail: "bg-amber-500", border: "border-amber-200", bg: "bg-amber-50/50", title: "text-amber-900" };
  return (
    <div className={`relative mb-2 flex items-start gap-2.5 overflow-hidden rounded-lg border ${c.border} ${c.bg} py-2.5 pl-3.5 pr-3`}>
      <span aria-hidden className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full ${c.rail}`} />
      <div className="min-w-0">
        <p className={`text-[12.5px] font-semibold leading-tight ${c.title}`}>{title}</p>
        <p className="mt-0.5 truncate font-mono text-[10.5px] leading-tight text-slate-500">{detail}</p>
      </div>
    </div>
  );
};

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
  <section id="risk" className="scroll-mt-20 border-b border-slate-100 bg-white">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">The risk</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl">
          One bad label can cost you the lot.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-slate-600">
          Regulators, state AGs, and plaintiffs&rsquo; attorneys are actively comparing your
          advertised price to your deal jacket — and the consequences land on the dealership, not
          the ad agency that built the site.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card iconSrc={landingIcons.ftcEnforcement} title="FTC enforcement">
          FTC Act §5 and 16 CFR Part 455 target undisclosed add-ons, bait pricing, and missing consent.
          Investigations begin with a website crawl, not a customer complaint.
        </Card>
        <Card iconSrc={landingIcons.advertisedPriceLiability} title="Advertised-price liability">
          Selling a vehicle for more than the advertised price exposes the dealer to refunds,
          rescission, and state UDAP penalties — even when the mismatch was a typo.
        </Card>
        <Card iconSrc={landingIcons.stateAgAudits} title="State AG audits">
          California (SB 766, eff. Oct 2026), Massachusetts, New York, and Maryland have active
          dealer enforcement units that pull records on demand.
        </Card>
        <Card iconSrc={landingIcons.recallExposure} title="Recall exposure">
          Selling a new vehicle under an open recall is federally prohibited, and used-car recall
          disclosure is a growing FTC and state-AG target. AutoLabels checks NHTSA campaigns at
          listing, re-checks at signing, and hard-stops on do-not-drive orders.
        </Card>
      </div>

      <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-700">
          <strong className="text-slate-900">AutoLabels is the shield.</strong> Continuous price
          reconciliation, 50-state disclosure engine, signed customer acknowledgements, and a
          tamper-evident audit log — so the regulator sees a clean record, not a missing one.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Every addendum is <strong className="text-slate-900">red-teamed before it prints</strong> —
          banned phrases hard-fail, doc fees are checked against all 50 state caps, and a used car
          can&rsquo;t go out without its Buyers Guide.
        </p>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// How it works — four verbs, unified card system.
// ──────────────────────────────────────────────────────────────

const HowItWorks = () => (
  <section id="how" className="scroll-mt-20 border-b border-slate-100 bg-white">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">How it works</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl">
          Four verbs. One platform.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          The product is built around four actions. That&rsquo;s it.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-2 lg:grid-cols-4">
        <NumberedCard
          num="01"
          iconSrc={landingIcons.decode}
          title="Decode"
          body="VIN to a decoded spec sheet in under a second via NHTSA — year, make, model, trim, and standard equipment, auto-filled."
        />
        <NumberedCard
          num="02"
          iconSrc={landingIcons.stick}
          title="Stick"
          body="Build an FTC-aligned dealer addendum — products, pricing, disclosures, and your state's doc fee — audit-ready in under a minute."
        />
        <NumberedCard
          num="03"
          iconSrc={landingIcons.sign}
          title="Sign"
          body="Customer scans a QR, signs on their phone, and every action lands in your audit log. No paper, no chasing signatures."
        />
        <NumberedCard
          num="04"
          iconSrc={landingIcons.close}
          title="Close"
          body="Every scan becomes a lead. Every addendum becomes data. See what's selling, what's stuck, and what's closing — live."
        />
      </div>

      {/* From arrival to windshield — the self-aware get-ready pipeline,
          folded in here so the how-it-works story is told exactly once. */}
      <div className="mx-auto mt-16 max-w-6xl">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">From arrival to windshield</p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
          Point AutoLabels at your inventory &mdash; a VDP URL, a VIN, or your nightly feed &mdash; and
          nothing prints until the work is signed off.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((s) => (
            <NumberedCard key={s.num} num={s.num} iconSrc={s.icon} title={s.title} body={s.body} />
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {["Itemized get-ready, not a sticky note.", "Nothing lists until it's ready.", "Every install is proven before it's advertised."].map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
              <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// New inventory queues its own get-ready (recon / detail / vendors) and the
// correct sticker version, gated by the foreman prep sign-off. Grounded in
// real features: useGetReady, install_proofs, usePrepSignOff, version-lock.
const PIPELINE = [
  { num: "01", icon: landingIcons.vehicleArrives, title: "Vehicle arrives", body: "Paste a VDP or VIN, or let the nightly sync pull it in. The file builds itself — decode, equipment, photos, and live market position." },
  { num: "02", icon: landingIcons.getReadyQueues, title: "Get-Ready queues itself", body: "Itemized recon, inspection, detail, and accessory installs auto-assign to Service, Lot, Detail, and outside vendors — each with an owner, an email, and a cost." },
  { num: "03", icon: landingIcons.installersProveWork, title: "Installers prove the work", body: "Every item advertised as installed gets an installer signature and a photo. No proof, no claim." },
  { num: "04", icon: landingIcons.foremanSignsOff, title: "Foreman signs off", body: "The prep gate stays locked. The car can't be listed or published until it's truly ready." },
  { num: "05", icon: landingIcons.rightStickerGoesOut, title: "The right sticker goes out", body: "The correct window-sticker version and addendum generate — version-locked — and publish to the Vehicle Passport with its QR." },
];

// ──────────────────────────────────────────────────────────────
// Sticker Studio — template gallery (real: 18-template catalog +
// premium heroes, white/black label, version-locked).
// ──────────────────────────────────────────────────────────────

const TEMPLATES = [
  { icon: Sparkles, title: "Vehicle Passport Premium", body: "The flagship scan-first hero: branded header, price and QR cards, and a transparency strip." },
  { icon: Tag, title: "Big Price Lot Sticker", body: "Huge title, huge price, huge QR — readable across the lot from 6 to 10 feet." },
  { icon: BadgeCheck, title: "Executive Noir", body: "Luxury black-label with a gold accent for high-line inventory, with a light white-label variant." },
  { icon: ShieldCheck, title: "Compliance-first", body: "Disclosure-forward addendums with the QR required and a fixed, audit-friendly layout." },
  { icon: FileText, title: "Classic & Modern", body: "Clean general-purpose window stickers and addendums for everyday used-car inventory." },
  { icon: Palette, title: "Your brand, every time", body: "Logo, colors, disclaimers, pricing fields, benefits, and the Vehicle Passport link — baked in." },
];

// A believable 8.5x11 window-sticker artifact — the page sells a printed
// product, so it shows one instead of describing one.
const StickerMock = () => (
  <div className="mx-auto w-full max-w-[320px] rounded-xl border border-slate-200 bg-white p-4 shadow-[0_20px_50px_-20px_rgba(11,32,65,0.3)]">
    <div className="flex items-center justify-between border-b-2 border-[#0B2041] pb-2">
      <div>
        <p className="font-display text-[13px] font-black tracking-tight text-[#0B2041]">RIVERSIDE MOTORS</p>
        <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500">Certified Pre-Owned Center</p>
      </div>
      <ShieldCheck className="h-5 w-5 text-[#2563EB]" />
    </div>
    <div className="mt-2.5 flex items-start justify-between gap-2">
      <div>
        <p className="font-mono text-[14px] font-semibold leading-tight text-slate-900">2027 INFINITI QX60</p>
        <p className="text-[9px] font-medium text-slate-500">LUXE AWD · VIN …331335</p>
      </div>
      <div className="text-right">
        <p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Our Price</p>
        <p className="font-mono text-[16px] font-semibold tabular-nums text-[#0B2041]">$58,835</p>
      </div>
    </div>
    <div className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2">
      <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Installed equipment</p>
      <div className="mt-1.5 space-y-1">
        {[["Premium Package", "included"], ["All-Weather Protection", "$495"], ["VIN Etch Security", "$299"]].map(([n, p]) => (
          <div key={n} className="flex items-center justify-between text-[9px] font-medium text-slate-700">
            <span>{n}</span><span className="tabular-nums text-slate-500">{p}</span>
          </div>
        ))}
      </div>
    </div>
    <div className="mt-2.5 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Scan for the Vehicle Passport</p>
        <p className="mt-0.5 text-[8px] leading-snug text-slate-500">Full disclosures, warranty, market price, and signed documents for this VIN.</p>
      </div>
      <div className="shrink-0 rounded-md border border-slate-200 bg-white p-1">
        <QRCodeSVG value="https://autolabels.io/v/demo" size={44} fgColor="#0B2041" />
      </div>
    </div>
    <p className="mt-2 border-t border-slate-100 pt-1.5 text-center text-[7px] leading-snug text-slate-500">
      Optional items are not required to buy, lease, or finance. Doc fee disclosed per state rules.
    </p>
  </div>
);

const StickerStudioGallery = () => (
  <section id="studio" className="scroll-mt-20 border-b border-slate-100 bg-slate-50/40">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Sticker Studio</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl">
          Pick a template. The sticker builds itself.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          A growing library of 8.5&times;11 window stickers and 4.5&times;11 addendums &mdash; modern,
          classic, compliance-first, value, and black-label luxury. Each carries your branding, QR,
          pricing, disclosures, and the Vehicle Passport link &mdash; and locks the moment it&rsquo;s signed.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-6xl items-center gap-10 lg:grid-cols-[340px_minmax(0,1fr)]">
        <StickerMock />
        <div className="grid gap-5 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <Card key={t.title} icon={t.icon} title={t.title}>{t.body}</Card>
          ))}
        </div>
      </div>

      {/* Print workflow — folded in from the old Print-ready section. */}
      <div className="mx-auto mt-12 max-w-4xl">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Built for the printer, not just the browser</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRINT_SPECS.map((s) => (
            <div key={s} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
              <Check className="h-4 w-4 flex-shrink-0 text-blue-600" /> {s}
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center font-display text-base font-bold text-slate-900">
          Print it, post it, scan it, sign it, and save it &mdash; one record per VIN.
        </p>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Vehicle Passport — QR is the sales packet + scan analytics
// (real: /v/:slug published docs + qr_scan_events analytics).
// ──────────────────────────────────────────────────────────────

// The real panel lineup shipping in /v/:slug today — the page's job is to
// show the depth, not summarize it away.
const PASSPORT_INCLUDES = [
  "Market pricing with a confidence score",
  "Price history & 30-day trend",
  "Local demand & comparables in your own stock",
  "Verified factory warranty & CPO coverage",
  "Owner reviews + NHTSA crash-test stars",
  "Full factory build sheet with package MSRPs",
  "Ownership timeline & recall status",
  "CARFAX / AutoCheck report link — from your own site",
  "Buyers Guide, disclosures & signed documents",
  "Every panel deep-linkable & shareable",
];

const VehiclePassportSection = ({ waitTo }: { waitTo: string }) => (
  <section id="passport" className="scroll-mt-20 border-b border-slate-100 bg-white">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Vehicle Passport</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl">
          The QR is the new sales packet &mdash; and you see every scan.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Scan the sticker and the shopper gets a thirteen-panel digital showroom for that exact
          VIN &mdash; not a PDF. Market analysis, verified warranty, crash-test stars, the factory
          build sheet, and every signed document, before they ever sit at the desk.
        </p>
      </div>
      <div className="mx-auto mt-12 grid max-w-5xl gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h3 className="inline-flex items-center gap-2 font-barlow-condensed text-lg font-bold text-slate-900">
            <QrCode className="h-5 w-5 text-blue-600" /> Inside every Passport
          </h3>
          <ul className="mt-4 space-y-2.5">
            {PASSPORT_INCLUDES.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" /> {p}
              </li>
            ))}
          </ul>
          <Link to={DEMO_TO} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2563EB] hover:underline">
            Open the live sample Passport <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-8">
            <h3 className="inline-flex items-center gap-2 font-barlow-condensed text-lg font-bold text-slate-900">
              <BarChart3 className="h-5 w-5 text-blue-600" /> You see every scan
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-slate-700">
              Each sticker carries a tracked QR. Watch scans by vehicle and by sticker type, spot your
              most-shopped cars, and know which units are getting attention before a lead form is ever
              filled out.
            </p>
            <p className="mt-5 font-display text-base font-bold text-slate-900">
              The sticker keeps selling after the salesperson goes home.
            </p>
          </div>
          <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h3 className="inline-flex items-center gap-2 font-barlow-condensed text-lg font-bold text-slate-900">
              <Zap className="h-5 w-5 text-blue-600" /> Every scan becomes a routed lead
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-slate-700">
              Passport leads route themselves &mdash; CRM owner, assigned salesperson, sales rotation,
              BDC, then the manager &mdash; with timed escalation when nobody responds. Every touch is
              logged, so speed-to-lead is provable, not anecdotal.
            </p>
            <p className="mt-5 font-display text-base font-bold text-slate-900">
              No lead sits. Every touch is on the record.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">The closer</p>
            <h3 className="mt-1 font-barlow-condensed text-xl font-extrabold tracking-normal text-slate-900">
              &ldquo;Why This Is A Great Buy&rdquo; &mdash; a shareable buying report per vehicle.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              Trim-honest pricing versus MSRP and same-trim comps, verified history and warranty,
              factory package value, and local supply &mdash; the buying case your salesperson would
              make, printed and provable.
            </p>
          </div>
          <Link
            to={waitTo}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#2563EB] px-5 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            Request Early Access <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Print-ready — real dealership print workflow (calibration,
// PDF/PNG, label modes, QR quiet zone, per-VIN archive).
// ──────────────────────────────────────────────────────────────

const PRINT_SPECS = [
  "8.5×11 window stickers",
  "4.5×11 addendum stickers",
  "PDF & PNG export",
  "Black-label & white-label modes",
  "QR quiet-zone protection",
  "Logo & color branding",
  "Printer calibration & crop marks",
  "Saved archive per VIN",
  "Version-locked at signing",
];

// ──────────────────────────────────────────────────────────────
// Why now — single sourced FTC stat (cited, not fabricated). Keeps
// the urgency factual: links the real March 2026 enforcement action.
// ──────────────────────────────────────────────────────────────

const WhyNow = () => (
  <section className="border-b border-slate-100 bg-[#0B2041]">
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
            <Gavel className="h-4 w-4" />
          </span>
          <div>
            <p className="font-display text-lg font-bold leading-snug text-white sm:text-xl">
              In March 2026, the FTC warned 97 dealer groups about deceptive pricing.
              <a
                href="https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-warns-97-auto-dealership-groups-about-deceptive-pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 whitespace-nowrap align-super text-[10px] font-semibold text-blue-300 underline-offset-2 hover:underline"
              >
                FTC, 2026
              </a>
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/70">
              Enforcement reviews often start with a website crawl, not a customer complaint &mdash; comparing
              your advertised price to the deal. AutoLabels reconciles the two before that gap becomes a problem.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Where we fit — category comparison (generalized, no named
// vendors). Frames the cross-lane differentiation. Compliance-safe:
// "tamper-evident", "documents", "reconciliation" (never "guarantees"
// or "legal defense"); a footnote notes capabilities vary by vendor.
// ──────────────────────────────────────────────────────────────

const FIT_COLS = [
  "Window sticker + addendum",
  "QR Vehicle Passport",
  "Advertised-price reconciliation at signing",
  "Get-Ready + install proof",
  "Signed, tamper-evident record",
];
const FIT_ROWS: { label: string; cells: (boolean | "partial")[] }[] = [
  { label: "Digital packet tools", cells: ["partial", true, false, false, false] },
  { label: "F&I / compliance tools", cells: [false, false, true, false, "partial"] },
  { label: "Reconditioning tools", cells: [false, false, false, true, false] },
  { label: "Window-sticker tools", cells: [true, false, false, false, false] },
  { label: "AutoLabels", cells: [true, true, true, true, true] },
];

const FitCell = ({ v }: { v: boolean | "partial" }) =>
  v === true ? (
    <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
  ) : v === "partial" ? (
    <span className="text-xs font-semibold text-slate-500">partial</span>
  ) : (
    <span className="text-slate-300">&mdash;</span>
  );

const WhereWeFit = () => (
  <section id="compare" className="scroll-mt-20 border-b border-slate-100 bg-slate-50/40">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Where AutoLabels fits</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl">
          Four tools&rsquo; jobs. One record.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Packet tools show the car. Compliance tools watch the price. Recon tools fix the car. Sticker
          tools print a label. AutoLabels does all of it &mdash; per VIN, in one tamper-evident record.
        </p>
      </div>

      <div className="relative mx-auto mt-12 max-w-5xl">
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th scope="col" className="px-4 py-3 text-left font-display text-xs font-bold uppercase tracking-wide text-slate-500">
                Category
              </th>
              {FIT_COLS.map((c) => (
                <th scope="col" key={c} className="px-3 py-3 text-center text-[11px] font-semibold leading-tight text-slate-600">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIT_ROWS.map((r) => {
              const isUs = r.label === "AutoLabels";
              return (
                <tr key={r.label} className={`border-b border-slate-100 last:border-0 ${isUs ? "bg-blue-50/60" : ""}`}>
                  <th scope="row" className={`px-4 py-3 text-left text-sm ${isUs ? "font-bold text-[#0B2041]" : "font-medium text-slate-700"}`}>
                    {r.label}
                  </th>
                  {r.cells.map((v, i) => (
                    <td key={i} className="px-3 py-3 text-center">
                      <FitCell v={v} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {/* Scroll affordance where the table clips (phones/portrait tablets). */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-2xl bg-gradient-to-l from-white to-transparent lg:hidden" />
        <p className="mt-2 text-center text-[11px] font-medium text-slate-500 lg:hidden">Swipe to compare &rarr;</p>
      </div>

      <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-slate-500">
        Generalized by category; capabilities vary by vendor and plan. AutoLabels documents informed
        consent and produces a tamper-evident record &mdash; it is FTC-aligned and does not guarantee the
        outcome of any dispute.
      </p>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Take the power back — the pivot. Two pillars: provable add-on
// election and price integrity. Anchored at #power for the nav.
// ──────────────────────────────────────────────────────────────

const TakeThePowerBack = ({ waitTo }: { waitTo: string }) => (
  <section id="power" className="scroll-mt-20 border-b border-slate-100 bg-slate-50/40">
    <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Take the power back</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl [text-wrap:balance]">
          The FTC made you play defense. Take the power back.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-700">
          Scared of complaints, dealers stopped pitching add-ons and stopped putting a real price in
          writing. AutoLabels flips it: prove the customer chose it, prove you honored the price.
        </p>
      </div>

      <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-blue-200 bg-blue-50/50 p-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">For the dealer who sells it, not pre-installs it</p>
        <h3 className="mt-2 font-barlow-condensed text-2xl font-extrabold tracking-normal text-slate-900">
          You sell exterior &amp; interior protection — and install it when the car is delivered.
        </h3>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          You did everything right. The customer wanted it, you sold it, you installed it. Then weeks
          later comes the call: <em>&ldquo;I never agreed to that,&rdquo;</em> or <em>&ldquo;your
          salesperson told me it was required.&rdquo;</em> Until now an honest dealer had no way to
          answer that — no pre-installed product to point to, just your word against theirs.
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
          iconSrc={landingIcons.sellAddonsWithoutFear}
          eyebrow="Profitable add-on election"
          title="Sell add-ons without fear."
          body="F&I is your most profitable revenue — and your most exposed. AutoLabels captures per-item, informed election: the customer sees each product's price, sees it's optional, sees the benefit, and signs. Every yes is provable."
          chips={["F&I is your highest-margin revenue", "Per-item, informed, signed election"]}
          punch="Every yes, provable."
        />
        <PowerPillar
          iconSrc={landingIcons.ownYourPrice}
          eyebrow="Price integrity"
          title="Own your price. Prove you honored it."
          body={
            <>
              <p>
                The finance manager enters the agreed-upon sale price; AutoLabels adds the doc fee and every
                pre-installed item and checks it against your live advertised price. If they don't match, the deal
                is blocked from signing until it's fixed. Once reconciled, the platform seals a per-VIN defense file:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-4 text-slate-600">
                <li>The agreed sale price reconciled to your advertised price.</li>
                <li>A timestamped screenshot of your live website listing at signing.</li>
                <li>An installer sign-off with a photo for every pre-installed product.</li>
                <li>The signed disclosures and e-sign consent (IP, timestamp, content hash).</li>
                <li>All chained into a tamper-evident record you can hand to counsel or a regulator.</li>
              </ul>
            </>
          }
          chips={["Blocked at signing on a price mismatch", "FTC warned 97 dealer groups · Mar 2026"]}
          punch="Priced in ink, not pencil."
        />
      </div>

      <div className="mx-auto mt-5 grid max-w-5xl gap-5 sm:grid-cols-2">
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <LandingIcon src={landingIcons.signedProof} alt="Signed proof" className="h-10 w-10" />
          <div>
            <p className="font-barlow-condensed text-lg font-bold text-slate-900">Signed proof</p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
              Every election initialed and e-signed — consent, IP, timestamp, and content hash on file.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <LandingIcon src={landingIcons.auditDefenseFile} alt="Audit defense file" className="h-10 w-10" />
          <div>
            <p className="font-barlow-condensed text-lg font-bold text-slate-900">Audit defense file</p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
              One tamper-evident record per VIN — ready to hand to counsel or a regulator.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-2xl flex-col items-center gap-4 text-center">
        <p className="text-xs leading-relaxed text-slate-500">
          Tamper-evident, not tamper-proof. AutoLabels documents informed election and strengthens
          your position under FTC Act §5 &mdash; it does not guarantee the outcome of a dispute.
        </p>
        <Link
          to={waitTo}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[#2563EB] px-6 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
        >
          Request Early Access
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  </section>
);

const PowerPillar = ({
  iconSrc,
  eyebrow,
  title,
  body,
  chips,
  punch,
}: {
  iconSrc: string;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  chips: string[];
  punch: string;
}) => (
  <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
    <LandingIcon src={iconSrc} alt={title} />
    <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
    <h3 className="mt-1.5 font-barlow-condensed text-2xl font-extrabold tracking-normal text-slate-900">{title}</h3>
    <div className="mt-3 text-sm leading-relaxed text-slate-600">{body}</div>
    <div className="mt-5 flex flex-wrap gap-2">
      {chips.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> {c}
        </span>
      ))}
    </div>
    {/* mt-auto keeps the two cards' punchlines bottom-aligned. */}
    <p className="mt-auto border-t border-slate-100 pt-4 font-display text-base font-bold text-slate-900">{punch}</p>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Social proof — placeholders clearly marked.
// ──────────────────────────────────────────────────────────────

// Slim, truthful pre-launch band — no placeholder logos, no fake quotes.
// Real testimonials and logos replace this the day they're approved.
const SocialProof = () => (
  <section className="border-b border-slate-100">
    <div className="mx-auto max-w-5xl px-6 py-16 lg:px-8">
      <div className="grid gap-5 md:grid-cols-3">
        <div className="flex flex-col justify-center rounded-2xl border border-slate-200 bg-white p-7 shadow-sm md:col-span-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Built with dealers, for dealers</p>
          <h2 className="mt-2 font-barlow-condensed text-2xl font-extrabold tracking-normal text-slate-900">
            Now onboarding pilot dealer groups.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            The pilot cohort is deliberately small &mdash; single rooftops and select groups, onboarded
            hands-on. Early-access dealers lock launch pricing and shape the roadmap.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Pilot cohort limited", "Early-access pricing locked", "Hands-on onboarding"].map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> {c}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0B2041] to-[#13315e] p-7 text-white shadow-sm">
          <ShieldCheck className="h-7 w-7 text-[#3BB4FF]" />
          <p className="mt-3 font-barlow-condensed text-lg font-bold tracking-normal">FTC-aligned</p>
          <p className="text-sm text-white/70">50-state disclosure engine</p>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
            Built to the frameworks regulators cite
          </p>
        </div>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Pricing teaser
// ──────────────────────────────────────────────────────────────

const TIERS: { name: string; price: string; best: string; tagline: string; features: string[]; featured?: boolean }[] = [
  {
    name: "Essential",
    price: "$299",
    best: "Single-store dealers",
    tagline: "Everything one rooftop needs to print audit-ready window stickers and close clean, signed deals.",
    features: [
      "New + used car window stickers & dealer addendums",
      "FTC Buyers Guide — English + Spanish",
      "VIN decode + NHTSA recall & Takata stop-sale banner",
      "Customer digital signing on any phone via QR",
      "Vehicle Passport for every shopper (QR + website embed)",
      "Tamper-evident audit log",
      "Up to 75 VINs / month · email support",
    ],
  },
  {
    name: "Unlimited",
    price: "$599",
    featured: true,
    best: "Higher-volume stores",
    tagline: "Everything in Essential, with no VIN cap and the workflow tools a busy store runs on.",
    features: [
      "Everything in Essential, plus:",
      "Unlimited VINs",
      "Product-rules engine — auto-assign add-ons by year, make, model, trim, mileage",
      "Inventory management, CSV import & mobile lot scanner",
      "Leads + analytics — acceptance rates & revenue per addendum",
      "AI vehicle descriptions",
      "Co-buyer signatures · custom branding kit",
      "Priority support + onboarding assist",
    ],
  },
  {
    name: "Compliance Pro",
    price: "$1,499",
    best: "Groups that want every deal audit-ready",
    tagline: "Everything in Unlimited, plus the price-integrity and evidence layer that makes every deal defensible.",
    features: [
      "Everything in Unlimited, plus:",
      "Nightly inventory + advertised-price sync, with one-click re-check on any VIN — the deal number matches your live website the moment before the customer signs",
      "Website price verification as a hard signing gate — no deal signs while the contract price and the advertised price disagree",
      "Live re-scrape + timestamped website-price screenshot captured at signing",
      "Per-VIN tamper-evident defense file (SHA-256 chain)",
      "Verified installer sign-off + photo on pre-installed products",
      "50-state disclosure engine (CA SB 766, NY, TX, FL + 46 more)",
      "Prep + install compliance gate · multi-language addendums",
      "DMS webhooks · dedicated success manager",
    ],
  },
];

const PRICING_ADDONS: { title: string; body: string }[] = [
  { title: "Additional rooftops", body: "Per-rooftop pricing with group discounts across a dealer group." },
  { title: "DMS webhooks & API", body: "Push signed addendums and deal evidence into your DMS where supported." },
  { title: "Guided onboarding & import", body: "Hands-on setup, branding kit, and inventory/price-feed connection." },
  { title: "Custom state disclosure rules", body: "Tailor the 50-state disclosure engine to your group's legal playbook." },
];

const PricingTeaser = ({ waitTo }: { waitTo: string }) => (
  <section id="pricing" className="al-pricing scroll-mt-20 relative overflow-hidden bg-[#07090D] text-white">
    <style>{`
      .al-pricing::before{content:"";position:absolute;top:-160px;right:-120px;width:560px;height:560px;background:radial-gradient(circle,rgba(37,99,235,.28),transparent 62%);opacity:.5;pointer-events:none}
      .al-pricing::after{content:"";position:absolute;bottom:-180px;left:-140px;width:520px;height:520px;background:radial-gradient(circle,rgba(37,99,235,.18),transparent 65%);opacity:.5;pointer-events:none}
      .al-plan{position:relative;background:radial-gradient(120% 80% at 50% 0%,rgba(37,99,235,.16),transparent 60%),linear-gradient(180deg,#141821,#0C1017);border-radius:22px;padding:30px 26px 26px;display:flex;flex-direction:column;box-shadow:0 0 0 1px rgba(37,99,235,.28) inset,0 22px 60px -18px rgba(37,99,235,.32),0 40px 90px -30px rgba(0,0,0,.7);transition:transform .2s ease,box-shadow .2s ease}
      .al-plan::before{content:"";position:absolute;inset:-24px;border-radius:34px;z-index:-1;pointer-events:none;background:radial-gradient(50% 45% at 50% 20%,rgba(37,99,235,.30),transparent 70%);filter:blur(18px);opacity:.8}
      .al-plan::after{content:"";position:absolute;inset:0;border-radius:22px;padding:1.5px;pointer-events:none;background:linear-gradient(180deg,rgba(37,99,235,.75),rgba(37,99,235,.15) 55%,rgba(37,99,235,.35));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
      .al-plan:hover{transform:translateY(-3px)}
      .al-plan.pop{background:radial-gradient(130% 90% at 50% 0%,rgba(37,99,235,.30),transparent 62%),linear-gradient(180deg,#181C26,#0C1017);box-shadow:0 0 0 1.5px rgba(37,99,235,.6) inset,0 30px 80px -18px rgba(37,99,235,.5),0 50px 110px -30px rgba(0,0,0,.8);transform:translateY(-6px)}
      .al-plan.pop::before{background:radial-gradient(55% 50% at 50% 15%,rgba(37,99,235,.50),transparent 70%);opacity:1;filter:blur(22px)}
      .al-plan.pop::after{background:linear-gradient(180deg,rgba(96,165,250,1),rgba(37,99,235,.35) 55%,rgba(37,99,235,.6))}
      @media (max-width:900px){.al-plan.pop{transform:none}.al-plan:hover{transform:none}}
      .al-feats li:not(.hdr){position:relative;padding-left:26px}
      .al-feats li:not(.hdr)::before{content:"";position:absolute;left:0;top:2px;width:16px;height:16px;border-radius:50%;background:rgba(37,99,235,.15);box-shadow:0 0 0 1px rgba(37,99,235,.45) inset}
      .al-feats li:not(.hdr)::after{content:"";position:absolute;left:5px;top:6px;width:6px;height:3px;border-left:1.8px solid #60A5FA;border-bottom:1.8px solid #60A5FA;transform:rotate(-45deg)}
    `}</style>
    <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-400">Pricing</p>
        <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-white sm:text-5xl">
          Simple pricing. Three tiers.
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-300">
          Per rooftop, per month. Essential is free with any Autocurb.io subscription.
        </p>
        <p className="mt-2 text-sm font-medium text-slate-500">
          Free to join the early-access list · no card required · month-to-month · locks early-access pricing.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl items-stretch gap-8 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.name} className={`al-plan ${t.featured ? "pop" : ""}`}>
            {t.featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gradient-to-b from-[#3B82F6] to-[#2563EB] px-3.5 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-white shadow-[0_10px_22px_rgba(37,99,235,.5)]">
                Most Popular
              </span>
            )}
            <h3 className="font-barlow-condensed text-2xl font-bold tracking-normal text-white">{t.name}</h3>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-blue-400">{t.best}</p>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-barlow-condensed text-5xl font-extrabold leading-none tracking-normal text-white tabular-nums">{t.price}</span>
              <span className="text-sm font-semibold text-slate-500">/mo</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">{t.tagline}</p>
            <ul className="al-feats mt-5 flex-1 space-y-2.5 border-t border-white/10 pt-5">
              {t.features.map((feat) => {
                const isHeader = feat.endsWith("plus:");
                return (
                  <li key={feat} className={`${isHeader ? "hdr font-semibold text-white" : "text-[13px] leading-snug text-slate-200"}`}>
                    {feat}
                  </li>
                );
              })}
            </ul>
            <Link
              to={waitTo}
              className={`mt-6 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[11px] text-sm font-bold transition ${
                t.featured
                  ? "bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-[0_14px_30px_-10px_rgba(37,99,235,.6)] hover:brightness-110"
                  : "border border-white/15 text-slate-200 hover:bg-white/5"
              }`}
            >
              Request Early Access
              {t.featured && <ArrowRight className="h-3.5 w-3.5" />}
            </Link>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-400">Full Auto platform</p>
          <h3 className="mt-1.5 font-barlow-condensed text-2xl font-bold tracking-normal text-white">Bundle AutoLabels with the Auto suite</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Run AutoLabels alongside AutoCurb (trade &amp; retention) and AutoFilm (video sales &amp; service) on one shared
            dealer profile. Essential is included free with any Autocurb.io subscription.
          </p>
          <p className="mt-3 text-sm font-semibold text-slate-300">One login · shared inventory · group pricing available</p>
        </div>
        <div className="shrink-0 text-center sm:text-right">
          <Link
            to={waitTo}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-white px-6 text-sm font-bold text-slate-900 hover:bg-slate-100"
          >
            Talk to us <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-2 text-[11px] text-slate-500">Full AutoCurb &amp; AutoFilm features require those products active.</p>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-6xl">
        <h3 className="font-barlow-condensed text-xl font-bold tracking-normal text-white">Add-ons</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_ADDONS.map((a) => (
            <div key={a.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h4 className="text-sm font-bold text-white">{a.title}</h4>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{a.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[12px] leading-relaxed text-slate-500">
          All plans per rooftop, month-to-month. Advertised-price monitoring, DMS/OEM integrations, and high-volume usage
          may have setup or usage fees. No per-seat charges for standard dealership users.
        </p>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-5">
        <Link
          to={DEMO_TO}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 text-sm font-semibold text-white hover:bg-white/10"
        >
          See a live Vehicle Passport
        </Link>
        <Link to={waitTo} className="inline-flex items-center gap-1.5 py-2 text-sm font-semibold text-blue-400 hover:underline">
          Request early access <ArrowRight className="h-4 w-4" />
        </Link>
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
    q: "Where does my vehicle data come from?",
    a: "Either your existing inventory feed, or our nightly inventory and advertised-price update that pulls your live listings and site pricing. Nothing to install or swap — your vehicles and prices flow in automatically.",
  },
  {
    q: "What happens after I request early access?",
    a: "We review your dealership information and follow up within one business day. Then it's three steps: review your store, brands, and volume; configure templates, disclosures, and your inventory feed; and onboard your team hands-on. Requesting access is free and requires no card.",
  },
  {
    q: "Is there a long-term contract?",
    a: "No. Early-access pricing is month-to-month, per rooftop. Joining the early-access list costs nothing and locks your launch pricing.",
  },
  {
    q: "How does my inventory get in? Which DMS or feed providers work?",
    a: "Three paths: your existing inventory feed (vAuto, VinSolutions, CDK, Reynolds, and generic feeds via DMS webhooks on Compliance Pro), a CSV import, or our nightly website sync that reads your live listings directly — no IT project required.",
  },
];

const FAQ = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20 border-b border-slate-100 bg-slate-50/40">
      <div className="mx-auto max-w-4xl px-6 py-20 lg:px-8">
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">FAQ</p>
          <h2 className="mt-3 font-barlow-condensed text-4xl font-extrabold tracking-normal text-slate-900 sm:text-5xl">
            Questions, answered.
          </h2>
        </div>
        <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {FAQS.map((f, i) => (
            <div key={i} className="px-6 py-5">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                aria-controls={`faq-a-${i}`}
                className="flex w-full items-center justify-between gap-4 text-left"
              >
                <span className="text-base font-semibold text-slate-900">{f.q}</span>
                <ChevronDown
                  className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${
                    open === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              {open === i && (
                <p id={`faq-a-${i}`} className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────────────────────
// Final CTA
// ──────────────────────────────────────────────────────────────

const FinalCTA = ({ waitTo }: { waitTo: string }) => (
  <section className="px-6 py-20 lg:px-8">
    <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B2041] via-[#13315e] to-[#0B2041] px-8 py-20 text-center text-white lg:px-16">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-[#3BB4FF]/25 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-[#2563EB]/25 blur-3xl" />
      </div>
      <div className="relative">
        <h2 className="font-barlow-condensed text-4xl font-extrabold tracking-normal sm:text-5xl">
          Get early access.
        </h2>
        <p className="mt-5 text-lg text-white/70">First in line · Early-access pricing locked in.</p>
        <p className="mt-2 text-sm text-white/60">California SB 766 takes effect October 2026 — be audit-ready before your state's next enforcement sweep.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={waitTo}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-950 hover:bg-white/90"
          >
            Request Early Access
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to={DEMO_TO}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 text-sm font-semibold text-white hover:bg-white/20"
          >
            See a live Vehicle Passport
          </Link>
        </div>
      </div>
    </div>
  </section>
);

// ──────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────

const FOOTER_COLS: { title: string; links: { label: string; href?: string; to?: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Sticker Studio", href: "#studio" },
      { label: "Vehicle Passport", href: "#passport" },
      { label: "Pricing", href: "#pricing" },
      { label: "Live sample Passport", to: DEMO_TO },
    ],
  },
  {
    title: "Compliance",
    links: [
      { label: "The risk", href: "#risk" },
      { label: "Take the power back", href: "#power" },
      { label: "Where AutoLabels fits", href: "#compare" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Request early access", to: "/waitlist" },
      { label: "Sign in", to: "/login" },
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
    ],
  },
];

const Footer = ({ waitTo }: { waitTo: string }) => (
  <footer className="border-t border-slate-100 px-6 py-12 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <Logo variant="full" size={26} />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
            Window stickers, addendums, Buyers Guides, and QR Vehicle Passports — one
            tamper-evident record per VIN.
          </p>
          <Link
            to={waitTo}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#2563EB] px-4 text-sm font-medium text-white hover:bg-[#1D4ED8]"
          >
            Request Early Access <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {FOOTER_COLS.map((col) => (
          <div key={col.title}>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{col.title}</p>
            <ul className="mt-3 space-y-1">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.to ? (
                    <Link to={l.to} className="inline-block py-1.5 text-sm text-slate-600 hover:text-slate-900">{l.label}</Link>
                  ) : (
                    <a href={l.href} className="inline-block py-1.5 text-sm text-slate-600 hover:text-slate-900">{l.label}</a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} AutoLabels.io · Clear. Compliant. Consistent.</p>
        <p className="text-xs text-slate-500">FTC-aligned · Tamper-evident · 50-state disclosure engine</p>
      </div>
    </div>
  </footer>
);

// ──────────────────────────────────────────────────────────────
// Unified card primitives — used across every section.
// ──────────────────────────────────────────────────────────────

type IconType = typeof Scan;

// icon (Lucide, blue-box wrapper) survives for cards outside the landing icon
// system (Sticker Studio templates); iconSrc renders the bare gradient-tile SVG.
const Card = ({
  icon: Icon,
  iconSrc,
  title,
  children,
}: {
  icon?: IconType;
  iconSrc?: string;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    {iconSrc ? (
      <LandingIcon src={iconSrc} alt={title} />
    ) : Icon ? (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-[#2563EB]">
        <Icon className="h-5 w-5" />
      </div>
    ) : null}
    <h3 className="mt-4 font-barlow-condensed text-lg font-bold tracking-normal text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{children}</p>
  </div>
);

const NumberedCard = ({
  num,
  iconSrc,
  title,
  body,
}: {
  num: string;
  iconSrc: string;
  title: string;
  body: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <div className="flex items-start justify-between">
      <LandingIcon src={iconSrc} alt={title} />
      <span className="font-display text-xs font-bold tabular-nums text-[#2563EB]">{num}</span>
    </div>
    <h3 className="mt-4 font-barlow-condensed text-xl font-bold tracking-normal text-slate-900">{title}</h3>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
  </div>
);

export default Landing;
