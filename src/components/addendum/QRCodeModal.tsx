import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Check } from "lucide-react";

export interface ComplianceReceiptItem {
  label: string;
  // Optional sub-text, e.g. the statute or numeric guard cited.
  cite?: string;
}

interface QRCodeModalProps {
  open: boolean;
  signingUrl: string;
  onClose: () => void;
  // Wave 15.3 — when set, renders a green compliance-receipt
  // callout above the QR. Surfaces the silent enforcement that
  // just ran (E-SIGN hashed, Buyers Guide attached, doc-fee
  // within state cap, recall clean) so the dealer sees what the
  // platform did, not just "link created".
  complianceReceipt?: ComplianceReceiptItem[];
}

const QRCodeModal = ({ open, signingUrl, onClose, complianceReceipt }: QRCodeModalProps) => {
  if (!open) return null;

  const hasReceipt = (complianceReceipt?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 max-w-md w-full text-center space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold font-barlow-condensed text-foreground">Customer Signing</h2>

        {hasReceipt && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-left">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" strokeWidth={2.25} />
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">
                Compliance verified · ready to sign
              </p>
            </div>
            <ul className="space-y-1">
              {complianceReceipt!.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-emerald-900">
                  <Check className="w-3 h-3 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                  <span>
                    {item.label}
                    {item.cite && (
                      <span className="ml-1 text-emerald-700/70 font-mono text-[10px]">
                        {item.cite}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Have the customer scan this QR code with their phone or iPad to sign and initial the addendum.
        </p>
        <div className="flex justify-center py-2">
          <QRCodeSVG value={signingUrl} size={200} />
        </div>
        <p className="text-[10px] text-muted-foreground break-all font-mono">{signingUrl}</p>
        <div className="flex gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(signingUrl).then(() => alert("Link copied!"))}
            className="flex-1 h-10 rounded-lg border-2 border-border text-sm font-semibold text-foreground hover:bg-muted"
          >
            Copy Link
          </button>
          <button onClick={onClose} className="flex-1 h-10 rounded-lg bg-navy text-primary-foreground text-sm font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default QRCodeModal;
