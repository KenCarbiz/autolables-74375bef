import { useNavigate } from "react-router-dom";
import Logo from "@/components/brand/Logo";
import Seo from "@/components/Seo";
import { ArrowRight, ShieldCheck, Lock, FileText, Database, Mail, KeyRound, ScrollText } from "lucide-react";

const Section = ({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-2xl border border-border bg-card p-6 lg:p-8 shadow-sm">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
    </div>
    <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
  </section>
);

const Trust = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-background min-h-screen">
      <Seo
        title="Trust & Security — AutoLabels.io"
        description="How AutoLabels.io handles dealer and customer data: access controls, tenant isolation, signing evidence, retention, subprocessors, and how to contact us about security or privacy."
        path="/trust"
      />

      <nav className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <button onClick={() => navigate("/")} aria-label="Home">
            <Logo variant="full" size={28} />
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/about")}
              className="hidden md:inline-flex text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              About
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

      <header className="max-w-6xl mx-auto px-6 lg:px-8 pt-16 pb-10">
        <h1 className="text-3xl lg:text-5xl font-display font-semibold tracking-tight text-foreground">
          Trust & Security
        </h1>
        <p className="mt-4 text-base text-muted-foreground max-w-3xl">
          AutoLabels.io is a multi-tenant SaaS that helps franchise and independent dealers produce
          window stickers, addendums, Buyers Guides, and customer-signed delivery packets. This
          page is maintained by the AutoLabels.io team to answer common security, privacy, and
          compliance questions about the product.
        </p>
        <p className="mt-3 text-xs text-muted-foreground max-w-3xl">
          This page describes our current practices and is not an independent certification or
          third-party audit. It is updated as the product evolves.
        </p>
      </header>

      <main className="max-w-6xl mx-auto px-6 lg:px-8 pb-20 grid gap-6 md:grid-cols-2">
        <Section icon={ShieldCheck} title="Access & authentication">
          <p>
            Dealer users sign in with email + password or Google. Each user belongs to one or more
            tenants (dealer groups) through an accepted membership record; unaccepted invitations
            do not grant access.
          </p>
          <p>
            Platform-admin actions are gated behind a dedicated <code>admin</code> role stored in a
            separate role table, never on the user profile, to prevent client-side privilege
            escalation.
          </p>
        </Section>

        <Section icon={Database} title="Tenant isolation">
          <p>
            Every tenant-owned table enforces row-level security in the database. Policies scope
            reads and writes to rows whose <code>tenant_id</code> matches the caller's accepted
            tenant memberships. The same rules apply to API access, edge functions, and the
            dealer UI.
          </p>
          <p>
            Customer-facing pages (public listings, signing links, installer proof) use scoped,
            single-purpose tokens and never expose other tenants' data.
          </p>
        </Section>

        <Section icon={Lock} title="Hosting & platform">
          <p>
            The app runs on Lovable Cloud, backed by a managed Postgres database, object storage,
            and serverless functions. Data in transit uses TLS; data at rest is encrypted by the
            managed platform.
          </p>
          <p>
            Secrets (API keys for SMS, email, scraping, billing) are stored as server-side
            environment variables and are never shipped to the browser.
          </p>
        </Section>

        <Section icon={ScrollText} title="Signing evidence & audit trail">
          <p>
            Customer-signed addendums and deal packets capture an E-SIGN consent record, a SHA-256
            content hash, signer IP, user agent, and timestamp. Signed documents are immutable —
            edits after signature are blocked at the database level.
          </p>
          <p>
            Sensitive actions are appended to a hash-chained audit log so any retroactive tampering
            can be detected by re-verifying the chain.
          </p>
        </Section>

        <Section icon={FileText} title="Data we collect">
          <p>
            <strong className="text-foreground">Dealer data:</strong> staff names and emails,
            inventory (VIN, year/make/model, photos, prices), product catalogs, signed documents,
            and operational events.
          </p>
          <p>
            <strong className="text-foreground">Customer data (entered by the dealer or the
            customer during signing):</strong> name, contact info, signature image, signing IP and
            user agent, and any acknowledgments the dealer requires for the transaction.
          </p>
          <p>
            We do not sell customer or dealer data. Customer data is processed on behalf of the
            dealer who collected it.
          </p>
        </Section>

        <Section icon={KeyRound} title="Subprocessors & integrations">
          <p>
            We use a small set of subprocessors to run the service: the managed cloud platform
            (database, storage, functions), email and SMS delivery providers, payment processing
            (Stripe), web scraping for advertised-price verification, and AI providers used for
            description writing and compliance review.
          </p>
          <p>
            Optional integrations (DMS feeds, Autocurb inventory sync, NHTSA recall lookup) only
            transmit the fields needed for that integration.
          </p>
        </Section>

        <Section icon={Database} title="Retention & deletion">
          <p>
            Signed documents and their audit records are retained for the life of the dealer's
            account so they remain available for compliance and dispute defense. Operational data
            (inventory, drafts, scraped snapshots) is retained while the account is active.
          </p>
          <p>
            A dealer admin can request export or deletion of their tenant's data by contacting us
            at the address below. We honor verified customer privacy requests forwarded by the
            dealer of record.
          </p>
        </Section>

        <Section icon={Mail} title="Reporting a security issue">
          <p>
            If you believe you have found a vulnerability or a privacy issue, please email{" "}
            <a className="text-primary underline" href="mailto:security@autolabels.io">
              security@autolabels.io
            </a>{" "}
            with steps to reproduce. We respond to legitimate reports and do not pursue
            good-faith researchers who follow responsible disclosure.
          </p>
          <p>
            General privacy and data-handling questions can also go to{" "}
            <a className="text-primary underline" href="mailto:privacy@autolabels.io">
              privacy@autolabels.io
            </a>
            .
          </p>
        </Section>

        <Section icon={ShieldCheck} title="Compliance posture">
          <p>
            AutoLabels.io is built around U.S. motor-vehicle retailing rules — the federal Monroney
            Label Act, the FTC Used Car Rule (16 CFR Part 455), NHTSA recall disclosure, and
            state-specific addendum requirements such as California SB 766 and Connecticut K-208.
          </p>
          <p>
            We provide tooling to help dealers meet these rules; the dealer remains responsible
            for the accuracy of the disclosures they sign and deliver. We do not currently claim
            SOC 2, ISO 27001, HIPAA, or PCI certification.
          </p>
        </Section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} AutoLabels.io</span>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/about")} className="hover:text-foreground">About</button>
            <button onClick={() => navigate("/brand")} className="hover:text-foreground">Brand</button>
            <a href="mailto:security@autolabels.io" className="hover:text-foreground">Security contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Trust;
