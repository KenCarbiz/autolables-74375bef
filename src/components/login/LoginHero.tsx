import {
  IconVehicleTruth,
  IconComplianceShield,
  IconRetailOperations,
  type LoginIconProps,
} from "@/components/login/LoginIcons";

interface LoginHeroProps {
  year: number;
}

type HeroIcon = (props: LoginIconProps) => JSX.Element;

interface HeroFeature {
  Icon: HeroIcon;
  title: string;
  sub: string;
}

const HERO_FEATURES: HeroFeature[] = [
  {
    Icon: IconVehicleTruth,
    title: "Vehicle Truth",
    sub: "VIN intelligence, pricing, equipment and lifecycle",
  },
  {
    Icon: IconComplianceShield,
    title: "Compliance Engine",
    sub: "Rules, disclosures, audit trail and digital signing",
  },
  {
    Icon: IconRetailOperations,
    title: "Retail Operations",
    sub: "Get Ready, merchandising, documents and customer delivery",
  },
];

interface HeroProofPoint {
  value: string;
  label: string;
}

// Pack rule (005_LOGIN_TEXT_COPY.md): these are mockup figures, not
// verified metrics — confirm with the owner before they ship live.
const PROOF_POINTS: HeroProofPoint[] = [
  { value: "10,000+", label: "VEHICLES PROCESSED" },
  { value: "NATIONWIDE", label: "DEALERSHIPS" },
  { value: "ZERO COMPROMISE", label: "ON COMPLIANCE" },
];

export default function LoginHero({ year }: LoginHeroProps): JSX.Element {
  return (
    <section className="login-hero">
      <img
        className="login-hero-car"
        src="/login-assets/hero-car.png"
        alt=""
        aria-hidden="true"
      />
      <div className="login-hero-content">
        <div className="login-hero-brand" aria-label="AutoLabels.io" role="img">
          <span className="login-hero-wordmark">
            <span className="login-hero-wordmark-auto">auto</span>
            <span className="login-hero-wordmark-labels">(LABELS)</span>
          </span>
          <p className="login-hero-tagline">CLEAR · COMPLIANT · CONSISTENT.</p>
        </div>

        <div className="login-hero-main">
          <h1 className="login-hero-title">
            <span className="login-hero-title-line">Clear.</span>
            <span className="login-hero-title-line">Compliant.</span>
            <span className="login-hero-title-line">Consistent.</span>
          </h1>
          <p className="login-hero-kicker">
            One vehicle truth from acquisition to retail.
          </p>
          <div className="login-hero-accent" aria-hidden="true" />
          <p className="login-hero-description">
            The dealer label platform — every sticker, addendum, and Buyers
            Guide that leaves your lot, perfectly priced and ready to sign.
          </p>
          <ul className="login-hero-features">
            {HERO_FEATURES.map(({ Icon, title, sub }) => (
              <li className="login-hero-feature" key={title}>
                <div className="login-hero-feature-icon">
                  <Icon />
                </div>
                <div className="login-hero-feature-body">
                  <p className="login-hero-feature-title">{title}</p>
                  <p className="login-hero-feature-sub">{sub}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <ul className="login-hero-proof">
          {PROOF_POINTS.map(({ value, label }) => (
            <li className="login-hero-proof-item" key={label}>
              <p className="login-hero-proof-value">{value}</p>
              <p className="login-hero-proof-label">{label}</p>
            </li>
          ))}
        </ul>

        <p className="login-hero-footer">
          © {year} AutoLabels.io. All rights reserved.
        </p>
      </div>
    </section>
  );
}
