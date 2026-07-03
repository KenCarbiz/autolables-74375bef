// Dealer-page OEM copy generator. Labels are derived from the registry's
// official brand styling (INFINITI-style caps where the OEM wordmark is
// all-caps, Title Case otherwise); null/unresolved brands get generic
// labels so the page never fabricates a franchise claim.

import { type OemBrandKey, isLuxuryOemBrand, oemDisplayName } from "@/components/brand/OemLogoRegistry";

export interface OemDealerPageCopy {
  authorizedRetailerLabel: string;
  factoryTrainedTechniciansLabel: string;
  genuinePartsLabel: string;
  warrantySupportLabel: string;
  certifiedPreOwnedSupportLabel: string;
  certifiedServiceDepartmentLabel: string;
  ownershipExperienceLabel: string;
}

export function oemDealerPageCopy(brand: OemBrandKey | null): OemDealerPageCopy {
  if (!brand) {
    return {
      authorizedRetailerLabel: "Authorized Retailer",
      factoryTrainedTechniciansLabel: "Factory-Trained Technicians",
      genuinePartsLabel: "Genuine OEM Parts",
      warrantySupportLabel: "Warranty Support",
      certifiedPreOwnedSupportLabel: "Certified Pre-Owned Support",
      certifiedServiceDepartmentLabel: "Certified Service Department",
      ownershipExperienceLabel: "Ownership Support Experience",
    };
  }
  const name = oemDisplayName(brand);
  return {
    authorizedRetailerLabel: `${name} Authorized Retailer`,
    factoryTrainedTechniciansLabel: `Factory-Trained ${name} Technicians`,
    genuinePartsLabel: `Genuine ${name} Parts`,
    warrantySupportLabel: `${name} Warranty Support`,
    certifiedPreOwnedSupportLabel: `${name} Certified Pre-Owned Support`,
    certifiedServiceDepartmentLabel: `${name} Certified Service`,
    ownershipExperienceLabel: isLuxuryOemBrand(brand) ? "Luxury Ownership Experience" : "Ownership Support Experience",
  };
}
