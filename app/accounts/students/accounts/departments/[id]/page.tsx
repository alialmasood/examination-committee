'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type StageCounts = {
  first: number;
  second: number;
  third: number;
  fourth: number;
};

type DepartmentStat = {
  id: string;
  name: string;
  total?: number;
  totalAmount?: number;
  studyTypes?: {
    morning: StageCounts;
    evening: StageCounts;
  };
};

const DEPT_FALLBACK: Record<string, string> = {
  anesthesia: 'تقنيات التخدير',
  radiology: 'تقنيات الاشعة',
  dental: 'تقنيات صناعة الاسنان',
  construction: 'هندسة تقنيات البناء والانشاءات',
  'oil-gas': 'تقنيات هندسة النفط والغاز',
  'health-physics': 'تقنيات الفيزياء الصحية',
  optics: 'تقنيات البصريات',
  'community-health': 'تقنيات صحة المجتمع',
  'emergency-medicine': 'تقنيات طب الطوارئ',
  'physical-therapy': 'تقنيات العلاج الطبيعي',
  cybersecurity: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
  law: 'القانون',
};

const STAGES: Array<{ key: keyof StageCounts; label: string }> = [
  { key: 'first', label: 'المرحلة الأولى' },
  { key: 'second', label: 'المرحلة الثانية' },
  { key: 'third', label: 'المرحلة الثالثة' },
  { key: 'fourth', label: 'المرحلة الرابعة' },
];

const EMPTY_STAGES: StageCounts = {
  first: 0,
  second: 0,
  third: 0,
  fourth: 0,
};

function StudyTypeCard({
  title,
  studyType,
  departmentId,
  stages,
  accentClass,
}: {
  title: string;
  studyType: 'morning' | 'evening';
  departmentId: string;
  stages: StageCounts;
  accentClass: string;
}) {
  const total =
    (stages.first || 0) +
    (stages.second || 0) +
    (stages.third || 0) +
    (stages.fourth || 0);

  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className={`px-5 py-4 border-b border-gray-100 ${accentClass}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <span className="text-sm font-bold text-gray-800">{total} طالب</span>
        </div>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {STAGES.map((stage) => (
          <Link
            key={stage.key}
            href={`/accounts/students/accounts/departments/${departmentId}/${studyType}/${stage.key}`}
            className="rounded-md border border-gray-200 bg-slate-50 px-4 py-3 flex items-center justify-between hover:border-red-400 hover:bg-red-50/40 transition-colors"
          >
            <span className="text-sm font-medium text-gray-800">{stage.label}</span>
            <span className="text-base font-bold text-red-900">
              {stages[stage.key] || 0}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function StudentAccountsDepartmentPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [departmentName, setDepartmentName] = useState(
    DEPT_FALLBACK[id] || id || 'القسم'
  );
  const [morning, setMorning] = useState<StageCounts>(EMPTY_STAGES);
  const [evening, setEvening] = useState<StageCounts>(EMPTY_STAGES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/departments/stats?academic_year=all', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success || !Array.isArray(body.data)) {
        setError(body.error || 'تعذر تحميل بيانات القسم');
        return;
      }
      const found = (body.data as DepartmentStat[]).find((d) => d.id === id);
      if (!found) {
        setError('القسم غير موجود');
        return;
      }
      setDepartmentName(found.name || DEPT_FALLBACK[id] || id);
      setMorning(found.studyTypes?.morning || EMPTY_STAGES);
      setEvening(found.studyTypes?.evening || EMPTY_STAGES);
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-6">
        <Link
          href="/accounts/students/accounts"
          className="text-sm text-red-900 hover:underline"
        >
          ← العودة إلى الحسابات
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">{departmentName}</h1>
        <p className="text-sm text-gray-600 mt-1">
          توزيع الطلبة حسب نوع الدراسة والمرحلة
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-500 text-sm">جارٍ التحميل…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <StudyTypeCard
            title="الدراسة الصباحية"
            studyType="morning"
            departmentId={id}
            stages={morning}
            accentClass="bg-amber-50"
          />
          <StudyTypeCard
            title="الدراسة المسائية"
            studyType="evening"
            departmentId={id}
            stages={evening}
            accentClass="bg-slate-50"
          />
        </div>
      )}
    </div>
  );
}
