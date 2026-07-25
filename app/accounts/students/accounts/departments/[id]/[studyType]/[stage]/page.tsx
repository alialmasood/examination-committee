'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

const STUDY_TYPE_LABEL: Record<string, string> = {
  morning: 'الدراسة الصباحية',
  evening: 'الدراسة المسائية',
};

const STAGE_LABEL: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
};

/**
 * صفحة تفاصيل مرحلة ضمن قسم ونوع دراسة —
 * هيكل جاهز لبناء المحتوى لاحقاً.
 */
export default function StudentAccountsDepartmentStagePage() {
  const params = useParams();
  const departmentId = String(params?.id || '');
  const studyType = String(params?.studyType || '');
  const stage = String(params?.stage || '');

  const [departmentName, setDepartmentName] = useState(
    DEPT_FALLBACK[departmentId] || departmentId || 'القسم'
  );

  const studyTypeLabel = STUDY_TYPE_LABEL[studyType] || studyType;
  const stageLabel = STAGE_LABEL[stage] || stage;

  const backHref = useMemo(
    () => `/accounts/students/accounts/departments/${departmentId}`,
    [departmentId]
  );

  const loadName = useCallback(async () => {
    if (!departmentId) return;
    try {
      const res = await fetch('/api/departments/stats?academic_year=all', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success && Array.isArray(body.data)) {
        const found = body.data.find(
          (d: { id: string; name: string }) => d.id === departmentId
        );
        if (found?.name) setDepartmentName(found.name);
      }
    } catch {
      // الإبقاء على الاسم الاحتياطي
    }
  }, [departmentId]);

  useEffect(() => {
    void loadName();
  }, [loadName]);

  return (
    <div className="p-6 max-w-7xl mx-auto" dir="rtl">
      <div className="mb-4">
        <Link href={backHref} className="text-sm text-red-900 hover:underline">
          ← العودة إلى {departmentName}
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">
          {departmentName} — {studyTypeLabel} — {stageLabel}
        </h1>
        <p className="text-sm text-gray-600 mt-1">تفاصيل طلبة هذه المرحلة</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        سيتم بناء محتوى هذه المرحلة هنا لاحقاً.
      </div>
    </div>
  );
}
