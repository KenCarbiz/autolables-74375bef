import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";

interface AddendumFooterProps {
  inkSaving?: boolean;
}

const AddendumFooter = ({ inkSaving }: AddendumFooterProps) => {
  const { settings } = useDealerSettings();
  const { currentStore } = useTenant();

  const name = currentStore?.name || settings.dealer_name;

  // Licensed-seller identity — printed on the signed record so the artifact
  // identifies the seller on its own face (dealer-defense / chargeback).
  const cityStateZip = [
    [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", "),
    settings.dealer_zip,
  ].filter(Boolean).join(" ");
  const sellerLine = [
    settings.dealer_address,
    cityStateZip,
    settings.dealer_phone ? `Tel ${settings.dealer_phone}` : "",
    settings.dealer_license_number ? `Dealer Lic #${settings.dealer_license_number}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className={`text-center py-2 border-t border-border-custom text-[9px] text-muted-foreground ${inkSaving ? "" : "bg-light"}`}>
      <p>Signed acknowledgment of dealer-installed products, optional products, and disclosures. Retain a signed copy for dealership records per applicable state law. A separate window label is displayed on the vehicle.</p>
      <p className="font-semibold mt-0.5">{name} · Dealer Addendum</p>
      {sellerLine && <p className="mt-0.5">{sellerLine}</p>}
    </div>
  );
};

export default AddendumFooter;
