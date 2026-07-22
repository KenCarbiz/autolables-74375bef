// ──────────────────────────────────────────────────────────────────────
// LandingFeatureIcon — the single, consistent icon system for the public
// landing page. Built on the professional lucide-react line-icon library
// (crisp, detailed, one visual family) instead of hand-drawn glyphs.
//
// Each feature composes a primary lucide glyph on a softly-rounded #EFF6FF
// tile (1px #BFDBFE border, no gradient/glow/bevel/3D), with a small corner
// verification badge (check / shield) — and, where it clarifies meaning, a
// second small mark — mirroring the approved reference sheet. Repeated
// concepts (sign / signed proof) deliberately share the same composition.
//
// Sizes are explicit (never inherited) so an icon never shrinks when its
// adjoining label wraps:
//   hero      → 56×56 tile / 32 glyph desktop · 50×50 / 28 mobile
//   card      → 52×52 tile / 30 glyph desktop · 48×48 / 28 mobile
//   workflow  → 52×52 tile / 30 glyph desktop · 48×48 / 28 mobile
// ──────────────────────────────────────────────────────────────────────
import {
  QrCode, Waypoints, FilePenLine, ArrowRightLeft, DollarSign, FileText,
  ShieldCheck, FileLock2, BadgeDollarSign, FolderCheck, ScanBarcode, CarFront,
  Sticker, Handshake, TrendingUp, MoveRight, ListChecks, Clock, Camera, Wrench,
  ClipboardList, UserCheck, CircleCheck, BadgeCheck, type LucideIcon,
} from "lucide-react";

export type LandingGlyphName =
  | "qrPassport" | "routedLead" | "digitalSignature" | "priceReconciliation"
  | "ftcAddendum" | "tamperEvident" | "sellAddons" | "ownYourPrice"
  | "auditDefense" | "decode" | "stick" | "close" | "vehicleArrives"
  | "getReadyQueue" | "installProof" | "foremanSignoff" | "rightStickerOut";

type Variant = "hero" | "card" | "workflow";

const TILE: Record<Variant, string> = {
  hero: "h-[50px] w-[50px] min-h-[50px] min-w-[50px] lg:h-[56px] lg:w-[56px] lg:min-h-[56px] lg:min-w-[56px]",
  card: "h-12 w-12 min-h-[48px] min-w-[48px] lg:h-[52px] lg:w-[52px] lg:min-h-[52px] lg:min-w-[52px]",
  workflow: "h-12 w-12 min-h-[48px] min-w-[48px] lg:h-[52px] lg:w-[52px] lg:min-h-[52px] lg:min-w-[52px]",
};
const GLYPH: Record<Variant, string> = {
  hero: "h-7 w-7 lg:h-8 lg:w-8",
  card: "h-7 w-7 lg:h-[30px] lg:w-[30px]",
  workflow: "h-7 w-7 lg:h-[30px] lg:w-[30px]",
};

interface Comp {
  primary: LucideIcon;
  badge?: LucideIcon;             // corner verification mark (check / shield)
  secondary?: LucideIcon;         // small clarifying mark, top-left
}

const COMP: Record<LandingGlyphName, Comp> = {
  qrPassport: { primary: QrCode, badge: CircleCheck },
  routedLead: { primary: Waypoints, badge: CircleCheck },
  digitalSignature: { primary: FilePenLine, badge: CircleCheck },
  priceReconciliation: { primary: ArrowRightLeft, secondary: DollarSign, badge: CircleCheck },
  ftcAddendum: { primary: FileText, badge: ShieldCheck },
  tamperEvident: { primary: FileLock2, badge: CircleCheck },
  sellAddons: { primary: BadgeDollarSign, badge: ShieldCheck },
  ownYourPrice: { primary: ArrowRightLeft, secondary: DollarSign, badge: ShieldCheck },
  auditDefense: { primary: FolderCheck, badge: ShieldCheck },
  decode: { primary: ScanBarcode, badge: CircleCheck },
  stick: { primary: CarFront, badge: Sticker },
  close: { primary: Handshake, secondary: TrendingUp, badge: CircleCheck },
  vehicleArrives: { primary: CarFront, badge: MoveRight },
  getReadyQueue: { primary: ListChecks, badge: Clock },
  installProof: { primary: Camera, badge: Wrench },
  foremanSignoff: { primary: ClipboardList, badge: UserCheck },
  rightStickerOut: { primary: CarFront, badge: BadgeCheck },
};

interface Props {
  name: LandingGlyphName;
  variant?: Variant;
  className?: string;
}

export function LandingFeatureIcon({ name, variant = "card", className = "" }: Props) {
  const c = COMP[name];
  const Primary = c.primary;
  const Badge = c.badge;
  const Secondary = c.secondary;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] shadow-[0_1px_2px_rgba(15,23,42,0.08)] ${TILE[variant]} ${className}`}
    >
      <span className={`relative inline-flex items-center justify-center text-[#2563EB] ${GLYPH[variant]}`} aria-hidden="true">
        <Primary className="h-full w-full" strokeWidth={1.9} absoluteStrokeWidth />
        {Secondary && (
          <span className="absolute -top-1 -left-1 flex items-center justify-center rounded-[3px] bg-[#EFF6FF]">
            <Secondary className="h-3.5 w-3.5" strokeWidth={2.4} absoluteStrokeWidth />
          </span>
        )}
        {Badge && (
          <span className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-[#EFF6FF]">
            <Badge className="h-[17px] w-[17px]" strokeWidth={2.1} absoluteStrokeWidth />
          </span>
        )}
      </span>
    </span>
  );
}

export default LandingFeatureIcon;
