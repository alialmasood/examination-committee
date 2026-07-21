import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const runtime = "nodejs";

const DEFAULT_FILE_NAME = "question_calibration_ui_overrides.json";

function normalizeTemplateCode(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function fileNameForTemplate(templateCode: string): string {
  const code = normalizeTemplateCode(templateCode);
  if (!code || code === "OMR_25") return DEFAULT_FILE_NAME;
  return `question_calibration_ui_overrides.${code}.json`;
}

type LetterOffset = { nx: number; ny: number };

type OverrideRow = {
  nx: number;
  ny: number;
  spread: number;
  letters?: Record<string, LetterOffset>;
};

type StudentColOverrideRow = OverrideRow & {
  tailFromDigit?: number | null;
  tailExtraNy?: number;
};

function overridesPath(templateCode = "OMR_25"): string {
  return join(process.cwd(), "services", "omr-python", fileNameForTemplate(templateCode));
}

function parseLetters(v: unknown): Record<string, LetterOffset> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: Record<string, LetterOffset> = {};
  for (const L of ["A", "B", "C", "D"]) {
    if (!Object.prototype.hasOwnProperty.call(src, L)) continue;
    const entry = src[L];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      out[L] = { nx: 0, ny: 0 };
      continue;
    }
    const e = entry as Record<string, unknown>;
    const nx = Number(e.nx);
    const ny = Number(e.ny);
    out[L] = { nx: Number.isFinite(nx) ? nx : 0, ny: Number.isFinite(ny) ? ny : 0 };
  }
  return out;
}

function normalizeOverrideRow(v: unknown): OverrideRow | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const nx = Number(o.nx);
  const ny = Number(o.ny);
  const spread = Number(o.spread);
  const lettersParsed = o.letters !== undefined && o.letters !== null ? parseLetters(o.letters) : undefined;
  const hasBlock = [nx, ny, spread].every((n) => Number.isFinite(n));
  const hasLetters = Boolean(lettersParsed && Object.keys(lettersParsed).length > 0);
  if (!hasBlock && !hasLetters) return null;
  return {
    nx: Number.isFinite(nx) ? nx : 0,
    ny: Number.isFinite(ny) ? ny : 0,
    spread: Number.isFinite(spread) && spread > 0 ? spread : 1,
    ...(lettersParsed && Object.keys(lettersParsed).length ? { letters: lettersParsed } : {}),
  };
}

type CalibFileRoot = Record<string, unknown>;

