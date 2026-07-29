// The shape every passport drawer returns, extracted so panel builders can
// live in their own modules without importing PassportPanel (which imports
// them back).
export interface PanelDef {
  title: string;
  subtitle: string;
  body: React.ReactNode;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  footerQuestion?: string;
  specialistLabel?: string;
  footerNote?: string;
  wide?: boolean;
  xl?: boolean;
}
