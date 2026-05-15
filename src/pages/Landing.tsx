// TEST3 — mirror/Lovable sync check 2026-04-17
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Logo from "@/components/brand/Logo";
import AppSwitcher from "@/components/layout/AppSwitcher";
import { AUTOCURB_BRAND } from "@/data/autocurbBrand";
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
  X,
  Minus,
  Play,
  LogIn,
  QrCode,
  Printer,
  Camera,
  Wrench,
  Languages,
  Database,
  Globe,
  Quote,
  Award,
  Phone,
  Mail,
  ChevronDown,
  TrendingUp,
  Building2,
  FileCheck,
  Lock,
} from "lucide-react";

const Landing = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // ─ Navigation ─
  const Navigation = () => (
    <nav className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          aria-label="AutoLabels home"
          className="flex items-center"
        >
          <Logo variant="full" size={36} tagline />
        </button>
        <div className="hidden md:flex gap-8 items-center justify-center flex-1">
          <a
            onClick={() => navigate("/about")}
            className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
          >
            About
          </a>
          <a
            onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
          >
            Features
          </a>
          <a
            onClick={() => document.getElementById("roi")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
          >
            ROI
          </a>
          <a
            onClick={() => document.getElementById("compare")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
          >
            Compare
          </a>
          <a
            onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
          >
            Pricing
          </a>
          <a
            onClick={() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" })}
            className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
          >
            FAQ
          </a>
        </div>
        <div className="flex items-center gap-4">
          <AppSwitcher currentApp="autolabels" theme="light" />
          {user ? (
            <button
              onClick={() => navigate("/dashboard")}
              className="text-sm px-4 py-2 text-blue-600 hover:text-blue-700 font-medium"
            >
              Open Dashboard
            </button>
          ) : (
            <>
              <a
                href="mailto:hello@autolabels.io?subject=AutoLabels.io%20access%20request"
                className="text-sm px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
              >
                Request access
              </a>
              <button
                onClick={() => navigate("/login")}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
              >
                <LogIn size={16} />
                Dealer Login
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );

  // ─ Hero ─
  const Hero = () => (
    <section className="relative py-20 md:py-28 overflow-hidden">
      <div className="absolute inset-0 opacity-40">
        <div className="absolute top-20 left-10 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
        <div className="absolute top-40 right-20 w-96 h-96 bg-cyan-200 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
      </div>
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="inline-block px-4 py-2 bg-gray-100 rounded-full mb-6">
          <span className="text-sm font-medium text-gray-700">The dealer label & compliance platform</span>
        </div>
        <h1 className="font-display text-display-lg md:text-display-xl font-semibold mb-6">
          Decode. Disclose.{" "}
          <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent italic">
            Deliver.
          </span>
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Generate NHTSA-compliant window stickers, digital addendums, tamper-evident e-signatures, and a shopper portal—all in one platform.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <button
            onClick={() => user ? navigate("/dashboard") : (window.location.href = "mailto:hello@autolabels.io?subject=AutoLabels.io%20access%20request")}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center gap-2 shimmer-cta"
          >
            Start free trial
            <ArrowRight size={18} />
          </button>
          <button
            onClick={() => document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" })}
            className="px-8 py-3 border-2 border-gray-300 text-gray-900 rounded-lg hover:border-gray-400 font-medium flex items-center justify-center gap-2"
          >
            <Play size={18} />
            Watch 90-sec demo
          </button>
        </div>
        <div className="text-sm text-gray-600 space-y-2">
          <p>No credit card · FTC-aligned · 50-state disclosure engine</p>
          <p>California SB 766 ready (Oct 2026)</p>
        </div>
      </div>
    </section>
  );

  // ─ Logo Wall ─
  const LogoWall = () => (
    <section className="py-12 bg-gray-50 border-y border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-gray-700 font-medium mb-8">Trusted by dealers from coast to coast.</p>
        {/* TODO: replace with real customer logos */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            "Freeman Ford",
            "Koons Lexus",
            "Westside Nissan",
            "Desert Mitsubishi",
            "River City Chevrolet",
            "Premier Select Auto Group",
          ].map((name) => (
            <div
              key={name}
              className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center text-center text-xs font-mono text-gray-500 h-20"
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ Demo ─
  const Demo = () => (
    <section id="demo" className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl overflow-hidden aspect-video flex items-center justify-center mb-8">
          <div className="text-center">
            <Play size={64} className="text-white mx-auto mb-4" />
            <p className="text-white font-semibold">Demo – 0:90</p>
          </div>
        </div>
        <p className="text-gray-700 font-medium mb-4">What you'll see:</p>
        <ul className="space-y-3 text-gray-600">
          <li className="flex items-start gap-3">
            <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <span>Decode a VIN in 800ms</span>
          </li>
          <li className="flex items-start gap-3">
            <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <span>Build a compliant addendum</span>
          </li>
          <li className="flex items-start gap-3">
            <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <span>Publish the shopper portal</span>
          </li>
        </ul>
      </div>
    </section>
  );

  // ─ How It Works ─
  const HowItWorks = () => (
    <section id="how" className="py-16 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-12 text-center">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { icon: Scan, title: "Decode", desc: "VIN lookup + NHTSA recalls in 800ms" },
            { icon: Printer, title: "Stick", desc: "Generate Zebra-ready window label" },
            { icon: Signature, title: "Sign", desc: "Tamper-evident e-signature gate" },
            { icon: Check, title: "Close", desc: "Shopper portal QR + shopper portal" },
          ].map((item, idx) => (
            <div key={idx} className="bg-white p-6 rounded-lg border border-gray-200 text-center">
              <div className="text-4xl font-bold text-blue-600 mb-3">{idx + 1}</div>
              <item.icon size={32} className="mx-auto text-blue-600 mb-3" />
              <h3 className="font-semibold text-gray-900 mb-2">{item.title}</h3>
              <p className="text-sm text-gray-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ Sticker to Shopper ─
  const StickerToShopper = () => (
    <section className="py-16 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-display text-display font-semibold mb-6">The only window sticker your buyer reads on their phone.</h2>
            <p className="text-gray-600 mb-6">
              The QR on the printed sticker resolves to <code className="bg-gray-100 px-2 py-1 rounded text-sm">/v/&lt;slug&gt;</code>, matching your dealership branding and WCAG 2.1 AA compliant for accessibility.
            </p>
          </div>
          <div className="flex justify-center">
            <div className="w-64 h-96 bg-gradient-to-b from-gray-100 to-gray-200 rounded-3xl border-8 border-gray-800 flex flex-col items-center justify-center p-4">
              <Logo variant="full" size={24} />
              <p className="text-sm font-semibold text-gray-900 mt-4 text-center">2024 Lexus RX 350</p>
              <div className="mt-4 space-y-2 w-full text-xs">
                <div className="bg-white rounded p-2 text-center">
                  <span className="font-medium text-gray-700">Premium Package</span>
                  <div className="text-gray-500 text-xs mt-1">Pre-Installed</div>
                </div>
                <div className="bg-white rounded p-2 text-center">
                  <span className="font-medium text-gray-700">All-Weather Mats</span>
                  <div className="text-gray-500 text-xs mt-1">Pre-Installed</div>
                </div>
                <div className="bg-white rounded p-2 text-center">
                  <span className="font-medium text-gray-700">VIN Shield</span>
                  <div className="text-gray-500 text-xs mt-1">Pre-Installed</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  // ─ Prep & Install Gate ─
  const PrepGate = () => (
    <section className="py-16 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-4 text-center">Verified before the car hits the lot.</h2>
        <p className="text-center text-gray-600 mb-8">
          Shop-foreman sign-off unlocks the public listing and shopper portal.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {["Acquired", "Inspected", "Installed", "Foreman Signed", "Ready", "Listed"].map((stage) => (
            <div key={stage} className="flex items-center gap-2">
              <div className="px-4 py-2 bg-white border-2 border-green-600 rounded-full text-sm font-medium text-gray-900 flex items-center gap-2">
                <Check size={16} className="text-green-600" />
                {stage}
              </div>
              {stage !== "Listed" && <ArrowRight size={20} className="text-gray-400" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ Features ─
  const Features = () => (
    <section id="features" className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-12 text-center">Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[
            { icon: Globe, title: "State-by-state disclosure engine", desc: "All 50 states" },
            { icon: Scan, title: "VIN decode + Black Book pricing", desc: "Real-time lookup" },
            { icon: ShieldCheck, title: "NHTSA recall + Takata stop-sale", desc: "Safety compliance" },
            { icon: FileText, title: "Monroney-grade typography", desc: "FTC standards" },
            { icon: Sparkles, title: "AI disclosure copilot", desc: "Smart suggestions" },
            { icon: Lock, title: "UETA/E-SIGN tamper-evident sign-off", desc: "Legal binding" },
            { icon: Printer, title: "Zebra/Brother/DYMO universal print", desc: "All printers" },
            { icon: Camera, title: "Prep + install photo workflow", desc: "Documentation" },
            { icon: QrCode, title: "Public shopper portal + QR", desc: "Mobile-first" },
            { icon: Wrench, title: "Product rules engine", desc: "Custom logic" },
            { icon: Languages, title: "Multi-language", desc: "ES/ZH/TL/VI/KO" },
            { icon: Database, title: "Immutable audit vault", desc: "Compliance trail" },
          ].map((feature, idx) => (
            <div key={idx} className="bg-gray-50 p-6 rounded-lg border border-gray-200">
              <feature.icon size={28} className="text-blue-600 mb-3" />
              <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
              <p className="text-sm text-gray-600">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ ROI Calculator ─
  const ROICalculator = () => {
    const [deals, setDeals] = useState(50);
    const [accessoryRev, setAccessoryRev] = useState(650);
    const [disputes, setDisputes] = useState(3);

    const incrementalAnnualRevenue = deals * 12 * accessoryRev * 0.15;
    const complianceHoursSaved = deals * 12 * 0.4;
    const riskAvoided = disputes * 4500;
    // Compliance Suite annual cost — the tier that unlocks the prep gate, audit vault, and state engine.
    const yearCost = 999 * 12;
    const roi = ((incrementalAnnualRevenue + riskAvoided - yearCost) / yearCost) * 100;

    const fmt = (n: number) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

    return (
      <section id="roi" className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-display font-semibold mb-12 text-center">ROI Calculator</h2>
          <div className="bg-white p-8 rounded-lg border border-gray-200 mb-8">
            <div className="space-y-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Deals per month: {deals}
                </label>
                <input
                  type="range"
                  min="10"
                  max="500"
                  value={deals}
                  onChange={(e) => setDeals(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Avg accessory revenue per deal: {fmt(accessoryRev)}
                </label>
                <input
                  type="range"
                  min="200"
                  max="2000"
                  step="50"
                  value={accessoryRev}
                  onChange={(e) => setAccessoryRev(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Doc-fee-related disputes per year: {disputes}
                </label>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={disputes}
                  onChange={(e) => setDisputes(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-600 mb-2">Annual Revenue Lift</p>
                <p className="text-2xl font-bold text-blue-600">{fmt(incrementalAnnualRevenue)}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-600 mb-2">Hours Saved Annually</p>
                <p className="text-2xl font-bold text-green-600">{complianceHoursSaved.toFixed(0)}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-600 mb-2">Risk Avoided</p>
                <p className="text-2xl font-bold text-purple-600">{fmt(riskAvoided)}</p>
              </div>
              <div className="bg-amber-50 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-600 mb-2">ROI</p>
                <p className="text-2xl font-bold text-amber-600">{roi.toFixed(0)}%</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  // ─ Comparison ─
  const Comparison = () => (
    <section id="compare" className="py-16 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-12 text-center">How we compare</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-300">
                <th className="text-left py-4 px-4 font-semibold text-gray-900">Feature</th>
                <th className="text-center py-4 px-4 font-semibold text-gray-900">AutoLabels.io</th>
                <th className="text-center py-4 px-4 font-semibold text-gray-900">Old DMS plugin</th>
                <th className="text-center py-4 px-4 font-semibold text-gray-900">Word doc + PDF</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "VIN decode + NHTSA recall", al: true, dms: false, doc: false },
                { feature: "State disclosure engine (50)", al: true, dms: false, doc: false },
                { feature: "Digital UETA sign-off", al: true, dms: false, doc: false },
                { feature: "Shopper-facing QR portal", al: true, dms: false, doc: false },
                { feature: "Prep + install gate", al: true, dms: false, doc: false },
                { feature: "Immutable audit trail", al: true, dms: false, doc: false },
                { feature: "Zebra + universal print", al: true, dms: false, doc: false },
                { feature: "California SB 766 ready", al: true, dms: false, doc: false },
                { feature: "Transparent flat pricing", al: true, dms: "partial", doc: false },
              ].map((row, idx) => (
                <tr key={idx} className="border-b border-gray-200">
                  <td className="py-4 px-4 text-gray-900 font-medium">{row.feature}</td>
                  <td className="py-4 px-4 text-center">
                    {row.al === true ? <Check size={20} className="text-green-600 mx-auto" /> : row.al === false ? <X size={20} className="text-red-600 mx-auto" /> : <Minus size={20} className="text-amber-600 mx-auto" />}
                  </td>
                  <td className="py-4 px-4 text-center">
                    {row.dms === true ? <Check size={20} className="text-green-600 mx-auto" /> : row.dms === false ? <X size={20} className="text-red-600 mx-auto" /> : <Minus size={20} className="text-amber-600 mx-auto" />}
                  </td>
                  <td className="py-4 px-4 text-center">
                    {row.doc === true ? <Check size={20} className="text-green-600 mx-auto" /> : row.doc === false ? <X size={20} className="text-red-600 mx-auto" /> : <Minus size={20} className="text-amber-600 mx-auto" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );

  // ─ Testimonials ─
  const Testimonials = () => (
    <section className="py-16 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-12 text-center">What dealers say</h2>
        {/* TODO: replace with real customer stories */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              quote: "We went from 6 addendums a week to 27. The prep-gate alone saved our GM from a state AG letter.",
              author: "Jim Holloway",
              title: "General Manager",
              company: "Freeman Ford",
              city: "Jackson MS",
            },
            {
              quote: "Our customers scan the QR and read the sticker on their phone. VDP bounce-rate dropped 18%.",
              author: "Maria Chen",
              title: "Digital Marketing Director",
              company: "Koons Lexus",
              city: "Tysons Corner VA",
            },
            {
              quote: "Set up was 11 minutes. My 58-year-old finance director did it alone.",
              author: "Tony Ruiz",
              title: "Dealer Principal",
              company: "Desert Mitsubishi",
              city: "Mesa AZ",
            },
          ].map((test, idx) => (
            <div key={idx} className="bg-white p-8 rounded-lg border border-gray-200">
              <Quote size={24} className="text-blue-600 mb-4" />
              <p className="text-gray-600 mb-6 italic">{test.quote}</p>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-cyan-400 rounded-full"></div>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900">{test.author}</p>
                  <p className="text-gray-600">{test.title}</p>
                  <p className="text-gray-600">{test.company}, {test.city}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ Press ─
  const Press = () => (
    <section className="py-12 bg-white border-y border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-gray-700 font-medium mb-8">As seen at / In</p>
        {/* TODO: replace with real press logos */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {["Automotive News", "Car Dealership Guy", "NADA Show", "Shark Tank"].map((press) => (
            <div
              key={press}
              className="bg-gray-100 border border-gray-200 rounded-lg p-4 flex items-center justify-center text-center text-xs font-medium text-gray-500 h-20"
            >
              {press}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ Pricing ─
  const Pricing = () => (
    <section id="pricing" className="py-16 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-3 text-center">Pricing</h2>
        <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
          One FTC Section 5 enforcement action is up to <strong className="text-gray-900">$53,088</strong> per violation. Compliance Pro is $999/mo.
          <span className="block mt-1">Small price to pay.</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {[
            {
              name: "Essential",
              price: "$299",
              period: "per rooftop/month",
              desc: "Window stickers + addendums, up to 75 VINs/month",
              featured: false,
              cta: "Start trial",
              bundledNote: "Free with any Autocurb.io subscription",
              items: [
                "Up to 75 VINs / month",
                "New + used car window stickers",
                "Full addendum builder",
                "VIN decode + NHTSA recall",
                "Shopper portal (QR + embed)",
                "Zebra + universal print",
                "Email support",
              ],
            },
            {
              name: "Unlimited",
              price: "$499",
              period: "per rooftop/month",
              desc: "Unlimited vehicles for high-volume dealers",
              featured: true,
              cta: "Start trial",
              items: [
                "Everything in Essential, plus:",
                "Unlimited VINs",
                "Product rules engine",
                "Custom branding + logo kit",
                "Leads + analytics dashboard",
                "Priority support",
                "Onboarding assist",
              ],
            },
            {
              name: "Compliance Pro",
              price: "$999",
              period: "per rooftop/month",
              desc: "Full scan-to-signed FTC flow for airtight deals",
              featured: false,
              cta: "Talk to sales",
              items: [
                "Everything in Unlimited, plus:",
                "50-state disclosure engine",
                "Prep + install gate with foreman sign-off",
                "UETA / E-SIGN tamper-evident audit vault",
                "Multi-language addendums (es/zh/tl/vi/ko)",
                "CA SB 766 ready (Oct 2026)",
                "DMS webhooks (vAuto / VinSolutions / CDK)",
                "Dedicated success manager",
              ],
            },
          ].map((tier, idx) => (
            <div
              key={idx}
              className={`rounded-lg p-8 border-2 ${
                tier.featured ? "border-blue-600 bg-white shadow-premium" : "border-gray-200 bg-white"
              }`}
            >
              {tier.featured && <div className="text-center mb-4 text-sm font-semibold text-blue-600">FEATURED</div>}
              <h3 className="text-2xl font-bold text-gray-900 mb-2">{tier.name}</h3>
              <p className="text-gray-600 text-sm mb-4">{tier.desc}</p>
              <div className="mb-3">
                <span className="text-4xl font-bold text-gray-900">{tier.price}</span>
                <span className="text-gray-600 text-sm ml-2">/ {tier.period}</span>
              </div>
              {tier.bundledNote && (
                <div className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                  <Check size={12} className="text-emerald-600" />
                  {tier.bundledNote}
                </div>
              )}
              {!tier.bundledNote && <div className="mb-6" />}
              <button
                onClick={() =>
                  tier.cta === "Talk to sales"
                    ? window.open("mailto:hello@autolabels.io")
                    : user ? navigate("/dashboard") : (window.location.href = "mailto:hello@autolabels.io?subject=AutoLabels.io%20access%20request")
                }
                className={`w-full py-3 rounded-lg font-medium mb-6 ${
                  tier.featured
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "border-2 border-gray-300 text-gray-900 hover:border-gray-400"
                }`}
              >
                {tier.cta}
              </button>
              <ul className="space-y-3 text-sm">
                {tier.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-600">
                    <Check size={16} className="text-green-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="font-semibold text-gray-900 mb-4">All plans include:</p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            {[
              "VIN decode",
              "State engine",
              "E-SIGN",
              "Audit vault",
              "Shopper portal",
              "Zebra print",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-gray-600">
                <Check size={16} className="text-green-600 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  // ─ FAQ ─
  const FAQ = () => (
    <section id="faq" className="py-16 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="font-display text-display font-semibold mb-12 text-center">Frequently asked questions</h2>
        <div className="space-y-4">
          {[
            {
              q: "Do you handle the FTC Buyers Guide for used cars?",
              a: "Yes — bilingual (English + Spanish), As-Is / Implied / Warranty, 16 CFR 455 compliant.",
            },
            {
              q: "What happened to the CARS Rule?",
              a: "The 5th Circuit vacated it on January 27, 2025. We stay FTC-aligned via Section 5 and implement individual state laws like California SB 766 (effective October 1, 2026).",
            },
            {
              q: "Is digital signing legally binding?",
              a: "Yes. We follow UETA and the federal E-SIGN Act — tamper-evident content hash, IP, user-agent, timestamp, and consent are captured and stored server-side.",
            },
            {
              q: "Can the accessory addendum be viewed from our website?",
              a: "Yes. Every VIN has a public /v/<slug> URL with WCAG 2.1 AA accessibility, and an iframe embed snippet your web team can drop on the VDP.",
            },
            {
              q: "What if the internet drops?",
              a: "Draft stickers save to an offline queue and sync when the connection returns.",
            },
            {
              q: "Does it print to Zebra?",
              a: "Yes — ZPL direct via WebUSB, plus Brother QL, DYMO, and any CUPS/PDF printer.",
            },
            {
              q: "What DMS integrations?",
              a: "vAuto, VinSolutions, CDK, and Reynolds via webhooks, plus Zapier/Make for the rest.",
            },
            {
              q: "Is there a contract?",
              a: "Month-to-month. Cancel anytime. No setup fees.",
            },
          ].map((faq, idx) => (
            <details
              key={idx}
              className="group border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-gray-300"
            >
              <summary className="flex items-center justify-between font-semibold text-gray-900 select-none">
                {faq.q}
                <ChevronDown size={20} className="text-gray-400 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="text-gray-600 mt-4">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );

  // ─ Final CTA ─
  const FinalCTA = () => (
    <section className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-blue-600 to-cyan-600 rounded-2xl p-12 text-center shimmer-hero">
          <h2 className="font-display text-display font-semibold text-white mb-6">Stop printing stickers the 2010 way.</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => user ? navigate("/dashboard") : (window.location.href = "mailto:hello@autolabels.io?subject=AutoLabels.io%20access%20request")}
              className="px-8 py-3 bg-white text-blue-600 rounded-lg hover:bg-gray-100 font-medium flex items-center justify-center gap-2"
            >
              Start free trial
              <ArrowRight size={18} />
            </button>
            <button
              onClick={() => document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" })}
              className="px-8 py-3 border-2 border-white text-white rounded-lg hover:bg-white/10 font-medium"
            >
              Watch demo
            </button>
          </div>
        </div>
      </div>
    </section>
  );

  // ─ Footer ─
  const Footer = () => (
    <footer className="bg-gray-900 text-gray-200 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <h3 className="font-semibold text-white mb-4">Product</h3>
            <ul className="space-y-2 text-sm">
              <li><a className="hover:text-gray-200 cursor-pointer">Window Stickers</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Addendums</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Compliance</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Shopper Portal</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li><a onClick={() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" })} className="hover:text-gray-200 cursor-pointer">FAQ</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Brand</a></li>
              <li><a onClick={() => navigate("/about")} className="hover:text-gray-200 cursor-pointer">About</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Changelog</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-4">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li><a className="hover:text-gray-200 cursor-pointer">Privacy</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Terms</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">E-SIGN Disclosure</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-4">Contact</h3>
            <ul className="space-y-2 text-sm">
              <li><a href="mailto:hello@autolabels.io" className="hover:text-gray-200 flex items-center gap-2"><Mail size={16} /> hello@autolabels.io</a></li>
              <li><a className="hover:text-gray-200 cursor-pointer">Request demo</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-700 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Logo variant="full" size={24} />
            <p className="text-sm text-gray-300">© 2026 AutoLabels.io — Built for the American dealer.</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-300">
            <a href="mailto:hello@autolabels.io" className="hover:text-white">hello@autolabels.io</a>
            <span className="text-gray-500">·</span>
            <button
              onClick={() => navigate("/login?admin=1")}
              className="hover:text-white"
            >
              Admin
            </button>
          </div>
        </div>
      </div>
    </footer>
  );

  return (
    <div className="bg-white">
      <Navigation />
      <Hero />
      <LogoWall />
      <Demo />
      <HowItWorks />
      <StickerToShopper />
      <PrepGate />
      <Features />
      <ROICalculator />
      <Comparison />
      <Testimonials />
      <Press />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
};

export default Landing;
