import { copyFile, mkdir, writeFile, access, readdir } from 'fs/promises';
import path from 'path';
import {
  buildApplicationPrintHtml,
  type ApplicationSnapshot,
} from '@/src/lib/student-application-print';
import { buildPublicApplicationUrl, getConfiguredSiteOrigin } from '@/src/lib/site-url';

export const DOC_FILE_LABELS: Record<string, string> = {
  nationalIdFront: 'البطاقة_الوطنية_وجه1',
  nationalIdBack: 'البطاقة_الوطنية_وجه2',
  residenceCardFront: 'بطاقة_السكن_وجه1',
  residenceCardBack: 'بطاقة_السكن_وجه2',
  secondaryCertificate: 'وثيقة_الاعدادية',
  personalPhoto: 'الصورة_الشخصية',
  medicalExamination: 'الفحص_الطبي',
};

/** اسم مجلد/ملف آمن من الاسم الرباعي — بدون رمز الاستمارة */
export function sanitizePersonFolderName(fullName: string): string {
  const cleaned = String(fullName || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 100)
    .trim();
  return cleaned || 'طالب_بدون_اسم';
}

export function sanitizeFilePart(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** يحوّل قيمة المستمسك المخزّنة إلى مسار مطلق على القرص */
export function resolveUploadAbsolutePath(stored: string): string | null {
  const raw = String(stored || '').trim().replace(/\\/g, '/');
  if (!raw || raw === 'مرفق' || raw.includes('..')) return null;

  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');

  if (raw.startsWith('applications/') || raw.startsWith('students/')) {
    return path.join(uploadsRoot, ...raw.split('/').filter(Boolean));
  }

  // اسم ملف فقط → ابحث أولاً في students ثم applications/*/file
  return path.join(uploadsRoot, 'students', path.basename(raw));
}

async function findStoredFile(stored: string, studentFolderAbs?: string): Promise<string | null> {
  const direct = resolveUploadAbsolutePath(stored);
  if (direct && (await pathExists(direct))) return direct;

  const base = path.basename(String(stored || ''));
  if (!base || base === 'مرفق') return null;

  if (studentFolderAbs) {
    const inFolder = path.join(studentFolderAbs, base);
    if (await pathExists(inFolder)) return inFolder;
  }

  // بحث خفيف داخل applications إن وُجد اسم ملف فقط
  const appsRoot = path.join(process.cwd(), 'public', 'uploads', 'applications');
  if (await pathExists(appsRoot)) {
    try {
      const dirs = await readdir(appsRoot, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const candidate = path.join(appsRoot, d.name, base);
        if (await pathExists(candidate)) return candidate;
      }
    } catch {
      // تجاهل
    }
  }

  return null;
}

/**
 * يحفظ الاستمارة في مجلد باسم الطالب الرباعي فقط، مع المرفقات داخله.
 * المسار: public/uploads/applications/{الاسم الرباعي}/
 */
export async function archiveApplicationPackage(input: {
  fullName: string;
  code: string;
  payload: ApplicationSnapshot;
  publicUrl?: string;
}): Promise<{
  folderRelative: string;
  formRelative: string;
  formFileName: string;
  attachments: string[];
}> {
  const fullName = String(input.fullName || input.payload.personalData?.fullName || '').trim();
  const code = String(input.code || '').trim().toUpperCase();
  const folderBase = sanitizePersonFolderName(fullName);
  const folderAbs = path.join(process.cwd(), 'public', 'uploads', 'applications', folderBase);
  await mkdir(folderAbs, { recursive: true });

  const origin = getConfiguredSiteOrigin() || 'http://localhost:3000';
  const publicUrl =
    input.publicUrl || buildPublicApplicationUrl(origin, code);

  const html = buildApplicationPrintHtml({
    snapshot: input.payload,
    code,
    publicUrl,
    mode: 'full',
    autoPrint: false,
    logoUrl: `${origin}/logos/college-logo.png`,
  });

  // اسم ملف الاستمارة = الاسم الرباعي (بدون رمز الاستمارة)
  const formFileName = `${sanitizePersonFolderName(fullName)}.html`;
  const formAbs = path.join(folderAbs, formFileName);
  await writeFile(formAbs, html, 'utf8');

  const attachments: string[] = [];
  const docs = input.payload.documents || {};

  for (const [key, value] of Object.entries(docs)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const source = await findStoredFile(value, folderAbs);
    if (!source) continue;

    const ext = path.extname(source) || path.extname(value) || '.jpg';
    const label = DOC_FILE_LABELS[key] || sanitizeFilePart(key);
    // اسم المرفق يبدأ باسم الطالب ثم نوع المستمسك
    const destName = `${sanitizeFilePart(fullName)}_${label}${ext}`;
    const destAbs = path.join(folderAbs, destName);

    // إن كان الملف موجوداً مسبقاً بنفس المسار لا نعيد النسخ
    if (path.normalize(source) !== path.normalize(destAbs)) {
      await copyFile(source, destAbs);
    }
    attachments.push(destName);
  }

  const indexText = [
    `الاسم الرباعي: ${fullName}`,
    `رمز الاستمارة: ${code}`,
    `تاريخ الأرشفة: ${new Date().toISOString()}`,
    `ملف الاستمارة: ${formFileName}`,
    `عدد المرفقات: ${attachments.length}`,
    ...attachments.map((a, i) => `  ${i + 1}. ${a}`),
  ].join('\n');
  await writeFile(path.join(folderAbs, 'فهرس_المحتويات.txt'), indexText, 'utf8');

  return {
    folderRelative: `/uploads/applications/${folderBase}`,
    formRelative: `/uploads/applications/${folderBase}/${formFileName}`,
    formFileName,
    attachments,
  };
}
