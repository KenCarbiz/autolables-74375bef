import { User, Users, Copy } from "lucide-react";

export interface CustomerInfo {
  buyer_first_name: string;
  buyer_middle_initial: string;
  buyer_last_name: string;
  buyer_suffix: string;
  buyer_address: string;
  buyer_city: string;
  buyer_state: string;
  buyer_zip: string;
  buyer_phone: string;
  buyer_email: string;
  cobuyer_first_name: string;
  cobuyer_middle_initial: string;
  cobuyer_last_name: string;
  cobuyer_suffix: string;
  cobuyer_address: string;
  cobuyer_city: string;
  cobuyer_state: string;
  cobuyer_zip: string;
  cobuyer_phone: string;
  cobuyer_email: string;
}

interface CustomerInfoSectionProps {
  info: CustomerInfo;
  onChange: (info: CustomerInfo) => void;
  showCobuyer: boolean;
  inkSaving?: boolean;
}

const SUFFIXES = ["", "Jr.", "Sr.", "II", "III", "IV", "V"];

// Format a US phone as (xxx) xxx-xxxx while the user types.
export const formatPhone = (v: string): string => {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

// Compose a full legal name "First M. Last Suffix" from the parts.
export const composeName = (first: string, mi: string, last: string, suffix: string): string =>
  [first?.trim(), mi?.trim() ? `${mi.trim().toUpperCase()}.` : "", last?.trim(), suffix?.trim()]
    .filter(Boolean)
    .join(" ");

const inputCls =
  "w-full border-b-[1.5px] border-border-custom bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50 leading-[1.9] h-7 pb-1";
const labelCls = "text-[7px] font-bold text-muted-foreground uppercase tracking-wider";

// Renders one person's fields (buyer or co-buyer) given the field prefix.
// MUST stay at module scope: defining it inside CustomerInfoSection makes it a
// new component type on every keystroke, which remounts the inputs and drops
// focus after each character.
const PersonFields = ({
  prefix,
  info,
  update,
}: {
  prefix: "buyer" | "cobuyer";
  info: CustomerInfo;
  update: (field: keyof CustomerInfo, value: string) => void;
}) => {
    const k = (s: string) => `${prefix}_${s}` as keyof CustomerInfo;
    return (
      <>
        {/* Name row */}
        <div className="grid grid-cols-6 gap-2 mb-1">
          <div className="col-span-2">
            <label className={labelCls}>First Name</label>
            <input value={info[k("first_name")]} onChange={(e) => update(k("first_name"), e.target.value)} placeholder="First" className={inputCls} />
          </div>
          <div className="col-span-1">
            <label className={labelCls}>M.I.</label>
            <input value={info[k("middle_initial")]} onChange={(e) => update(k("middle_initial"), e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 1).toUpperCase())} placeholder="M" maxLength={1} className={`${inputCls} text-center`} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Last Name</label>
            <input value={info[k("last_name")]} onChange={(e) => update(k("last_name"), e.target.value)} placeholder="Last" className={inputCls} />
          </div>
          <div className="col-span-1">
            <label className={labelCls}>Suffix</label>
            <select
              value={info[k("suffix")]}
              onChange={(e) => update(k("suffix"), e.target.value)}
              className={`${inputCls} cursor-pointer`}
            >
              {SUFFIXES.map((s) => (
                <option key={s} value={s}>{s || "—"}</option>
              ))}
            </select>
          </div>
        </div>
        {/* Address row */}
        <div className="grid grid-cols-6 gap-2 mb-1">
          <div className="col-span-3">
            <label className={labelCls}>Street Address</label>
            <input value={info[k("address")]} onChange={(e) => update(k("address"), e.target.value)} placeholder="123 Main St" className={inputCls} />
          </div>
          <div className="col-span-1">
            <label className={labelCls}>City</label>
            <input value={info[k("city")]} onChange={(e) => update(k("city"), e.target.value)} placeholder="City" className={inputCls} />
          </div>
          <div className="col-span-1">
            <label className={labelCls}>State</label>
            <input value={info[k("state")]} onChange={(e) => update(k("state"), e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase())} placeholder="CT" maxLength={2} className={`${inputCls} text-center uppercase`} />
          </div>
          <div className="col-span-1">
            <label className={labelCls}>ZIP</label>
            <input value={info[k("zip")]} onChange={(e) => update(k("zip"), e.target.value.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder="06010" className={inputCls} />
          </div>
        </div>
        {/* Contact row */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Phone</label>
            <input value={info[k("phone")]} onChange={(e) => update(k("phone"), formatPhone(e.target.value))} placeholder="(555) 555-5555" type="tel" inputMode="tel" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input value={info[k("email")]} onChange={(e) => update(k("email"), e.target.value)} placeholder="email@example.com" type="email" className={inputCls} />
          </div>
        </div>
      </>
    );
};

const CustomerInfoSection = ({ info, onChange, showCobuyer, inkSaving }: CustomerInfoSectionProps) => {
  const update = (field: keyof CustomerInfo, value: string) => {
    onChange({ ...info, [field]: value });
  };

  // Copy the buyer's address onto the co-buyer (common: spouses at one address).
  const copyAddressToCobuyer = () => {
    onChange({
      ...info,
      cobuyer_address: info.buyer_address,
      cobuyer_city: info.buyer_city,
      cobuyer_state: info.buyer_state,
      cobuyer_zip: info.buyer_zip,
    });
  };
  const hasBuyerAddress = !!(info.buyer_address || info.buyer_city || info.buyer_zip);

  return (
    <div className={`px-3 py-2 rounded ${inkSaving ? "bg-card border border-border" : "bg-light border border-border-custom"}`}>
      <div className="flex items-center gap-1 mb-1.5">
        <User className="w-3 h-3 text-muted-foreground" />
        <p className="text-[9px] font-bold text-foreground uppercase tracking-wide">Buyer Information</p>
      </div>
      <PersonFields prefix="buyer" info={info} update={update} />

      {showCobuyer && (
        <>
          <div className="flex items-center justify-between gap-2 mt-2 mb-1.5 pt-1.5 border-t border-border-custom/50">
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3 text-muted-foreground" />
              <p className="text-[9px] font-bold text-foreground uppercase tracking-wide">Co-Buyer Information <span className="text-muted-foreground font-normal normal-case">(optional)</span></p>
            </div>
            {hasBuyerAddress && (
              <button
                type="button"
                onClick={copyAddressToCobuyer}
                className="no-print inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wide text-primary hover:underline"
                title="Copy the buyer's address to the co-buyer"
              >
                <Copy className="w-2.5 h-2.5" /> Same as buyer
              </button>
            )}
          </div>
          <PersonFields prefix="cobuyer" info={info} update={update} />
        </>
      )}
    </div>
  );
};

export default CustomerInfoSection;
export const emptyCustomerInfo: CustomerInfo = {
  buyer_first_name: "",
  buyer_middle_initial: "",
  buyer_last_name: "",
  buyer_suffix: "",
  buyer_address: "",
  buyer_city: "",
  buyer_state: "",
  buyer_zip: "",
  buyer_phone: "",
  buyer_email: "",
  cobuyer_first_name: "",
  cobuyer_middle_initial: "",
  cobuyer_last_name: "",
  cobuyer_suffix: "",
  cobuyer_address: "",
  cobuyer_city: "",
  cobuyer_state: "",
  cobuyer_zip: "",
  cobuyer_phone: "",
  cobuyer_email: "",
};
