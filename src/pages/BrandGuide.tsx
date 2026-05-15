import { useState } from "react";
import { AUTOCURB_BRAND } from "@/data/autocurbBrand";
import Logo from "@/components/brand/Logo";
import {
  Copy,
  Check,
  Sparkles,
  Type,
  Palette,
  MessageSquare,
  Code,
  Download,
} from "lucide-react";
import { toast } from "sonner";

const BrandGuide = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const b = AUTOCURB_BRAND;

  const copy = (value: string, id: string) => {
    navigator.clipboard.writeText(value);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="bg-muted/20 min-h-[calc(100vh-3.5rem)]">
      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white py-20 px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <Logo variant="full" size={42} inverted tagline />
          <h1 className="text-5xl lg:text-6xl font-black tracking-tighter font-display mt-10 leading-none">
            Brand Guidelines
          </h1>
          <p className="text-xl text-white/85 mt-4 max-w-xl">
            The visual and voice system for AutoLabels.io — clear, compliant, consistent labels for every vehicle on the lot.
          </p>
          <div className="mt-8 flex items-center gap-2 text-xs text-white/75">
            <span>v1.0</span>
            <span>·</span>
            <span>Updated {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-16">
        {/* Positioning */}
        <Section
          eyebrow="Positioning"
          title="The modern dealer's command center"
          subtitle={b.positioning}
        >
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground mb-2">Mission</p>
              <p className="text-base text-foreground leading-relaxed">{b.mission}</p>
            </Card>
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground mb-2">Vision</p>
              <p className="text-base text-foreground leading-relaxed">{b.vision}</p>
            </Card>
          </div>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            {b.principles.map((p) => (
              <Card key={p.number}>
                <p className="text-[10px] font-bold text-blue-600 tabular-nums">{p.number}</p>
                <h4 className="text-base font-semibold text-foreground mt-1">{p.title}</h4>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.body}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* Logo variants */}
        <Section eyebrow="Identity" title="Logo" subtitle="The mark, the wordmark, and the full lockup — always respect clear space of 1× the mark height.">
          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Mark" subtitle="Square app icon, favicon">
              <div className="py-8 flex items-center justify-center bg-muted/30 rounded-lg">
                <Logo variant="mark" size={80} />
              </div>
              <DownloadLink href="/logo-mark.svg" label="logo-mark.svg" />
            </Card>
            <Card title="Full" subtitle="Headers, emails, business cards">
              <div className="py-8 flex items-center justify-center bg-muted/30 rounded-lg">
                <Logo variant="full" size={42} />
              </div>
              <DownloadLink href="/logo-full.svg" label="logo-full.svg" />
            </Card>
            <Card title="Wordmark" subtitle="Text only">
              <div className="py-8 flex items-center justify-center bg-muted/30 rounded-lg">
                <Logo variant="wordmark" size={40} />
              </div>
            </Card>
            <Card title="Inverted" subtitle="Dark backgrounds, video">
              <div className="py-8 flex items-center justify-center bg-slate-950 rounded-lg">
                <Logo variant="full" size={42} inverted />
              </div>
              <DownloadLink href="/logo-full-inverted.svg" label="logo-full-inverted.svg" />
            </Card>
          </div>
        </Section>

        {/* Colors */}
        <Section eyebrow="Palette" title="Color System" subtitle="Wide palette, tight compositions. Never use more than 3 colors in one piece." icon={Palette}>
          <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground mb-3">Core</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {b.colors.core.map((c) => (
              <ColorSwatch key={c.name} color={c} onCopy={copy} copiedId={copiedId} />
            ))}
          </div>

          <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground mb-3 mt-8">Accents</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {b.colors.accents.map((c) => (
              <ColorSwatch key={c.name} color={c} onCopy={copy} copiedId={copiedId} />
            ))}
          </div>

          <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground mb-3 mt-8">Gradients</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(b.colors.gradients).map(([name, value]) => (
              <div key={name} className="rounded-xl overflow-hidden border border-border shadow-premium">
                <div className="h-20" style={{ background: value }} />
                <div className="p-3 bg-card flex items-center justify-between">
                  <span className="text-xs font-medium capitalize">{name.replace(/([A-Z])/g, " $1").trim()}</span>
                  <button
                    onClick={() => copy(value, `grad-${name}`)}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {copiedId === `grad-${name}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    Copy CSS
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Typography */}
        <Section eyebrow="Typography" title="Type System" subtitle="Inter for everything, with JetBrains Mono for data." icon={Type}>
          <div className="bg-card rounded-xl border border-border shadow-premium p-6 space-y-6">
            {b.typography.scale.map((t) => (
              <div key={t.label} className="flex items-baseline gap-6 border-b border-border pb-4 last:border-0">
                <div className="w-20 flex-shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{t.size}</p>
                </div>
                <p
                  className="font-display font-semibold text-foreground truncate"
                  style={{ fontSize: t.size, lineHeight: t.lineHeight, letterSpacing: "-0.02em" }}
                >
                  Every curb. Every car.
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* Voice */}
        <Section eyebrow="Voice" title="How AutoLabels Talks" subtitle="Direct, confident, respectful of both the dealer and the customer." icon={MessageSquare}>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {b.voice.attributes.map((attr) => (
              <Card key={attr.name}>
                <p className="text-sm font-semibold text-foreground">{attr.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{attr.desc}</p>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-label text-emerald-600 mb-2">Words we use</p>
              <div className="flex flex-wrap gap-1.5">
                {b.voice.wordsWeUse.map((w) => (
                  <span key={w} className="text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
                    {w}
                  </span>
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-label text-red-600 mb-2">Words we avoid</p>
              <div className="flex flex-wrap gap-1.5">
                {b.voice.wordsWeAvoid.map((w) => (
                  <span key={w} className="text-xs font-medium bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded line-through">
                    {w}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-label text-emerald-600 mb-2">✓ Good</p>
              <ul className="space-y-2">
                {b.sampleCopy.good.map((s, i) => (
                  <li key={i} className="text-sm text-foreground italic">"{s}"</li>
                ))}
              </ul>
            </Card>
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-label text-red-600 mb-2">✗ Bad</p>
              <ul className="space-y-2">
                {b.sampleCopy.bad.map((s, i) => (
                  <li key={i} className="text-sm text-muted-foreground line-through italic">"{s}"</li>
                ))}
              </ul>
            </Card>
          </div>
        </Section>

        {/* Verbs */}
        <Section eyebrow="Vocabulary" title="Four Verbs" subtitle="The product is built around four actions.">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {b.verbs.map((v, i) => (
              <Card key={v.verb}>
                <p className="text-[10px] font-bold text-blue-600 tabular-nums">0{i + 1}</p>
                <h4 className="text-2xl font-bold tracking-tight font-display text-foreground mt-2">{v.verb}</h4>
                <p className="text-xs text-muted-foreground mt-1">{v.body}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* Naming */}
        <Section eyebrow="Product Surfaces" title="Naming Conventions" subtitle="Named after parts of the dealership.">
          <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-label text-muted-foreground">Surface</th>
                  <th className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-label text-muted-foreground">AutoLabels Name</th>
                </tr>
              </thead>
              <tbody>
                {b.naming.map((n) => (
                  <tr key={n.surface} className="border-t border-border">
                    <td className="px-5 py-3 text-sm text-muted-foreground">{n.surface}</td>
                    <td className="px-5 py-3 text-sm font-semibold text-foreground">{n.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Email signature */}
        <Section eyebrow="Templates" title="Email Signature" subtitle="Use this HTML block for internal and partner-facing email." icon={Code}>
          <EmailSignature onCopy={copy} copiedId={copiedId} />
        </Section>

        {/* Social card preview */}
        <Section eyebrow="Social" title="Open Graph Card" subtitle="1200 × 630. Used for link previews on social + messaging.">
          <div className="rounded-xl overflow-hidden border border-border shadow-premium-lg">
            <img src="/og-image.svg" alt="AutoLabels.io OG card" className="w-full" />
          </div>
          <DownloadLink href="/og-image.svg" label="og-image.svg" />
        </Section>
      </div>

      {/* Footer */}
      <footer className="bg-slate-950 text-white/60 py-10 px-6 mt-16">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <Logo variant="full" size={28} inverted tagline />
          <p className="text-xs">© {new Date().getFullYear()} AutoLabels.io · Clear. Compliant. Consistent.</p>
        </div>
      </footer>
    </div>
  );
};

const Section = ({
  eyebrow,
  title,
  subtitle,
  children,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  icon?: typeof Sparkles;
}) => (
  <section>
    <div className="flex items-center gap-2 mb-2">
      {Icon && <Icon className="w-3.5 h-3.5 text-blue-600" />}
      <p className="text-[10px] font-bold uppercase tracking-label text-blue-600">{eyebrow}</p>
    </div>
    <h2 className="text-3xl font-bold tracking-tight font-display text-foreground">{title}</h2>
    {subtitle && <p className="text-base text-muted-foreground mt-2 max-w-2xl">{subtitle}</p>}
    <div className="mt-6">{children}</div>
  </section>
);

const Card = ({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-5">
    {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
    {subtitle && <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>}
    {children}
  </div>
);

const ColorSwatch = ({
  color,
  onCopy,
  copiedId,
}: {
  color: { name: string; hex: string; hsl: string; use: string };
  onCopy: (value: string, id: string) => void;
  copiedId: string | null;
}) => (
  <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
    <div className="h-24" style={{ backgroundColor: color.hex }} />
    <div className="p-3">
      <p className="text-sm font-semibold text-foreground">{color.name}</p>
      <button
        onClick={() => onCopy(color.hex, `hex-${color.name}`)}
        className="text-[10px] text-muted-foreground hover:text-foreground font-mono mt-1 flex items-center gap-1"
      >
        {copiedId === `hex-${color.name}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {color.hex}
      </button>
      <p className="text-[10px] text-muted-foreground/70 mt-1 leading-tight">{color.use}</p>
    </div>
  </div>
);

