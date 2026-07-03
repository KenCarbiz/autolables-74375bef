// V3 Vehicle Passport design tokens — single source for the values that were
// duplicated verbatim across the passport surfaces. Centralized so the V3 look
// changes in one place. (The legacy V2 passport uses its own palette — #1a6dff
// / #1a9d5c — and is intentionally NOT consolidated here.)

export const BLUE = "#2563EB";
export const GREEN = "#16A34A";

// The standard elevated passport card: rounded, hairline border, soft shadow.
export const CARD =
  "rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.05)] print:break-inside-avoid print:shadow-none";
