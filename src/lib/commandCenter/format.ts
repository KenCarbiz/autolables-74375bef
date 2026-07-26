// Display helpers shared by the three command surfaces and the pure package
// builder, so a date or a document name is never spelled two ways.

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const humanize = (s: string): string =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export const DOC_TYPE_LABEL: Record<string, string> = {
  window: "Window Sticker",
  addendum: "Addendum",
  passport: "Vehicle Passport",
  cpo_sheet: "CPO Sheet",
  buyers_guide: "FTC Buyers Guide",
  // generated_documents accepts 'k208' since 20260722180000_k208_ingest_forms_flow.
  k208: "CT K-208 Safety Inspection",
  // generated_documents accepts 'factory_sticker' since 20260727070000_factory_sticker_foundation.
  factory_sticker: "Factory Build Record",
};

export const documentLabel = (documentType: string | null | undefined): string =>
  DOC_TYPE_LABEL[String(documentType || "")] || humanize(String(documentType || "Document"));