const EmailSignature = ({ onCopy, copiedId }: { onCopy: (v: string, id: string) => void; copiedId: string | null }) => {
  const signatureHtml = `<table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, 'Inter', sans-serif;">
  <tr>
    <td style="padding-right: 16px; border-right: 2px solid #2563EB;">
      <img src="https://autolabels.io/logo-mark.svg" width="48" height="48" alt="AutoLabels" />
    </td>
    <td style="padding-left: 16px;">
      <div style="font-size: 15px; font-weight: 700; color: #0B2041; letter-spacing: -0.01em;">Your Name</div>
      <div style="font-size: 13px; color: #64748B;">Title · AutoLabels.io</div>
      <div style="font-size: 12px; color: #2563EB; margin-top: 4px;">Every label. Every vehicle. Every deal.</div>
      <div style="font-size: 12px; color: #64748B; margin-top: 6px;">
        <a href="https://autolabels.io" style="color: #2563EB; text-decoration: none;">autolabels.io</a>
      </div>
    </td>
  </tr>
</table>`;

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border shadow-premium p-8">
        <table cellPadding={0} cellSpacing={0} border={0} style={{ fontFamily: "Inter, sans-serif" }}>
          <tbody>
            <tr>
              <td style={{ paddingRight: 16, borderRight: "2px solid #2563EB" }}>
                <Logo variant="mark" size={48} />
              </td>
              <td style={{ paddingLeft: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0B2041", letterSpacing: "-0.01em" }}>
                  Your Name
                </div>
                <div style={{ fontSize: 13, color: "#64748B" }}>Title · AutoLabels.io</div>
                <div style={{ fontSize: 12, color: "#2563EB", marginTop: 4 }}>Every label. Every vehicle. Every deal.</div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>
                  <a href="https://autolabels.io" style={{ color: "#2563EB", textDecoration: "none" }}>autolabels.io</a>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        onClick={() => onCopy(signatureHtml, "email-sig")}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
      >
        {copiedId === "email-sig" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        Copy signature HTML
      </button>
    </div>
  );
};

const DownloadLink = ({ href, label }: { href: string; label: string }) => (
  <a
    href={href}
    download
    className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
  >
    <Download className="w-3 h-3" />
    {label}
  </a>
);

export default BrandGuide;
