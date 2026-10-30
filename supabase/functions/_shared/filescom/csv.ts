// RFC 4180 CSV parser: quoted fields with commas, doubled quotes and line
// breaks; CRLF or LF; a leading UTF-8 BOM; fully blank rows are skipped.

export type CsvParse = { ok: true; headers: string[]; rows: string[][] } | { ok: false; reason: string; line?: number };

export function parseCsv(input: string): CsvParse {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let line = 1;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
    quotedField = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) records.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        const n = text[i];
        if (n !== undefined && n !== "," && n !== "\r" && n !== "\n") return { ok: false, reason: "quote_followed_by_text", line };
        continue;
      }
      if (c === "\n") line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field.length > 0 || quotedField) return { ok: false, reason: "quote_inside_unquoted_field", line };
      inQuotes = true;
      quotedField = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      endRow();
      line++;
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) return { ok: false, reason: "unterminated_quote", line };
  if (field.length > 0 || row.length > 0 || quotedField) endRow();
  const nonBlank = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonBlank.length === 0) return { ok: false, reason: "empty_file" };
  const [headers, ...rows] = nonBlank;
  return { ok: true, headers: headers.map((h) => h.trim()), rows };
}
