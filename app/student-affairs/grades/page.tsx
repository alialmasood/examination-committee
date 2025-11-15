'use client';

import { useState, useEffect } from 'react';
import { Student } from '@/src/lib/types';

export default function GradesPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedStudyType, setSelectedStudyType] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedAcademicYear, setSelectedAcademicYear] = useState('');

  // أقسام الكلية
  const departments = [
    'تقنيات التخدير',
    'تقنيات الأشعة',
    'تقنيات صناعة الأسنان',
    'هندسة تقنيات البناء والانشاءات',
    'تقنيات النفط والغاز',
    'تقنيات الفيزياء الصحية',
    'تقنيات البصريات',
    'تقنيات صحة المجتمع',
    'تقنيات طب الطوارئ',
    'تقنيات العلاج الطبيعي',
    'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
    'القانون'
  ];

  // المراحل الدراسية
  const levels = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة'];

  // أنواع الدراسة
  const studyTypes = ['صباحي', 'مسائي'];

  // الفصول الدراسية
  const semesters = ['الأول', 'الثاني'];

  // السنوات الأكاديمية
  const academicYears = [
    '2020-2021',
    '2021-2022', 
    '2022-2023',
    '2023-2024',
    '2024-2025',
    '2025-2026'
  ];

  // جلب بيانات الطلبة
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        if (selectedDepartment) params.append('department', selectedDepartment);
        if (selectedLevel) params.append('level', selectedLevel);
        if (selectedStudyType) params.append('study_type', selectedStudyType);
        if (selectedSemester) params.append('semester', selectedSemester);
        if (selectedAcademicYear) params.append('academic_year', selectedAcademicYear);
        
        const response = await fetch(`/api/students?${params.toString()}`);
        const data = await response.json();
        console.log('API Response:', data);
        console.log('Search params:', params.toString());
        setStudents(data.students || []);
      } catch (error) {
        console.error('Error fetching students:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStudents();
  }, [searchTerm, selectedDepartment, selectedLevel, selectedStudyType, selectedSemester, selectedAcademicYear]);

  return (
    <div className="space-y-6">
      {/* عنوان الصفحة */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">النتائج والدرجات</h1>
        <p className="text-gray-600">إدارة وعرض درجات الطلبة والنتائج النهائية</p>
      </div>

      {/* نظام البحث والفلترة */}
      <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
        <h2 className="text-xl font-bold text-gray-800 mb-4">البحث والفلترة</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
          {/* البحث بالاسم أو الرقم */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1">البحث</label>
            <input
              type="text"
              placeholder="الاسم أو الرقم الأكاديمي"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10 text-xs"
            />
          </div>

          {/* القسم */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1">القسم</label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10 text-xs"
            >
              <option value="">جميع الأقسام</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>

          {/* المرحلة */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1">المرحلة</label>
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10 text-xs"
            >
              <option value="">جميع المراحل</option>
              {levels.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>

          {/* نوع الدراسة */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1">نوع الدراسة</label>
            <select
              value={selectedStudyType}
              onChange={(e) => setSelectedStudyType(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10 text-xs"
            >
              <option value="">جميع الأنواع</option>
              {studyTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* الفصل الدراسي */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1">الفصل الدراسي</label>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10 text-xs"
            >
              <option value="">جميع الفصول</option>
              {semesters.map((semester) => (
                <option key={semester} value={semester}>{semester}</option>
              ))}
            </select>
          </div>

          {/* السنة الأكاديمية */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1">السنة الأكاديمية</label>
            <select
              value={selectedAcademicYear}
              onChange={(e) => setSelectedAcademicYear(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10 text-xs"
            >
              <option value="">جميع السنوات</option>
              {academicYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          {/* زر إعادة تعيين */}
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-gray-700 mb-1 opacity-0">إعادة تعيين</label>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedDepartment('');
                setSelectedLevel('');
                setSelectedStudyType('');
                setSelectedSemester('');
                setSelectedAcademicYear('');
              }}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors duration-300 h-10 text-xs"
            >
              إعادة تعيين
            </button>
          </div>
        </div>
      </div>

      {/* إحصائيات سريعة */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-blue-600">إجمالي الطلبة</p>
              <p className="text-2xl font-bold text-blue-800">{students.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-green-50 rounded-lg p-4 border border-green-200">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-green-600">ناجحون</p>
              <p className="text-2xl font-bold text-green-800">-</p>
            </div>
          </div>
        </div>

        <div className="bg-red-50 rounded-lg p-4 border border-red-200">
          <div className="flex items-center">
            <div className="p-2 bg-red-100 rounded-lg">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-red-600">راسبون</p>
              <p className="text-2xl font-bold text-red-800">-</p>
            </div>
          </div>
        </div>

        <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-purple-600">نسبة النجاح</p>
              <p className="text-2xl font-bold text-purple-800">-</p>
            </div>
          </div>
        </div>
      </div>

      {/* قائمة الطلبة */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">قائمة الطلبة</h2>
          <p className="text-gray-600 mt-1">عرض جميع الطلبة المسجلين في النظام</p>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">جاري التحميل...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-12">التسلسل</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider min-w-48">الاسم الكامل</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الرقم التسلسلي</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">القسم</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">المرحلة</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">نوع الدراسة</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">السنة الأكاديمية</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">النتيجة</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.map((student, index) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-2 py-4 whitespace-nowrap text-sm font-medium text-gray-900 w-12">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap min-w-48">
                      <div className="text-sm font-medium text-gray-900">
                        {student.full_name_ar || `${student.first_name} ${student.last_name}`}
                      </div>
                      {student.nickname && (
                        <div className="text-sm text-gray-500">{student.nickname}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.university_id || 'غير محدد'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.major || 'غير محدد'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(() => {
                        const levelMap: { [key: string]: string } = {
                          'first': 'الأولى',
                          'second': 'الثانية', 
                          'third': 'الثالثة',
                          'fourth': 'الرابعة',
                          'bachelor': 'البكالوريوس',
                          'master': 'الماجستير',
                          'phd': 'الدكتوراه',
                          'diploma': 'الدبلوم'
                        };
                        return levelMap[student.level || ''] || student.level || 'غير محدد';
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(() => {
                        const studyTypeMap: { [key: string]: string } = {
                          'morning': 'صباحي',
                          'evening': 'مسائي',
                          'صباحي': 'صباحي',
                          'مسائي': 'مسائي'
                        };
                        return studyTypeMap[student.study_type || ''] || student.study_type || 'غير محدد';
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.academic_year || 'غير محدد'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      -
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button className="text-green-600 hover:text-green-900 font-semibold">
                        عرض النتيجة
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {students.length === 0 && (
              <div className="p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد نتائج</h3>
                <p className="mt-1 text-sm text-gray-500">لم يتم العثور على طلبة مطابقين لمعايير البحث.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
