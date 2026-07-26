import { describe, expect, it } from "vitest";
import { encodeQrMatrix, QR_QUIET_ZONE } from "./qrMatrix";

const URL = "https://autolabels.io/v/demo-qx80";

const isFinderAt = (matrix: boolean[][], r0: number, c0: number): boolean => {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const expected =
        r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      if (matrix[r0 + r][c0 + c] !== expected) return false;
    }
  }
  return true;
};

const bchRemainderIsZero = (fifteenBits: number): boolean => {
  let v = fifteenBits;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if (v & (1 << i)) v ^= gen << (i - 10);
  }
  return v === 0;
};

describe("qrMatrix", () => {
  it("produces a square matrix with quiet zone", () => {
    const enc = encodeQrMatrix(URL);
    expect(enc.size).toBe(enc.coreSize + QR_QUIET_ZONE * 2);
    expect(enc.coreSize).toBe(17 + 4 * enc.version);
    expect(enc.matrix.length).toBe(enc.size);
    for (const row of enc.matrix) expect(row.length).toBe(enc.size);
  });

  it("keeps the quiet zone entirely light", () => {
    const enc = encodeQrMatrix(URL);
    for (let i = 0; i < enc.size; i++) {
      for (const q of [0, 1, 2, 3]) {
        expect(enc.matrix[q][i]).toBe(false);
        expect(enc.matrix[enc.size - 1 - q][i]).toBe(false);
        expect(enc.matrix[i][q]).toBe(false);
        expect(enc.matrix[i][enc.size - 1 - q]).toBe(false);
      }
    }
  });

  it("selects version 3-6 for passport URLs and places finder patterns at three corners", () => {
    const enc = encodeQrMatrix(URL);
    expect(enc.version).toBeGreaterThanOrEqual(3);
    expect(enc.version).toBeLessThanOrEqual(6);
    const q = QR_QUIET_ZONE;
    expect(isFinderAt(enc.matrix, q, q)).toBe(true);
    expect(isFinderAt(enc.matrix, q, q + enc.coreSize - 7)).toBe(true);
    expect(isFinderAt(enc.matrix, q + enc.coreSize - 7, q)).toBe(true);
  });

  it("is deterministic for the same input", () => {
    expect(encodeQrMatrix(URL)).toEqual(encodeQrMatrix(URL));
  });

  it("differs for different inputs", () => {
    const a = encodeQrMatrix(URL);
    const b = encodeQrMatrix("https://autolabels.io/v/demo-rav4");
    expect(JSON.stringify(a.matrix)).not.toBe(JSON.stringify(b.matrix));
  });

  it("writes parsable format information (ECC M + chosen mask, valid BCH)", () => {
    const enc = encodeQrMatrix(URL);
    const q = QR_QUIET_ZONE;
    const cells: Array<[number, number]> = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    let format = 0;
    cells.forEach(([r, c], k) => {
      if (enc.matrix[q + r][q + c]) format |= 1 << (14 - k);
    });
    const unmasked = format ^ 0b101010000010010;
    expect(bchRemainderIsZero(unmasked)).toBe(true);
    const data5 = unmasked >> 10;
    expect(data5 >> 3).toBe(0b00);
    expect(data5 & 0b111).toBe(enc.mask);
  });

  it("handles a ~90 character URL within version 6 and rejects oversize payloads", () => {
    const long = `https://app.autolabels.io/v/${"x".repeat(60)}`;
    expect(long.length).toBeGreaterThanOrEqual(85);
    const enc = encodeQrMatrix(long);
    expect(enc.version).toBeLessThanOrEqual(6);
    expect(() => encodeQrMatrix("x".repeat(200))).toThrow(/capacity/);
    expect(() => encodeQrMatrix("")).toThrow();
  });
});
