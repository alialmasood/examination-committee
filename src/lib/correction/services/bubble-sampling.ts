/**
 * عينات دوائر OMR على مصفوفة بكسل رمادية (أو متعددة القنوات).
 * تُستخدم في مرحلة الاستخراج فقط — لا تقارن صور مفاتيح بصور طلاب.
 */

export function readGray(data: Buffer, width: number, height: number, channels: number, x: number, y: number): number {
  const xi = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const idx = (yi * width + xi) * channels;
  if (channels === 1) return data[idx]!;
  if (channels >= 3) {
    const r = data[idx]!;
    const g = data[idx + 1]!;
    const b = data[idx + 2]!;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return data[idx]!;
}

export function sampleDiskMean(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  r: number
): number {
  let sum = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        sum += readGray(data, width, height, channels, x, y);
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 255;
}

export function sampleDiskMin(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  r: number
): number {
  let min = 255;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const g = readGray(data, width, height, channels, x, y);
        if (g < min) min = g;
      }
    }
  }
  return min;
}

export function sampleAnnulusMean(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number
): number {
  let sum = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - rOuter));
  const x1 = Math.min(width - 1, Math.ceil(cx + rOuter));
  const y0 = Math.max(0, Math.floor(cy - rOuter));
  const y1 = Math.min(height - 1, Math.ceil(cy + rOuter));
  const ri2 = rInner * rInner;
  const ro2 = rOuter * rOuter;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > ri2 && d2 <= ro2) {
        sum += readGray(data, width, height, channels, x, y);
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 255;
}

/** درجة تظليل كلاسيكية (للعرض والتوافق مع الواجهة) */
export function bubbleMarkScore(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  innerR: number
): number {
  const innerMin = sampleDiskMin(data, width, height, channels, cx, cy, innerR);
  const innerMean = sampleDiskMean(data, width, height, channels, cx, cy, innerR);
  const outer = sampleAnnulusMean(data, width, height, channels, cx, cy, innerR + 2, innerR + 11);
  const ringContrast = Math.max(0, outer - innerMin);
  const pencilDark = Math.max(0, 255 - innerMin - 6);
  const meanHint = Math.max(0, 255 - innerMean - 4) * 0.35;
  return Math.max(ringContrast, pencilDark * 0.52, meanHint);
}

/**
 * نسبة تعبئة تقريبية 0..1 داخل القرص: نسبة البكسلات «الداكنة» تحت عتبة فاتحة.
 */
export function bubbleFillRatio(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  r: number,
  inkThreshold = 200
): number {
  let dark = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        n++;
        if (readGray(data, width, height, channels, x, y) < inkThreshold) dark++;
      }
    }
  }
  return n > 0 ? dark / n : 0;
}

function readBinaryInk(binary: Buffer, width: number, height: number, x: number, y: number): number {
  const xi = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(height - 1, Math.floor(y)));
  return binary[yi * width + xi]! < 128 ? 1 : 0;
}

/** نسبة تعبئة داخل قرص داخلي فقط (تجاهل حلقة الحافة). innerFraction من نصف القطر الخارجي. */
export function bubbleInnerDiskFillRatioGray(
  gray: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  outerRadiusPx: number,
  innerFraction: number,
  inkThreshold = 200
): number {
  const innerR = Math.max(1, outerRadiusPx * Math.min(1, Math.max(0.05, innerFraction)));
  return bubbleFillRatio(gray, width, height, channels, cx, cy, innerR, inkThreshold);
}

/** نسبة حبر داخل القرص الداخلي على صورة ثنائية (0 = حبر). */
export function bubbleInnerDiskFillRatioBinary(
  binary: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  outerRadiusPx: number,
  innerFraction: number
): number {
  const innerR = Math.max(1, outerRadiusPx * Math.min(1, Math.max(0.05, innerFraction)));
  let ink = 0;
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - innerR));
  const x1 = Math.min(width - 1, Math.ceil(cx + innerR));
  const y0 = Math.max(0, Math.floor(cy - innerR));
  const y1 = Math.min(height - 1, Math.ceil(cy + innerR));
  const r2 = innerR * innerR;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        n++;
        ink += readBinaryInk(binary, width, height, x, y);
      }
    }
  }
  return n > 0 ? ink / n : 0;
}

/** درجة تظليل: قرص داخلي + حلقة مرجعية بين inner و outerRadiusPx. */
export function bubbleMarkScoreInnerRing(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  cx: number,
  cy: number,
  outerRadiusPx: number,
  innerFraction: number
): number {
  const innerR = Math.max(1, outerRadiusPx * Math.min(1, Math.max(0.05, innerFraction)));
  const innerMin = sampleDiskMin(data, width, height, channels, cx, cy, innerR);
  const innerMean = sampleDiskMean(data, width, height, channels, cx, cy, innerR);
  const rOuter = Math.min(outerRadiusPx, innerR + 12);
  const outer = sampleAnnulusMean(data, width, height, channels, cx, cy, innerR + 1, rOuter);
  const ringContrast = Math.max(0, outer - innerMin);
  const pencilDark = Math.max(0, 255 - innerMin - 6);
  const meanHint = Math.max(0, 255 - innerMean - 4) * 0.35;
  return Math.max(ringContrast, pencilDark * 0.52, meanHint);
}
