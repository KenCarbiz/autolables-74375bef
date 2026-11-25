// Neutralize spreadsheet formula triggers (=, +, -, @, tab, CR) at the start
// of a cell (including after leading whitespace) so exported CSVs cannot
// execute formulas when opened in Excel, Google Sheets, or LibreOffice Calc.
const FORMULA_PREFIX_RE = /^[\s]*[=+\-@]|^[\t\r]/;

export function neutralizeCsvCell(value: unknown): string {
  if (value == null) return "";
  const s = value instanceof Date
    ? value.toISOString()
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return FORMULA_PREFIX_RE.test(s) ? `'${s}` : s;
}

export function escapeCsvCell(value: unknown, alwaysQuote = true): string {
  const safe = neutralizeCsvCell(value);
  if (alwaysQuote || /[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}