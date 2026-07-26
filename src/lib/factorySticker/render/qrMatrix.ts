// Dependency-free QR encoder: byte mode, ECC level M, versions 1-6
// (auto-selected), standard mask evaluation, 4-module quiet zone. Emits a
// boolean matrix for vector realization in PDF and SVG.

export const QR_QUIET_ZONE = 4;

interface BlockSpec {
  ecPerBlock: number;
  groups: Array<[count: number, dataPerBlock: number]>;
}

const EC_M: Record<number, BlockSpec> = {
  1: { ecPerBlock: 10, groups: [[1, 16]] },
  2: { ecPerBlock: 16, groups: [[1, 28]] },
  3: { ecPerBlock: 26, groups: [[1, 44]] },
  4: { ecPerBlock: 18, groups: [[2, 32]] },
  5: { ecPerBlock: 24, groups: [[2, 43]] },
  6: { ecPerBlock: 16, groups: [[4, 27]] },
};

const REMAINDER_BITS: Record<number, number> = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 };

const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

const MAX_VERSION = 6;

const dataCapacityBytes = (version: number): number => {
  const spec = EC_M[version];
  const codewords = spec.groups.reduce((a, [n, d]) => a + n * d, 0);
  return codewords - 2;
};

// GF(256) tables for Reed-Solomon over 0x11d.
const GF_EXP = new Array<number>(512);
const GF_LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

const rsGeneratorPoly = (degree: number): number[] => {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
};

const rsEncode = (data: number[], ecLen: number): number[] => {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
};

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const bchFormat = (data5: number): number => {
  let rem = data5 << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= gen << (i - 10);
  }
  return ((data5 << 10) | rem) ^ 0b101010000010010;
};

export interface QrEncoding {
  version: number;
  mask: number;
  /** Core matrix size (modules per side, excluding quiet zone). */
  coreSize: number;
  /** Full matrix size including the quiet zone. */
  size: number;
  quietZone: number;
  /** size x size booleans, true = dark, quiet zone included. */
  matrix: boolean[][];
}

