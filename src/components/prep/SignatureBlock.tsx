import SignaturePad from "@/components/addendum/SignaturePad";

interface SignatureBlockProps {
  name: string;
  onName: (value: string) => void;
  nameLabel?: string;
  showCompany?: boolean;
  company?: string;
  onCompany?: (value: string) => void;
  onSignature: (data: string, type: "draw" | "type") => void;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
}

export const CONFIRMATION_TEXT =
  "I confirm the work recorded above was completed on this vehicle and the information is accurate.";

const SignatureBlock = ({
  name,
  onName,
  nameLabel,
  showCompany,
  company,
  onCompany,
  onSignature,
  confirmed,
  onConfirmed,
}: SignatureBlockProps) => (
  <div className="rounded-2xl bg-card border border-border shadow-premium p-4 space-y-4">
    <div>
      <label className="block text-xs font-semibold text-foreground mb-1.5">
        {nameLabel || "Your name"} *
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder="Full name"
        className="w-full h-12 px-4 rounded-xl border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
    {showCompany && (
      <div>
        <label className="block text-xs font-semibold text-foreground mb-1.5">Company *</label>
        <input
          type="text"
          value={company || ""}
          onChange={(e) => onCompany?.(e.target.value)}
          placeholder="Company name"
          className="w-full h-12 px-4 rounded-xl border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    )}
    <SignaturePad label="Signature" subtitle="Sign to certify this work" onChange={onSignature} />
    <label className="flex items-start gap-3 min-h-[48px] cursor-pointer">
      <input
        type="checkbox"
        checked={confirmed}
        onChange={(e) => onConfirmed(e.target.checked)}
        className="w-5 h-5 mt-0.5 rounded accent-blue-600"
      />
      <span className="text-sm text-foreground">{CONFIRMATION_TEXT}</span>
    </label>
  </div>
);

export default SignatureBlock;