async function readCalibRoot(templateCode = "OMR_25"): Promise<CalibFileRoot> {
  try {
    const raw = await readFile(overridesPath(templateCode), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CalibFileRoot;
  } catch {
    return {};
  }
}

function extractQuestionOverrides(root: CalibFileRoot): Record<string, OverrideRow> {
  const out: Record<string, OverrideRow> = {};
  for (const [k, v] of Object.entries(root)) {
    if (k === "studentCodeColumns") continue;
    if (!/^\d+$/.test(k)) continue;
    const row = normalizeOverrideRow(v);
    if (row) out[k] = row;
  }
  return out;
}

function normalizeStudentColRow(v: unknown): StudentColOverrideRow | null {
  const base = normalizeOverrideRow(v);
  if (!base) return null;
  const o = v as Record<string, unknown>;
  const out: StudentColOverrideRow = { ...base };
  if (Object.prototype.hasOwnProperty.call(o, "tailFromDigit") && o.tailFromDigit !== null && o.tailFromDigit !== "") {
    const tf = Number(o.tailFromDigit);
    if (Number.isInteger(tf) && tf >= 0 && tf <= 9) {
      out.tailFromDigit = tf;
      const ten = Number(o.tailExtraNy);
      out.tailExtraNy = Number.isFinite(ten) ? ten : 0;
    }
  }
  return out;
}

function extractStudentCodeColumnOverrides(root: CalibFileRoot): Record<string, StudentColOverrideRow> {
  const sc = root.studentCodeColumns;
  if (!sc || typeof sc !== "object" || Array.isArray(sc)) return {};
  const out: Record<string, StudentColOverrideRow> = {};
  for (const [k, v] of Object.entries(sc as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) continue;
    const col = Number(k);
    if (col < 0 || col > 4) continue;
    const row = normalizeStudentColRow(v);
    if (row) out[String(col)] = row;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const templateCode = String(searchParams.get("templateCode") || "OMR_25");
    const root = await readCalibRoot(templateCode);
    const overrides = extractQuestionOverrides(root);
    const studentCodeColumns = extractStudentCodeColumnOverrides(root);
    return NextResponse.json({
      success: true,
      templateCode: normalizeTemplateCode(templateCode) || "OMR_25",
      overrides,
      studentCodeColumns,
      path: `services/omr-python/${fileNameForTemplate(templateCode)}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذر قراءة ملف الضبط.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      templateCode?: string;
      question?: number;
      studentCodeColumn?: number;
      nx?: number;
      ny?: number;
      spread?: number;
      letters?: Record<string, { nx?: number; ny?: number }>;
      tailFromDigit?: number;
      tailExtraNy?: number;
    };

    const nx = Number(body.nx);
    const ny = Number(body.ny);
    const spread = Number(body.spread);
    const lettersProvided = body.letters !== undefined && body.letters !== null;
    const lettersBody = lettersProvided ? parseLetters(body.letters) : undefined;
    const hasBlock = [nx, ny, spread].every((n) => Number.isFinite(n));
    if (!hasBlock && !lettersProvided) {
      return NextResponse.json(
        { success: false, error: "أرسل nx وny وspread أو حقل letters للفقاعات." },
        { status: 400 }
      );
    }
    const spreadClamped = hasBlock ? Math.max(0.05, Math.min(3, spread)) : 1;
    const templateCode = normalizeTemplateCode(String(body.templateCode || "OMR_25")) || "OMR_25";

    const path = overridesPath(templateCode);
    await mkdir(dirname(path), { recursive: true });
    const root = await readCalibRoot(templateCode);

    const col = body.studentCodeColumn;
    if (col !== undefined && col !== null) {
      const c = Number(col);
      if (!Number.isInteger(c) || c < 0 || c > 4) {
        return NextResponse.json(
          { success: false, error: "رقم عمود كود الورقة غير صالح (0–4)." },
          { status: 400 }
        );
      }
      const prevSc =
        root.studentCodeColumns && typeof root.studentCodeColumns === "object" && !Array.isArray(root.studentCodeColumns)
          ? { ...(root.studentCodeColumns as Record<string, unknown>) }
          : {};
      const prevEntry =
        prevSc[String(c)] && typeof prevSc[String(c)] === "object" && !Array.isArray(prevSc[String(c)])
          ? { ...(prevSc[String(c)] as Record<string, unknown>) }
          : {};
      const row: Record<string, unknown> = { ...prevEntry, nx, ny, spread: spreadClamped };

      if (body.tailFromDigit === undefined) {
        delete row.tailFromDigit;
        delete row.tailExtraNy;
      } else {
        const tf = Number(body.tailFromDigit);
        if (!Number.isInteger(tf) || tf < 0 || tf > 9) {
          return NextResponse.json(
            { success: false, error: "tailFromDigit يجب أن يكون عددًا صحيحًا بين 0 و 9." },
            { status: 400 }
          );
        }
        row.tailFromDigit = tf;
        const ten = body.tailExtraNy !== undefined ? Number(body.tailExtraNy) : 0;
        if (!Number.isFinite(ten)) {
          return NextResponse.json({ success: false, error: "tailExtraNy غير رقمي." }, { status: 400 });
        }
        row.tailExtraNy = Math.max(-0.15, Math.min(0.15, ten));
      }
      prevSc[String(c)] = row;
      root.studentCodeColumns = prevSc;
    } else {
      const q = Number(body.question);
      if (!Number.isInteger(q) || q < 1 || q > 100) {
        return NextResponse.json({ success: false, error: "رقم السؤال غير صالح (1–100)." }, { status: 400 });
      }
      const prevRaw = root[String(q)];
      const prev =
        prevRaw && typeof prevRaw === "object" && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, unknown>)
          : {};
      const prevLetters = parseLetters(prev.letters);
      const mergedLetters: Record<string, LetterOffset> =
        lettersBody !== undefined ? { ...lettersBody } : { ...prevLetters };
      const cleanedLetters: Record<string, LetterOffset> = {};
      for (const L of ["A", "B", "C", "D"]) {
        const off = mergedLetters[L];
        if (!off) continue;
        if (off.nx === 0 && off.ny === 0) continue;
        cleanedLetters[L] = off;
      }
      const nextRow: Record<string, unknown> = {
        ...prev,
        nx: hasBlock ? nx : Number.isFinite(Number(prev.nx)) ? Number(prev.nx) : 0,
        ny: hasBlock ? ny : Number.isFinite(Number(prev.ny)) ? Number(prev.ny) : 0,
        spread: hasBlock ? spreadClamped : Number.isFinite(Number(prev.spread)) && Number(prev.spread) > 0 ? Number(prev.spread) : 1,
      };
      if (Object.keys(cleanedLetters).length) nextRow.letters = cleanedLetters;
      else delete nextRow.letters;
      root[String(q)] = nextRow;
    }

    await writeFile(path, JSON.stringify(root, null, 2), "utf8");

    if (col !== undefined && col !== null) {
      const c = Number(col);
      const sc = extractStudentCodeColumnOverrides(root);
      return NextResponse.json({
        success: true,
        templateCode,
        studentCodeColumn: c,
        saved: sc[String(c)],
        path: `services/omr-python/${fileNameForTemplate(templateCode)}`,
      });
    }
    const q = Number(body.question);
    return NextResponse.json({
      success: true,
      templateCode,
      question: q,
      saved: root[String(q)] as OverrideRow,
      path: `services/omr-python/${fileNameForTemplate(templateCode)}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذر حفظ الضبط.";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
