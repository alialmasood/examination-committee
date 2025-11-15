'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Student } from '@/src/lib/types';

// تعريف جميع الأعمدة المتاحة للتصدير من قاعدة البيانات
const allExportableColumns = {
  // المعلومات الشخصية
  personal: {
    title: 'المعلومات الشخصية',
    icon: '👤',
    columns: [
      { id: 'university_id', label: 'الرقم الجامعي', enabled: true, category: 'personal' },
      { id: 'full_name', label: 'الاسم الرباعي', enabled: true, category: 'personal' },
      { id: 'nickname', label: 'اللقب', enabled: true, category: 'personal' },
      { id: 'mother_name', label: 'اسم الأم الثلاثي', enabled: true, category: 'personal' },
      { id: 'national_id', label: 'رقم الهوية الوطنية', enabled: true, category: 'personal' },
      { id: 'birth_date', label: 'تاريخ الميلاد', enabled: true, category: 'personal' },
      { id: 'birth_place', label: 'مكان الميلاد', enabled: false, category: 'personal' },
      { id: 'area', label: 'المنطقة', enabled: true, category: 'personal' },
      { id: 'gender', label: 'الجنس', enabled: true, category: 'personal' },
      { id: 'religion', label: 'الديانة', enabled: false, category: 'personal' },
      { id: 'marital_status', label: 'الحالة الاجتماعية', enabled: false, category: 'personal' },
      { id: 'phone', label: 'رقم الهاتف', enabled: true, category: 'personal' },
      { id: 'email', label: 'البريد الإلكتروني', enabled: false, category: 'personal' },
      { id: 'address', label: 'العنوان', enabled: false, category: 'personal' },
      { id: 'emergency_contact_name', label: 'اسم جهة الاتصال الطارئ', enabled: false, category: 'personal' },
      { id: 'emergency_contact_relationship', label: 'صلة القرابة', enabled: false, category: 'personal' },
      { id: 'emergency_contact_phone', label: 'هاتف جهة الاتصال الطارئ', enabled: false, category: 'personal' }
    ]
  },
  // التعليم الثانوي
  secondary: {
    title: 'التعليم الثانوي',
    icon: '🎓',
    columns: [
      { id: 'secondary_school_name', label: 'اسم المدرسة الثانوية', enabled: false, category: 'secondary' },
      { id: 'secondary_school_type', label: 'نوع المدرسة', enabled: false, category: 'secondary' },
      { id: 'secondary_graduation_year', label: 'سنة التخرج', enabled: true, category: 'secondary' },
      { id: 'secondary_gpa', label: 'المعدل التراكمي', enabled: true, category: 'secondary' },
      { id: 'secondary_total_score', label: 'المجموع الكلي', enabled: false, category: 'secondary' },
      { id: 'exam_attempt', label: 'الدور', enabled: false, category: 'secondary' },
      { id: 'exam_number', label: 'الرقم الامتحاني', enabled: false, category: 'secondary' },
      { id: 'exam_password', label: 'الرقم السري', enabled: false, category: 'secondary' },
      { id: 'branch', label: 'الفرع', enabled: false, category: 'secondary' }
    ]
  },
  // القبول الجامعي
  university: {
    title: 'القبول الجامعي',
    icon: '🏛️',
    columns: [
      { id: 'admission_type', label: 'مرحلة القبول', enabled: true, category: 'university' },
      { id: 'department', label: 'القسم', enabled: true, category: 'university' },
      { id: 'study_type', label: 'نوع الدراسة', enabled: true, category: 'university' },
      { id: 'level', label: 'الدرجة العلمية', enabled: true, category: 'university' },
      { id: 'semester', label: 'الفصل الدراسي', enabled: true, category: 'university' },
      { id: 'academic_year', label: 'السنة الأكاديمية', enabled: true, category: 'university' },
      { id: 'special_requirements', label: 'المتطلبات الخاصة', enabled: false, category: 'university' },
      { id: 'scholarship', label: 'منحة دراسية', enabled: false, category: 'university' },
      { id: 'scholarship_type', label: 'نوع المنحة', enabled: false, category: 'university' }
    ]
  },
  // معلومات النظام
  system: {
    title: 'معلومات النظام',
    icon: '⚙️',
    columns: [
      { id: 'created_at', label: 'تاريخ التسجيل', enabled: false, category: 'system' },
      { id: 'updated_at', label: 'آخر تحديث', enabled: false, category: 'system' },
      { id: 'status', label: 'الحالة', enabled: false, category: 'system' }
    ]
  }
};

