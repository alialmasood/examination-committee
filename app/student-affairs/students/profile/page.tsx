'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface Student {
  id: string;
  university_id: string;
  full_name_ar: string;
  full_name: string;
  nickname: string;
  first_name: string;
  last_name: string;
  national_id: string;
  email: string;
  phone: string;
  address: string;
  birth_date: string;
  gender: string;
  department: string;
  study_type: string;
  enrollment_date: string;
  secondary_gpa: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function StudentProfilePage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  // جلب بيانات الطلاب
  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (selectedDepartment) params.append('department', selectedDepartment);
      
      const response = await fetch(`/api/students?${params.toString()}`);
      const data = await response.json();
      
      if (data.success) {
        console.log('البيانات المستلمة من API:', data.students);
        setStudents(data.students || []);
      }
    } catch (error) {
      console.error('خطأ في جلب بيانات الطلاب:', error);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, selectedDepartment]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  // فلترة الطلاب حسب البحث
  const filteredStudents = students.filter(student =>
    (student.full_name_ar || student.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.university_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.national_id.includes(searchTerm) ||
    student.department?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleStudentClick = (student: Student) => {
    router.push(`/student-affairs/students/profile/${student.id}`);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedDepartment('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                بروفايل الطلاب
              </h1>
              <p className="text-gray-600">
                عرض وتعديل بيانات الطلاب الشخصية والأكاديمية
              </p>
            </div>
            <Link
              href="/student-affairs/students"
              className="flex items-center space-x-2 space-x-reverse px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>العودة</span>
            </Link>
          </div>

          {/* Search Bar and Filters */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  البحث في الطلاب
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ابحث بالاسم، الرقم الجامعي، القسم، أو التخصص..."
                    className="w-full px-4 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right h-10 text-sm"
                    dir="rtl"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="lg:w-64">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  فلترة حسب القسم
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right h-10 text-sm"
                >
                  <option value="">جميع الأقسام</option>
                  <option value="anesthesia">تقنيات التخدير</option>
                  <option value="radiology">تقنيات الأشعة</option>
                  <option value="dental">تقنيات صناعة الأسنان</option>
                  <option value="construction">هندسة تقنيات البناء والانشاءات</option>
                  <option value="oil-gas">تقنيات النفط والغاز</option>
                  <option value="health-physics">تقنيات الفيزياء الصحية</option>
                  <option value="optics">تقنيات البصريات</option>
                  <option value="community-health">تقنيات صحة المجتمع</option>
                  <option value="emergency-medicine">تقنيات طب الطوارئ</option>
                  <option value="physical-therapy">تقنيات العلاج الطبيعي</option>
                  <option value="cybersecurity">هندسة تقنيات الامن السيبراني والحوسبة السحابية</option>
                  <option value="law">القانون</option>
                </select>
              </div>

              {(searchTerm || selectedDepartment) && (
                <div className="flex items-end">
                  <button
                    onClick={clearFilters}
                    className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors duration-200 h-10 text-sm"
                  >
                    مسح الفلاتر
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Students Table */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">
              قائمة الطلاب
            </h2>
            <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
              {filteredStudents.length} طالب
            </span>
          </div>

          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">التسلسل</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">الرقم التسلسلي</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">الاسم الكامل</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">القسم</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">العام الدراسي</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">المرحلة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="flex justify-center items-center">
                          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                          <span className="mr-3 text-gray-600">جاري التحميل...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredStudents.length > 0 ? (
                    filteredStudents.map((student, index) => (
                      <tr 
                        key={student.id} 
                        className="hover:bg-gray-50 transition-colors duration-200 cursor-pointer"
                        onClick={() => handleStudentClick(student)}
                      >
                        <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                          {index + 1}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {student.university_id}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center ml-3">
                              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{student.full_name_ar || student.full_name}</div>
                              <div className="text-sm text-gray-500">{student.nickname || 'لا يوجد لقب'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {student.department || 'غير محدد'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          2025-2026
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {student.study_type === 'morning' ? 'صباحي' : student.study_type === 'evening' ? 'مسائي' : 'غير محدد'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="text-center">
                          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">لم يتم العثور على طلاب</h3>
                          <p className="text-gray-600">جرب البحث بكلمات مختلفة</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}