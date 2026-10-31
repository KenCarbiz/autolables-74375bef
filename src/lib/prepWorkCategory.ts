export type PrepWorkCategory = "detail" | "accessories" | "mechanical" | "reconditioning";

export const PREP_WORK_CATEGORIES: { key: PrepWorkCategory; label: string }[] = [
  { key: "detail", label: "Detail" },
  { key: "accessories", label: "Accessories" },
  { key: "mechanical", label: "Mechanical" },
  { key: "reconditioning", label: "Reconditioning" },
];

const RULES: [PrepWorkCategory, RegExp][] = [
  ["reconditioning", /\b(dent|touch[- ]?up|repair|refinish|respray|scratch|chip|windshield|glass|bumper)\b/i],
  ["mechanical", /\b(tire|tires|nitrogen|brake|oil|battery|alignment|rotor|filter|coolant|fluid|engine|transmission|suspension)\b/i],
  ["detail", /\b(detail|wash|polish|wax|ceramic|coating|protection|paint|fabric|interior|exterior|clean)\b/i],
];

export const prepWorkCategory = (productName: string): PrepWorkCategory => {
  for (const [key, re] of RULES) if (re.test(productName)) return key;
  return "accessories";
};

export const prepWorkCategories = (items: { product_name: string }[]): PrepWorkCategory[] =>
  Array.from(new Set(items.map((i) => prepWorkCategory(i.product_name || ""))));

export const prepProofNeeded = (row: {
  install_photos?: unknown[] | null;
  foreman_signature_data?: string | null;
}): string => {
  const needsPhoto = !row.install_photos || row.install_photos.length === 0;
  const needsSignature = !row.foreman_signature_data;
  if (needsPhoto && needsSignature) return "Photos + signature";
  if (needsPhoto) return "Photos";
  if (needsSignature) return "Signature";
  return "None";
};
