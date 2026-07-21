/**
 * تكييف محلي (أسلوب Gaussian mean) على صورة رمادية 8 بت — ناتج ثنائي 255 ورقة / 0 حبر.
 * blockSize يجب أن يكون فرديًا و ≥ 3.
 */

function oddBlockSize(n: number): number {
  if (!Number.isFinite(n) || n < 3) return 0;
  const k = Math.floor(n);
  return k % 2 === 1 ? k : k - 1;
}

/**
 * يبني صورة ثنائية: بكسل داكن إذا كان الرمادي أقل من متوسط الحيّ − C.
 */
export function adaptiveThresholdGray(
  gray: Buffer,
  width: number,
  height: number,
  blockSize: number,
  C: number
): Buffer {
  const bs = oddBlockSize(blockSize);
  if (bs < 3) {
    return Buffer.from(gray);
  }
  const half = (bs - 1) >> 1;
  const w1 = width + 1;
  const sat = new Float64Array(w1 * (height + 1));
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const g = gray[(y - 1) * width + (x - 1)]!;
      const a = sat[(y - 1) * w1 + x]!;
      const b = sat[y * w1 + (x - 1)]!;
      const c = sat[(y - 1) * w1 + (x - 1)]!;
      sat[y * w1 + x] = g + a + b - c;
    }
  }

  const out = Buffer.alloc(width * height, 255);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      const sum =
        sat[(y1 + 1) * w1 + (x1 + 1)]! -
        sat[y0 * w1 + (x1 + 1)]! -
        sat[(y1 + 1) * w1 + x0]! +
        sat[y0 * w1 + x0]!;
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = sum / cnt;
      const v = gray[y * width + x]!;
      out[y * width + x] = v < mean - C ? 0 : 255;
    }
  }
  return out;
}
