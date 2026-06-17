import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Check, Smartphone, Mail, Link2, MessageSquare, Monitor } from "lucide-react";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";

export interface ComplianceReceiptItem {
  label: string;
  // Optional sub-text, e.g. the statute or numeric guard cited.
  cite?: string;
}

export type DeliveryChannel = "qr" | "email" | "sms" | "device" | "link";

interface QRCodeModalProps {
  open: boolean;
  signingUrl: string;
  onClose: () => void;
  // Wave 15.3 — when set, renders a green compliance-receipt callout above
  // the QR. Surfaces the silent enforcement that just ran.
  complianceReceipt?: ComplianceReceiptItem[];
  // Phase 2 lifecycle context — when the addendum has been locked + versioned
  // these render in the header and the delivery channels light up.
  dealId?: string;
  version?: string;
  customerEmail?: string;
  // Fired when the dealer picks a delivery channel, so the caller can append
  // a `link_sent` event to the addendum timeline.
  onChannel?: (channel: DeliveryChannel) => void;
  onSendEmail?: (email: string) => Promise<void> | void;
  onSendSms?: (phone: string) => Promise<void> | void;
}

const QRCodeModal = ({
  open, signingUrl, onClose, complianceReceipt, dealId, version, customerEmail, onChannel, onSendEmail, onSendSms,
}: QRCodeModalProps) => {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState(customerEmail || "");
  const [smsOpen, setSmsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const sendSms = async () => {
    if (!phone.trim() || !onSendSms) return;
    setSending(true);
    try {
      await onSendSms(phone.trim());
      onChannel?.("sms");
      setSmsOpen(false);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const hasReceipt = (complianceReceipt?.length ?? 0) > 0;

  const copyLink = () => {
    navigator.clipboard.writeText(signingUrl).then(() => {
      setCopied(true);
      onChannel?.("link");
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const sendEmail = async () => {
    if (!email.trim() || !onSendEmail) return;
    setSending(true);
    try {
      await onSendEmail(email.trim());
      onChannel?.("email");
      setEmailOpen(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-center">
          <h2 className="text-lg font-bold font-barlow-condensed text-foreground">Signature Delivery</h2>
          {(version || dealId) && (
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">
              {version ? `Addendum ${version}` : ""}
              {version && dealId ? " · " : ""}
              {dealId ? `ID ${dealId.slice(0, 8)}` : ""}
            </p>
          )}
        </div>

        {hasReceipt && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-left">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" strokeWidth={2.25} />
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">
                Compliance verified · locked for signature
              </p>
            </div>
            <ul className="space-y-1">
              {complianceReceipt!.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-emerald-900">
                  <Check className="w-3 h-3 mt-0.5 flex-shrink-0" strokeWidth={2.5} />
                  <span>
                    {item.label}
                    {item.cite && <span className="ml-1 text-emerald-700/70 font-mono text-[10px]">{item.cite}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col items-center py-1">
          <div className="rounded-xl border border-border p-3 bg-white">
            <QRCodeSVG value={signingUrl} size={168} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Scan to review &amp; sign on a phone or iPad</p>
        </div>

        {/* Delivery channels */}
        <div className="grid grid-cols-2 gap-2">
          <a
            href={signingUrl}
            onClick={() => onChannel?.("device")}
            className="inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-navy text-primary-foreground text-sm font-semibold col-span-2"
          >
            <Monitor className="w-4 h-4" />
            Sign on this device
          </a>

          <button
            onClick={() => setEmailOpen((v) => !v)}
            disabled={!onSendEmail}
            className="inline-flex items-center justify-center gap-1.5 h-11 rounded-lg border-2 border-border text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Mail className="w-4 h-4" />
            Email
          </button>

          <button
            onClick={copyLink}
            className="inline-flex items-center justify-center gap-1.5 h-11 rounded-lg border-2 border-border text-sm font-semibold text-foreground hover:bg-muted"
          >
            <Link2 className="w-4 h-4" />
            {copied ? "Copied" : "Copy link"}
          </button>

          <button
            onClick={() => setSmsOpen((v) => !v)}
            disabled={!onSendSms}
            className="inline-flex items-center justify-center gap-1.5 h-11 rounded-lg border-2 border-border text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed col-span-2"
          >
            <MessageSquare className="w-4 h-4" />
            Text message
          </button>
        </div>

        {smsOpen && onSendSms && (
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="(555) 123-4567"
              type="tel"
              className="flex-1 h-10 rounded-lg border-2 border-border px-3 text-sm bg-background text-foreground"
            />
            <button
              onClick={sendSms}
              disabled={sending || !phone.trim()}
              className="h-10 px-4 rounded-lg bg-teal text-primary-foreground text-sm font-semibold disabled:opacity-50"
            >
              {sending ? "Sending…" : "Text"}
            </button>
          </div>
        )}

        {emailOpen && onSendEmail && (
          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@email.com"
              type="email"
              className="flex-1 h-10 rounded-lg border-2 border-border px-3 text-sm bg-background text-foreground"
            />
            <button
              onClick={sendEmail}
              disabled={sending || !email.trim()}
              className="h-10 px-4 rounded-lg bg-teal text-primary-foreground text-sm font-semibold disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground break-all font-mono text-center">{signingUrl}</p>
        <div className="flex items-center gap-1.5 justify-center text-[10px] text-muted-foreground">
          <Smartphone className="w-3 h-3" />
          Highest completion: text or QR in the showroom
        </div>

        <button onClick={onClose} className="w-full h-10 rounded-lg border-2 border-border text-sm font-semibold text-foreground hover:bg-muted">
          Done
        </button>
      </div>
    </div>
  );
};

export default QRCodeModal;
