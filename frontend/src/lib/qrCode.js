// Pure zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, ECC Level L, Versions 1-6).
// Generates real scannable SVG / Canvas QR codes offline under strict Content-Security-Policy ('self').

// Version 1..6 specs at ECC Level L: [size, totalDataCodewords, ecCodewordsPerBlock, numBlocks, alignmentCenterOrZero]
const VERSIONS_L = [
  null,
  [21, 19, 7, 1, 0],
  [25, 34, 10, 1, 18],
  [29, 55, 15, 1, 22],
  [33, 80, 20, 1, 26],
  [37, 108, 26, 1, 30],
  [41, 136, 18, 2, 34],
];

// GF(256) log/exp tables with primitive polynomial 0x11d
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const factor = EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j += 1) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

function computeFormatBits(eclBits, mask) {
  const data5 = (eclBits << 3) | mask;
  let rem = data5 << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data5 << 10) | rem) ^ 0x5412;
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

export function encodeQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let ver = 1;
  while (ver <= 6 && bytes.length + 2 > VERSIONS_L[ver][1]) ver += 1;
  if (ver > 6) throw new Error('Nội dung mã QR quá dài');

  const [size, totalData, ecPerBlock, numBlocks, alignPos] = VERSIONS_L[ver];

  // Pack bitstream: 4-bit Byte mode (0100) + 8-bit length + bytes + terminator + pad bytes
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  bytes.forEach((b) => pushBits(b, 8));
  const maxBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = new Uint8Array(totalData);
  for (let i = 0; i < bits.length / 8; i += 1) {
    let v = 0;
    for (let b = 0; b < 8; b += 1) v = (v << 1) | bits[i * 8 + b];
    dataCw[i] = v;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < totalData; i += 1, p += 1) {
    dataCw[i] = pads[p % 2];
  }

  // Reed-Solomon blocks & interleaving
  const blockLen = totalData / numBlocks;
  const dBlocks = [];
  const eBlocks = [];
  for (let b = 0; b < numBlocks; b += 1) {
    const slice = dataCw.subarray(b * blockLen, (b + 1) * blockLen);
    dBlocks.push(slice);
    eBlocks.push(rsRemainder(slice, ecPerBlock));
  }
  const fullCw = [];
  for (let i = 0; i < blockLen; i += 1) {
    for (let b = 0; b < numBlocks; b += 1) fullCw.push(dBlocks[b][i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (let b = 0; b < numBlocks; b += 1) fullCw.push(eBlocks[b][i]);
  }

  // Matrix: 0 = light, 1 = dark; isFunc marks function modules
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));
  const setFunc = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark ? 1 : 0;
    isFunc[r][c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (fr, fc) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(fr + dr, fc + dc, inOuter && (onBorder || inCore));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment pattern (Version 2..6 has single non-overlapping center at [alignPos, alignPos])
  if (alignPos > 0) {
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setFunc(alignPos + dr, alignPos + dc, dist !== 1);
      }
    }
  }

  // Dark module + reserve format areas
  setFunc(size - 8, 8, true);
  for (let i = 0; i <= 8; i += 1) {
    if (!isFunc[8][i]) setFunc(8, i, false);
    if (!isFunc[i][8]) setFunc(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    setFunc(8, size - 1 - i, false);
    if (i < 7) setFunc(size - 1 - i, 8, false);
  }

  // Place data bits in upward/downward 2-column zigzag
  let bitIdx = 0;
  const totalPayloadBits = fullCw.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v += 1) {
      const r = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        if (!isFunc[r][c]) {
          let dark = false;
          if (bitIdx < totalPayloadBits) {
            dark = ((fullCw[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx += 1;
          }
          modules[r][c] = dark ? 1 : 0;
        }
      }
    }
    upward = !upward;
  }

  // Pick lowest-penalty mask (0..7)
  const writeFormat = (mat, mask) => {
    // ECC Level L = 01
    const fmt = computeFormatBits(0b01, mask);
    for (let i = 0; i <= 5; i += 1) mat[8][i] = (fmt >> (14 - i)) & 1;
    mat[8][7] = (fmt >> 8) & 1;
    mat[8][8] = (fmt >> 7) & 1;
    mat[7][8] = (fmt >> 6) & 1;
    for (let i = 0; i <= 5; i += 1) mat[5 - i][8] = (fmt >> (5 - i)) & 1;

    for (let i = 0; i < 7; i += 1) mat[size - 1 - i][8] = (fmt >> (14 - i)) & 1;
    for (let i = 0; i < 8; i += 1) mat[8][size - 8 + i] = (fmt >> (7 - i)) & 1;
  };

  let bestMat = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m += 1) {
    const copy = modules.map((row, r) => {
      const nr = new Uint8Array(row);
      for (let c = 0; c < size; c += 1) {
        if (!isFunc[r][c] && MASK_FNS[m](r, c)) nr[c] ^= 1;
      }
      return nr;
    });
    writeFormat(copy, m);
    // Basic run-length + balance penalty
    let pen = 0;
    let darkCount = 0;
    for (let r = 0; r < size; r += 1) {
      let runH = 1;
      let runV = 1;
      for (let c = 0; c < size; c += 1) {
        if (copy[r][c]) darkCount += 1;
        if (c > 0) {
          if (copy[r][c] === copy[r][c - 1]) {
            runH += 1;
            if (runH === 5) pen += 3;
            else if (runH > 5) pen += 1;
          } else runH = 1;
          if (copy[c][r] === copy[c - 1][r]) {
            runV += 1;
            if (runV === 5) pen += 3;
            else if (runV > 5) pen += 1;
          } else runV = 1;
        }
      }
    }
    pen += Math.abs((darkCount * 100) / (size * size) - 50) * 2;
    if (pen < bestScore) {
      bestScore = pen;
      bestMat = copy;
    }
  }
  return bestMat;
}

export function renderQrToCanvas(text, pxSize = 260, { dark = '#111113', light = '#ffffff', quiet = 3 } = {}) {
  const mat = encodeQrMatrix(text);
  const n = mat.length;
  const total = n + quiet * 2;
  const canvas = document.createElement('canvas');
  canvas.width = pxSize;
  canvas.height = pxSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, pxSize, pxSize);
  const cell = pxSize / total;
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (mat[r][c]) {
        const x = (c + quiet) * cell;
        const y = (r + quiet) * cell;
        ctx.beginPath();
        ctx.roundRect(x, y, cell * 0.96, cell * 0.96, cell * 0.28);
        ctx.fill();
      }
    }
  }
  return canvas;
}
