'use client';

import { useEffect, useState, useMemo } from 'react';
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

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string | null;
  department: string;
}

export default function TeachingPage() {
  const pathname = usePathname();
  const system = pathname.split('/')[1] || 'xrays';
  
  const [subjects, setSubjects] = useState<TeachingSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  
  // Filters and search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterAcademicYear, setFilterAcademicYear] = useState<string>('all');
  const [filterStudyType, setFilterStudyType] = useState<string>('all');
  const [filterStage, setFilterStage] = useState<string>('all');
  
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

  const fetchTeachers = async () => {
    try {
      setLoadingTeachers(true);
      const res = await fetch('/api/hr/teachers');
      const data = await res.json();
      if (data.success) {
        setTeachers(data.data || []);
      }
    } catch (err) {
      console.error('خطأ في جلب التدريسيين:', err);
    } finally {
      setLoadingTeachers(false);
    }
  };

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

  // Filtered and searched subjects
  const filteredSubjects = useMemo(() => {
    let result = [...subjects];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (subject) =>
          subject.material_name.toLowerCase().includes(query) ||
          subject.instructor_name.toLowerCase().includes(query)
      );
    }

    // Semester filter
    if (filterSemester !== 'all') {
      result = result.filter((subject) => subject.semester === filterSemester);
    }

    // Academic year filter
    if (filterAcademicYear !== 'all') {
      result = result.filter((subject) => subject.academic_year === filterAcademicYear);
    }

    // Study type filter
    if (filterStudyType !== 'all') {
      result = result.filter((subject) => subject.study_type === filterStudyType);
    }

    // Stage filter
    if (filterStage !== 'all') {
      result = result.filter((subject) => (subject.stage || 'first') === filterStage);
    }

    return result;
  }, [subjects, searchQuery, filterSemester, filterAcademicYear, filterStudyType, filterStage]);

  // Statistics
  const stats = useMemo(() => {
    const total = subjects.length;
    const byStage = {
      first: subjects.filter((s) => (s.stage || 'first') === 'first').length,
      second: subjects.filter((s) => (s.stage || 'first') === 'second').length,
      third: subjects.filter((s) => (s.stage || 'first') === 'third').length,
      fourth: subjects.filter((s) => (s.stage || 'first') === 'fourth').length,
    };
    const byType = {
      practical: subjects.filter((s) => s.has_practical !== false).length,
      theoretical: subjects.filter((s) => s.has_practical === false).length,
    };
    const byStudyType = {
      morning: subjects.filter((s) => s.study_type === 'morning').length,
      evening: subjects.filter((s) => s.study_type === 'evening').length,
    };

    return { total, byStage, byType, byStudyType };
  }, [subjects]);

  // Get unique academic years for filter
  const academicYears = useMemo(() => {
    const years = new Set(subjects.map((s) => s.academic_year));
    return Array.from(years).sort().reverse();
  }, [subjects]);

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
    fetchTeachers();
  };

  const handleDuplicate = (subject: TeachingSubject) => {
    setEditingSubjectId(null);
    setFormData({
      material_name: `${subject.material_name} (نسخة)`,
      instructor_name: subject.instructor_name,
      academic_year: subject.academic_year,
      semester: subject.semester,
      stage: subject.stage || 'first',
      study_type: subject.study_type || 'morning',
      has_practical: subject.has_practical !== undefined ? subject.has_practical : true,
      units: subject.units !== undefined && subject.units !== null ? String(subject.units) : '3'
    });
    setShowModal(true);
    fetchTeachers();
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingSubjectId(null);
    setFormData({ material_name: '', instructor_name: '', academic_year: '2025-2026', semester: 'first', stage: 'first', study_type: 'morning', has_practical: true, units: '3' });
  };

  const handleOpenModal = () => {
    setEditingSubjectId(null);
    setFormData({ material_name: '', instructor_name: '', academic_year: '2025-2026', semester: 'first', stage: 'first', study_type: 'morning', has_practical: true, units: '3' });
    setShowModal(true);
    fetchTeachers();
  };

  const handleExportExcel = async () => {
    if (!filteredSubjects.length) {
      alert('لا توجد بيانات للتصدير');
      return;
    }

    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('التدريسات');
      
      worksheet.views = [{ rightToLeft: true }];
      
      const colors = {
        header: { argb: 'FFFEE2E2' }, // bg-red-50
        border: { argb: 'FF9CA3AF' }, // border-gray-400
      };

      // Headers
      const headers = [
        'التسلسل',
        'اسم المادة',
        'اسم التدريسي',
        'نوع الدراسة',
        'نوع المادة',
        'عدد الوحدات',
        'الفصل الدراسي',
        'السنة الدراسية',
        'المرحلة'
      ];

      worksheet.addRow(headers);
      
      // Style headers
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, size: 11 };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: colors.header };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: colors.border },
          bottom: { style: 'thin', color: colors.border },
          left: { style: 'thin', color: colors.border },
          right: { style: 'thin', color: colors.border }
        };
      });

      // Data rows
      filteredSubjects.forEach((subject, index) => {
        const studyTypeLabel = subject.study_type === 'morning' ? 'صباحي' : subject.study_type === 'evening' ? 'مسائي' : '-';
        const materialTypeLabel = subject.has_practical !== false ? 'عملي + نظري (60 درجة)' : 'نظري فقط (70 درجة)';
        const semesterLabel = subject.semester === 'first' ? 'الأول' : 'الثاني';
        const stageLabel = stageLabelMap[subject.stage || 'first'] || 'المرحلة الأولى';

        worksheet.addRow([
          index + 1,
          subject.material_name,
          subject.instructor_name,
          studyTypeLabel,
          materialTypeLabel,
          subject.units ?? '-',
          semesterLabel,
          subject.academic_year,
          stageLabel
        ]);
      });

      // Style data rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin', color: colors.border },
              bottom: { style: 'thin', color: colors.border },
              left: { style: 'thin', color: colors.border },
              right: { style: 'thin', color: colors.border }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          });
        }
      });

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        if (column.eachCell) {
          let maxLength = 0;
          column.eachCell({ includeEmpty: false }, (cell) => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
              maxLength = columnLength;
            }
          });
          column.width = maxLength < 10 ? 10 : maxLength + 2;
        }
      });

      // Download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `التدريسات_${system}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('خطأ في تصدير Excel:', err);
      alert('خطأ في تصدير البيانات');
    }
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
            onClick={handleOpenModal}
            className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 shadow-sm hover:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة مادة جديدة
          </button>
        </div>

        {/* Statistics Cards */}
        {subjects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-4 border border-red-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">إجمالي المواد</p>
                  <p className="text-2xl font-bold text-red-700">{stats.total}</p>
                </div>
                <div className="bg-red-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.747 5.754 18 7.5 18s3.332.747 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.747 18.247 18 16.5 18c-1.746 0-3.332.747-4.5 1.253" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">المرحلة الأولى</p>
                  <p className="text-2xl font-bold text-blue-700">{stats.byStage.first}</p>
                </div>
                <div className="bg-blue-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">المرحلة الثانية</p>
                  <p className="text-2xl font-bold text-green-700">{stats.byStage.second}</p>
                </div>
                <div className="bg-green-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">المرحلة الثالثة</p>
                  <p className="text-2xl font-bold text-purple-700">{stats.byStage.third}</p>
                </div>
                <div className="bg-purple-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">المرحلة الرابعة</p>
                  <p className="text-2xl font-bold text-orange-700">{stats.byStage.fourth}</p>
                </div>
                <div className="bg-orange-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-orange-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters and Search */}
        {subjects.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              {/* Search */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">بحث</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث في اسم المادة أو التدريسي..."
                    className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                  />
                  <svg className="absolute right-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Semester Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">الفصل الدراسي</label>
                <select
                  value={filterSemester}
                  onChange={(e) => setFilterSemester(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                >
                  <option value="all">الكل</option>
                  <option value="first">الأول</option>
                  <option value="second">الثاني</option>
                </select>
              </div>

              {/* Academic Year Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">السنة الدراسية</label>
                <select
                  value={filterAcademicYear}
                  onChange={(e) => setFilterAcademicYear(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                >
                  <option value="all">الكل</option>
                  {academicYears.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              {/* Study Type Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">نوع الدراسة</label>
                <select
                  value={filterStudyType}
                  onChange={(e) => setFilterStudyType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                >
                  <option value="all">الكل</option>
                  <option value="morning">صباحي</option>
                  <option value="evening">مسائي</option>
                </select>
              </div>

              {/* Stage Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">المرحلة</label>
                <select
                  value={filterStage}
                  onChange={(e) => setFilterStage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                >
                  <option value="all">الكل</option>
                  <option value="first">الأولى</option>
                  <option value="second">الثانية</option>
                  <option value="third">الثالثة</option>
                  <option value="fourth">الرابعة</option>
                </select>
              </div>
            </div>

            {/* Export Button */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                تصدير Excel
              </button>
            </div>
          </div>
        )}

        {subjects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد مواد تدريسية</h3>
            <p className="mt-1 text-sm text-gray-500">قم بإضافة مادة تدريسية جديدة</p>
          </div>
        ) : filteredSubjects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">لا توجد نتائج</h3>
            <p className="mt-1 text-sm text-gray-500">لم يتم العثور على مواد تطابق معايير البحث</p>
          </div>
        ) : (
          <div className="space-y-6">
            {stageOrder.map((stageKey) => {
              const stageSubjects = filteredSubjects.filter((subject) => (subject.stage || 'first') === stageKey);
              if (filterStage !== 'all' && filterStage !== stageKey) return null;
              
              return (
                <div key={stageKey} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-red-50 to-transparent">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">مواد {stageLabelMap[stageKey]}</h3>
                        <p className="text-sm text-gray-600">
                          {stageSubjects.length > 0
                            ? `عدد المواد المسجلة: ${stageSubjects.length}`
                            : 'لا توجد مواد مسجلة لهذه المرحلة حالياً'}
                        </p>
                      </div>
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
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">التسلسل</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">اسم المادة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">اسم التدريسي</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">نوع الدراسة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">نوع المادة</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">عدد الوحدات</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الفصل الدراسي</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">السنة الدراسية</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الإجراءات</th>
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
                              <tr key={subject.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{index + 1}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.material_name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.instructor_name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    subject.study_type === 'morning' 
                                      ? 'bg-blue-100 text-blue-800' 
                                      : 'bg-purple-100 text-purple-800'
                                  }`}>
                                    {studyTypeLabel}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{materialTypeLabel}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-semibold">{subject.units ?? '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    subject.semester === 'first' 
                                      ? 'bg-green-100 text-green-800' 
                                      : 'bg-orange-100 text-orange-800'
                                  }`}>
                                    {formatSemester(subject.semester)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{subject.academic_year}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleEdit(subject)}
                                      className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                                      title="تعديل"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => handleDuplicate(subject)}
                                      className="text-green-600 hover:text-green-800 hover:bg-green-50 px-2 py-1 rounded transition-colors"
                                      title="نسخ"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => handleDelete(subject.id)}
                                      className="text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                                      title="حذف"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
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
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {editingSubjectId ? 'تعديل مادة تدريسية' : 'إضافة مادة تدريسية'}
                  </h3>
                  <button
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
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
                    {loadingTeachers ? (
                      <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-center">
                        جاري تحميل قائمة التدريسيين...
                      </div>
                    ) : (
                      <select
                        required
                        value={formData.instructor_name}
                        onChange={(e) => setFormData({ ...formData, instructor_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                      >
                        <option value="">اختر التدريسي</option>
                        {teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.full_name_ar || teacher.full_name}>
                            {teacher.full_name_ar || teacher.full_name} {teacher.department ? `- ${teacher.department}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
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
                      className="flex-1 bg-red-700 hover:bg-red-800 text-white py-2 rounded-lg transition-colors shadow-sm hover:shadow-md"
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
