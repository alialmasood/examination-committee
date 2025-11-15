'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';

interface DepartmentInfo {
  id: string;
  name: string;
  color: string;
}

export default function DepartmentAttendancePage() {
  const params = useParams();
  const departmentId = params.departmentId as string;
  const [departmentInfo, setDepartmentInfo] = useState<DepartmentInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // أقسام الكلية مع الألوان
  const departments = [
    { id: 'anesthesia', name: 'تقنيات التخدير', color: 'blue' },
    { id: 'radiology', name: 'تقنيات الأشعة', color: 'green' },
    { id: 'dental', name: 'تقنيات صناعة الأسنان', color: 'orange' },
    { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات', color: 'purple' },
    { id: 'oil-gas', name: 'تقنيات النفط والغاز', color: 'red' },
    { id: 'health-physics', name: 'تقنيات الفيزياء الصحية', color: 'indigo' },
    { id: 'optics', name: 'تقنيات البصريات', color: 'teal' },
    { id: 'community-health', name: 'تقنيات صحة المجتمع', color: 'pink' },
    { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ', color: 'yellow' },
    { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي', color: 'cyan' },
    { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', color: 'gray' },
    { id: 'law', name: 'القانون', color: 'slate' }
  ];

  useEffect(() => {
    const department = departments.find(dept => dept.id === departmentId);
    if (department) {
      setDepartmentInfo(department);
    }
    setLoading(false);
  }, [departmentId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="mr-3 text-gray-600">جاري التحميل...</span>
      </div>
    );
  }

  if (!departmentInfo) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">القسم غير موجود</h1>
          <p className="text-gray-600 mb-4">عذراً، القسم المطلوب غير موجود</p>
          <button 
            onClick={() => window.history.back()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            العودة للخلف
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* عنوان الصفحة */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">الحضور والغيابات</h1>
        <p className="text-gray-600">قسم {departmentInfo.name}</p>
      </div>

      {/* محتوى فارغ - سيتم إضافته لاحقاً */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
        <div className={`w-16 h-16 bg-${departmentInfo.color}-100 rounded-full flex items-center justify-center mx-auto mb-4`}>
          <svg className={`w-8 h-8 text-${departmentInfo.color}-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">صفحة قسم {departmentInfo.name}</h2>
        <p className="text-gray-600">المحتوى سيتم إضافته قريباً</p>
      </div>
    </div>
  );
}
