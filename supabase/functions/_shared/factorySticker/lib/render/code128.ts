// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/code128.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Code 128 encoder (subsets B/C with automatic selection) producing the
// module-width sequence for vector barcode realization, plus a decoder used
// by the QA round-trip tests.

const PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232",
];

const STOP_PATTERN = "2331112";
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

const digitRunAt = (s: string, i: number): number => {
  let n = 0;
  while (i + n < s.length && isDigit(s[i + n])) n++;
  return n;
};

export interface Code128Encoding {
  payload: string;
  codes: number[];
  checksum: number;
  /** Alternating bar/space module widths, starting with a bar. */
  widths: number[];
  totalModules: number;
}

export function encodeCode128(payload: string): Code128Encoding {
  if (!payload.length) throw new Error("code128: empty payload");
  for (const ch of payload) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`code128: unsupported character ${JSON.stringify(ch)}`);
  }

  const codes: number[] = [];
  let mode: "B" | "C";
  if (digitRunAt(payload, 0) >= 4) {
    mode = "C";
    codes.push(START_C);
  } else {
    mode = "B";
    codes.push(START_B);
  }

  let i = 0;
  while (i < payload.length) {
    if (mode === "C") {
      const run = digitRunAt(payload, i);
      if (run >= 2) {
        codes.push(Number(payload.slice(i, i + 2)));
        i += 2;
      } else {
        codes.push(CODE_B);
        mode = "B";
      }
    } else {
      const run = digitRunAt(payload, i);
      if (run >= 4) {
        if (run % 2 === 1) {
          codes.push(payload.charCodeAt(i) - 32);
          i += 1;
        }
        codes.push(CODE_C);
        mode = "C";
      } else {
        codes.push(payload.charCodeAt(i) - 32);
        i += 1;
      }
    }
  }

  let sum = codes[0];
  for (let j = 1; j < codes.length; j++) sum += codes[j] * j;
  const checksum = sum % 103;

  const symbols = [...codes, checksum];
  const widths: number[] = [];
  for (const value of symbols) {
    for (const d of PATTERNS[value]) widths.push(Number(d));
  }
  for (const d of STOP_PATTERN) widths.push(Number(d));

  return {
    payload,
    codes,
    checksum,
    widths,
    totalModules: widths.reduce((a, b) => a + b, 0),
  };
}

const VALUE_BY_PATTERN = new Map<string, number>(PATTERNS.map((p, v) => [p, v]));

/** Test-oriented decoder: module widths back to the encoded string, verifying checksum. */
export function decodeCode128(widths: number[]): string {
  if (widths.length < 6 + 6 + 7 || (widths.length - 7) % 6 !== 0) {
    throw new Error("code128 decode: malformed width sequence");
  }
  const stop = widths.slice(-7).join("");
  if (stop !== STOP_PATTERN) throw new Error("code128 decode: missing stop pattern");

  const values: number[] = [];
  for (let i = 0; i < widths.length - 7; i += 6) {
    const key = widths.slice(i, i + 6).join("");
    const value = VALUE_BY_PATTERN.get(key);
    if (value === undefined) throw new Error(`code128 decode: unknown pattern ${key}`);
    values.push(value);
  }

  const check = values.pop();
  let sum = values[0];
  for (let j = 1; j < values.length; j++) sum += values[j] * j;
  if (check !== sum % 103) throw new Error("code128 decode: checksum mismatch");

  const start = values[0];
  if (start !== START_B && start !== START_C) throw new Error("code128 decode: unsupported start code");
  let mode: "B" | "C" = start === START_C ? "C" : "B";

  let out = "";
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (mode === "C") {
      if (v === CODE_B) { mode = "B"; continue; }
      if (v > 99) throw new Error(`code128 decode: invalid subset C value ${v}`);
      out += String(v).padStart(2, "0");
    } else {
      if (v === CODE_C) { mode = "C"; continue; }
      if (v > 94) throw new Error(`code128 decode: unsupported subset B value ${v}`);
      out += String.fromCharCode(v + 32);
    }
  }
  return out;
}
