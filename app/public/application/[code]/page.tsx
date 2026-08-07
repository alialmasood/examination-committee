'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ApplicationSnapshot,
  buildApplicationPrintHtml,
  labelAdmissionChannel,
  labelAdmissionType,
  labelExamAttempt,
  labelGender,
  labelLevel,
  labelMarital,
  labelSchoolType,
  labelSemester,
  labelStudyType,
  type PrintMode,
} from '@/src/lib/student-application-print';
import { buildBrowserPublicApplicationUrl } from '@/src/lib/site-url';

const DOC_LABELS: Record<string, string> = {
  nationalIdFront: 'البطاقة الوطنية (وجه 1)',
  nationalIdBack: 'البطاقة الوطنية (وجه 2)',
  residenceCardFront: 'بطاقة السكن (وجه 1)',
  residenceCardBack: 'بطاقة السكن (وجه 2)',
  secondaryCertificate: 'وثيقة الإعدادية',
  personalPhoto: 'الصورة الشخصية',
  medicalExamination: 'الفحص الطبي',
};

export default function PublicApplicationPage() {
  const params = useParams();
  const code = String(params?.code || '').toUpperCase();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<ApplicationSnapshot | null>(null);

  const publicUrl = useMemo(() => {
    if (!code) return '';
    return buildBrowserPublicApplicationUrl(code);
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch(`/api/public/applications/${encodeURIComponent(code)}`);
        const data = await res.json();
        if (!data.success) {
          if (!cancelled) setError(data.error || 'الاستمارة غير موجودة');
          return;
        }
        if (!cancelled) setSnapshot(data.payload as ApplicationSnapshot);
      } catch {
        if (!cancelled) setError('تعذر الاتصال بالخادم');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const openPrint = (mode: PrintMode) => {
    if (!snapshot || !publicUrl) return;
    const html = buildApplicationPrintHtml({
      snapshot,
      code,
      publicUrl,
      mode,
      autoPrint: true,
    });

    // فتح فوري ضمن حدث الضغط
    const w = window.open('about:blank', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      return;
    }

    // بديل iframe إن حُظرت النوافذ
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      alert('تعذر بدء الطباعة');
      return;
    }
    const htmlNoAuto = html.replace(/window\.onload\s*=\s*function\s*\(\)\s*\{[\s\S]*?\};\s*/m, '');
    doc.open();
    doc.write(htmlNoAuto);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1500);
    }, 700);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600" dir="rtl">
        جاري تحميل الاستمارة...
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm max-w-md">
          <h1 className="text-lg font-bold text-slate-800">تعذر عرض الاستمارة</h1>
          <p className="mt-2 text-sm text-slate-600">{error || 'غير موجودة'}</p>
        </div>
      </div>
    );
  }

  const p = snapshot.personalData;
  const se = snapshot.secondaryEducation;
  const u = snapshot.universityAdmission;
  const barcodeImg = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(code)}&code=Code128&dpi=120&translate-esc=off`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&ecc=M&data=${encodeURIComponent(publicUrl)}`;

  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="text-xs font-medium text-[#053E37]">كلية الشرق · عرض عام للاستمارة</p>
            <h1 className="text-base font-bold text-slate-900">استمارة تسجيل طالب</h1>
            <p className="font-mono text-xs text-slate-500" dir="ltr">
              {code}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openPrint('full')}
              className="rounded-md bg-[#053E37] px-3 py-2 text-sm font-semibold text-white hover:bg-[#032a25]"
            >
              طباعة الاستمارة / PDF
            </button>
            <button
              type="button"
              onClick={() => openPrint('codes')}
              className="rounded-md border border-[#E8913A] bg-white px-3 py-2 text-sm font-semibold text-[#E8913A] hover:bg-orange-50"
            >
              طباعة باركود
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 border-b border-slate-100 pb-2 text-sm font-bold text-[#053E37]">البيانات الشخصية</h2>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 md:grid-cols-3">
            <div><strong>الاسم:</strong> {p.fullName || '—'}</div>
            <div><strong>اللقب:</strong> {p.nickname || '—'}</div>
            <div><strong>اسم الأم:</strong> {p.motherName || '—'}</div>
            <div><strong>الهوية:</strong> {p.nationalId || '—'}</div>
            <div><strong>الميلاد:</strong> {p.birthDate || '—'}</div>
            <div><strong>المحافظة:</strong> {p.birthPlace || '—'}</div>
            <div><strong>المنطقة:</strong> {p.area || '—'}</div>
            <div><strong>الجنس:</strong> {labelGender(p.gender)}</div>
            <div><strong>الديانة:</strong> {p.religion || '—'}</div>
            <div><strong>الحالة:</strong> {labelMarital(p.maritalStatus)}</div>
            <div><strong>الهاتف:</strong> {p.phone || '—'}</div>
            <div><strong>البريد:</strong> {p.email || '—'}</div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 border-b border-slate-100 pb-2 text-sm font-bold text-[#053E37]">الدراسة الإعدادية</h2>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 md:grid-cols-3">
            <div><strong>المدرسة:</strong> {se.schoolName || '—'}</div>
            <div><strong>النوع:</strong> {labelSchoolType(se.schoolType)}</div>
            <div><strong>التخرج:</strong> {se.graduationYear || '—'}</div>
            <div><strong>المعدل:</strong> {se.gpa || '—'}</div>
            <div><strong>الدرجات:</strong> {se.totalScore || '—'}</div>
            <div><strong>الدور:</strong> {labelExamAttempt(se.examAttempt)}</div>
            <div><strong>الرقم الامتحاني:</strong> {se.examNumber || '—'}</div>
            <div><strong>الرقم السري:</strong> {se.examPassword || '—'}</div>
            <div><strong>الفرع:</strong> {se.branch || '—'}</div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 border-b border-slate-100 pb-2 text-sm font-bold text-[#053E37]">القبول الجامعي</h2>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 md:grid-cols-3">
            <div><strong>المرحلة:</strong> {labelAdmissionType(u.admissionType)}</div>
            <div><strong>قناة القبول:</strong> {labelAdmissionChannel(u.admissionChannel)}</div>
            <div><strong>القسم:</strong> {u.department || '—'}</div>
            <div><strong>الدراسة:</strong> {labelStudyType(u.studyType)}</div>
            <div><strong>المستوى:</strong> {labelLevel(u.level)}</div>
            <div><strong>الفصل:</strong> {labelSemester(u.semester)}</div>
            <div><strong>السنة:</strong> {u.academicYear || '—'}</div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 border-b border-slate-100 pb-2 text-sm font-bold text-[#053E37]">المستمسكات</h2>
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {Object.entries(snapshot.documents || {}).map(([k, ok]) => (
              <div key={k}>
                <strong>{DOC_LABELS[k] || k}:</strong> {ok ? 'مرفق' : 'غير مرفق'}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm text-center">
          <h2 className="mb-4 text-sm font-bold text-[#053E37]">باركود و QR للاستمارة</h2>
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-600">الباركود</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={barcodeImg} alt="باركود" className="mx-auto h-16" />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-600">QR</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImg} alt="QR" className="mx-auto h-40 w-40 rounded border border-slate-200 bg-white p-2" />
            </div>
          </div>
          <p className="mt-3 break-all font-mono text-[11px] text-slate-500" dir="ltr">
            {publicUrl}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            للطباعة أو الحفظ PDF استخدم زر «طباعة الاستمارة / PDF» ثم اختر «حفظ كـ PDF» من نافذة الطباعة.
          </p>
        </section>
      </div>
    </div>
  );
}
