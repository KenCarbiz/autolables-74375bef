// Transaction Audit Record — the evidentiary block that proves WHEN, WHERE,
// and on WHAT DEVICE a signing happened. Every value here comes straight out
// of the hashed canonical payload (no new data is invented), so it can be
// shown to the customer post-sign and embedded in the archived PDF as the
// court-facing record of the electronic signature.

interface TransactionAuditRecordProps {
  dealId: string;
  vin?: string | null;
  signedAt: string;
  generatedAt?: string | null;
  customerName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  contentHash?: string | null;
  location?: { latitude?: number | null; longitude?: number | null } | null;
}

// Best-effort device/browser from the UA string. Order matters: Edge and
// Chrome both contain "Safari"; modern iPadOS reports as Macintosh, so we
// fall back to a generic label rather than guessing wrong.
const deviceFromUA = (ua: string): string => {
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown device";
};

const browserFromUA = (ua: string): string => {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/CriOS|Chrome/i.test(ua)) return "Chrome";
  if (/FxiOS|Firefox/i.test(ua)) return "Firefox";
  if (/Safari/i.test(ua)) return "Safari";
  return "Browser";
};

const fmt = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit",
      });
};

const Field = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-400">{label}</p>
    <p className={`text-[12px] text-slate-800 truncate ${mono ? "font-mono" : "font-semibold"}`}>{value}</p>
  </div>
);

const TransactionAuditRecord = ({
  dealId, vin, signedAt, generatedAt, customerName, ip, userAgent, contentHash, location,
}: TransactionAuditRecordProps) => {
  const ua = userAgent || "";
  const hashShort = contentHash ? `${contentHash.slice(0, 12)}…${contentHash.slice(-8)}` : "—";
  const geo =
    location && location.latitude != null && location.longitude != null
      ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
      : "Not shared";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Transaction Audit Record</p>
        <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-600">SHA-256 sealed</span>
      </div>
      <div className="p-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Deal ID" value={dealId || "—"} mono />
        {vin && <Field label="VIN" value={vin} mono />}
        <Field label="Signed by" value={customerName || "—"} />
        <Field label="Signed at" value={fmt(signedAt)} />
        {generatedAt && <Field label="Generated" value={fmt(generatedAt)} />}
        <Field label="Device" value={ua ? deviceFromUA(ua) : "—"} />
        <Field label="Browser" value={ua ? browserFromUA(ua) : "—"} />
        <Field label="IP address" value={ip || "—"} mono />
        <Field label="Location" value={geo} mono />
        <div className="col-span-2 min-w-0">
          <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-400">Content hash</p>
          <p className="text-[12px] text-slate-800 font-mono break-all">{hashShort}</p>
        </div>
      </div>
      <p className="px-5 pb-4 text-[10px] text-slate-400 leading-relaxed">
        This record is captured at the moment of signature and hashed into the signed document. It is admissible
        evidence of the electronic signature under the federal E-SIGN Act and your state's UETA.
      </p>
    </div>
  );
};

export default TransactionAuditRecord;
