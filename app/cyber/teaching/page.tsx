'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface TeachingSubject {
  id: string;
  department: string;
  material_name: string;
  instructor_name: string;
  semester: string;
  academic_year: string;
  stage?: string;
  study_type?: string;
  has_practical?: boolean;
  units?: number | null;
  created_at: string;
}

export default function TeachingPage() {
  const pathname = usePathname();
  const system = pathname.split('/')[1] || 'xrays';
  
  const [subjects, setSubjects] = useState<TeachingSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    material_name: '',
    instructor_name: '',
    academic_year: '2025-2026',
    semester: 'first',
    stage: 'first',
    study_type: 'morning',
    has_practical: true,
    units: '3'
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/teaching-subjects/${system}`);
      const data = await res.json();
      if (data.success) {
        setSubjects(data.data);
      } else {
        setError('تعذر جلب بيانات المواد');
      }
    } catch (err) {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const unitsValue = Number(formData.units);
      if (!Number.isFinite(unitsValue) || unitsValue <= 0) {
        alert('يرجى إدخال عدد الوحدات (رقم أكبر من صفر)');
        return;
      }

      const payload = {
        ...formData,
        units: unitsValue
      };

      const url = editingSubjectId 
        ? `/api/teaching-subjects/${system}/${editingSubjectId}`
        : `/api/teaching-subjects/${system}`;
      
      const res = await fetch(url, {
        method: editingSubjectId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setEditingSubjectId(null);
        setFormData({ material_name: '', instructor_name: '', academic_year: '2025-2026', semester: 'first', stage: 'first', study_type: 'morning', has_practical: true, units: '3' });
        fetchData();
      } else {
        alert(editingSubjectId ? 'خطأ في تحديث المادة' : 'خطأ في حفظ المادة');
      }
    } catch (err) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه المادة؟')) return;
    
    try {
      const res = await fetch(`/api/teaching-subjects/${system}/${id}`, {
        method: 'DELETE'
      });
      
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert('خطأ في حذف المادة');
      }
    } catch (err) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const handleEdit = (subject: TeachingSubject) => {
    setEditingSubjectId(subject.id);
    setFormData({
      material_name: subject.material_name,
      instructor_name: subject.instructor_name,
      academic_year: subject.academic_year,
      semester: subject.semester,
      stage: subject.stage || 'first',
      study_type: subject.study_type || 'morning',
      has_practical: subject.has_practical !== undefined ? subject.has_practical : true,
      units: subject.units !== undefined && subject.units !== null ? String(subject.units) : '3'
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingSubjectId(null);
    setFormData({ material_name: '', instructor_name: '', academic_year: '2025-2026', semester: 'first', stage: 'first', study_type: 'morning', has_practical: true, units: '3' });
  };

  const formatSemester = (sem: string) => {
    switch (sem) {
      case 'first': return 'الأول';
      case 'second': return 'الثاني';
      default: return sem;
    }
  };

const stageLabelMap: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة'
};

const stageOrder = ['first', 'second', 'third', 'fourth'] as const;

  if (loading) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center py-12 text-red-600">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">التدريسات</h1>
            <p className="text-gray-600">قسم تقنيات الأشعة</p>
          </div>
          <button
            onClick={() => {
              setEditingSubjectId(null);
            setFormData({ material_name: '', instructor_name: '', academic_year: '2025-2026', semester: 'first', stage: 'first', study_type: 'morning', has_practical: true, units: '3' });
              setShowModal(true);
            }}
            className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة مادة جديدة
          </button>
        </div>

        {subjects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد مواد تدريسية</h3>
            <p className="mt-1 text-sm text-gray-500">قم بإضافة مادة تدريسية جديدة</p>
          </div>
        ) : (
          <div className="space-y-6">
            {stageOrder.map((stageKey) => {
              const stageSubjects = subjects.filter((subject) => (subject.stage || 'first') === stageKey);
              return (
                <div key={stageKey} className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">مواد {stageLabelMap[stageKey]}</h3>
                      <p className="text-sm text-gray-600">
                        {stageSubjects.length > 0
                          ? `عدد المواد المسجلة: ${stageSubjects.length}`
                          : 'لا توجد مواد مسجلة لهذه المرحلة حالياً'}
                      </p>
                    </div>
                  </div>
                  {stageSubjects.length === 0 ? (
                    <div className="p-6 text-sm text-gray-500">
                      لم يتم تسجيل مواد في هذه المرحلة.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-red-50">
                          <tr>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">التسلسل</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">اسم المادة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">اسم التدريسي</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">نوع الدراسة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">نوع المادة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">عدد الوحدات</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">الفصل الدراسي</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">السنة الدراسية</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">الإجراءات</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {stageSubjects.map((subject, index) => {
                            const studyTypeLabel =
                              subject.study_type === 'morning'
                                ? 'صباحي'
                                : subject.study_type === 'evening'
                                ? 'مسائي'
                                : '-';
                            const materialTypeLabel =
                              subject.has_practical !== false
                                ? 'عملي + نظري (60 درجة)'
                                : 'نظري فقط (70 درجة)';
                            return (
                              <tr key={subject.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{index + 1}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.material_name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.instructor_name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{studyTypeLabel}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{materialTypeLabel}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.units ?? '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{formatSemester(subject.semester)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.academic_year}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                  <div className="flex gap-3">
                                    <button
                                      onClick={() => handleEdit(subject)}
                                      className="text-blue-600 hover:text-blue-800"
                                    >
                                      تعديل
                                    </button>
                                    <button
                                      onClick={() => handleDelete(subject.id)}
                                      className="text-red-600 hover:text-red-800"
                                    >
                                      حذف
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Modal لإضافة مادة */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {editingSubjectId ? 'تعديل مادة تدريسية' : 'إضافة مادة تدريسية'}
                  </h3>
                  <button
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">اسم المادة</label>
                    <input
                      type="text"
                      required
                      value={formData.material_name}
                      onChange={(e) => setFormData({ ...formData, material_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      placeholder="أدخل اسم المادة"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">اسم التدريسي</label>
                    <input
                      type="text"
                      required
                      value={formData.instructor_name}
                      onChange={(e) => setFormData({ ...formData, instructor_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      placeholder="أدخل اسم التدريسي"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">الفصل الدراسي</label>
                    <select
                      required
                      value={formData.semester}
                      onChange={(e) => setFormData({ ...formData, semester: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="first">الأول</option>
                      <option value="second">الثاني</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">المرحلة</label>
                    <select
                      required
                      value={formData.stage}
                      onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="first">الأولى</option>
                      <option value="second">الثانية</option>
                      <option value="third">الثالثة</option>
                      <option value="fourth">الرابعة</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">نوع الدراسة</label>
                    <select
                      required
                      value={formData.study_type}
                      onChange={(e) => setFormData({ ...formData, study_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="morning">صباحي</option>
                      <option value="evening">مسائي</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">نوع المادة</label>
                    <select
                      required
                      value={formData.has_practical ? 'true' : 'false'}
                      onChange={(e) => setFormData({ ...formData, has_practical: e.target.value === 'true' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="true">عملي + نظري (60 درجة)</option>
                      <option value="false">نظري فقط (70 درجة)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">عدد الوحدات</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={formData.units}
                      onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      placeholder="أدخل عدد الوحدات"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">السنة الدراسية</label>
                    <select
                      required
                      value={formData.academic_year}
                      onChange={(e) => setFormData({ ...formData, academic_year: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="2024-2025">2024-2025</option>
                      <option value="2025-2026">2025-2026</option>
                      <option value="2026-2027">2026-2027</option>
                      <option value="2027-2028">2027-2028</option>
                      <option value="2028-2029">2028-2029</option>
                      <option value="2029-2030">2029-2030</option>
                      <option value="2030-2031">2030-2031</option>
                    </select>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      className="flex-1 bg-red-700 hover:bg-red-800 text-white py-2 rounded-lg transition-colors"
                    >
                      حفظ
                    </button>
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg transition-colors"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