export function encodeQrMatrix(text: string): QrEncoding {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length) throw new Error("qr: empty payload");

  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= dataCapacityBytes(v)) { version = v; break; }
  }
  if (!version) throw new Error(`qr: payload of ${bytes.length} bytes exceeds version ${MAX_VERSION} ECC M capacity`);

  const spec = EC_M[version];
  const totalDataCodewords = spec.groups.reduce((a, [n, d]) => a + n * d, 0);

  const buf = new BitBuffer();
  buf.push(0b0100, 4);
  buf.push(bytes.length, 8);
  for (const b of bytes) buf.push(b, 8);
  const capacityBits = totalDataCodewords * 8;
  buf.push(0, Math.min(4, capacityBits - buf.bits.length));
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);
  const dataCodewords: number[] = [];
  for (let i = 0; i < buf.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
    dataCodewords.push(byte);
  }
  const padBytes = [0xec, 0x11];
  for (let i = 0; dataCodewords.length < totalDataCodewords; i++) {
    dataCodewords.push(padBytes[i % 2]);
  }

  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [count, dataPerBlock] of spec.groups) {
    for (let b = 0; b < count; b++) {
      const block = dataCodewords.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      blocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ecPerBlock));
    }
  }
  const interleaved: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) interleaved.push(ec[i]);
  }

  const bitStream: number[] = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) bitStream.push((byte >> i) & 1);
  }
  for (let i = 0; i < REMAINDER_BITS[version]; i++) bitStream.push(0);

  const coreSize = 17 + 4 * version;
  const modules: number[][] = Array.from({ length: coreSize }, () => new Array<number>(coreSize).fill(0));
  const isFunction: boolean[][] = Array.from({ length: coreSize }, () => new Array<boolean>(coreSize).fill(false));

  const set = (r: number, c: number, dark: boolean): void => {
    modules[r][c] = dark ? 1 : 0;
    isFunction[r][c] = true;
  };

  const placeFinder = (r0: number, c0: number): void => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= coreSize || cc < 0 || cc >= coreSize) continue;
        const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, dark);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, coreSize - 7);
  placeFinder(coreSize - 7, 0);

  for (let i = 8; i < coreSize - 8; i++) {
    if (!isFunction[6][i]) set(6, i, i % 2 === 0);
    if (!isFunction[i][6]) set(i, 6, i % 2 === 0);
  }

  const centers = ALIGNMENT_CENTERS[version];
  for (const cr of centers) {
    for (const cc of centers) {
      if (isFunction[cr][cc]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          set(cr + r, cc + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  set(coreSize - 8, 8, true);

  const formatCells: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { formatCells.push([8, i]); formatCells.push([i, 8]); }
  }
  for (let i = 0; i < 8; i++) {
    formatCells.push([8, coreSize - 1 - i]);
    formatCells.push([coreSize - 1 - i, 8]);
  }
  for (const [r, c] of formatCells) {
    if (!isFunction[r][c]) { modules[r][c] = 0; isFunction[r][c] = true; }
  }

  const dataCells: Array<[number, number]> = [];
  let upward = true;
  for (let col = coreSize - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < coreSize; i++) {
      const r = upward ? coreSize - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (!isFunction[r][c]) dataCells.push([r, c]);
      }
    }
    upward = !upward;
  }
  for (let i = 0; i < dataCells.length; i++) {
    const [r, c] = dataCells[i];
    modules[r][c] = i < bitStream.length ? bitStream[i] : 0;
  }

  // ISO/IEC 18004 format placement: MSB (bit 14) first along the top-left
  // sequence, bits 14..8 up the bottom-left column, bits 7..0 across the
  // top-right row.
  const writeFormat = (grid: number[][], mask: number): void => {
    const format = bchFormat((0b00 << 3) | mask);
    const bit = (i: number): number => (format >> i) & 1;
    const a: Array<[number, number]> = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    for (let k = 0; k < 15; k++) grid[a[k][0]][a[k][1]] = bit(14 - k);
    for (let k = 0; k < 7; k++) grid[coreSize - 1 - k][8] = bit(14 - k);
    for (let k = 0; k < 8; k++) grid[8][coreSize - 8 + k] = bit(7 - k);
    grid[coreSize - 8][8] = 1;
  };

  const penalty = (grid: number[][]): number => {
    let score = 0;
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < coreSize; i++) {
        let run = 1;
        for (let j = 1; j < coreSize; j++) {
          const cur = axis === 0 ? grid[i][j] : grid[j][i];
          const prev = axis === 0 ? grid[i][j - 1] : grid[j - 1][i];
          if (cur === prev) {
            run++;
            if (j === coreSize - 1 && run >= 5) score += 3 + (run - 5);
          } else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1;
          }
        }
      }
    }
    for (let r = 0; r < coreSize - 1; r++) {
      for (let c = 0; c < coreSize - 1; c++) {
        const v = grid[r][c];
        if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) score += 3;
      }
    }
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < coreSize; i++) {
        for (let j = 0; j <= coreSize - 11; j++) {
          let m1 = true;
          let m2 = true;
          for (let k = 0; k < 11; k++) {
            const v = axis === 0 ? grid[i][j + k] : grid[j + k][i];
            if (v !== p1[k]) m1 = false;
            if (v !== p2[k]) m2 = false;
          }
          if (m1) score += 40;
          if (m2) score += 40;
        }
      }
    }
    let dark = 0;
    for (const row of grid) for (const v of row) dark += v;
    const pct = (dark * 100) / (coreSize * coreSize);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  };

  let bestMask = 0;
  let bestScore = Infinity;
  let bestGrid: number[][] = modules;
  for (let mask = 0; mask < 8; mask++) {
    const grid = modules.map((row) => row.slice());
    for (let r = 0; r < coreSize; r++) {
      for (let c = 0; c < coreSize; c++) {
        if (!isFunction[r][c] && MASKS[mask](r, c)) grid[r][c] ^= 1;
      }
    }
    writeFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestGrid = grid;
    }
  }

  const size = coreSize + QR_QUIET_ZONE * 2;
  const matrix: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (let r = 0; r < coreSize; r++) {
    for (let c = 0; c < coreSize; c++) {
      matrix[r + QR_QUIET_ZONE][c + QR_QUIET_ZONE] = bestGrid[r][c] === 1;
    }
  }

  return { version, mask: bestMask, coreSize, size, quietZone: QR_QUIET_ZONE, matrix };
}
