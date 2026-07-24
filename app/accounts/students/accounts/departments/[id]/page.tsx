'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

type DepartmentStat = {
  id: string;
  name: string;
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

/**
 * صفحة تفاصيل القسم — هيكل جاهز لبناء المحتوى التفصيلي لاحقاً.
 */
export default function StudentAccountsDepartmentPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [departmentName, setDepartmentName] = useState(
    DEPT_FALLBACK[id] || id || 'القسم'
  );

  const loadName = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch('/api/departments/stats?academic_year=all', {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success && Array.isArray(body.data)) {
        const found = (body.data as DepartmentStat[]).find((d) => d.id === id);
        if (found?.name) setDepartmentName(found.name);
      }
    } catch {
      // الإبقاء على الاسم الاحتياطي
    }
  }, [id]);

  useEffect(() => {
    void loadName();
  }, [loadName]);

  return (
    <div className="p-6" dir="rtl">
      <div className="mb-4">
        <Link
          href="/accounts/students/accounts"
          className="text-sm text-red-900 hover:underline"
        >
          ← العودة إلى الحسابات
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-2">{departmentName}</h1>
        <p className="text-sm text-gray-600 mt-1">تفاصيل حسابات القسم</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        سيتم بناء المحتوى التفصيلي لهذا القسم هنا لاحقاً.
      </div>
    </div>
  );
}
