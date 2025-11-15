'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

interface Student {
  id: string;
  university_id: string;
  full_name: string;
  nickname?: string;
  mother_name?: string;
  department: string;
  level?: string;
  admission_type?: string;
  semester?: string;
  academic_year?: string;
  registration_date?: string;
  photo?: string;
  payment_status?: string;
  payment_amount?: number;
  payment_date?: string;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/department-students/health');
      const data = await res.json();
      if (data.success) {
        setStudents(data.data);
      } else {
        setError('تعذر جلب بيانات الطلاب');
      }
    } catch (err) {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
    const channel = new BroadcastChannel('payments');
    channel.onmessage = (event) => {
      if (event.data.type === 'payment-updated' && event.data.systemPath === 'health') {
        fetchStudents();
      }
    };
    return () => { channel.close(); };
  }, []);

  const formatLevel = (level?: string) => {
    if (!level) return 'غير محدد';
    switch (level) {
      case 'bachelor': return 'البكالوريوس';
      case 'master': return 'الماجستير';
      case 'phd': return 'الدكتوراه';
      case 'diploma': return 'الدبلوم';
      default: return level;
    }
  };

  const formatStage = (admissionType?: string) => {
    switch (admissionType) {
      case 'first': return 'الأولى';
      case 'second': return 'الثانية';
      case 'third': return 'الثالثة';
      case 'fourth': return 'الرابعة';
      default: return 'غير محدد';
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">الطلبة</h1>
          <p className="text-gray-600">قسم تقنيات صحة المجتمع - الطلبة المسددون للأقساط</p>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">جاري التحميل...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center py-12 text-red-600">{error}</div>
          </div>
        ) : students.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد بيانات</h3>
              <p className="mt-1 text-sm text-gray-500">لا يوجد طلاب مسددون للأقساط حالياً</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">قائمة الطلاب المسددون للأقساط</h2>
              <span className="text-xs text-gray-500">الإجمالي: {students.length}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {students.map((s) => (
                <div key={s.id} className="p-5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
                      {s.photo ? (
                        <Image src={`/uploads/students/${s.photo}`} alt={s.full_name} width={48} height={48} className="w-12 h-12 object-cover" />
                      ) : (
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 15c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {s.full_name} {s.nickname ? <span className="text-gray-500">({s.nickname})</span> : null}
                      </p>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
                        <span>التسلسلي: <span className="font-medium text-gray-900">{s.university_id}</span></span>
                        <span>اسم الأم: <span className="font-medium text-gray-900">{s.mother_name || '-'}</span></span>
                        <span>المرحلة: <span className="font-medium text-gray-900">{formatStage(s.admission_type)}</span></span>
                        <span>القسم: <span className="font-medium text-gray-900">{s.department}</span></span>
                        <span>تاريخ التسجيل: <span className="font-medium text-gray-900">{formatDate(s.registration_date)}</span></span>
                        <span>السنة الأكاديمية: <span className="font-medium text-gray-900">{s.academic_year || '-'}</span></span>
                        <span>الفصل الدراسي: <span className="font-medium text-gray-900">{s.semester === 'first' ? 'الأول' : s.semester === 'second' ? 'الثاني' : (s.semester || '-')}</span></span>
                        <span>الدرجة العلمية: <span className="font-medium text-gray-900">{formatLevel(s.level)}</span></span>
                      </div>
                    </div>
                  </div>
                  <div className="text-left ml-4 flex-shrink-0">
                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      تم الدفع
                    </div>
                    {s.payment_amount && (
                      <div className="mt-1 text-xs text-gray-600">
                        {new Intl.NumberFormat('en-US').format(s.payment_amount)} IQD
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