// إنشاء قائمة مسطحة من جميع الأعمدة
const exportableColumns = Object.values(allExportableColumns).flatMap(category => category.columns);

export default function StudentsListPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedAdmissionType, setSelectedAdmissionType] = useState('');
  const [selectedStudyType, setSelectedStudyType] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState(exportableColumns);
  const [columnSearchTerm, setColumnSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState('excel');
  const [paperSize, setPaperSize] = useState<'A4' | 'A3'>('A3');

  console.log('🏗️ تهيئة صفحة قائمة الطلاب');

  // جلب بيانات الطلاب
  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      console.log('🔄 بدء جلب بيانات الطلاب...');
      console.log('الصفحة الحالية:', currentPage);
      console.log('مصطلح البحث:', searchTerm);
      console.log('القسم المحدد:', selectedDepartment);
      
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '50', // عرض 50 طالب في الصفحة
        ...(searchTerm && { search: searchTerm }),
        ...(selectedDepartment && { department: selectedDepartment }),
        ...(selectedLevel && { level: selectedLevel }),
        ...(selectedAdmissionType && { admission_type: selectedAdmissionType }),
        ...(selectedStudyType && { study_type: selectedStudyType }),
        ...(selectedSemester && { semester: selectedSemester })
      });

      console.log('URL المطلوب:', `/api/students?${params}`);
      const response = await fetch(`/api/students?${params}`);
      console.log('استجابة API:', response.status, response.statusText);
      
      const result = await response.json();
      console.log('النتيجة الكاملة من API:', result);

      if (result.success && result.students) {
        console.log('✅ بيانات الطلاب المستلمة:', result.students);
        console.log('عدد الطلاب:', result.students.length);
        console.log('إجمالي الطلاب:', result.pagination.total);
        setStudents(result.students);
        setTotalPages(result.pagination.total_pages);
        setTotalStudents(result.pagination.total);
      } else {
        console.log('❌ لم يتم العثور على بيانات الطلاب:', result);
        setStudents([]);
        setTotalPages(1);
        setTotalStudents(0);
      }
    } catch (error) {
      console.error('❌ خطأ في جلب بيانات الطلاب:', error);
      setStudents([]);
      setTotalPages(1);
      setTotalStudents(0);
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchTerm, selectedDepartment, selectedLevel, selectedAdmissionType, selectedStudyType, selectedSemester]);

  useEffect(() => {
    console.log('🚀 تحميل صفحة قائمة الطلاب');
    console.log('الحالة الحالية:', { currentPage, searchTerm, selectedDepartment, selectedLevel, selectedAdmissionType, selectedStudyType, selectedSemester });
    console.log('fetchStudents function:', typeof fetchStudents);
    fetchStudents();
    // بث فوري لتحديث القائمة عند تغيير حالات الدفع
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel('payments');
      ch.onmessage = (e) => {
        if (e?.data?.type === 'payment-updated') {
          fetchStudents();
        }
      };
    } catch {}
    return () => {
      try { ch?.close(); } catch {}
    };
  }, [currentPage, searchTerm, selectedDepartment, selectedLevel, selectedAdmissionType, selectedStudyType, selectedSemester, fetchStudents]);

  // معالجة البحث
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchStudents();
  };

  // معالجة تغيير الفلتر
  const handleDepartmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDepartment(e.target.value);
    setCurrentPage(1); // إعادة تعيين الصفحة إلى 1 عند تغيير الفلتر
  };

  // معالجة تغيير فلتر المرحلة
  const handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLevel(e.target.value);
    setCurrentPage(1); // إعادة تعيين الصفحة إلى 1 عند تغيير الفلتر
  };

  // معالجة تغيير فلتر مرحلة القبول
  const handleAdmissionTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedAdmissionType(e.target.value);
    setCurrentPage(1);
  };

  // معالجة تغيير فلتر نوع الدراسة
  const handleStudyTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedStudyType(e.target.value);
    setCurrentPage(1);
  };

  // معالجة تغيير فلتر الفصل الدراسي
  const handleSemesterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSemester(e.target.value);
    setCurrentPage(1);
  };

  // معالجة تغيير الصفحة
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // تنسيق التاريخ
  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB'); // تنسيق ميلادي
  };

  // تنسيق الجنس
  const formatGender = (gender: string) => {
    return gender === 'male' ? 'ذكر' : gender === 'female' ? 'أنثى' : gender;
  };

  // تنسيق المرحلة الدراسية
  const formatLevel = (level: string) => {
    if (!level) return '-';
    const levels: { [key: string]: string } = {
      'bachelor': 'بكالوريوس',
      'master': 'ماجستير',
      'phd': 'دكتوراه',
      'doctorate': 'دكتوراه',
      'diploma': 'دبلوم'
    };
    return levels[level.toLowerCase()] || level;
  };

  // تنسيق مرحلة القبول
  const formatAdmissionType = (admissionType: string) => {
    if (!admissionType) return '-';
    const types: { [key: string]: string } = {
      'first': 'الأولى',
      'second': 'الثانية',
      'third': 'الثالثة',
      'fourth': 'الرابعة',
      'regular': 'عادي',
      'conditional': 'مشروط',
      'transfer': 'منقول',
      'international': 'دولي'
    };
    return types[admissionType.toLowerCase()] || admissionType;
  };

  // تنسيق القسم
  const formatDepartment = (department: string) => {
    console.log('القسم المستلم:', department);
    const departments: { [key: string]: string } = {
      'anesthesia': 'قسم تقنيات التخدير',
      'radiology': 'قسم تقنيات الأشعة',
      'dentistry': 'قسم تقنيات صناعة الأسنان',
      'construction': 'قسم هندسة تقنيات البناء والانشاءات',
      'oil_gas': 'قسم تقنيات النفط والغاز',
      'physics': 'قسم تقنيات الفيزياء الصحية',
      'optics': 'قسم تقنيات البصريات',
      'community_health': 'قسم تقنيات صحة المجتمع',
      'emergency': 'قسم تقنيات طب الطوارئ',
      'physiotherapy': 'قسم تقنيات العلاج الطبيعي',
      'cybersecurity': 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية',
      'law': 'قسم القانون'
    };
    return departments[department] || department || '-';
  };


  // دوال نظام التصدير المتقدم
  const handleColumnToggle = (columnId: string) => {
    setSelectedColumns(columns =>
      columns.map(col =>
        col.id === columnId ? { ...col, enabled: !col.enabled } : col
      )
    );
  };

  const handleSelectAllColumns = (category: string) => {
    const categoryColumns = allExportableColumns[category as keyof typeof allExportableColumns];
    const newSelection = [...selectedColumns];
    
    categoryColumns.columns.forEach(column => {
      const index = newSelection.findIndex(col => col.id === column.id);
      if (index !== -1) {
        newSelection[index] = { ...newSelection[index], enabled: true };
      }
    });
    
    setSelectedColumns(newSelection);
  };

  const handleDeselectAllColumns = (category: string) => {
    const categoryColumns = allExportableColumns[category as keyof typeof allExportableColumns];
    const newSelection = [...selectedColumns];
    
    categoryColumns.columns.forEach(column => {
      const index = newSelection.findIndex(col => col.id === column.id);
      if (index !== -1) {
        newSelection[index] = { ...newSelection[index], enabled: false };
      }
    });
    
    setSelectedColumns(newSelection);
  };

  const handleSelectAll = () => {
    const newSelection = selectedColumns.map(col => ({ ...col, enabled: true }));
    setSelectedColumns(newSelection);
  };

  const handleDeselectAll = () => {
    const newSelection = selectedColumns.map(col => ({ ...col, enabled: false }));
    setSelectedColumns(newSelection);
  };

  // فلترة الأعمدة حسب البحث والفئة
  const getFilteredColumns = () => {
    let filtered = selectedColumns;

    // فلترة حسب الفئة
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(col => col.category === selectedCategory);
    }

    // فلترة حسب البحث
    if (columnSearchTerm) {
      filtered = filtered.filter(col => 
        col.label.toLowerCase().includes(columnSearchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  // تصدير متقدم
  const handleAdvancedExport = async () => {
    try {
      setExportLoading(true);
      
    const enabledColumns = selectedColumns.filter(col => col.enabled);
    
      if (enabledColumns.length === 0) {
        alert('يرجى اختيار عمود واحد على الأقل للتصدير');
        return;
      }

      if (exportFormat === 'excel') {
        await exportToExcelAdvanced(enabledColumns);
      } else if (exportFormat === 'pdf') {
        await exportToPDFAdvanced(enabledColumns);
      }
      
      setShowExportModal(false);
      alert(`تم تصدير البيانات إلى ${exportFormat === 'excel' ? 'Excel' : 'PDF'} بنجاح!`);
      
    } catch (error) {
      console.error('خطأ في التصدير:', error);
      alert('حدث خطأ في تصدير البيانات');
    } finally {
      setExportLoading(false);
    }
  };

  // تصدير Excel متقدم
  const exportToExcelAdvanced = async (enabledColumns: typeof exportableColumns) => {
    // Create CSV content
    let csvContent = '\uFEFF'; // UTF-8 BOM for Arabic support
    
    // Headers
    csvContent += enabledColumns.map(col => col.label).join(',') + '\n';
    
    // Data rows
    students.forEach(student => {
      const row = enabledColumns.map(col => {
        const value = getStudentFieldValue(student, col.id);
        return `"${value}"`;
      });
      csvContent += row.join(',') + '\n';
    });
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `طلاب_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // تصدير PDF متقدم
  const exportToPDFAdvanced = async (enabledColumns: typeof exportableColumns) => {
    // Create table HTML محسن للـ A3
    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <title>قائمة الطلاب</title>
          <style>
            @page {
              size: ${paperSize} landscape;
              margin: 12mm;
            }
            body { 
              font-family: 'Arial', sans-serif; 
              padding: 15px; 
              margin: 0;
              direction: rtl;
              text-align: right;
              font-size: 10px;
            }
            .header {
              text-align: center;
              margin-bottom: 20px;
              border-bottom: 2px solid #333;
              padding-bottom: 15px;
            }
            .header h1 {
              color: #2c3e50;
              margin: 0;
              font-size: 18px;
            }
            .header p {
              color: #7f8c8d;
              margin: 8px 0 0 0;
              font-size: 11px;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-top: 15px;
              font-size: 8px;
              table-layout: fixed;
            }
            th, td { 
              border: 1px solid #ddd; 
              padding: 3px 5px; 
              text-align: right; 
              vertical-align: top;
              word-wrap: break-word;
              word-break: break-word;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: normal;
              line-height: 1.2;
            }
            th { 
              background-color: #f8f9fa; 
              font-weight: bold; 
              color: #2c3e50;
              font-size: 7px;
              white-space: nowrap;
            }
            td { 
              background-color: white;
              font-size: 7px;
              line-height: 1.1;
            }
            tr:nth-child(even) {
              background-color: #f8f9fa;
            }
            tr:nth-child(odd) {
              background-color: white;
            }
            .footer {
              margin-top: 20px;
              text-align: center;
              font-size: 8px;
              color: #7f8c8d;
              border-top: 1px solid #ddd;
              padding-top: 8px;
            }
            /* تحسين عرض الأعمدة الطويلة */
            .long-text {
              max-width: 120px;
              white-space: normal;
              overflow: hidden;
              text-overflow: ellipsis;
              word-wrap: break-word;
              word-break: break-word;
              line-height: 1.1;
            }
            /* تحسين عرض الأعمدة القصيرة */
            .short-text {
              max-width: 70px;
              white-space: normal;
              overflow: hidden;
              text-overflow: ellipsis;
              word-wrap: break-word;
              word-break: break-word;
              line-height: 1.1;
            }
            /* تحسين عرض الأعمدة المتوسطة */
            .medium-text {
              max-width: 90px;
              white-space: normal;
              overflow: hidden;
              text-overflow: ellipsis;
              word-wrap: break-word;
              word-break: break-word;
              line-height: 1.1;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>قائمة الطلاب</h1>
            <p>تاريخ التصدير: ${new Date().toLocaleDateString('en-GB')} | عدد الطلاب: ${students.length} | عدد الأعمدة: ${enabledColumns.length}</p>
          </div>
          
          <table>
            <thead>
              <tr>
                ${enabledColumns.map(col => {
                  const className = col.id.includes('name') || col.id.includes('address') || col.id.includes('achievements') || 
                                  col.id.includes('school') || col.id.includes('contact') || col.id.includes('requirements') ? 'long-text' : 
                                  col.id.includes('id') || col.id.includes('phone') || col.id.includes('date') || 
                                  col.id.includes('year') || col.id.includes('gpa') || col.id.includes('score') ? 'medium-text' : 'short-text';
                  return `<th class="${className}">${col.label}</th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>
              ${students.map(student => {
                return '<tr>' + enabledColumns.map(col => {
                  const value = getStudentFieldValue(student, col.id);
                  const className = col.id.includes('name') || col.id.includes('address') || col.id.includes('achievements') || 
                                  col.id.includes('school') || col.id.includes('contact') || col.id.includes('requirements') ? 'long-text' : 
                                  col.id.includes('id') || col.id.includes('phone') || col.id.includes('date') || 
                                  col.id.includes('year') || col.id.includes('gpa') || col.id.includes('score') ? 'medium-text' : 'short-text';
                  return `<td class="${className}">${value}</td>`;
                }).join('') + '</tr>';
              }).join('')}
            </tbody>
          </table>
          
          <div class="footer">
            <p>تم إنشاء هذا التقرير تلقائياً من نظام إدارة الطلاب | حجم الورق: ${paperSize} أفقي</p>
          </div>
        </body>
      </html>
    `;
    
    // Open print dialog
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
  };

  // دالة للحصول على قيمة حقل الطالب
  const getStudentFieldValue = (student: Student, fieldId: string): string => {
    switch(fieldId) {
      case 'university_id':
        return student.university_id || '';
      case 'full_name':
        return (student.full_name_ar || student.full_name || '').replace(/,/g, '؛');
      case 'nickname':
        return (student.nickname || '').replace(/,/g, '؛');
      case 'mother_name':
        return (student.mother_name || '').replace(/,/g, '؛');
      case 'national_id':
        return student.national_id || '';
      case 'birth_date':
        return formatDate(student.birth_date);
      case 'birth_place':
        return (student.birth_place || '').replace(/,/g, '؛');
      case 'area':
        return (student.area || '').replace(/,/g, '؛');
      case 'gender':
        return formatGender(student.gender);
      case 'religion':
        return student.religion || '';
      case 'marital_status':
        return student.marital_status === 'single' ? 'أعزب' : 
               student.marital_status === 'married' ? 'متزوج' : 
               student.marital_status === 'divorced' ? 'مطلق' : 
               student.marital_status === 'widowed' ? 'أرمل' : student.marital_status || '';
      case 'phone':
        return student.phone ? (student.phone.startsWith('+964') ? student.phone.replace('+964', '') : student.phone) : '';
      case 'email':
        return student.email || '';
      case 'address':
        return (student.address || '').replace(/,/g, '؛');
      case 'emergency_contact_name':
        return (student.emergency_contact_name || '').replace(/,/g, '؛');
      case 'emergency_contact_relationship':
        return (student.emergency_contact_relationship || '').replace(/,/g, '؛');
      case 'emergency_contact_phone':
        return student.emergency_contact_phone ? (student.emergency_contact_phone.startsWith('+964') ? student.emergency_contact_phone.replace('+964', '') : student.emergency_contact_phone) : '';
      case 'secondary_school_name':
        return (student.secondary_school_name || '').replace(/,/g, '؛');
      case 'secondary_school_type':
        return student.secondary_school_type === 'public' ? 'حكومية' : 
               student.secondary_school_type === 'private' ? 'أهلية' : 
               student.secondary_school_type === 'international' ? 'دولية' : student.secondary_school_type || '';
      case 'secondary_graduation_year':
        return student.secondary_graduation_year || '';
      case 'secondary_gpa':
        return student.secondary_gpa !== null && student.secondary_gpa !== undefined 
          ? (typeof student.secondary_gpa === 'number' 
              ? student.secondary_gpa.toFixed(2).replace(/\.?0+$/, '') 
              : parseFloat(String(student.secondary_gpa)).toFixed(2).replace(/\.?0+$/, ''))
          : '';
      case 'secondary_total_score':
        return student.secondary_total_score ? String(student.secondary_total_score) : '';
      case 'exam_attempt':
        return student.exam_attempt === 'first' ? 'الأول' : 
               student.exam_attempt === 'second' ? 'الثاني' : 
               student.exam_attempt === 'third' ? 'الثالث' : student.exam_attempt || '';
      case 'exam_number':
        return student.exam_number || '';
      case 'exam_password':
        return student.exam_password || '';
      case 'branch':
        return (student.branch || '').replace(/,/g, '؛');
      case 'admission_type':
        return formatAdmissionType(student.admission_type || '');
      case 'department':
        return formatDepartment(student.department || student.major || '');
      case 'study_type':
        return student.study_type === 'morning' ? 'صباحي' : student.study_type === 'evening' ? 'مسائي' : student.study_type || '';
      case 'level':
        return formatLevel(student.level || '');
      case 'semester':
        return student.semester === 'first' ? 'الأول' : student.semester === 'second' ? 'الثاني' : student.semester || '';
      case 'academic_year':
        return student.academic_year || '';
      case 'special_requirements':
        return ((student as Student & { special_requirements?: string }).special_requirements || '').replace(/,/g, '؛');
      case 'scholarship':
        return (student as Student & { scholarship?: boolean }).scholarship ? 'نعم' : 'لا';
      case 'scholarship_type':
        return ((student as Student & { scholarship_type?: string }).scholarship_type || '').replace(/,/g, '؛');
      case 'created_at':
        return formatDate(student.created_at);
      case 'updated_at':
        return formatDate(student.updated_at);
      case 'status':
        return student.status || 'نشط';
      default:
        return '';
    }
  };

  console.log('🎯 عرض صفحة قائمة الطلاب:', { 
    loading, 
    studentsCount: students.length, 
    totalStudents, 
    currentPage, 
    totalPages 
  });
  
  console.log('📋 بيانات الطلاب الحالية:', students);
      console.log('🔍 تفاصيل الطالب الأول:', students[0] ? {
        id: students[0].id,
        full_name: students[0].full_name,
        mother_name: students[0].mother_name,
        area: students[0].area,
        exam_attempt: students[0].exam_attempt,
        exam_number: students[0].exam_number,
        exam_password: students[0].exam_password,
        branch: students[0].branch,
        has_mother_name: 'mother_name' in students[0],
        has_area: 'area' in students[0],
        has_exam_attempt: 'exam_attempt' in students[0],
        has_exam_number: 'exam_number' in students[0],
        has_exam_password: 'exam_password' in students[0],
        has_branch: 'branch' in students[0]
      } : 'لا توجد بيانات');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <div className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4 space-x-reverse">
              <button
                onClick={() => router.back()}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors duration-200"
                title="العودة"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
                             <div>
                 <h1 className="text-xl font-bold text-gray-900">قائمة الطلبة</h1>
                 <p className="text-xs text-gray-600">عرض وإدارة جميع الطلبة المسجلين</p>
               </div>
            </div>
            <div className="flex items-center space-x-4 space-x-reverse">
              <span className="text-sm text-gray-600">
                إجمالي الطلبة: <span className="font-semibold text-blue-600">{totalStudents}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0 lg:space-x-4 space-x-reverse">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-md">
              <div className="relative">
                                 <input
                   type="text"
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   placeholder="البحث بالاسم أو رقم الهوية..."
                   className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-10"
                 />
                <div className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </form>

                         {/* Department Filter, Level Filter & Export */}
             <div className="flex items-center gap-3">
               <select
                 value={selectedDepartment}
                 onChange={handleDepartmentChange}
                 className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white h-10"
               >
                <option value="">جميع الأقسام</option>
                <option value="تقنيات التخدير">قسم تقنيات التخدير</option>
                <option value="تقنيات الأشعة">قسم تقنيات الأشعة</option>
                <option value="تقنيات صناعة الأسنان">قسم تقنيات صناعة الأسنان</option>
                <option value="هندسة تقنيات البناء والانشاءات">قسم هندسة تقنيات البناء والانشاءات</option>
                <option value="تقنيات النفط والغاز">قسم تقنيات النفط والغاز</option>
                <option value="تقنيات الفيزياء الصحية">قسم تقنيات الفيزياء الصحية</option>
                <option value="تقنيات البصريات">قسم تقنيات البصريات</option>
                <option value="تقنيات صحة المجتمع">قسم تقنيات صحة المجتمع</option>
                <option value="تقنيات طب الطوارئ">قسم تقنيات طب الطوارئ</option>
                <option value="تقنيات العلاج الطبيعي">قسم تقنيات العلاج الطبيعي</option>
                <option value="هندسة تقنيات الامن السيبراني والحوسبة السحابية">قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية</option>
                <option value="القانون">قسم القانون</option>
              </select>

              {/* Level Filter */}
              <select
                value={selectedLevel}
                onChange={handleLevelChange}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white h-10"
              >
                <option value="">الدرجة العلمية</option>
                <option value="bachelor">بكالوريوس</option>
                <option value="master">ماجستير</option>
                <option value="phd">دكتوراه</option>
                <option value="diploma">دبلوم</option>
              </select>

              {/* Admission Type Filter */}
              <select
                value={selectedAdmissionType}
                onChange={handleAdmissionTypeChange}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white h-10"
              >
                <option value="">المرحلة الدراسية</option>
                <option value="first">الأولى</option>
                <option value="second">الثانية</option>
                <option value="third">الثالثة</option>
                <option value="fourth">الرابعة</option>
              </select>

              {/* Study Type Filter */}
              <select
                value={selectedStudyType}
                onChange={handleStudyTypeChange}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white h-10"
              >
                <option value="">نوع الدراسة</option>
                <option value="morning">صباحي</option>
                <option value="evening">مسائي</option>
              </select>

              {/* Semester Filter */}
              <select
                value={selectedSemester}
                onChange={handleSemesterChange}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white h-10"
              >
                <option value="">الفصل الدراسي</option>
                <option value="first">الأول</option>
                <option value="second">الثاني</option>
              </select>
              
                             {/* Export Button */}
               <button
                 onClick={() => setShowExportModal(true)}
                 className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-sm hover:shadow-md h-10"
                 title="تصدير البيانات"
               >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="hidden sm:inline">تصدير</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal المتقدم */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-green-600 to-green-500 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">تصدير البيانات المتقدم</h2>
                    <p className="text-green-100 text-sm">اختر الأعمدة المطلوبة وتنسيق التصدير</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-white hover:text-green-200 transition-colors duration-200 p-2 hover:bg-white/10 rounded-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex h-[70vh]">
              {/* Sidebar - فئات الأعمدة */}
              <div className="w-80 bg-gray-50 border-l border-gray-200 p-4 overflow-y-auto">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">فئات البيانات</h3>
                  
                  {/* أزرار التحكم العامة */}
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={handleSelectAll}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 text-sm"
                    >
                      اختيار الكل
                    </button>
                    <button
                      onClick={handleDeselectAll}
                      className="flex-1 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 text-sm"
                    >
                      إلغاء الكل
                    </button>
                  </div>

                  {/* البحث */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={columnSearchTerm}
                      onChange={(e) => setColumnSearchTerm(e.target.value)}
                      placeholder="البحث في الأعمدة..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                    />
                  </div>

                  {/* فلتر الفئات */}
                  <div className="mb-4">
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                    >
                      <option value="all">جميع الفئات</option>
                      <option value="personal">المعلومات الشخصية</option>
                      <option value="secondary">التعليم الثانوي</option>
                      <option value="university">القبول الجامعي</option>
                      <option value="system">معلومات النظام</option>
                    </select>
                  </div>
                </div>

                {/* قائمة الفئات */}
              <div className="space-y-2">
                  {Object.entries(allExportableColumns).map(([categoryKey, category]) => {
                    const categoryColumns = category.columns;
                    const enabledCount = categoryColumns.filter(col => 
                      selectedColumns.find(selected => selected.id === col.id)?.enabled
                    ).length;
                    
                    return (
                      <div key={categoryKey} className="border border-gray-200 rounded-lg p-3 bg-white">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{category.icon}</span>
                            <span className="font-medium text-gray-800 text-sm">{category.title}</span>
                          </div>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {enabledCount}/{categoryColumns.length}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleSelectAllColumns(categoryKey)}
                            className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 transition-colors duration-200"
                          >
                            الكل
                          </button>
                          <button
                            onClick={() => handleDeselectAllColumns(categoryKey)}
                            className="flex-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 transition-colors duration-200"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Main Content - قائمة الأعمدة */}
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">الأعمدة المختارة</h3>
                  <p className="text-gray-600 text-sm">
                    تم اختيار {selectedColumns.filter(col => col.enabled).length} من {selectedColumns.length} عمود
                  </p>
                </div>

                <div className="space-y-2">
                  {getFilteredColumns().map((column) => (
                  <label
                    key={column.id}
                    className="flex items-center p-3 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors duration-200"
                  >
                    <input
                      type="checkbox"
                      checked={column.enabled}
                        onChange={() => handleColumnToggle(column.id)}
                      className="w-5 h-5 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                    />
                      <div className="mr-3 flex-1">
                        <span className="text-gray-700 font-medium">{column.label}</span>
                        <span className="text-xs text-gray-500 mr-2">({column.category})</span>
                      </div>
                  </label>
                ))}
                </div>

                {getFilteredColumns().length === 0 && (
                  <div className="text-center py-8">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500">لا توجد أعمدة تطابق البحث</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">تنسيق التصدير:</label>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value)}
                    className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                  >
                    <option value="excel">Excel (CSV)</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>
                
                {exportFormat === 'pdf' && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">حجم الورق:</label>
                    <select
                      value={paperSize}
                      onChange={(e) => setPaperSize(e.target.value as 'A4' | 'A3')}
                      className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                    >
                      <option value="A3">A3 (أكبر - للأعمدة الكثيرة)</option>
                      <option value="A4">A4 (عادي)</option>
                    </select>
                  </div>
                )}
                
                <div className="text-sm text-gray-600">
                  {selectedColumns.filter(col => col.enabled).length} عمود مختار
                </div>
              </div>
              
              <div className="flex gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                  className="px-6 py-2 text-gray-600 hover:text-gray-800 transition-colors duration-200"
              >
                إلغاء
              </button>
              <button
                  onClick={handleAdvancedExport}
                  disabled={exportLoading || selectedColumns.filter(col => col.enabled).length === 0}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {exportLoading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      جاري التصدير...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                      تصدير {exportFormat === 'excel' ? 'Excel' : 'PDF'}
                    </>
                  )}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

             {/* Table */}
       <div className="w-full px-1 py-6">
         <div className="bg-white shadow-xl rounded-lg overflow-x-auto relative">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-600">جاري تحميل البيانات...</p>
              </div>
            </div>
                     ) : students.length === 0 ? (
             <div className="text-center py-12">
               <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
               </svg>
               <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد بيانات</h3>
               <p className="text-gray-600">لم يتم العثور على أي طلاب</p>
               {(selectedDepartment || selectedLevel || selectedAdmissionType || selectedStudyType || selectedSemester) && (
                 <p className="text-sm text-gray-500 mt-2">
                   لا يوجد طلاب يطابقون المعايير المحددة
                 </p>
               )}
             </div>
          ) : (
            <div className="w-full">
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                      #
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                      الرقم التسلسلي
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-56">
                      الاسم الكامل
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                      اللقب
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-44">
                      تاريخ الميلاد
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-44">
                      رقم الهاتف
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      الجنس
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                      سنة التخرج
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-56">
                      القسم
                    </th>
                                         <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-44">
                       السنة الأكاديمية
                     </th>
                     <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                       مرحلة القبول
                     </th>
                     <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                       الدرجة العلمية
                     </th>
                     <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                       رقم الهوية الوطنية
                     </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                      المعدل التراكمي
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                      نوع الدراسة
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-36">
                      الفصل الدراسي
                    </th>
                    <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                      تأكيد الدفع
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {students.map((student, index) => {
                    console.log('📊 عرض الجدول مع', students.length, 'طالب');
                    return (
                    <tr key={student.id} className="hover:bg-gray-50 transition-colors duration-200">
                      <td className="px-2 py-4 whitespace-nowrap text-xs font-medium text-gray-900 text-center">
                        {(currentPage - 1) * 50 + index + 1}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs font-medium text-blue-600 text-center">
                        {student.university_id || '-'}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900">
                        {student.full_name_ar || student.full_name}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {student.nickname}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {formatDate(student.birth_date)}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {student.phone ? 
                          (student.phone.startsWith('+964') ? 
                            student.phone.replace('+964', '') : 
                            student.phone
                          ) : 
                          '-'
                        }
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {formatGender(student.gender)}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {student.secondary_graduation_year || '-'}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900">
                        {formatDepartment(student.department || student.major || '')}
                      </td>
                                             <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                         {student.academic_year || '-'}
                       </td>
                       <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                         {formatAdmissionType(student.admission_type || '')}
                       </td>
                       <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                         {formatLevel(student.level || '')}
                       </td>
                       <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                         {student.national_id || '-'}
                       </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {student.secondary_gpa !== null && student.secondary_gpa !== undefined 
                          ? (typeof student.secondary_gpa === 'number' 
                              ? student.secondary_gpa.toFixed(2).replace(/\.?0+$/, '') 
                              : parseFloat(String(student.secondary_gpa)).toFixed(2).replace(/\.?0+$/, ''))
                          : '-'}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {student.study_type === 'morning' ? 'صباحي' : student.study_type === 'evening' ? 'مسائي' : student.study_type || '-'}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-gray-900 text-center">
                        {student.semester === 'first' ? 'الأول' : student.semester === 'second' ? 'الثاني' : student.semester || '-'}
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap text-xs text-center">
                        {student.payment_status === 'paid' ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-emerald-700 bg-emerald-50 border border-emerald-200">تم الدفع</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-amber-700 bg-amber-50 border border-amber-200">بانتظار الدفع</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <div className="text-sm text-gray-700">
              عرض <span className="font-medium">{(currentPage - 1) * 50 + 1}</span> إلى{' '}
              <span className="font-medium">
                {Math.min(currentPage * 50, totalStudents)}
              </span>{' '}
              من <span className="font-medium">{totalStudents}</span> نتيجة
            </div>
            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                السابق
              </button>
              
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const page = i + 1;
                return (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`px-3 py-2 text-sm font-medium rounded-md ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
