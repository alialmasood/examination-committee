/**
 * منطق تطبيق معايرة أعمدة كود الورقة فقط (بدون قراءة ملفات) — آمن للاستيراد من مكوّنات العميل.
 */

export type StudentCodeColumnOverride = {
  nx: number;
  ny: number;
  spread: number;
  tailFromDigit?: number | null;
  tailExtraNy?: number;
};

/** عشر نقاط عمود واحد (رقم 0 فوق … 9 تحت) بعد ضبط المعايرة */
export function applyOneStudentColumnToTenPoints(
  baseTen: { nx: number; ny: number }[],
  o: StudentCodeColumnOverride
): { nx: number; ny: number }[] {
  const spread = o.spread > 0 ? o.spread : 1;
  const dnx = o.nx;
  const dny = o.ny;
  const tailExtra = Number.isFinite(o.tailExtraNy) ? Number(o.tailExtraNy) : 0;
  const tf = o.tailFromDigit;
  if (tf === undefined || tf === null || !Number.isInteger(tf) || tf < 0 || tf > 9) {
    const translated = baseTen.map((p) => ({ nx: p.nx + dnx, ny: p.ny + dny }));
    const cy = translated.reduce((s, p) => s + p.ny, 0) / translated.length;
    return translated.map((p) => ({ nx: p.nx, ny: cy + (p.ny - cy) * spread }));
  }
  const out = baseTen.map((p) => ({ nx: p.nx, ny: p.ny }));
  for (let d = 0; d < tf; d++) {
    out[d] = { nx: baseTen[d]!.nx + dnx, ny: baseTen[d]!.ny + dny };
  }
  const tail = baseTen.slice(tf);
  const translated = tail.map((p) => ({ nx: p.nx + dnx, ny: p.ny + dny }));
  const cyTail = translated.reduce((s, p) => s + p.ny, 0) / translated.length;
  for (let i = 0; i < translated.length; i++) {
    out[tf + i] = {
      nx: translated[i]!.nx,
      ny: cyTail + (translated[i]!.ny - cyTail) * spread + tailExtra,
    };
  }
  return out;
}

/** ترتيب النقاط: لكل عمود من 5، الأرقام 0..9 من الأعلى للأسفل — مطابق buildStudentCodeFlatPointsFromGeometry */
export function applyUiOverridesToFlatStudentCodePoints(
  base: { nx: number; ny: number }[],
  overrides: Record<number, StudentCodeColumnOverride>,
  numColumns = 5
): { nx: number; ny: number }[] {
  if (!Object.keys(overrides).length) return base.map((p) => ({ nx: p.nx, ny: p.ny }));
  const perCol = 10;
  const out = base.map((p) => ({ nx: p.nx, ny: p.ny }));
  const nCol = Math.min(numColumns, Math.floor(base.length / perCol));
  for (let col = 0; col < nCol; col++) {
    const d = overrides[col];
    if (!d) continue;
    const start = col * perCol;
    if (start + perCol - 1 >= base.length) break;
    const slice = base.slice(start, start + perCol);
    const adj = applyOneStudentColumnToTenPoints(slice, d);
    for (let j = 0; j < perCol; j++) out[start + j] = adj[j]!;
  }
  return out;
}
