'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Student } from '@/src/lib/types';

interface PersonalData {
  fullName: string; // الاسم الرباعي
  nickname: string; // اللقب
  motherName: string; // اسم الأم الثلاثي
  nationalId: string;
  birthDate: string;
  birthPlace: string;
  area: string; // المنطقة
  gender: 'male' | 'female';
  religion: 'مسلم' | 'مسيحي' | 'الصابئة' | 'اليزيدية' | 'غير ذلك';
  maritalStatus: 'single' | 'married' | 'divorced' | 'widowed';
  phone: string;
  email: string;
  address: string;
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
}

interface SecondaryEducation {
  schoolName: string;
  schoolType: '' | 'public' | 'private' | 'international';
  graduationYear: string;
  gpa: string;
  totalScore: string;
  examAttempt: '' | 'first' | 'second' | 'third'; // الدور
  examNumber: string; // الرقم الامتحاني
  examPassword: string; // الرقم السري
  branch: string; // الفرع
}

interface UniversityAdmission {
  admissionType: '' | 'first' | 'second' | 'third' | 'fourth';
  admissionChannel: '' | 'general' | 'martyrs' | 'social_care' | 'special_needs' | 'political_prisoners' | 'siblings_married' | 'minister_directive' | 'dean_approval' | 'faculty_children' | 'top_students' | 'health_ministry';
  department: string;
  studyType: '' | 'morning' | 'evening';
  level: '' | 'bachelor' | 'master' | 'phd' | 'diploma';
  semester: '' | 'first' | 'second';
  academicYear: '' | '2024-2025' | '2025-2026' | '2026-2027' | '2027-2028' | '2028-2029';
  specialRequirements: string;
  scholarship: boolean;
  scholarshipType?: string;
  username: string; // الاسم المستخدم
  password: string; // كلمة المرور
}

interface Documents {
  nationalIdFront: File | null;
  nationalIdBack: File | null;
  residenceCardFront: File | null;
  residenceCardBack: File | null;
  secondaryCertificate: File | null;
  personalPhoto: File | null;
  medicalExamination: File | null; // الفحص الطبي
}

interface StudentFormData {
  personalData: PersonalData;
  secondaryEducation: SecondaryEducation;
  universityAdmission: UniversityAdmission;
  documents: Documents;
}

export default function StudentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkImportMode, setBulkImportMode] = useState<'table' | 'file'>('table');
  const [bulkImportStudents, setBulkImportStudents] = useState<Array<{
    full_name: string;
    nickname: string;
    mother_name: string;
    birth_date: string;
    national_id: string;
    phone: string;
    school_name: string;
    gpa: string;
    graduation_year: string;
    exam_number: string;
    exam_password: string;
    department: string;
    username: string;
    password: string;
    stage: string;
    study_type: string;
    level: string;
    academic_year: string;
    semester: string;
  }>>([{
    full_name: '',
    nickname: '',
    mother_name: '',
    birth_date: '',
    national_id: '',
    phone: '',
    school_name: '',
    gpa: '',
    graduation_year: '',
    exam_number: '',
    exam_password: '',
    department: '',
    username: '',
    password: '',
    stage: '',
    study_type: '',
    level: '',
    academic_year: '',
    semester: ''
  }]);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  
  // بيانات الطلاب الحقيقية
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>('all');
  const [academicYears, setAcademicYears] = useState<string[]>(['all']);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    total_pages: 0
  });
  const [departmentCounts, setDepartmentCounts] = useState<Record<string, number>>({});
  
  // حالة لأخطاء التحقق من صحة البيانات
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  
  const [formData, setFormData] = useState<StudentFormData>({
    personalData: {
      fullName: '', // الاسم الرباعي
      nickname: '', // اللقب
      motherName: '', // اسم الأم الثلاثي
      nationalId: '',
      birthDate: '',
      birthPlace: '',
      area: '',
      gender: 'male',
      religion: 'مسلم', // القيمة الافتراضية
      maritalStatus: 'single',
      phone: '',
      email: '',
      address: '',
      emergencyContact: {
        name: '',
        relationship: '',
        phone: ''
      }
    },
    secondaryEducation: {
      schoolName: '',
      schoolType: '',
      graduationYear: '',
      gpa: '',
      totalScore: '',
      examAttempt: '', // الدور الافتراضي
      examNumber: '', // الرقم الامتحاني
      examPassword: '', // الرقم السري
      branch: '' // الفرع
    },
    universityAdmission: {
      admissionType: '',
      admissionChannel: '',
      department: '',
      studyType: '',
      level: '',
      semester: '',
      academicYear: '',
      specialRequirements: '',
      scholarship: false,
      scholarshipType: '',
      username: '', // الاسم المستخدم
      password: '' // كلمة المرور
    },
    documents: {
      nationalIdFront: null,
      nationalIdBack: null,
      residenceCardFront: null,
      residenceCardBack: null,
      secondaryCertificate: null,
      personalPhoto: null,
      medicalExamination: null
    }
  });

  const [generatedStudentId, setGeneratedStudentId] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [openStatusDropdown, setOpenStatusDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [printStudent, setPrintStudent] = useState<Student | null>(null);

  // قائمة حالات الطالب
  const studentStatuses = [
    'مستمر',
    'مرقن بسبب الغياب',
    'مرقن بسبب عدم تسليم وثيقة الإعدادية',
    'مرقن بسبب الوفاة',
    'مرقن بسبب الرسوب سنتين',
    'مرقن بسبب الرسوب بمواد التحميل',
    'راسب بسبب الغياب',
    'راسب بسبب عقوبة انضباطية',
    'راسب بالمواد الدراسية',
    'محمل من المرحلة السابقة',
    'مؤجّل',
    'حالات أخرى'
  ];

  // دالة للحصول على لون الحالة
  const getStatusColor = (status: string) => {
    if (!status || status === 'مستمر') {
      return 'bg-green-100 text-green-800 border-green-200';
    }
    if (status.includes('مرقن')) {
      return 'bg-orange-100 text-orange-800 border-orange-200';
    }
    if (status.includes('راسب')) {
      return 'bg-red-100 text-red-800 border-red-200';
    }
    if (status === 'محمل من المرحلة السابقة') {
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    }
    if (status === 'مؤجّل') {
      return 'bg-blue-100 text-blue-800 border-blue-200';
    }
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  // دالة لتحديث حالة الطالب
  const handleUpdateStatus = async (studentId: string, newStatus: string) => {
    try {
      // جلب بيانات الطالب الحالية أولاً
      const student = students.find(s => s.id === studentId);
      if (!student) return;

      const response = await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          ...student,
          academic_status: newStatus 
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // تحديث الحالة في القائمة المحلية
        setStudents(prevStudents =>
          prevStudents.map(s =>
            s.id === studentId
              ? { ...s, academic_status: newStatus }
              : s
          )
        );
        setOpenStatusDropdown(null);
      } else {
        console.error('خطأ في تحديث الحالة:', data.message || data.error);
        alert('حدث خطأ أثناء تحديث الحالة: ' + (data.message || data.error || 'خطأ غير معروف'));
      }
    } catch (error) {
      console.error('خطأ في تحديث الحالة:', error);
      alert('حدث خطأ أثناء تحديث الحالة');
    }
  };

  // دالة لتنسيق التاريخ
  const formatRegistrationDate = (dateString: string) => {
    if (!dateString) return 'غير محدد';
    
    // إذا كان التاريخ بصيغة YYYY-MM-DD، إرجاعه مباشرة
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [year, month, day] = dateString.split('-');
      return `${day}/${month}/${year}`;
    }
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'غير محدد';
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  };

  const fetchStudents = async () => {
    try {
      setLoading(true);
      console.log('🔄 جلب بيانات الطلاب في الصفحة الرئيسية...');
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(selectedDepartment && { department: selectedDepartment }),
        ...(selectedAcademicYear && selectedAcademicYear !== 'all' && { academic_year: selectedAcademicYear })
      });

      console.log('URL المطلوب:', `/api/students?${params}`);
      const response = await fetch(`/api/students?${params}`);
      console.log('استجابة API:', response.status, response.statusText);
      
      const data = await response.json();
      console.log('النتيجة الكاملة:', data);

          if (data.success && data.students) {
        console.log('✅ بيانات الطلاب المستلمة في الصفحة الرئيسية:', data.students);
        console.log('عدد الطلاب:', data.students.length);
        console.log('تفاصيل الطالب الأول:', data.students[0]);
        console.log('الاسم الكامل:', data.students[0]?.full_name);
        console.log('اللقب:', data.students[0]?.nickname);
        const provinceInfo = data.students.map((s: Student) => ({
          name: s.full_name,
          province: s.province,
          province_type: typeof s.province,
          province_is_null: s.province === null,
          province_is_undefined: s.province === undefined,
          has_province: 'province' in s
        }));
        console.log('🔍 المحافظة للطلاب:', provinceInfo);
        console.log('🔍 تفاصيل المحافظة للطالب الأول:', {
          student: data.students[0]?.full_name,
          province: data.students[0]?.province,
          province_in_object: 'province' in (data.students[0] || {}),
          all_keys: data.students[0] ? Object.keys(data.students[0]) : []
        });
            const stageInfo = data.students.map((s: Student) => ({
              name: s.full_name,
              admission_type: s.admission_type,
              study_type: s.study_type,
              level: s.level,
              academic_year: s.academic_year,
              semester: s.semester
            }));
            console.log('🔍 المرحلة للطلاب:', stageInfo);
            console.log('🔍 تفاصيل المرحلة للطالب الأول:', {
              name: data.students[0]?.full_name,
              admission_type: data.students[0]?.admission_type,
              admission_type_type: typeof data.students[0]?.admission_type,
              admission_type_null: data.students[0]?.admission_type === null,
              admission_type_undefined: data.students[0]?.admission_type === undefined,
              study_type: data.students[0]?.study_type,
              level: data.students[0]?.level,
              academic_year: data.students[0]?.academic_year,
              semester: data.students[0]?.semester
            });
        setStudents(data.students);
        setPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          total_pages: data.pagination.total_pages
        }));
      } else {
        console.log('❌ لم يتم العثور على بيانات الطلاب:', data);
        setStudents([]);
      }
    } catch (error) {
      console.error('خطأ في جلب الطلاب:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartmentCounts = async () => {
    try {
      // خريطة لربط أسماء الأقسام من API بالأسماء المستخدمة في البطاقات
      const departmentNameMapping: Record<string, string> = {
        'تقنيات التخدير': 'تقنيات التخدير',
        'تقنيات الاشعة': 'تقنيات الأشعة', // API يستخدم 'الاشعة' بدون همزة
        'تقنيات صناعة الاسنان': 'تقنيات صناعة الأسنان', // API يستخدم 'الاسنان' بدون همزة
        'هندسة تقنيات البناء والانشاءات': 'هندسة تقنيات البناء والانشاءات',
        'تقنيات البناء والاستشارات': 'هندسة تقنيات البناء والانشاءات', // للتوافق مع البيانات القديمة
        'تقنيات هندسة النفط والغاز': 'تقنيات هندسة النفط والغاز',
        'تقنيات الفيزياء الصحية': 'تقنيات الفيزياء الصحية',
        'تقنيات البصريات': 'تقنيات البصريات',
        'تقنيات صحة المجتمع': 'تقنيات صحة المجتمع',
        'تقنيات طب الطوارئ': 'تقنيات طب الطوارئ',
        'تقنيات العلاج الطبيعي': 'تقنيات العلاج الطبيعي',
        'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
        'تقنيات الامن السيبراني': 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', // للتوافق مع البيانات القديمة
        'تقنيات الأمن السيبراني': 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', // للتوافق مع البيانات القديمة
        'القانون': 'القانون'
      };

      // جلب إحصائيات الأقسام من API مع فلترة حسب العام الدراسي
      const url = selectedAcademicYear && selectedAcademicYear !== 'all'
        ? `/api/departments/stats?academic_year=${encodeURIComponent(selectedAcademicYear)}`
        : '/api/departments/stats';
      const response = await fetch(url);
      const data = await response.json();

      if (data.success && data.data) {
        const counts: Record<string, number> = {};
        
        // تهيئة جميع الأقسام بصفر
        const displayDepartments = [
          'تقنيات التخدير',
          'تقنيات الأشعة',
          'تقنيات صناعة الأسنان',
          'هندسة تقنيات البناء والانشاءات',
          'تقنيات هندسة النفط والغاز',
          'تقنيات الفيزياء الصحية',
          'تقنيات البصريات',
          'تقنيات صحة المجتمع',
          'تقنيات طب الطوارئ',
          'تقنيات العلاج الطبيعي',
          'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
          'القانون'
        ];
        
        displayDepartments.forEach(dept => {
          counts[dept] = 0;
        });

        // تحويل البيانات من API إلى الأسماء المستخدمة في البطاقات
        data.data.forEach((dept: { name: string; total: number }) => {
          const displayName = departmentNameMapping[dept.name] || dept.name;
          if (displayName && counts.hasOwnProperty(displayName)) {
            counts[displayName] = dept.total;
          }
        });

        console.log('📈 عدد الطلاب في كل قسم:', counts);
        setDepartmentCounts(counts);
      } else {
        console.error('❌ فشل في جلب إحصائيات الأقسام:', data);
      }
    } catch (error) {
      console.error('خطأ في جلب عدد الطلاب للأقسام:', error);
    }
  };

  // تأخير البحث لتجنب الطلبات المتكررة مع كل حرف
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchTerm.trim();
      setDebouncedSearch(next);
      setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // جلب قائمة الأعوام الدراسية المتاحة
  useEffect(() => {
    const fetchAcademicYears = async () => {
      try {
        const response = await fetch('/api/academic-years');
        const data = await response.json();
        if (data.success && data.data && data.data.length > 0) {
          // إضافة خيار "جميع السنوات" في البداية
          setAcademicYears(['all', ...data.data]);
          // القيمة الافتراضية هي "جميع السنوات"
          setSelectedAcademicYear('all');
        } else {
          // إذا لم تكن هناك أعوام، نضيف فقط "جميع السنوات"
          setAcademicYears(['all']);
          setSelectedAcademicYear('all');
        }
      } catch (error) {
        console.error('خطأ في جلب الأعوام الدراسية:', error);
        // في حالة الخطأ، نضيف فقط "جميع السنوات"
        setAcademicYears(['all']);
        setSelectedAcademicYear('all');
      } finally {
        setYearsLoading(false);
      }
    };

    fetchAcademicYears();
  }, []);

  // جلب بيانات الطلاب من قاعدة البيانات
  useEffect(() => {
    fetchStudents();
    fetchDepartmentCounts();
  }, [pagination.page, debouncedSearch, selectedDepartment, selectedAcademicYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // البث الفوري لتحديث القائمة عند تغيير حالات الدفع من نظام الحسابات
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel('payments');
      ch.onmessage = (e) => {
        if (e?.data?.type === 'payment-updated') {
          fetchStudents();
          fetchDepartmentCounts();
        }
      };
    } catch {}
    return () => {
      try { ch?.close(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // فحص معامل URL لفتح الفورم تلقائياً
  useEffect(() => {
    const openForm = searchParams.get('openForm');
    if (openForm === 'true') {
      setCurrentStep(1);
      setShowConfirmation(false);
      setGeneratedStudentId('');
      setShowAddStudentModal(true);
      // إزالة المعامل من URL
      window.history.replaceState({}, '', '/student-affairs/students');
    }
  }, [searchParams]);

  // مستمع للحدث من الزر العائم
  useEffect(() => {
    const handleOpenAddStudentModal = () => {
      setCurrentStep(1);
      setShowConfirmation(false);
      setGeneratedStudentId('');
      setShowAddStudentModal(true);
    };

    window.addEventListener('openAddStudentModal', handleOpenAddStudentModal);
    
    return () => {
      window.removeEventListener('openAddStudentModal', handleOpenAddStudentModal);
    };
  }, []);

  // دوال التحقق من صحة البيانات
  const validateArabicText = (value: string): boolean => {
    // السماح بالحروف العربية والمسافات فقط (لا أرقام)
    const arabicTextPattern = /^[\u0600-\u06FF\s\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/;
    return arabicTextPattern.test(value) || value === '';
  };

  const validateNumbersOnly = (value: string): boolean => {
    // السماح بالأرقام فقط
    const numbersPattern = /^[0-9]*$/;
    return numbersPattern.test(value);
  };

  const validatePhoneNumber = (value: string): boolean => {
    // السماح بالأرقام فقط و 10 أرقام بالضبط
    const phonePattern = /^[0-9]{0,10}$/;
    return phonePattern.test(value);
  };

  const validateEmail = (value: string): boolean => {
    if (!value) return true; // الحقل اختياري
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(value);
  };

  const handleInputChange = (section: keyof StudentFormData, field: string, value: string | boolean) => {
    // التحقق من صحة البيانات حسب نوع الحقل
    let isValid = true;
    let errorMessage = '';

    if (typeof value === 'string') {
      // التحقق من الحقول النصية (حروف عربية فقط - بدون أرقام)
      if ((field === 'fullName' || field === 'nickname' || field === 'motherName') && section === 'personalData') {
        if (value && !validateArabicText(value)) {
          isValid = false;
          errorMessage = 'يجب إدخال حروف عربية فقط (بدون أرقام)';
        }
      }

      // التحقق من رقم الهوية (أرقام فقط)
      if (field === 'nationalId' && section === 'personalData') {
        if (value && !validateNumbersOnly(value)) {
          isValid = false;
          errorMessage = 'يجب إدخال أرقام فقط';
        }
      }

      // التحقق من رقم الهاتف (أرقام فقط، 10 أرقام كحد أقصى)
      if (field === 'phone' && section === 'personalData') {
        if (value && !validatePhoneNumber(value)) {
          isValid = false;
          errorMessage = 'يجب إدخال أرقام فقط (10 أرقام كحد أقصى)';
        }
      }

      // التحقق من البريد الإلكتروني
      if (field === 'email' && section === 'personalData') {
        if (value && !validateEmail(value)) {
          isValid = false;
          errorMessage = 'يرجى إدخال بريد إلكتروني صحيح';
        }
      }
    }

    // تحديث حالة الأخطاء
    const errorKey = `${section}.${field}`;
    if (isValid) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    } else {
      setValidationErrors(prev => ({
        ...prev,
        [errorKey]: errorMessage
      }));
    }

    // إذا كانت القيمة غير صحيحة، لا نحدث الحقل
    if (!isValid) {
      return;
    }

    setFormData(prev => {
      // إنشاء نسخة جديدة من القسم مع تحديث الحقل المطلوب
      const sectionData = prev[section] as unknown as Record<string, unknown>;
      const updatedSection = {
        ...sectionData,
        [field]: value
      };

      const newFormData = {
        ...prev,
        [section]: updatedSection
      };

      // إذا تم تغيير الفرع، أعد تعيين القسم
      if (section === 'secondaryEducation' && field === 'branch') {
        newFormData.universityAdmission = {
          ...newFormData.universityAdmission,
          department: ''
        };
      }

      console.log(`✅ تم تحديث ${section}.${field} إلى:`, value);
      return newFormData;
    });
  };

  // دالة خاصة للتعامل مع القوائم المنسدلة - تحديث فوري عند التغيير
  const handleSelectChange = (section: keyof StudentFormData, field: string, value: string) => {
    console.log(`🔄 تحديث القائمة المنسدلة (onChange): ${section}.${field} = "${value}"`);
    // تحديث مباشر - لا حاجة للانتظار
    handleInputChange(section, field, value);
  };

  // دالة للتعامل مع حدث Input - تحديث عند أي تغيير (بما في ذلك الكيبورد)
  const handleSelectInput = (section: keyof StudentFormData, field: string, e: React.FormEvent<HTMLSelectElement>) => {
    const value = (e.target as HTMLSelectElement).value;
    console.log(`📝 حدث Input: ${section}.${field} = "${value}"`);
    handleInputChange(section, field, value);
  };

  // دالة للتعامل مع فقدان التركيز (Blur) - تحديث إضافي للتأكد
  const handleSelectBlur = (section: keyof StudentFormData, field: string, e: React.FocusEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    console.log(`👁️ فقدان التركيز (onBlur): ${section}.${field} = "${value}"`);
    // تحديث القيمة دائماً (حتى لو كانت فارغة) لضمان التحديث
    handleInputChange(section, field, value);
  };

  // دالة للتعامل مع الضغط على المفاتيح - تحديث عند التغيير
  const handleSelectKeyDown = (section: keyof StudentFormData, field: string, e: React.KeyboardEvent<HTMLSelectElement>) => {
    // التعامل مع جميع المفاتيح (Enter, Tab, Arrow keys, Space)
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === ' ') {
      // استخدام setTimeout للتأكد من أن القيمة محدثة بعد تغيير القائمة
      setTimeout(() => {
        const value = (e.target as HTMLSelectElement).value;
        console.log(`⌨️ تحديث بعد ضغط مفتاح (${e.key}): ${section}.${field} = "${value}"`);
        handleInputChange(section, field, value);
      }, 10);
    }
  };

  // دالة للتعامل مع تغيير القيمة باستخدام الماوس أو الكيبورد
  const handleSelectValueChange = (section: keyof StudentFormData, field: string, value: string) => {
    console.log(`🎯 تغيير مباشر للقيمة: ${section}.${field} = "${value}"`);
    handleInputChange(section, field, value);
  };

  const handleEmergencyContactChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      personalData: {
        ...prev.personalData,
        emergencyContact: {
          ...prev.personalData.emergencyContact,
          [field]: value
        }
      }
    }));
  };

  const handleFileChange = (field: string, file: File | null) => {
    setFormData(prev => ({
      ...prev,
      documents: {
        ...prev.documents,
        [field]: file
      }
    }));
  };

  // دالة لتحديد الأقسام المتاحة بناءً على الفرع
  const getAvailableDepartments = (branch: string) => {
    if (branch === 'علمي') {
      return [
        { value: 'تقنيات التخدير', label: 'قسم تقنيات التخدير' },
        { value: 'تقنيات الاشعة', label: 'قسم تقنيات الاشعة' },
        { value: 'تقنيات صناعة الاسنان', label: 'قسم تقنيات صناعة الاسنان' },
        { value: 'تقنيات البصريات', label: 'قسم تقنيات البصريات' },
        { value: 'تقنيات طب الطوارئ', label: 'قسم تقنيات طب الطوارئ' },
        { value: 'تقنيات صحة المجتمع', label: 'قسم تقنيات صحة المجتمع' },
        { value: 'تقنيات العلاج الطبيعي', label: 'قسم تقنيات العلاج الطبيعي' },
        { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' },
        { value: 'تقنيات هندسة النفط والغاز', label: 'قسم تقنيات هندسة النفط والغاز' },
        { value: 'تقنيات الفيزياء الصحية', label: 'قسم تقنيات الفيزياء الصحية والعلاج الاشعاعي' },
        { value: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', label: 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية' }
      ];
    }
    
    if (branch === 'احيائي') {
      return [
        { value: 'تقنيات التخدير', label: 'قسم تقنيات التخدير' },
        { value: 'تقنيات الاشعة', label: 'قسم تقنيات الاشعة' },
        { value: 'تقنيات صناعة الاسنان', label: 'قسم تقنيات صناعة الاسنان' },
        { value: 'تقنيات البصريات', label: 'قسم تقنيات البصريات' },
        { value: 'تقنيات طب الطوارئ', label: 'قسم تقنيات طب الطوارئ' },
        { value: 'تقنيات صحة المجتمع', label: 'قسم تقنيات صحة المجتمع' },
        { value: 'تقنيات العلاج الطبيعي', label: 'قسم تقنيات العلاج الطبيعي' },
        { value: 'تقنيات هندسة النفط والغاز', label: 'قسم تقنيات هندسة النفط والغاز' },
        { value: 'تقنيات الفيزياء الصحية', label: 'قسم تقنيات الفيزياء الصحية والعلاج الاشعاعي' },
        { value: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', label: 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية' }
      ];
    }
    
    if (branch === 'تطبيقي') {
      return [
        { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' },
        { value: 'تقنيات هندسة النفط والغاز', label: 'قسم تقنيات هندسة النفط والغاز' },
        { value: 'تقنيات الفيزياء الصحية', label: 'قسم تقنيات الفيزياء الصحية والعلاج الاشعاعي' },
        { value: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', label: 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية' }
      ];
    }
    
    if (branch === 'صناعي ( بناء)') {
      return [
        { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' }
      ];
    }
    
    if (branch === 'صناعي ( رسم هندسي)') {
      return [
        { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' }
      ];
    }
    
    if (branch === 'صناعي ( مساحة )') {
      return [
        { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' }
      ];
    }
    
    if (branch === 'خريجي مركز التدريب المهني / معهد السكك الذي تكون مدة الدراسة فيها ثلاثة سنوات والذين ادوا الامتحان الوزاري في الاختصاص المناظر') {
      return [
        { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' }
      ];
    }
    
    if (branch === 'صناعي ( تكرير النفط ومعالجة الغاز)' || branch === 'صناعي ( صناعات بتروكيمياوية)') {
      return [
        { value: 'تقنيات هندسة النفط والغاز', label: 'قسم تقنيات هندسة النفط والغاز' }
      ];
    }
    
    if (branch === 'صناعي ( اجهزة طبية )' || 
        branch === 'صناعي ( صيانة منظومات الليزر )' || 
        branch === 'صناعي ( اتصالات )' || 
        branch === 'صناعي ( كهرباء )') {
      return [
        { value: 'تقنيات الفيزياء الصحية', label: 'قسم تقنيات الفيزياء الصحية' }
      ];
    }
    
    if (branch === 'صناعي ( الكترونيك وسيطرة - الكترون )') {
      return [
        { value: 'تقنيات الفيزياء الصحية', label: 'قسم تقنيات الفيزياء الصحية والعلاج الاشعاعي' },
        { value: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', label: 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية' }
      ];
    }
    
    if (branch === 'صناعي ( حاسبات )' || 
        branch === 'صناعي ( شبكات الحاسوب )' || 
        branch === 'صناعي ( تكنولوجيا اعلام )' || 
        branch === 'الحاسوب وتقنيات المعلومات ( تجميع وصيانة الحاسوب )' || 
        branch === 'الحاسوب وتقنيات المعلومات ( شبكات الحاسوب )' || 
        branch === 'الحاسوب وتقنيات المعلومات ( الحاسوب والهاتف النقال )') {
      return [
        { value: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', label: 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية' }
      ];
    }
    
    // الأقسام الافتراضية لجميع الفروع الأخرى
    return [
      { value: 'تقنيات التخدير', label: 'قسم تقنيات التخدير' },
      { value: 'تقنيات الاشعة', label: 'قسم تقنيات الاشعة' },
      { value: 'تقنيات صناعة الاسنان', label: 'قسم تقنيات صناعة الاسنان' },
      { value: 'هندسة تقنيات البناء والانشاءات', label: 'قسم هندسة تقنيات البناء والانشاءات' },
      { value: 'تقنيات هندسة النفط والغاز', label: 'قسم تقنيات هندسة النفط والغاز' },
      { value: 'تقنيات الفيزياء الصحية', label: 'قسم تقنيات الفيزياء الصحية والعلاج الاشعاعي' },
      { value: 'تقنيات البصريات', label: 'قسم تقنيات البصريات' },
      { value: 'تقنيات صحة المجتمع', label: 'قسم تقنيات صحة المجتمع' },
      { value: 'تقنيات طب الطوارئ', label: 'قسم تقنيات طب الطوارئ' },
      { value: 'تقنيات العلاج الطبيعي', label: 'قسم تقنيات العلاج الطبيعي' },
      { value: 'تقنيات الامن السيبراني', label: 'قسم تقنيات الامن السيبراني والحوسبة السحابية' },
      { value: 'القانون', label: 'قسم القانون' }
    ];
  };


  const nextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSave = () => {
    // فتح واجهة مراجعة المدخلات
    setShowReviewModal(true);
  };

  const handleQuickUpdate = async () => {
    try {
      setLoading(true);
      const result = await confirmSave();
      // إذا كان confirmSave رجع false (خطأ تحقق)، لا نكمل
      if (result === false) {
        return;
      }
      await fetchStudents();
      await fetchDepartmentCounts();
      alert('تم تحديث بيانات الطالب بنجاح! 🎉');
    } catch (error) {
      console.error('خطأ في تحديث الطالب:', error);
      alert('حدث خطأ في تحديث بيانات الطالب: ' + (error instanceof Error ? error.message : 'خطأ غير معروف'));
    } finally {
      setLoading(false);
    }
  };

  const confirmSave = async () => {
    try {
      // التحقق من صحة البيانات قبل الحفظ
      // التحقق من رقم الهاتف (مطلوب ويجب أن يكون 10 أرقام بالضبط)
      if (!formData.personalData.phone || formData.personalData.phone.trim() === '') {
        alert('⚠️ رقم الهاتف مطلوب');
        setValidationErrors(prev => ({
          ...prev,
          'personalData.phone': 'رقم الهاتف مطلوب'
        }));
        return false;
      }
      if (formData.personalData.phone.length !== 10) {
        alert('⚠️ رقم الهاتف يجب أن يتكون من 10 أرقام بالضبط');
        setValidationErrors(prev => ({
          ...prev,
          'personalData.phone': 'رقم الهاتف يجب أن يتكون من 10 أرقام بالضبط'
        }));
        return false;
      }

      // التحقق من البريد الإلكتروني إذا كان موجوداً
      if (formData.personalData.email && !validateEmail(formData.personalData.email)) {
        alert('⚠️ يرجى إدخال بريد إلكتروني صحيح');
        setValidationErrors(prev => ({
          ...prev,
          'personalData.email': 'يرجى إدخال بريد إلكتروني صحيح'
        }));
        return false;
      }

      // رفع جميع الملفات
      let photoFilename = '';
      let nationalIdFrontFilename = '';
      let nationalIdBackFilename = '';
      let residenceCardFrontFilename = '';
      let residenceCardBackFilename = '';
      let secondaryCertificateFilename = '';

      // رفع الصورة الشخصية
      if (formData.documents.personalPhoto && formData.documents.personalPhoto.size > 0) {
        console.log('📁 معلومات الملف المراد رفعه:', {
          name: formData.documents.personalPhoto.name,
          type: formData.documents.personalPhoto.type,
          size: formData.documents.personalPhoto.size
        });
        
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.personalPhoto);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          photoFilename = uploadResult.filename;
          console.log('✅ تم رفع الصورة الشخصية:', photoFilename);
        } else {
          console.error('❌ فشل رفع الصورة الشخصية:', uploadResult.error);
          alert('خطأ في رفع الصورة الشخصية: ' + uploadResult.error);
        }
      }

      // رفع صورة البطاقة الوطنية الوجه الأول
      if (formData.documents.nationalIdFront && formData.documents.nationalIdFront.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.nationalIdFront);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          nationalIdFrontFilename = uploadResult.filename;
          console.log('✅ تم رفع صورة البطاقة الوطنية الوجه الأول:', nationalIdFrontFilename);
        } else {
          console.error('❌ فشل رفع صورة البطاقة الوطنية الوجه الأول:', uploadResult.error);
        }
      }

      // رفع صورة البطاقة الوطنية الوجه الثاني
      if (formData.documents.nationalIdBack && formData.documents.nationalIdBack.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.nationalIdBack);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          nationalIdBackFilename = uploadResult.filename;
          console.log('✅ تم رفع صورة البطاقة الوطنية الوجه الثاني:', nationalIdBackFilename);
        } else {
          console.error('❌ فشل رفع صورة البطاقة الوطنية الوجه الثاني:', uploadResult.error);
        }
      }

      // رفع صورة بطاقة السكن الوجه الأول
      if (formData.documents.residenceCardFront && formData.documents.residenceCardFront.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.residenceCardFront);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          residenceCardFrontFilename = uploadResult.filename;
          console.log('✅ تم رفع صورة بطاقة السكن الوجه الأول:', residenceCardFrontFilename);
        } else {
          console.error('❌ فشل رفع صورة بطاقة السكن الوجه الأول:', uploadResult.error);
        }
      }

      // رفع صورة بطاقة السكن الوجه الثاني
      if (formData.documents.residenceCardBack && formData.documents.residenceCardBack.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.residenceCardBack);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          residenceCardBackFilename = uploadResult.filename;
          console.log('✅ تم رفع صورة بطاقة السكن الوجه الثاني:', residenceCardBackFilename);
        } else {
          console.error('❌ فشل رفع صورة بطاقة السكن الوجه الثاني:', uploadResult.error);
        }
      }

      // رفع وثيقة الإعدادية
      if (formData.documents.secondaryCertificate && formData.documents.secondaryCertificate.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.secondaryCertificate);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          secondaryCertificateFilename = uploadResult.filename;
          console.log('✅ تم رفع وثيقة الإعدادية:', secondaryCertificateFilename);
        } else {
          console.error('❌ فشل رفع وثيقة الإعدادية:', uploadResult.error);
        }
      }

      // رفع الفحص الطبي
      let medicalExaminationFilename = '';
      if (formData.documents.medicalExamination && formData.documents.medicalExamination.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.medicalExamination);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          medicalExaminationFilename = uploadResult.filename;
          console.log('✅ تم رفع الفحص الطبي:', medicalExaminationFilename);
        } else {
          console.error('❌ فشل رفع الفحص الطبي:', uploadResult.error);
        }
      }
      
      // تحضير البيانات للحفظ
      console.log('🔍 بيانات الطالب المرسلة:', {
        motherName: formData.personalData.motherName,
        area: formData.personalData.area
      });

      const studentData = {
        full_name: formData.personalData.fullName, // الاسم الرباعي
        full_name_ar: formData.personalData.fullName, // الاسم الرباعي بالعربية (نفس القيمة)
        nickname: formData.personalData.nickname, // اللقب
        mother_name: formData.personalData.motherName, // اسم الأم الثلاثي
        national_id: formData.personalData.nationalId,
        birth_date: formData.personalData.birthDate,
        birth_place: formData.personalData.birthPlace,
        province: formData.personalData.birthPlace,
        area: formData.personalData.area,
        gender: formData.personalData.gender,
        religion: formData.personalData.religion,
        marital_status: formData.personalData.maritalStatus,
        phone: formData.personalData.phone ? `+964${formData.personalData.phone}` : '',
        email: formData.personalData.email,
        address: formData.personalData.address,
        emergency_contact_name: formData.personalData.emergencyContact.name,
        emergency_contact_relationship: formData.personalData.emergencyContact.relationship,
        emergency_contact_phone: formData.personalData.emergencyContact.phone ? `+964${formData.personalData.emergencyContact.phone}` : '',
        secondary_school_name: formData.secondaryEducation.schoolName,
        secondary_school_type: formData.secondaryEducation.schoolType,
        secondary_graduation_year: formData.secondaryEducation.graduationYear,
        secondary_gpa: (() => {
          const gpaString = formData.secondaryEducation.gpa.trim();
          // إذا كانت القيمة فارغة، إرجاع 0
          if (!gpaString) return 0;
          // تحويل إلى رقم بدون إضافة أصفار عشرية غير ضرورية
          const gpaValue = parseFloat(gpaString);
          console.log('📊 المعدل التراكمي من الفورم:', formData.secondaryEducation.gpa, 'بعد التحويل:', gpaValue, 'نوع القيمة:', typeof gpaValue, 'هل يحتوي على كسور عشرية؟', gpaValue % 1 !== 0);
          // إرجاع القيمة مع حد أقصى 100 (الحفاظ على الكسور العشرية)
          const finalValue = isNaN(gpaValue) ? 0 : Math.min(gpaValue, 100);
          console.log('✅ القيمة النهائية المرسلة:', finalValue, 'نوع القيمة:', typeof finalValue);
          return finalValue;
        })(),
        secondary_total_score: (() => {
          const totalScoreString = formData.secondaryEducation.totalScore.trim();
          if (!totalScoreString) return '';
          const totalScoreValue = parseFloat(totalScoreString);
          // إرجاع القيمة مع حد أقصى 999.99 (لتجنب numeric field overflow)
          return isNaN(totalScoreValue) ? '' : Math.min(totalScoreValue, 999.99).toString();
        })(),
        exam_attempt: formData.secondaryEducation.examAttempt,
        exam_number: formData.secondaryEducation.examNumber,
        exam_password: formData.secondaryEducation.examPassword,
        branch: formData.secondaryEducation.branch,
        admission_type: formData.universityAdmission.admissionType || '',
        admission_channel: formData.universityAdmission.admissionChannel || '',
        department: formData.universityAdmission.department,
        study_type: formData.universityAdmission.studyType || 'morning',
        level: formData.universityAdmission.level || 'bachelor',
        semester: formData.universityAdmission.semester || 'first',
        academic_year: formData.universityAdmission.academicYear || '2025-2026',
        special_requirements: formData.universityAdmission.specialRequirements,
        username: formData.universityAdmission.username,
        password: formData.universityAdmission.password,
        national_id_copy: nationalIdFrontFilename || formData.documents.nationalIdFront?.name || '',
        birth_certificate: nationalIdBackFilename || formData.documents.nationalIdBack?.name || '',
        secondary_certificate: secondaryCertificateFilename || formData.documents.secondaryCertificate?.name || '',
        photo: photoFilename || formData.documents.personalPhoto?.name || '',
        medical_certificate: residenceCardFrontFilename || formData.documents.residenceCardFront?.name || '',
        other_documents: residenceCardBackFilename || formData.documents.residenceCardBack?.name || '',
        medical_examination: medicalExaminationFilename || formData.documents.medicalExamination?.name || ''
      };
      
      console.log('=== بيانات الطالب الكاملة المرسلة ===');
      console.log('الاسم الكامل:', studentData.full_name);
      console.log('اللقب:', studentData.nickname);
      console.log('اسم الأم الثلاثي:', studentData.mother_name);
      console.log('المحافظة:', studentData.birth_place);
      console.log('المنطقة:', studentData.area);
      console.log('اسم جهة الاتصال في حالات الطوارئ:', studentData.emergency_contact_name);
      console.log('صلة القرابة:', studentData.emergency_contact_relationship);
      console.log('رقم الهاتف العراقي:', studentData.emergency_contact_phone);
      console.log('اسم المدرسة:', studentData.secondary_school_name);
      console.log('إجمالي الدرجات:', studentData.secondary_total_score);
      console.log('متطلبات خاصة:', studentData.special_requirements);
      console.log('📁 بيانات الملفات من الفورم:', {
        national_id_copy: studentData.national_id_copy,
        birth_certificate: studentData.birth_certificate,
        secondary_certificate: studentData.secondary_certificate,
        photo: studentData.photo,
        medical_certificate: studentData.medical_certificate,
        other_documents: studentData.other_documents
      });
      console.log('البيانات الشخصية من الفورم:', formData.personalData);
      console.log('المعدل التراكمي:', studentData.secondary_gpa);
      console.log('نوع الدراسة:', studentData.study_type);
      console.log('الفصل الدراسي:', studentData.semester);
      
      // إزالة File objects قبل الإرسال (لا يمكن تحويلها إلى JSON)
      const studentDataWithoutFiles = {
        full_name: studentData.full_name,
        full_name_ar: studentData.full_name_ar,
        nickname: studentData.nickname,
        mother_name: studentData.mother_name,
        national_id: studentData.national_id,
        birth_date: studentData.birth_date,
        birth_place: studentData.birth_place,
        area: studentData.area,
        gender: studentData.gender,
        religion: studentData.religion,
        marital_status: studentData.marital_status,
        phone: studentData.phone,
        email: studentData.email,
        address: studentData.address,
        emergency_contact_name: studentData.emergency_contact_name,
        emergency_contact_relationship: studentData.emergency_contact_relationship,
        emergency_contact_phone: studentData.emergency_contact_phone,
        secondary_school_name: studentData.secondary_school_name,
        secondary_school_type: studentData.secondary_school_type,
        secondary_graduation_year: studentData.secondary_graduation_year,
        secondary_gpa: studentData.secondary_gpa !== undefined && studentData.secondary_gpa !== null ? String(studentData.secondary_gpa) : '',
        secondary_total_score: studentData.secondary_total_score !== undefined && studentData.secondary_total_score !== null ? String(studentData.secondary_total_score) : '',
        exam_attempt: studentData.exam_attempt,
        exam_number: studentData.exam_number,
        exam_password: studentData.exam_password,
        branch: studentData.branch,
        admission_type: studentData.admission_type || '',
        admission_channel: studentData.admission_channel || '',
        department: studentData.department || '',
        study_type: studentData.study_type || '',
        level: studentData.level || '',
        semester: studentData.semester || '',
        academic_year: studentData.academic_year || '',
        special_requirements: studentData.special_requirements,
        username: formData.universityAdmission.username || '',
        password: formData.universityAdmission.password || '',
        national_id_copy: studentData.national_id_copy,
        birth_certificate: studentData.birth_certificate,
        secondary_certificate: studentData.secondary_certificate,
        photo: studentData.photo,
        medical_certificate: studentData.medical_certificate,
        medical_examination: studentData.medical_examination,
        other_documents: studentData.other_documents
      };
      
      console.log('البيانات المرسلة (بدون ملفات):', studentDataWithoutFiles);
      console.log('🔍 بيانات التحديث المرسلة:', {
        motherName: formData.personalData.motherName,
        area: formData.personalData.area
      });
      console.log('🔍 قيم الحقول المهمة قبل الحفظ:', {
        admissionType: formData.universityAdmission.admissionType,
        maritalStatus: formData.personalData.maritalStatus,
        religion: formData.personalData.religion,
        studyType: formData.universityAdmission.studyType,
        level: formData.universityAdmission.level,
        semester: formData.universityAdmission.semester
      });
      console.log('🔍 البيانات الكاملة للـ formData.universityAdmission:', formData.universityAdmission);
      console.log('🔍 البيانات الكاملة للـ formData.personalData:', formData.personalData);

      const url = editingStudentId ? `/api/students/${editingStudentId}` : '/api/students';
      const method = editingStudentId ? 'PUT' : 'POST';
      
      console.log('📤 البيانات المرسلة للتحديث:', studentDataWithoutFiles);
      console.log('📤 القيم المهمة في البيانات المرسلة:', {
        admission_type: studentDataWithoutFiles.admission_type,
        marital_status: studentDataWithoutFiles.marital_status,
        religion: studentDataWithoutFiles.religion,
        secondary_school_type: studentDataWithoutFiles.secondary_school_type,
        study_type: studentDataWithoutFiles.study_type,
        level: studentDataWithoutFiles.level,
        semester: studentDataWithoutFiles.semester
      });
      
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(studentDataWithoutFiles),
      });
      
      console.log('📥 استجابة API:', response.status, response.statusText);

      const result = await response.json();
      console.log('📋 نتيجة API:', result);

      if (result.success) {
        // إغلاق واجهة المراجعة
        setShowReviewModal(false);
        
        // إغلاق فورم إضافة الطالب
        setShowAddStudentModal(false);
        setCurrentStep(1);
        setShowConfirmation(false);
        setGeneratedStudentId('');
        
        // إعادة جلب قائمة الطلاب وعدد الطلاب للأقسام
        await fetchStudents();
        await fetchDepartmentCounts();
        
        // عرض رسالة تأكيد الحفظ مع الرقم التسلسلي
        const message = editingStudentId 
          ? `تم تحديث بيانات الطالب بنجاح!\n\nالرقم الجامعي: ${result.data.university_id}`
          : `تم حفظ بيانات الطالب بنجاح!\n\nالرقم الجامعي: ${result.data.university_id}`;
        alert(message);
        
        // لا حاجة لإعادة التوجيه - البيانات محدثة تلقائياً
      } else {
        // عرض رسالة خطأ واضحة للمستخدم
        const errorMessage = result.error || 'خطأ في حفظ الطالب';
        const errorDetails = result.details || result.detail || '';
        
        // في حالة خطأ التحقق (400) - فقط عرض الرسالة ولا نرمي خطأ
        if (response.status === 400) {
          console.warn('⚠️ تحذير: ' + errorMessage);
          alert('⚠️ ' + errorMessage);
          return false; // إيقاف التنفيذ وإرجاع false للإشارة إلى فشل التحقق
        }
        
        // في حالة أخطاء أخرى (500, إلخ) - نرمي الخطأ
        console.error('❌ خطأ من API:', errorMessage);
        console.error('❌ تفاصيل الخطأ:', errorDetails);
        console.error('❌ استجابة API كاملة:', result);
        
        const fullErrorMessage = errorDetails 
          ? `${errorMessage}\n\nالتفاصيل: ${errorDetails}` 
          : errorMessage;
        alert('⚠️ خطأ: ' + fullErrorMessage);
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('خطأ في حفظ الطالب:', error);
      throw error; // إعادة رمي الخطأ ليتم التعامل معه في handleQuickUpdate
    }
  };

  // دالة حفظ الطالب قيد التسجيل
  const saveAsPendingRegistration = async () => {
    try {
      // التحقق من صحة البيانات قبل الحفظ (نفس التحقق في confirmSave)
      // التحقق من رقم الهاتف (مطلوب ويجب أن يكون 10 أرقام بالضبط)
      if (!formData.personalData.phone || formData.personalData.phone.trim() === '') {
        alert('⚠️ رقم الهاتف مطلوب');
        setValidationErrors(prev => ({
          ...prev,
          'personalData.phone': 'رقم الهاتف مطلوب'
        }));
        return false;
      }
      if (formData.personalData.phone.length !== 10) {
        alert('⚠️ رقم الهاتف يجب أن يتكون من 10 أرقام بالضبط');
        setValidationErrors(prev => ({
          ...prev,
          'personalData.phone': 'رقم الهاتف يجب أن يتكون من 10 أرقام بالضبط'
        }));
        return false;
      }

      // التحقق من البريد الإلكتروني إذا كان موجوداً
      if (formData.personalData.email && !validateEmail(formData.personalData.email)) {
        alert('⚠️ يرجى إدخال بريد إلكتروني صحيح');
        setValidationErrors(prev => ({
          ...prev,
          'personalData.email': 'يرجى إدخال بريد إلكتروني صحيح'
        }));
        return false;
      }

      // نفس منطق confirmSave ولكن مع payment_status = 'registration_pending'
      // رفع جميع الملفات (نفس الكود)
      let photoFilename = '';
      let nationalIdFrontFilename = '';
      let nationalIdBackFilename = '';
      let residenceCardFrontFilename = '';
      let residenceCardBackFilename = '';
      let secondaryCertificateFilename = '';
      let medicalExaminationFilename = '';

      // رفع الصورة الشخصية
      if (formData.documents.personalPhoto && formData.documents.personalPhoto.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.personalPhoto);
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) {
          photoFilename = uploadResult.filename;
        }
      }

      // رفع بقية الملفات (نفس الكود من confirmSave)
      if (formData.documents.nationalIdFront && formData.documents.nationalIdFront.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.nationalIdFront);
        const uploadResponse = await fetch('/api/students/upload', { method: 'POST', body: uploadFormData });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) nationalIdFrontFilename = uploadResult.filename;
      }

      if (formData.documents.nationalIdBack && formData.documents.nationalIdBack.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.nationalIdBack);
        const uploadResponse = await fetch('/api/students/upload', { method: 'POST', body: uploadFormData });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) nationalIdBackFilename = uploadResult.filename;
      }

      if (formData.documents.residenceCardFront && formData.documents.residenceCardFront.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.residenceCardFront);
        const uploadResponse = await fetch('/api/students/upload', { method: 'POST', body: uploadFormData });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) residenceCardFrontFilename = uploadResult.filename;
      }

      if (formData.documents.residenceCardBack && formData.documents.residenceCardBack.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.residenceCardBack);
        const uploadResponse = await fetch('/api/students/upload', { method: 'POST', body: uploadFormData });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) residenceCardBackFilename = uploadResult.filename;
      }

      if (formData.documents.secondaryCertificate && formData.documents.secondaryCertificate.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.secondaryCertificate);
        const uploadResponse = await fetch('/api/students/upload', { method: 'POST', body: uploadFormData });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) secondaryCertificateFilename = uploadResult.filename;
      }

      if (formData.documents.medicalExamination && formData.documents.medicalExamination.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.medicalExamination);
        const uploadResponse = await fetch('/api/students/upload', { method: 'POST', body: uploadFormData });
        const uploadResult = await uploadResponse.json();
        if (uploadResult.success) medicalExaminationFilename = uploadResult.filename;
      }

      // تحضير البيانات (نفس confirmSave)
      const studentDataWithoutFiles = {
        full_name: formData.personalData.fullName,
        full_name_ar: formData.personalData.fullName,
        nickname: formData.personalData.nickname,
        mother_name: formData.personalData.motherName,
        national_id: formData.personalData.nationalId,
        birth_date: formData.personalData.birthDate,
        birth_place: formData.personalData.birthPlace,
        province: formData.personalData.birthPlace,
        area: formData.personalData.area,
        gender: formData.personalData.gender,
        religion: formData.personalData.religion,
        marital_status: formData.personalData.maritalStatus,
        phone: formData.personalData.phone ? `+964${formData.personalData.phone}` : '',
        email: formData.personalData.email,
        address: formData.personalData.address,
        emergency_contact_name: formData.personalData.emergencyContact.name,
        emergency_contact_relationship: formData.personalData.emergencyContact.relationship,
        emergency_contact_phone: formData.personalData.emergencyContact.phone ? `+964${formData.personalData.emergencyContact.phone}` : '',
        secondary_school_name: formData.secondaryEducation.schoolName,
        secondary_school_type: formData.secondaryEducation.schoolType,
        secondary_graduation_year: formData.secondaryEducation.graduationYear,
        secondary_gpa: (() => {
          const gpaString = formData.secondaryEducation.gpa.trim();
          if (!gpaString) return 0;
          const gpaValue = parseFloat(gpaString);
          return isNaN(gpaValue) ? 0 : Math.min(gpaValue, 100);
        })(),
        secondary_total_score: (() => {
          const totalScoreString = formData.secondaryEducation.totalScore.trim();
          if (!totalScoreString) return '';
          const totalScoreValue = parseFloat(totalScoreString);
          return isNaN(totalScoreValue) ? '' : Math.min(totalScoreValue, 999.99).toString();
        })(),
        exam_attempt: formData.secondaryEducation.examAttempt,
        exam_number: formData.secondaryEducation.examNumber,
        exam_password: formData.secondaryEducation.examPassword,
        branch: formData.secondaryEducation.branch,
        admission_type: formData.universityAdmission.admissionType || '',
        admission_channel: formData.universityAdmission.admissionChannel || '',
        department: formData.universityAdmission.department,
        study_type: formData.universityAdmission.studyType || 'morning',
        level: formData.universityAdmission.level || 'bachelor',
        semester: formData.universityAdmission.semester || 'first',
        academic_year: formData.universityAdmission.academicYear || '2025-2026',
        special_requirements: formData.universityAdmission.specialRequirements,
        username: formData.universityAdmission.username,
        password: formData.universityAdmission.password,
        national_id_copy: nationalIdFrontFilename || formData.documents.nationalIdFront?.name || '',
        birth_certificate: nationalIdBackFilename || formData.documents.nationalIdBack?.name || '',
        secondary_certificate: secondaryCertificateFilename || formData.documents.secondaryCertificate?.name || '',
        photo: photoFilename || formData.documents.personalPhoto?.name || '',
        medical_certificate: residenceCardFrontFilename || formData.documents.residenceCardFront?.name || '',
        medical_examination: medicalExaminationFilename || formData.documents.medicalExamination?.name || '',
        other_documents: residenceCardBackFilename || formData.documents.residenceCardBack?.name || '',
        payment_status: 'registration_pending' // الحالة الجديدة: قيد التسجيل
      };

      const response = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studentDataWithoutFiles),
      });

      const result = await response.json();

      if (result.success) {
        setShowReviewModal(false);
        setShowAddStudentModal(false);
        setCurrentStep(1);
        setShowConfirmation(false);
        setGeneratedStudentId('');
        
        await fetchStudents();
        await fetchDepartmentCounts();
        
        alert(`تم حفظ الطالب قيد التسجيل بنجاح!\n\nالرقم الجامعي: ${result.data.university_id}\n\nيمكنك إتمام التسجيل لاحقاً من قائمة الطلاب.`);
        // لا حاجة لإعادة التوجيه - البيانات محدثة تلقائياً
      } else {
        const errorMessage = result.error || 'خطأ في حفظ الطالب';
        if (response.status === 400) {
          console.warn('⚠️ تحذير: ' + errorMessage);
          alert('⚠️ ' + errorMessage);
          return false;
        }
        console.error('❌ خطأ من API:', errorMessage);
        alert('⚠️ خطأ: ' + errorMessage);
      }
    } catch (error) {
      console.error('خطأ في حفظ الطالب قيد التسجيل:', error);
      alert('حدث خطأ في حفظ الطالب: ' + (error instanceof Error ? error.message : 'خطأ غير معروف'));
    }
  };

  const finalConfirmSave = () => {
    // إغلاق نافذة التأكيد وإعادة تعيين الفورم
    setShowAddStudentModal(false);
    setCurrentStep(1);
    setShowConfirmation(false);
    setGeneratedStudentId('');
  };

  // دوال التعامل مع الطلاب
  const handleEditStudent = async (studentId: string) => {
    try {
      const response = await fetch(`/api/students/${studentId}`);
      const result = await response.json();
      
      if (result.success) {
        const student = result.data;
        console.log('تعديل بيانات الطالب:', student);
        console.log('البيانات الشخصية:', {
          full_name_ar: student.full_name_ar,
          full_name: student.full_name,
          first_name: student.first_name,
          last_name: student.last_name,
          nationalId: student.national_id,
          birthDate: student.birth_date,
          phone: student.phone
        });
        console.log('📁 بيانات الملفات من قاعدة البيانات:', {
          national_id_copy: student.national_id_copy,
          birth_certificate: student.birth_certificate,
          secondary_certificate: student.secondary_certificate,
          photo: student.photo,
          medical_certificate: student.medical_certificate,
          other_documents: student.other_documents
        });
        
        // تحويل بيانات الطالب إلى تنسيق الفورم
        console.log('🔍 بيانات الطالب المستلمة:', {
          mother_name: student.mother_name,
          area: student.area
        });

        console.log('🔍 بيانات الطالب المستلمة من API:', {
          secondary_school_type: student.secondary_school_type,
          secondary_total_score: student.secondary_total_score,
          exam_attempt: student.exam_attempt,
          branch: student.branch,
          admission_channel: student.admission_channel
        });

        const formData = {
          personalData: {
            fullName: student.full_name_ar && student.full_name_ar !== 'غير محدد' ? student.full_name_ar : 
                     student.full_name && student.full_name !== 'غير محدد' ? student.full_name : 
                     `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'غير محدد',
            nickname: student.nickname || '',
            motherName: student.mother_name || '',
            nationalId: student.national_id || '',
            birthDate: student.birth_date || '',
            birthPlace: student.province || student.birth_place || '',
            area: student.area || '',
            gender: student.gender || 'male',
            religion: student.religion || 'مسلم',
            maritalStatus: student.marital_status || 'single',
            phone: student.phone ? student.phone.replace('+964', '') : '',
            email: student.email || '',
            address: student.address || '',
            emergencyContact: {
              name: student.emergency_contact_name || '',
              relationship: student.emergency_contact_relationship || '',
              phone: student.emergency_contact_phone ? student.emergency_contact_phone.replace('+964', '') : ''
            }
          },
          secondaryEducation: {
            schoolName: student.secondary_school_name || '',
            schoolType: student.secondary_school_type || '',
            graduationYear: student.secondary_graduation_year || '',
            gpa: student.secondary_gpa !== null && student.secondary_gpa !== undefined ? (typeof student.secondary_gpa === 'number' ? student.secondary_gpa.toString() : String(student.secondary_gpa)) : '',
            totalScore: student.secondary_total_score?.toString() || '',
            examAttempt: student.exam_attempt || 'first',
            examNumber: student.exam_number || '',
            examPassword: student.exam_password || '',
            branch: student.branch || ''
          },
          universityAdmission: {
            admissionType: student.admission_type || '',
            admissionChannel: student.admission_channel || '',
            department: student.department || student.major || '',
            studyType: student.study_type || '',
            level: (student.level && student.level !== 'null' && student.level !== null) ? student.level : '',
            semester: (student.semester && student.semester !== 'null' && student.semester !== null) ? student.semester : '',
            academicYear: student.academic_year || '',
            specialRequirements: student.special_requirements || '',
            scholarship: false,
            scholarshipType: '',
            username: student.username || '',
            password: student.password || ''
          },
          documents: {
            nationalIdFront: student.national_id_copy ? { 
              name: student.national_id_copy, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null,
            nationalIdBack: student.birth_certificate ? { 
              name: student.birth_certificate, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null,
            residenceCardFront: student.medical_certificate ? { 
              name: student.medical_certificate, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null,
            residenceCardBack: student.other_documents ? { 
              name: student.other_documents, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null,
            secondaryCertificate: student.secondary_certificate ? { 
              name: student.secondary_certificate, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null,
            personalPhoto: student.photo ? { 
              name: student.photo, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null,
            medicalExamination: student.medical_examination ? { 
              name: student.medical_examination, 
              type: 'image/jpeg', 
              size: 0 
            } as File : null
          }
        };
        
        // تحديث حالة الفورم
        setFormData(formData);
        setCurrentStep(1);
        setShowAddStudentModal(true);
        setShowConfirmation(false);
        setShowReviewModal(false);
        setGeneratedStudentId(student.university_id);
        setEditingStudentId(studentId);
        
        console.log('تم تحميل بيانات الطالب في الفورم:', formData);
        console.log('البيانات الشخصية في الفورم:', formData.personalData);
      } else {
        alert('خطأ في جلب بيانات الطالب للتعديل');
      }
    } catch (error) {
      console.error('خطأ في تعديل الطالب:', error);
      alert('خطأ في تعديل بيانات الطالب');
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    if (confirm('هل أنت متأكد من حذف هذا الطالب؟')) {
      try {
        const response = await fetch(`/api/students/${studentId}`, {
          method: 'DELETE',
        });
        
        const result = await response.json();
        
        if (result.success) {
          alert('تم حذف الطالب بنجاح');
          // إعادة جلب قائمة الطلاب وإحصائيات الأقسام
          await fetchStudents();
          await fetchDepartmentCounts();
        } else {
          alert('خطأ في حذف الطالب: ' + result.error);
        }
      } catch (error) {
        console.error('خطأ في حذف الطالب:', error);
        alert('خطأ في حذف الطالب');
      }
    }
  };

  const closeModal = () => {
    setShowAddStudentModal(false);
    setCurrentStep(1);
    setShowConfirmation(false);
    setShowReviewModal(false);
    setGeneratedStudentId('');
    setEditingStudentId(null);
  };

  return (
    <div className="space-y-6">
      {/* عنوان الصفحة */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">إدارة الطلبة</h1>
        <p className="text-gray-600">إدارة شاملة لبيانات الطلبة المسجلين</p>
      </div>

      {/* الأقسام الرئيسية */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
        {/* إضافة طالب جديد */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl shadow-lg border border-blue-200/50 p-5 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-blue-800 mb-2">إضافة طالب جديد</h2>
            <p className="text-blue-600 text-sm mb-3">إدخال بيانات الطالب الشخصية والأكاديمية</p>
            <button
              onClick={() => {
                setCurrentStep(1);
                setShowConfirmation(false);
                setGeneratedStudentId('');
                setShowAddStudentModal(true);
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm"
            >
              إضافة طالب
            </button>
          </div>
        </div>

        {/* استيراد جماعي */}
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow-lg border border-purple-200/50 p-5 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-14 h-14 bg-purple-500/20 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-purple-800 mb-2">استيراد جماعي</h2>
            <p className="text-purple-600 text-sm mb-3">إدخال عدة طلاب دفعة واحدة من ملف اكسل</p>
            <button
              onClick={() => {
                setBulkImportMode('table');
                setBulkImportStudents([{
                  full_name: '',
                  nickname: '',
                  mother_name: '',
                  birth_date: '',
                  national_id: '',
                  phone: '',
                  school_name: '',
                  gpa: '',
                  graduation_year: '',
                  exam_number: '',
                  exam_password: '',
                  department: '',
                  username: '',
                  password: '',
                  stage: '',
                  study_type: '',
                  level: '',
                  academic_year: '',
                  semester: ''
                }]);
                setExcelFile(null);
                setShowBulkImportModal(true);
              }}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm"
            >
              استيراد طلاب
            </button>
          </div>
        </div>

        {/* قائمة الطلبة */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl shadow-lg border border-green-200/50 p-5 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-14 h-14 bg-green-500/20 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-green-800 mb-2">قائمة الطلبة</h2>
            <p className="text-green-600 text-sm mb-3">عرض جميع الطلبة مع خيارات البحث والتعديل</p>
            <button
              onClick={() => router.push('/student-affairs/students/list')}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm"
            >
              عرض القائمة
            </button>
          </div>
        </div>

        {/* ملف الطالب الشخصي */}
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow-lg border border-purple-200/50 p-5 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-14 h-14 bg-purple-500/20 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-purple-800 mb-2">ملف الطالب الشخصي</h2>
            <p className="text-purple-600 text-sm mb-3">عرض وتعديل بيانات الطالب الشخصية والأكاديمية</p>
            <button
              onClick={() => router.push('/student-affairs/students/profile')}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm"
            >
              عرض الملف
            </button>
          </div>
        </div>

        {/* السجل الأكاديمي للطلبة */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl shadow-lg border border-amber-200/50 p-5 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-14 h-14 bg-amber-500/20 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 014-4h6m-5-4l4 4-4 4" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-amber-800 mb-2">السجل الأكاديمي للطلبة</h2>
            <p className="text-amber-600 text-sm mb-3">تتبع مراحل الطالب ونتائجه عبر السنوات الدراسية</p>
            <button
              onClick={() => router.push('/student-affairs/history')}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm"
            >
              عرض السجل
            </button>
          </div>
        </div>
      </div>

      {/* بطاقات الأقسام */}
      <div className="mt-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">الأقسام</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* قسم تقنيات التخدير */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-md border border-blue-200/50 p-4 hover:shadow-lg transition-all duration-300">
          <div className="text-center">
              <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
              <h3 className="text-sm font-bold text-blue-800 mb-1">تقنيات التخدير</h3>
              <p className="text-2xl font-bold text-blue-600">{departmentCounts['تقنيات التخدير'] || 0}</p>
              <p className="text-xs text-blue-500">طالب</p>
          </div>
        </div>

          {/* قسم تقنيات الأشعة */}
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-md border border-green-200/50 p-4 hover:shadow-lg transition-all duration-300">
          <div className="text-center">
              <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
              <h3 className="text-sm font-bold text-green-800 mb-1">تقنيات الأشعة</h3>
              <p className="text-2xl font-bold text-green-600">{departmentCounts['تقنيات الأشعة'] || 0}</p>
              <p className="text-xs text-green-500">طالب</p>
          </div>
        </div>

          {/* قسم تقنيات صناعة الأسنان */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow-md border border-purple-200/50 p-4 hover:shadow-lg transition-all duration-300">
          <div className="text-center">
              <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-purple-800 mb-1">تقنيات صناعة الأسنان</h3>
              <p className="text-2xl font-bold text-purple-600">{departmentCounts['تقنيات صناعة الأسنان'] || 0}</p>
              <p className="text-xs text-purple-500">طالب</p>
            </div>
          </div>

          {/* قسم هندسة تقنيات البناء والانشاءات */}
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg shadow-md border border-orange-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-orange-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-orange-800 mb-1">هندسة تقنيات البناء والانشاءات</h3>
              <p className="text-2xl font-bold text-orange-600">{departmentCounts['هندسة تقنيات البناء والانشاءات'] || departmentCounts['تقنيات البناء والاستشارات'] || 0}</p>
              <p className="text-xs text-orange-500">طالب</p>
            </div>
          </div>

          {/* قسم تقنيات هندسة النفط والغاز */}
          <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg shadow-md border border-red-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-red-800 mb-1">تقنيات هندسة النفط والغاز</h3>
              <p className="text-2xl font-bold text-red-600">{departmentCounts['تقنيات هندسة النفط والغاز'] || 0}</p>
              <p className="text-xs text-red-500">طالب</p>
            </div>
          </div>

          {/* قسم تقنيات الفيزياء الصحية */}
          <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-lg shadow-md border border-teal-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-teal-800 mb-1">تقنيات الفيزياء الصحية</h3>
              <p className="text-2xl font-bold text-teal-600">{departmentCounts['تقنيات الفيزياء الصحية'] || 0}</p>
              <p className="text-xs text-teal-500">طالب</p>
            </div>
          </div>

          {/* قسم تقنيات البصريات */}
          <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg shadow-md border border-indigo-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
              <h3 className="text-sm font-bold text-indigo-800 mb-1">تقنيات البصريات</h3>
              <p className="text-2xl font-bold text-indigo-600">{departmentCounts['تقنيات البصريات'] || 0}</p>
              <p className="text-xs text-indigo-500">طالب</p>
            </div>
          </div>

          {/* قسم تقنيات صحة المجتمع */}
          <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg shadow-md border border-pink-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-pink-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-pink-800 mb-1">تقنيات صحة المجتمع</h3>
              <p className="text-2xl font-bold text-pink-600">{departmentCounts['تقنيات صحة المجتمع'] || 0}</p>
              <p className="text-xs text-pink-500">طالب</p>
            </div>
          </div>

          {/* قسم تقنيات طب الطوارئ */}
          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg shadow-md border border-yellow-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-yellow-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-yellow-800 mb-1">تقنيات طب الطوارئ</h3>
              <p className="text-2xl font-bold text-yellow-600">{departmentCounts['تقنيات طب الطوارئ'] || 0}</p>
              <p className="text-xs text-yellow-500">طالب</p>
            </div>
          </div>

          {/* قسم تقنيات العلاج الطبيعي */}
          <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg shadow-md border border-cyan-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-cyan-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-cyan-800 mb-1">تقنيات العلاج الطبيعي</h3>
              <p className="text-2xl font-bold text-cyan-600">{departmentCounts['تقنيات العلاج الطبيعي'] || 0}</p>
              <p className="text-xs text-cyan-500">طالب</p>
            </div>
          </div>

          {/* قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية */}
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg shadow-md border border-gray-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-gray-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-gray-800 mb-1">هندسة تقنيات الامن السيبراني والحوسبة السحابية</h3>
              <p className="text-2xl font-bold text-gray-600">{departmentCounts['هندسة تقنيات الامن السيبراني والحوسبة السحابية'] || departmentCounts['تقنيات الأمن السيبراني'] || departmentCounts['تقنيات الامن السيبراني'] || 0}</p>
              <p className="text-xs text-gray-500">طالب</p>
            </div>
          </div>

          {/* قسم القانون */}
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg shadow-md border border-amber-200/50 p-4 hover:shadow-lg transition-all duration-300">
            <div className="text-center">
              <div className="w-12 h-12 bg-amber-500/20 rounded-lg flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l-2.83 2.83M6 7l2.83 2.83m0 0L9 16l-2.83-2.83M9 16l2.83-2.83M9 16l-2.83-2.83" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-amber-800 mb-1">القانون</h3>
              <p className="text-2xl font-bold text-amber-600">{departmentCounts['القانون'] || 0}</p>
              <p className="text-xs text-amber-500">طالب</p>
            </div>
          </div>
        </div>
      </div>

      {/* Modal إضافة طالب جديد */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-white">
                    {editingStudentId ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد'}
                  </h2>
                  <span className="text-xs text-blue-100">
                    {currentStep === 1 && 'البيانات الشخصية'}
                    {currentStep === 2 && 'الدراسة الإعدادية'}
                    {currentStep === 3 && 'القبول الجامعي'}
                    {currentStep === 4 && 'المستمسكات والوثائق'}
                  </span>
                </div>
                <button
                  onClick={closeModal}
                  className="text-white hover:text-blue-200 transition-colors duration-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Progress Steps */}
              <div className="flex items-center justify-center mt-2 space-x-3 space-x-reverse">
                {[1, 2, 3, 4].map((step) => (
                  <div key={step} className="flex items-center">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      currentStep >= step 
                        ? 'bg-white text-blue-600' 
                        : 'bg-blue-400 text-white'
                    }`}>
                      {step}
                    </div>
                    {step < 4 && (
                      <div className={`w-6 h-0.5 mx-1.5 ${
                        currentStep > step ? 'bg-white' : 'bg-blue-400'
                      }`}></div>
                    )}
                  </div>
                ))}
              </div>
              
              {/* رسالة التحديث السريع */}
              {editingStudentId && (
                <div className="mt-1.5 text-center">
                  <p className="text-blue-100 text-xs">
                    💡 يمكنك تحديث البيانات في أي خطوة باستخدام زر &quot;تحديث&quot;
                  </p>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {currentStep === 1 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">البيانات الشخصية</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الاسم الرباعي *
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.fullName}
                        onChange={(e) => handleInputChange('personalData', 'fullName', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          validationErrors['personalData.fullName'] ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="مثال: أحمد محمد عبدالله السعد"
                        required
                      />
                      {validationErrors['personalData.fullName'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.fullName']}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اللقب
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.nickname}
                        onChange={(e) => handleInputChange('personalData', 'nickname', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          validationErrors['personalData.nickname'] ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="مثال: أبو محمد"
                      />
                      {validationErrors['personalData.nickname'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.nickname']}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الأم الثلاثي *
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.motherName}
                        onChange={(e) => handleInputChange('personalData', 'motherName', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          validationErrors['personalData.motherName'] ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="مثال: فاطمة أحمد محمد"
                        required
                      />
                      {validationErrors['personalData.motherName'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.motherName']}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الهوية الوطنية *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formData.personalData.nationalId}
                        onChange={(e) => handleInputChange('personalData', 'nationalId', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                          validationErrors['personalData.nationalId'] ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="أدخل رقم الهوية (أرقام فقط)"
                        required
                      />
                      {validationErrors['personalData.nationalId'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.nationalId']}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ الميلاد *
                      </label>
                      <input
                        type="date"
                        value={formData.personalData.birthDate}
                        onChange={(e) => handleInputChange('personalData', 'birthDate', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          المحافظة *
                        </label>
                        <select
                          value={formData.personalData.birthPlace}
                          onChange={(e) => handleSelectChange('personalData', 'birthPlace', e.target.value)}
                          onBlur={(e) => handleSelectBlur('personalData', 'birthPlace', e)}
                          onKeyDown={(e) => handleSelectKeyDown('personalData', 'birthPlace', e)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm"
                          required
                        >
                          <option value="">اختر المحافظة</option>
                          <option value="بغداد">بغداد</option>
                          <option value="البصرة">البصرة</option>
                          <option value="الموصل">الموصل</option>
                          <option value="أربيل">أربيل</option>
                          <option value="السليمانية">السليمانية</option>
                          <option value="دهوك">دهوك</option>
                          <option value="كركوك">كركوك</option>
                          <option value="الأنبار">الأنبار</option>
                          <option value="النجف">النجف</option>
                          <option value="كربلاء">كربلاء</option>
                          <option value="بابل">بابل</option>
                          <option value="واسط">واسط</option>
                          <option value="ديالى">ديالى</option>
                          <option value="صلاح الدين">صلاح الدين</option>
                          <option value="الديوانية">الديوانية</option>
                          <option value="ميسان">ميسان</option>
                          <option value="ذي قار">ذي قار</option>
                          <option value="المثنى">المثنى</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          المنطقة
                        </label>
                        <input
                          type="text"
                          value={formData.personalData.area}
                          onChange={(e) => handleInputChange('personalData', 'area', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10"
                          placeholder="أدخل المنطقة"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الجنس *
                        </label>
                        <select
                          value={formData.personalData.gender}
                          onChange={(e) => handleSelectChange('personalData', 'gender', e.target.value)}
                          onBlur={(e) => handleSelectBlur('personalData', 'gender', e)}
                          onKeyDown={(e) => handleSelectKeyDown('personalData', 'gender', e)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm"
                          required
                        >
                          <option value="male">ذكر</option>
                          <option value="female">أنثى</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الديانة
                        </label>
                        <select
                          value={formData.personalData.religion}
                          onChange={(e) => {
                            const value = e.target.value;
                            handleSelectChange('personalData', 'religion', value);
                          }}
                          onInput={(e) => handleSelectInput('personalData', 'religion', e)}
                          onBlur={(e) => handleSelectBlur('personalData', 'religion', e)}
                          onKeyDown={(e) => handleSelectKeyDown('personalData', 'religion', e)}
                          onKeyUp={(e) => {
                            // تحديث إضافي عند رفع المفتاح
                            const value = (e.target as HTMLSelectElement).value;
                            if (value !== formData.personalData.religion) {
                              handleSelectValueChange('personalData', 'religion', value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm"
                        >
                          <option value="">اختر الديانة</option>
                          <option value="مسلم">مسلم</option>
                          <option value="مسيحي">مسيحي</option>
                          <option value="الصابئة">الصابئة</option>
                          <option value="اليزيدية">اليزيدية</option>
                          <option value="غير ذلك">غير ذلك</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الحالة الاجتماعية
                        </label>
                        <select
                          value={formData.personalData.maritalStatus}
                          onChange={(e) => {
                            const value = e.target.value;
                            handleSelectChange('personalData', 'maritalStatus', value);
                          }}
                          onInput={(e) => handleSelectInput('personalData', 'maritalStatus', e)}
                          onBlur={(e) => handleSelectBlur('personalData', 'maritalStatus', e)}
                          onKeyDown={(e) => handleSelectKeyDown('personalData', 'maritalStatus', e)}
                          onKeyUp={(e) => {
                            // تحديث إضافي عند رفع المفتاح
                            const value = (e.target as HTMLSelectElement).value;
                            if (value !== formData.personalData.maritalStatus) {
                              handleSelectValueChange('personalData', 'maritalStatus', value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm"
                        >
                          <option value="single">أعزب</option>
                          <option value="married">متزوج</option>
                          <option value="divorced">مطلق</option>
                          <option value="widowed">أرمل</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          رقم الهاتف العراقي *
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                            <span className="text-gray-500 text-sm font-medium">+964</span>
                          </div>
                          <input
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            value={formData.personalData.phone}
                            onChange={(e) => handleInputChange('personalData', 'phone', e.target.value)}
                            className={`w-full px-3 py-2 pr-16 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 ${
                              validationErrors['personalData.phone'] ? 'border-red-500' : 'border-gray-300'
                            }`}
                            placeholder="7XX XXX XXXX"
                            required
                          />
                        </div>
                        {validationErrors['personalData.phone'] ? (
                          <p className="text-xs text-red-600 mt-1.5">{validationErrors['personalData.phone']}</p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1.5">
                            أدخل رقم الهاتف بدون رمز البلد (10 أرقام بالضبط)
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          البريد الإلكتروني
                        </label>
                        <input
                          type="email"
                          value={formData.personalData.email}
                          onChange={(e) => handleInputChange('personalData', 'email', e.target.value)}
                          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 ${
                            validationErrors['personalData.email'] ? 'border-red-500' : 'border-gray-300'
                          }`}
                          placeholder="example@email.com"
                        />
                        {validationErrors['personalData.email'] ? (
                          <p className="text-xs text-red-600 mt-1.5">{validationErrors['personalData.email']}</p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1.5">
                            البريد الإلكتروني اختياري
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      العنوان *
                    </label>
                    <textarea
                      value={formData.personalData.address}
                      onChange={(e) => handleInputChange('personalData', 'address', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>


                  <div className="border-t pt-6">
                    <h4 className="text-md font-semibold text-gray-800 mb-4">جهة الاتصال في حالات الطوارئ</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الاسم *
                        </label>
                        <input
                          type="text"
                          value={formData.personalData.emergencyContact.name}
                          onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          صلة القرابة *
                        </label>
                        <input
                          type="text"
                          value={formData.personalData.emergencyContact.relationship}
                          onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          رقم الهاتف العراقي *
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                            <span className="text-gray-500 text-sm font-medium">+964</span>
                          </div>
                          <input
                            type="tel"
                            value={formData.personalData.emergencyContact.phone}
                            onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                            className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="7XX XXX XXXX"
                            pattern="[0-9]{10}"
                            maxLength={10}
                            required
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          أدخل رقم الهاتف بدون رمز البلد (10 أرقام)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">الدراسة الإعدادية</h3>
                  
                  {/* السطر الأول: اسم المدرسة، نوع المدرسة، سنة التخرج */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم المدرسة *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.schoolName}
                        onChange={(e) => handleInputChange('secondaryEducation', 'schoolName', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع المدرسة *
                      </label>
                      <select
                        value={formData.secondaryEducation.schoolType}
                        onChange={(e) => {
                          const value = e.target.value;
                          handleSelectChange('secondaryEducation', 'schoolType', value);
                        }}
                        onInput={(e) => handleSelectInput('secondaryEducation', 'schoolType', e)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'schoolType', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'schoolType', e)}
                        onKeyUp={(e) => {
                          // تحديث إضافي عند رفع المفتاح
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.secondaryEducation.schoolType) {
                            handleSelectValueChange('secondaryEducation', 'schoolType', value);
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر نوع المدرسة</option>
                        <option value="public">حكومية</option>
                        <option value="private">أهلية</option>
                        <option value="international">دولية</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        سنة التخرج *
                      </label>
                      <select
                        value={formData.secondaryEducation.graduationYear}
                        onChange={(e) => {
                          const value = e.target.value;
                          handleSelectChange('secondaryEducation', 'graduationYear', value);
                        }}
                        onInput={(e) => handleSelectInput('secondaryEducation', 'graduationYear', e)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'graduationYear', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'graduationYear', e)}
                        onKeyUp={(e) => {
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.secondaryEducation.graduationYear) {
                            handleSelectValueChange('secondaryEducation', 'graduationYear', value);
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر سنة التخرج</option>
                        {Array.from({ length: 26 }, (_, i) => {
                          const startYear = 2000 + i;
                          const endYear = startYear + 1;
                          const yearValue = `${startYear}-${endYear}`;
                          return (
                            <option key={yearValue} value={yearValue}>
                              {yearValue}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  {/* السطر الثاني: المعدل التراكمي، إجمالي الدرجات، الدور */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        المعدل التراكمي *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.secondaryEducation.gpa}
                        onChange={(e) => {
                          const value = e.target.value;
                          // السماح بالأرقام والكسور العشرية
                          if (value === '' || /^\d*\.?\d*$/.test(value)) {
                            handleInputChange('secondaryEducation', 'gpa', value);
                          }
                        }}
                        onBlur={(e) => {
                          // تحويل القيمة إلى رقم عشري عند فقدان التركيز
                          const value = e.target.value;
                          if (value && !isNaN(parseFloat(value))) {
                            const numValue = parseFloat(value);
                            if (numValue > 100) {
                              handleInputChange('secondaryEducation', 'gpa', '100');
                            } else if (numValue < 0) {
                              handleInputChange('secondaryEducation', 'gpa', '0');
                            } else {
                              // الحفاظ على الكسور العشرية
                              handleInputChange('secondaryEducation', 'gpa', numValue.toString());
                            }
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="مثال: 85.5"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        إجمالي الدرجات *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.totalScore}
                        onChange={(e) => handleInputChange('secondaryEducation', 'totalScore', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الدور *
                      </label>
                      <select
                        value={formData.secondaryEducation.examAttempt}
                        onChange={(e) => handleSelectChange('secondaryEducation', 'examAttempt', e.target.value)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'examAttempt', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'examAttempt', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر الدور</option>
                        <option value="first">الأول</option>
                        <option value="second">الثاني</option>
                        <option value="third">الثالث</option>
                      </select>
                    </div>
                  </div>

                  {/* باقي الحقول */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الرقم الامتحاني *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.examNumber}
                        onChange={(e) => handleInputChange('secondaryEducation', 'examNumber', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="مثال: 123456789"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الرقم السري *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.examPassword}
                        onChange={(e) => handleInputChange('secondaryEducation', 'examPassword', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="أدخل الرقم السري"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الفرع *
                      </label>
                      <select
                        value={formData.secondaryEducation.branch}
                        onChange={(e) => handleSelectChange('secondaryEducation', 'branch', e.target.value)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'branch', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'branch', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر فرع الاعدادية</option>
                        <option value="علمي">علمي</option>
                        <option value="احيائي">احيائي</option>
                        <option value="تطبيقي">تطبيقي</option>
                        <option value="صناعي ( تكرير النفط ومعالجة الغاز)">صناعي ( تكرير النفط ومعالجة الغاز)</option>
                        <option value="صناعي ( صناعات بتروكيمياوية)">صناعي ( صناعات بتروكيمياوية)</option>
                        <option value="صناعي ( بناء)">صناعي ( بناء)</option>
                        <option value="صناعي ( رسم هندسي)">صناعي ( رسم هندسي)</option>
                        <option value="صناعي ( مساحة )">صناعي ( مساحة )</option>
                        <option value="صناعي ( اجهزة طبية )">صناعي ( اجهزة طبية )</option>
                        <option value="صناعي ( صيانة منظومات الليزر )">صناعي ( صيانة منظومات الليزر )</option>
                        <option value="صناعي ( اتصالات )">صناعي ( اتصالات )</option>
                        <option value="صناعي ( كهرباء )">صناعي ( كهرباء )</option>
                        <option value="صناعي ( الكترونيك وسيطرة - الكترون )">صناعي ( الكترونيك وسيطرة - الكترون )</option>
                        <option value="صناعي ( حاسبات )">صناعي ( حاسبات )</option>
                        <option value="صناعي ( شبكات الحاسوب )">صناعي ( شبكات الحاسوب )</option>
                        <option value="صناعي ( تكنولوجيا اعلام )">صناعي ( تكنولوجيا اعلام )</option>
                        <option value="الحاسوب وتقنيات المعلومات ( تجميع وصيانة الحاسوب )">الحاسوب وتقنيات المعلومات ( تجميع وصيانة الحاسوب )</option>
                        <option value="الحاسوب وتقنيات المعلومات ( شبكات الحاسوب )">الحاسوب وتقنيات المعلومات ( شبكات الحاسوب )</option>
                        <option value="الحاسوب وتقنيات المعلومات ( الحاسوب والهاتف النقال )">الحاسوب وتقنيات المعلومات ( الحاسوب والهاتف النقال )</option>
                        <option value="خريجي مركز التدريب المهني / معهد السكك الذي تكون مدة الدراسة فيها ثلاثة سنوات والذين ادوا الامتحان الوزاري في الاختصاص المناظر">خريجي مركز التدريب المهني / معهد السكك الذي تكون مدة الدراسة فيها ثلاثة سنوات والذين ادوا الامتحان الوزاري في الاختصاص المناظر</option>
                      </select>
                    </div>
                  </div>


                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">القبول الجامعي</h3>
                  
                  {/* السطر الأول: المرحلة، قناة القبول، الفصل الدراسي */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        المرحلة *
                      </label>
                      <select
                        value={formData.universityAdmission.admissionType}
                        onChange={(e) => {
                          const value = e.target.value;
                          handleSelectChange('universityAdmission', 'admissionType', value);
                        }}
                        onInput={(e) => handleSelectInput('universityAdmission', 'admissionType', e)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'admissionType', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'admissionType', e)}
                        onKeyUp={(e) => {
                          // تحديث إضافي عند رفع المفتاح
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.universityAdmission.admissionType) {
                            handleSelectValueChange('universityAdmission', 'admissionType', value);
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر المرحلة</option>
                        <option value="first">الأولى</option>
                        <option value="second">الثانية</option>
                        <option value="third">الثالثة</option>
                        <option value="fourth">الرابعة</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        قناة القبول *
                      </label>
                      <select
                        value={formData.universityAdmission.admissionChannel}
                        onChange={(e) => handleSelectChange('universityAdmission', 'admissionChannel', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'admissionChannel', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'admissionChannel', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر قناة القبول</option>
                        <option value="general">القناة العامة</option>
                        <option value="martyrs">قناة ذوي الشهداء</option>
                        <option value="social_care">قناة الرعاية الاجتماعية</option>
                        <option value="special_needs">قناة ذوي الهمم</option>
                        <option value="political_prisoners">قناة السجناء السياسيين</option>
                        <option value="siblings_married">تخفيض الاخوة والمتزوجين</option>
                        <option value="minister_directive">تخفيض توجيهات معالي الوزير</option>
                        <option value="dean_approval">تخفيض موافقة السيد العميد</option>
                        <option value="faculty_children">تخفيض ابناء الهيئة التدريسية</option>
                        <option value="top_students">تخفيض الاوائل</option>
                        <option value="health_ministry">تخفيض موظفي وزارة الصحة</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الفصل الدراسي *
                      </label>
                      <select
                        value={formData.universityAdmission.semester}
                        onChange={(e) => handleSelectChange('universityAdmission', 'semester', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'semester', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'semester', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر الفصل الدراسي</option>
                        <option value="first">الأول</option>
                        <option value="second">الثاني</option>
                      </select>
                    </div>
                  </div>

                  {/* باقي الحقول */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        القسم *
                      </label>
                      <select
                        value={formData.universityAdmission.department}
                        onChange={(e) => handleSelectChange('universityAdmission', 'department', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'department', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'department', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      >
                        <option value="">اختر القسم</option>
                        {getAvailableDepartments(formData.secondaryEducation.branch).map((dept) => (
                          <option key={dept.value} value={dept.value}>
                            {dept.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع الدراسة *
                      </label>
                      <select
                        value={formData.universityAdmission.studyType}
                        onChange={(e) => handleSelectChange('universityAdmission', 'studyType', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'studyType', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'studyType', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر نوع الدراسة</option>
                        <option value="morning">صباحي</option>
                        <option value="evening">مسائي</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        المرحلة الدراسية *
                      </label>
                      <select
                        value={formData.universityAdmission.level}
                        onChange={(e) => handleSelectChange('universityAdmission', 'level', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'level', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'level', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر المرحلة الدراسية</option>
                        <option value="bachelor">بكالوريوس</option>
                        <option value="master">ماجستير</option>
                        <option value="phd">دكتوراه</option>
                        <option value="diploma">دبلوم</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        السنة الأكاديمية *
                      </label>
                      <select
                        value={formData.universityAdmission.academicYear}
                        onChange={(e) => handleSelectChange('universityAdmission', 'academicYear', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'academicYear', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'academicYear', e)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        required
                      >
                        <option value="">اختر السنة الأكاديمية</option>
                        <option value="2024-2025">2024-2025</option>
                        <option value="2025-2026">2025-2026</option>
                        <option value="2026-2027">2026-2027</option>
                        <option value="2027-2028">2027-2028</option>
                        <option value="2028-2029">2028-2029</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الاسم المستخدم
                      </label>
                      <input
                        type="text"
                        value={formData.universityAdmission.username || ''}
                        onChange={(e) => handleInputChange('universityAdmission', 'username', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        placeholder="أدخل الاسم المستخدم"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        كلمة المرور
                      </label>
                      <input
                        type="text"
                        value={formData.universityAdmission.password || ''}
                        onChange={(e) => handleInputChange('universityAdmission', 'password', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        placeholder="أدخل كلمة المرور"
                      />
                    </div>

                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      متطلبات خاصة
                    </label>
                    <textarea
                      value={formData.universityAdmission.specialRequirements}
                      onChange={(e) => handleInputChange('universityAdmission', 'specialRequirements', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.universityAdmission.scholarship}
                      onChange={(e) => handleInputChange('universityAdmission', 'scholarship', e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label className="mr-2 block text-sm text-gray-700">
                      حاصل على منحة دراسية
                    </label>
                  </div>

                  {formData.universityAdmission.scholarship && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع المنحة
                      </label>
                      <input
                        type="text"
                        value={formData.universityAdmission.scholarshipType || ''}
                        onChange={(e) => handleInputChange('universityAdmission', 'scholarshipType', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {currentStep === 4 && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">المستمسكات والوثائق</h3>
                  
                  {/* ملاحظة مهمة عن الملفات */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="mr-3">
                        <h4 className="text-sm font-medium text-blue-800 mb-2">ملاحظات مهمة حول الملفات:</h4>
                        <ul className="text-sm text-blue-700 space-y-1">
                          <li>• يجب أن تكون جميع الملفات بصيغة الصور (JPG, PNG, GIF, WEBP) أو PDF</li>
                          <li>• الحد الأقصى لحجم الملف: 5 ميجابايت</li>
                          <li>• يجب أن تكون الصور واضحة ومقروءة</li>
                          <li>• الصورة الشخصية يجب أن تكون حديثة وبخلفية بيضاء</li>
                          <li>• جميع الملفات مطلوبة لإكمال التسجيل</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        صورة البطاقة الوطنية أو الجنسية (الوجه الأول) *
                        </label>
                          <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('nationalIdFront', file);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                      {formData.documents.nationalIdFront && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.nationalIdFront.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        صورة البطاقة الوطنية أو الجنسية (الوجه الثاني) *
                        </label>
                          <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('nationalIdBack', file);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                      {formData.documents.nationalIdBack && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.nationalIdBack.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        صورة بطاقة السكن (الوجه الأول) *
                      </label>
                          <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('residenceCardFront', file);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                      {formData.documents.residenceCardFront && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.residenceCardFront.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        صورة بطاقة السكن (الوجه الثاني) *
                      </label>
                          <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('residenceCardBack', file);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                      {formData.documents.residenceCardBack && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.residenceCardBack.name}
                        </p>
                      )}
                    </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                        صورة وثيقة الإعدادية *
                        </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('secondaryCertificate', file);
                        }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                        />
                      {formData.documents.secondaryCertificate && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.secondaryCertificate.name}
                        </p>
                      )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                        صورة شخصية حديثة بخلفية بيضاء *
                        </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('personalPhoto', file);
                        }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                      {formData.documents.personalPhoto && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.personalPhoto.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الفحص الطبي *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleFileChange('medicalExamination', file);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                      {formData.documents.medicalExamination && (
                        <p className="text-sm text-green-600 mt-1">
                          تم اختيار الملف: {formData.documents.medicalExamination.name}
                        </p>
                      )}
                    </div>
                  </div>
              </div>
              )}
              </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-2 flex justify-between items-center">
              <button
                onClick={prevStep}
                disabled={currentStep === 1}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors duration-200 ${
                  currentStep === 1
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-600 hover:bg-gray-700 text-white'
                }`}
              >
                السابق
              </button>

              <div className="flex space-x-2 space-x-reverse">
                {/* زر التحديث في كل خطوة */}
                {editingStudentId && (
                  <button
                    onClick={handleQuickUpdate}
                    disabled={loading}
                    className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {loading ? 'جاري التحديث...' : 'تحديث'}
                  </button>
                )}
                
                {currentStep < 4 ? (
                  <button
                    onClick={nextStep}
                    className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200"
                  >
                    التالي
                  </button>
                ) : (
                  !editingStudentId && (
                    <button
                      onClick={handleSave}
                      className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200"
                    >
                      حفظ
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">مراجعة البيانات قبل الحفظ</h2>
                <button
                  onClick={() => setShowReviewModal(false)}
                  className="text-white hover:text-orange-200 transition-colors duration-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-blue-800 mb-2">البيانات الشخصية</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div><strong>الاسم الرباعي:</strong> {formData.personalData.fullName}</div>
                    <div><strong>اللقب:</strong> {formData.personalData.nickname}</div>
                    <div><strong>اسم الأم الثلاثي:</strong> {formData.personalData.motherName}</div>
                    <div><strong>رقم الهوية:</strong> {formData.personalData.nationalId}</div>
                    <div><strong>تاريخ الميلاد:</strong> {formData.personalData.birthDate}</div>
                    <div><strong>المحافظة:</strong> {formData.personalData.birthPlace}</div>
                    <div><strong>المنطقة:</strong> {formData.personalData.area}</div>
                    <div><strong>الجنس:</strong> {formData.personalData.gender === 'male' ? 'ذكر' : 'أنثى'}</div>
                    <div><strong>الديانة:</strong> {formData.personalData.religion}</div>
                    <div><strong>الحالة الاجتماعية:</strong> {formData.personalData.maritalStatus === 'single' ? 'أعزب' : formData.personalData.maritalStatus === 'married' ? 'متزوج' : formData.personalData.maritalStatus === 'divorced' ? 'مطلق' : 'أرمل'}</div>
                    <div><strong>الهاتف:</strong> {formData.personalData.phone}</div>
                    <div><strong>البريد الإلكتروني:</strong> {formData.personalData.email}</div>
                    <div><strong>العنوان:</strong> {formData.personalData.address}</div>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-green-800 mb-2">الدراسة الإعدادية</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div><strong>اسم المدرسة:</strong> {formData.secondaryEducation.schoolName}</div>
                    <div><strong>نوع المدرسة:</strong> {formData.secondaryEducation.schoolType === 'public' ? 'حكومية' : formData.secondaryEducation.schoolType === 'private' ? 'أهلية' : 'دولية'}</div>
                    <div><strong>سنة التخرج:</strong> {formData.secondaryEducation.graduationYear}</div>
                    <div><strong>المعدل التراكمي:</strong> {formData.secondaryEducation.gpa}</div>
                    <div><strong>إجمالي الدرجات:</strong> {formData.secondaryEducation.totalScore}</div>
                    <div><strong>الدور:</strong> {formData.secondaryEducation.examAttempt === 'first' ? 'الأول' : formData.secondaryEducation.examAttempt === 'second' ? 'الثاني' : 'الثالث'}</div>
                    <div><strong>الرقم الامتحاني:</strong> {formData.secondaryEducation.examNumber}</div>
                    <div><strong>الرقم السري:</strong> {formData.secondaryEducation.examPassword}</div>
                    <div><strong>الفرع:</strong> {formData.secondaryEducation.branch}</div>
                  </div>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-purple-800 mb-2">القبول الجامعي</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div><strong>المرحلة:</strong> {formData.universityAdmission.admissionType === 'first' ? 'الأولى' : formData.universityAdmission.admissionType === 'second' ? 'الثانية' : formData.universityAdmission.admissionType === 'third' ? 'الثالثة' : 'الرابعة'}</div>
                    <div><strong>قناة القبول:</strong> {
                      formData.universityAdmission.admissionChannel === 'general' ? 'القناة العامة' :
                      formData.universityAdmission.admissionChannel === 'martyrs' ? 'قناة ذوي الشهداء' :
                      formData.universityAdmission.admissionChannel === 'social_care' ? 'قناة الرعاية الاجتماعية' :
                      formData.universityAdmission.admissionChannel === 'special_needs' ? 'قناة ذوي الهمم' :
                      formData.universityAdmission.admissionChannel === 'political_prisoners' ? 'قناة السجناء السياسيين' :
                      formData.universityAdmission.admissionChannel === 'siblings_married' ? 'تخفيض الاخوة والمتزوجين' :
                      formData.universityAdmission.admissionChannel === 'minister_directive' ? 'تخفيض توجيهات معالي الوزير' :
                      formData.universityAdmission.admissionChannel === 'dean_approval' ? 'تخفيض موافقة السيد العميد' :
                      formData.universityAdmission.admissionChannel === 'faculty_children' ? 'تخفيض ابناء الهيئة التدريسية' :
                      formData.universityAdmission.admissionChannel === 'top_students' ? 'تخفيض الاوائل' :
                      formData.universityAdmission.admissionChannel === 'health_ministry' ? 'تخفيض موظفي وزارة الصحة' :
                      'غير محدد'
                    }</div>
                    <div><strong>القسم:</strong> {formData.universityAdmission.department}</div>
                    <div><strong>نوع الدراسة:</strong> {formData.universityAdmission.studyType === 'morning' ? 'صباحي' : 'مسائي'}</div>
                    <div><strong>المرحلة الدراسية:</strong> {formData.universityAdmission.level === 'bachelor' ? 'بكالوريوس' : formData.universityAdmission.level === 'master' ? 'ماجستير' : formData.universityAdmission.level === 'phd' ? 'دكتوراه' : 'دبلوم'}</div>
                    <div><strong>الفصل الدراسي:</strong> {formData.universityAdmission.semester === 'first' ? 'الأول' : 'الثاني'}</div>
                    <div><strong>السنة الأكاديمية:</strong> {formData.universityAdmission.academicYear}</div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-yellow-800 mb-2">المستمسكات والوثائق</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div><strong>صورة البطاقة الوطنية (الوجه الأول):</strong> {formData.documents.nationalIdFront ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                    <div><strong>صورة البطاقة الوطنية (الوجه الثاني):</strong> {formData.documents.nationalIdBack ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                    <div><strong>صورة بطاقة السكن (الوجه الأول):</strong> {formData.documents.residenceCardFront ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                    <div><strong>صورة بطاقة السكن (الوجه الثاني):</strong> {formData.documents.residenceCardBack ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                    <div><strong>صورة وثيقة الإعدادية:</strong> {formData.documents.secondaryCertificate ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                    <div><strong>الصورة الشخصية:</strong> {formData.documents.personalPhoto ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                    <div><strong>الفحص الطبي:</strong> {formData.documents.medicalExamination ? 'تم رفع الملف' : 'لم يتم رفع الملف'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
              <button
                onClick={() => setShowReviewModal(false)}
                className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors duration-200"
              >
                إلغاء
              </button>
              <div className="flex gap-3">
                {!editingStudentId && (
                  <button
                    onClick={saveAsPendingRegistration}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200"
                  >
                    قيد التسجيل
                  </button>
                )}
                <button
                  onClick={confirmSave}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200"
                >
                  {editingStudentId ? 'تأكيد التحديث' : 'تأكيد الحفظ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  تم إنشاء الرقم الجامعي بنجاح!
                </h3>
                <p className="text-gray-600 mb-4">
                  تم حفظ جميع بيانات الطالب في النظام
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-blue-800 font-medium">الرقم الجامعي:</p>
                  <p className="text-xl font-bold text-blue-900">{generatedStudentId}</p>
                </div>
                <p className="text-sm text-gray-500">
                  هذا الرقم فريد ولا يتكرر أبداً وسيستخدم كمعرف للطالب في النظام
                </p>
              </div>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end">
              <button
                onClick={finalConfirmSave}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200"
              >
                تأكيد
              </button>
          </div>
        </div>
      </div>
      )}

      {/* جدول الطلاب */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-gray-800">قائمة الطلاب المسجلين</h2>
          <div className="flex items-center space-x-4 space-x-reverse">
            <div className="relative">
              <input
                type="text"
                placeholder="ابحث بالاسم أو الرقم الجامعي أو الهوية أو اللقب..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-80 px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            <select 
              value={selectedAcademicYear}
              onChange={(e) => {
                setSelectedAcademicYear(e.target.value);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              disabled={yearsLoading}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year === 'all' ? 'جميع السنوات' : year}
                </option>
              ))}
            </select>
            <select 
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-10 text-sm"
            >
              <option value="">جميع الأقسام</option>
              <option value="تقنيات التخدير">قسم تقنيات التخدير</option>
              <option value="تقنيات الاشعة">قسم تقنيات الاشعة</option>
              <option value="تقنيات صناعة الاسنان">قسم تقنيات صناعة الاسنان</option>
              <option value="هندسة تقنيات البناء والانشاءات">قسم هندسة تقنيات البناء والانشاءات</option>
              <option value="تقنيات هندسة النفط والغاز">قسم تقنيات هندسة النفط والغاز</option>
              <option value="تقنيات الفيزياء الصحية">قسم تقنيات الفيزياء الصحية والعلاج الاشعاعي</option>
              <option value="تقنيات البصريات">قسم تقنيات البصريات</option>
              <option value="تقنيات صحة المجتمع">قسم تقنيات صحة المجتمع</option>
              <option value="تقنيات طب الطوارئ">قسم تقنيات طب الطوارئ</option>
              <option value="تقنيات العلاج الطبيعي">قسم تقنيات العلاج الطبيعي</option>
              <option value="هندسة تقنيات الامن السيبراني والحوسبة السحابية">قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية</option>
              <option value="القانون">قسم القانون</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">الرقم الجامعي</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">الاسم الكامل</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">القسم</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">المرحلة</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">تاريخ التسجيل</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">الحالة</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">تأكيد الدفع</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      جاري تحميل البيانات...
                    </div>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    لا توجد بيانات طلاب
                    <br />
                    <span className="text-xs text-gray-400">
                      إجمالي الطلاب: {pagination.total} | حالة التحميل: {loading ? 'جاري التحميل' : 'انتهى التحميل'}
                    </span>
                  </td>
                </tr>
              ) : (
                console.log('📊 عرض الجدول مع', students.length, 'طالب في الصفحة الرئيسية'),
                students.map((student) => (
                  <tr 
                    key={student.id} 
                    className={`border-b border-gray-200 hover:bg-gray-50 ${
                      student.payment_status === 'paid' 
                        ? 'border-r-4 border-r-emerald-500' 
                        : 'border-r-4 border-r-red-500'
                    }`}
                  >
                    <td className="px-4 py-3 text-sm font-mono text-blue-600">{student.university_id}</td>
                    <td className="px-4 py-3 text-sm text-gray-800">
                      {student.full_name_ar || student.full_name || `${student.first_name} ${student.last_name}`}
                      {student.nickname && (
                        <span className="text-gray-500 text-xs mr-2">({student.nickname})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{student.department || 'غير محدد'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {(() => {
                        const admissionType = student.admission_type;
                        console.log(`🔍 عرض المرحلة للطالب ${student.full_name}:`, {
                          admission_type: admissionType,
                          type: typeof admissionType,
                          isNull: admissionType === null,
                          isUndefined: admissionType === undefined,
                          isString: typeof admissionType === 'string',
                          value: admissionType
                        });
                        if (admissionType === 'first' || admissionType === 'regular' || admissionType === 'conditional') return 'الأولى';
                        if (admissionType === 'second') return 'الثانية';
                        if (admissionType === 'third') return 'الثالثة';
                        if (admissionType === 'fourth') return 'الرابعة';
                        return 'غير محدد';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatRegistrationDate(student.registration_date)}</td>
                  <td className="px-4 py-3 w-[200px]">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const viewportHeight = window.innerHeight;
                            const viewportWidth = window.innerWidth;
                            const dropdownHeight = 320; // تقريباً ارتفاع القائمة
                            const dropdownWidth = 320; // عرض القائمة
                            
                            // حساب الموضع مع التحقق من المساحة المتاحة
                            // استخدام getBoundingClientRect مباشرة بدون scrollY/scrollX للـ fixed
                            let top = rect.bottom + 4;
                            let left = rect.left;
                            
                            // إذا كانت القائمة ستخرج من أسفل الشاشة، نعرضها فوق الزر
                            if (rect.bottom + dropdownHeight > viewportHeight) {
                              top = rect.top - dropdownHeight - 4;
                            }
                            
                            // إذا كانت القائمة ستخرج من اليمين، نضبط الموضع
                            if (left + dropdownWidth > viewportWidth) {
                              left = viewportWidth - dropdownWidth - 8;
                            }
                            
                            // التأكد من أن القائمة لا تخرج من اليسار
                            if (left < 8) {
                              left = 8;
                            }
                            
                            // التأكد من أن القائمة لا تخرج من الأعلى
                            if (top < 8) {
                              top = rect.bottom + 4;
                            }
                            
                            setDropdownPosition({ top, left });
                            setOpenStatusDropdown(openStatusDropdown === student.id ? null : student.id);
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] leading-tight font-medium border w-[180px] h-[32px] overflow-hidden ${getStatusColor(student.academic_status || 'مستمر')}`}
                        >
                          <span className="line-clamp-2 text-right break-words flex-1 min-w-0 overflow-hidden text-ellipsis">{student.academic_status || 'مستمر'}</span>
                          <svg className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {student.payment_status === 'paid' ? (
                      <div className="w-full py-2 rounded text-emerald-700 bg-emerald-100 border-2 border-emerald-300 font-medium text-[10px]">تم الدفع</div>
                    ) : (
                      <div className="w-full py-2 rounded text-red-700 bg-red-100 border-2 border-red-300 font-medium text-[10px]">بانتظار الدفع</div>
                    )}
                  </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-center space-y-2">
                        {student.payment_status === 'registration_pending' && (
                          <div className="w-full py-1.5 rounded text-blue-700 bg-blue-100 border-2 border-blue-300 font-medium text-[10px] text-center mb-2">
                            قيد التسجيل
                          </div>
                        )}
                        <div className="flex items-center space-x-2 space-x-reverse">
                          {student.payment_status === 'registration_pending' && (
                            <button 
                              onClick={async () => {
                                if (confirm('هل أنت متأكد من إتمام التسجيل؟ سيتم ترحيل الطالب إلى صفحة الحسابات.')) {
                                  try {
                                    const response = await fetch(`/api/students/${student.id}/complete-registration`, {
                                      method: 'POST'
                                    });
                                    const result = await response.json();
                                    if (result.success) {
                                      alert('تم إتمام التسجيل بنجاح! سيتم ترحيل الطالب إلى صفحة الحسابات.');
                                      await fetchStudents();
                                      await fetchDepartmentCounts();
                                    } else {
                                      alert('خطأ: ' + (result.error || 'فشل إتمام التسجيل'));
                                    }
                                  } catch (error) {
                                    alert('حدث خطأ في إتمام التسجيل');
                                    console.error(error);
                                  }
                                }
                              }}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                              title="إتمام التسجيل"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>
                          )}
                        <button 
                          onClick={async () => {
                            try {
                              console.log('🖨️ جلب بيانات الطالب للطباعة:', student.id);
                              const response = await fetch(`/api/students/${student.id}`);
                              const result = await response.json();
                              console.log('📄 نتيجة API:', result);
                              
                              if (result.success) {
                                // API قد يرجع student أو data
                                const studentData = result.student || result.data || result;
                                console.log('✅ بيانات الطالب:', studentData);
                                setPrintStudent(studentData);
                              } else {
                                console.error('❌ خطأ في API:', result.error);
                                alert('خطأ في جلب بيانات الطالب للطباعة: ' + (result.error || 'خطأ غير معروف'));
                              }
                            } catch (error) {
                              console.error('❌ خطأ في جلب بيانات الطالب:', error);
                              alert('حدث خطأ في جلب بيانات الطالب: ' + (error instanceof Error ? error.message : 'خطأ غير معروف'));
                            }
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                          title="طباعة الاستمارة"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                          </svg>
                        </button>
                        <button 
                          onClick={() => handleEditStudent(student.id)}
                          className="text-green-600 hover:text-green-800 text-sm"
                          title="تعديل"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button 
                          onClick={() => handleDeleteStudent(student.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                          title="حذف"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-gray-700">
            عرض {((pagination.page - 1) * pagination.limit) + 1} إلى {Math.min(pagination.page * pagination.limit, pagination.total)} من {pagination.total} طالب
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <button 
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page <= 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              السابق
            </button>
            <span className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg">
              {pagination.page}
            </span>
            <button 
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page >= pagination.total_pages}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              التالي
            </button>
          </div>
        </div>
      </div>

      {/* القائمة المنسدلة لحالات الطالب - خارج الجدول */}
      {openStatusDropdown && dropdownPosition && (
        <div className="fixed inset-0 z-[9998]" style={{ pointerEvents: 'auto' }}>
          {/* خلفية شفافة */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => {
              setOpenStatusDropdown(null);
              setDropdownPosition(null);
            }}
          />
          
          {/* القائمة */}
          <div
            className="absolute bg-white rounded-xl shadow-2xl border-2 border-blue-200 w-80 max-h-80 overflow-hidden"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              maxHeight: 'calc(100vh - 16px)',
              zIndex: 10000,
              position: 'fixed'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                اختر الحالة الأكاديمية
              </h3>
            </div>
            
            {/* List */}
            <div className="overflow-y-auto max-h-64">
              <div className="py-2">
                {studentStatuses.map((status) => {
                  const currentStudent = students.find(s => s.id === openStatusDropdown);
                  const isActive = (currentStudent?.academic_status || 'مستمر') === status;
                  
                  return (
                    <button
                      key={status}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openStatusDropdown) {
                          handleUpdateStatus(openStatusDropdown, status);
                        }
                      }}
                      className={`w-full text-right px-4 py-2.5 text-sm transition-all duration-200 rounded-lg mx-2 my-1 flex items-center justify-between group ${
                        isActive 
                          ? 'bg-blue-50 text-blue-700 font-semibold border-r-4 border-blue-500 shadow-sm' 
                          : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <span className="flex-1">{status}</span>
                      {isActive && (
                        <svg className="w-4 h-4 text-blue-600 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {!isActive && (
                        <div className="w-4 h-4 mr-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* نافذة طباعة الاستمارة */}
      {printStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4 print:hidden print:fixed print:inset-0 print:bg-transparent print:p-0">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col print:shadow-none print:rounded-none print:max-w-none print:max-h-none print:w-full print:h-auto print:overflow-visible">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 flex items-center justify-between no-print">
              <h2 className="text-xl font-bold text-white">استمارة الطالب</h2>
              <div className="flex items-center space-x-4 space-x-reverse">
                <button
                  onClick={() => {
                    // إنشاء نافذة طباعة جديدة
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      const printContent = document.querySelector('.print-container');
                      if (printContent) {
                        // الحصول على مسار الشعار
                        const logoPath = window.location.origin + '/logos/college-logo.png';
                        
                        // استخراج العنوان من المحتوى
                        const contentHTML = printContent.innerHTML;
                        const titleMatch = contentHTML.match(/<h1[^>]*>(.*?)<\/h1>/);
                        const title = titleMatch ? titleMatch[1] : 'كلية الشرق للعلوم التقنية التخصصية';
                        
                        // الحصول على اسم الطالب
                        const studentName = printStudent.full_name_ar || printStudent.full_name || 
                                          `${printStudent.first_name} ${printStudent.last_name}` || 'غير محدد';
                        const subtitle = `استمارة تسجيل الطالب (${studentName})`;
                        
                        const yearMatch = contentHTML.match(/السنة الأكاديمية: ([^<]+)/);
                        const year = yearMatch ? yearMatch[1] : (printStudent.academic_year || '2025-2026');
                        
                        // الحصول على الفصل الدراسي ونوع الدراسة
                        const semester = printStudent.semester === 'first' ? 'الأول' : 
                                        printStudent.semester === 'second' ? 'الثاني' : 
                                        printStudent.semester || '';
                        const studyType = printStudent.study_type === 'morning' ? 'صباحي' : 
                                         printStudent.study_type === 'evening' ? 'مسائي' : 
                                         printStudent.study_type || '';
                        
                        // بناء نص السنة الأكاديمية مع الفصل ونوع الدراسة
                        let academicInfo = `السنة الأكاديمية: ${year}`;
                        if (semester) {
                          academicInfo += ` - الفصل الدراسي: ${semester}`;
                        }
                        if (studyType) {
                          academicInfo += ` - نوع الدراسة: ${studyType}`;
                        }
                        
                        // إضافة القسم
                        const department = printStudent.department || '';
                        let departmentInfo = '';
                        if (department) {
                          departmentInfo = `القسم: ${department}`;
                        }
                        
                        // إزالة العنوان من المحتوى
                        const cleanedContent = contentHTML
                          .replace(/<div[^>]*class="[^"]*text-center[^"]*mb-8[^"]*"[^>]*>[\s\S]*?<\/div>/, '');
                        
                        printWindow.document.write(`
                          <!DOCTYPE html>
                          <html dir="rtl" lang="ar">
                            <head>
                              <meta charset="UTF-8">
                              <title>استمارة الطالب</title>
                              <style>
                                @page {
                                  size: A4;
                                  margin: 15mm 20mm;
                                }
                                body {
                                  font-family: 'Cairo', Arial, sans-serif;
                                  direction: rtl;
                                  margin: 0;
                                  padding: 0;
                                  font-size: 11pt;
                                  line-height: 1.5;
                                }
                                .header-logo {
                                  text-align: center;
                                  margin-bottom: 15pt;
                                }
                                .header-logo img {
                                  max-width: 80pt;
                                  max-height: 80pt;
                                  object-fit: contain;
                                  margin-bottom: 8pt;
                                }
                                .header-logo h1 {
                                  font-size: 18pt;
                                  font-weight: bold;
                                  color: #1f2937;
                                  margin: 8pt 0 4pt 0;
                                }
                                .header-logo h2 {
                                  font-size: 16pt;
                                  font-weight: 600;
                                  color: #374151;
                                  margin: 0 0 6pt 0;
                                }
                                .header-logo .academic-year {
                                  font-size: 11pt;
                                  color: #6b7280;
                                  margin-bottom: 4pt;
                                }
                                .header-logo .department {
                                  font-size: 11pt;
                                  color: #6b7280;
                                  margin-bottom: 8pt;
                                  font-weight: 600;
                                }
                                .header-logo .divider {
                                  width: 100%;
                                  height: 2pt;
                                  background-color: #2563eb;
                                  margin: 0;
                                }
                                table {
                                  width: 100%;
                                  border-collapse: collapse;
                                  margin-bottom: 12pt;
                                }
                                td {
                                  padding: 6pt 8pt;
                                  border: 1pt solid #e5e7eb;
                                }
                                td:first-child {
                                  background-color: #f9fafb;
                                  font-weight: 600;
                                  width: 35%;
                                }
                                h1 { font-size: 18pt; margin-bottom: 8pt; }
                                h2 { font-size: 16pt; margin-bottom: 6pt; }
                                h3 { 
                                  font-size: 13pt; 
                                  margin-bottom: 8pt; 
                                  padding: 4pt 8pt;
                                  background-color: #2563eb;
                                  color: white;
                                }
                                .bg-blue-600 {
                                  background-color: #2563eb !important;
                                  color: white !important;
                                }
                                .bg-gray-50 {
                                  background-color: #f9fafb !important;
                                }
                                .print-footer {
                                  margin-top: 20pt;
                                  padding-top: 10pt;
                                  border-top: 2pt solid #9ca3af;
                                  display: flex;
                                  justify-content: space-between;
                                  align-items: flex-start;
                                  font-size: 11pt;
                                }
                                .print-footer .footer-left {
                                  display: flex;
                                  flex-direction: column;
                                  gap: 4pt;
                                }
                                .print-footer .footer-right {
                                  text-align: right;
                                }
                                .print-footer .signature-line {
                                  width: 80pt;
                                  height: 1pt;
                                  background-color: #9ca3af;
                                  margin-top: 20pt;
                                }
                                .barcode-page {
                                  page-break-before: always;
                                  break-before: page;
                                  margin-top: 30pt;
                                  text-align: center;
                                }
                                .barcode-section {
                                  margin-bottom: 30pt;
                                }
                                .barcode-section h3 {
                                  font-size: 14pt;
                                  font-weight: 600;
                                  color: #1f2937;
                                  margin-bottom: 15pt;
                                }
                                .barcode-container {
                                  display: flex;
                                  flex-direction: column;
                                  align-items: center;
                                  gap: 10pt;
                                }
                                .barcode-container img {
                                  max-width: 100%;
                                  height: auto;
                                }
                                .university-id {
                                  font-size: 16pt;
                                  font-weight: bold;
                                  font-family: monospace;
                                  color: #1f2937;
                                  margin-top: 10pt;
                                  padding: 8pt;
                                  border: 2pt solid #2563eb;
                                  border-radius: 4pt;
                                  display: inline-block;
                                }
                              </style>
                            </head>
                            <body>
                              <div class="header-logo">
                                <img src="${logoPath}" alt="شعار كلية الشرق" onerror="this.style.display='none'">
                                <h1>${title}</h1>
                                <h2>${subtitle}</h2>
                                <div class="academic-year">${academicInfo}</div>
                                ${departmentInfo ? `<div class="department">${departmentInfo}</div>` : ''}
                                <div class="divider"></div>
                              </div>
                              ${cleanedContent}
                              <div class="print-footer">
                                <div class="footer-left">
                                  <p style="font-weight: 600;">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                                  <p style="font-weight: 600;">كلية الشرق للعلوم التقنية التخصصية</p>
                                  <p style="font-size: 9pt; color: #6b7280;">نظام SHAU لإدارة شؤون الطلبة</p>
                                </div>
                                <div class="footer-right">
                                  <p style="font-weight: 600; margin-bottom: 8pt;">توقيع المسؤول</p>
                                  <div class="signature-line"></div>
                                </div>
                              </div>
                              
                              <!-- صفحة الباركود والـ QR Code -->
                              <div class="barcode-page">
                                <div class="barcode-section">
                                  <h3>الرقم الجامعي</h3>
                                  <div class="university-id">${printStudent.university_id}</div>
                                </div>
                                
                                <div class="barcode-section">
                                  <h3>باركود الطالب</h3>
                                  <div class="barcode-container">
                                    <img src="https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(printStudent.university_id)}&code=Code128&dpi=96&dataseparator=" alt="باركود الطالب" />
                                  </div>
                                </div>
                                
                                <div class="barcode-section">
                                  <h3>QR Code الطالب</h3>
                                  <div class="barcode-container">
                                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(printStudent.university_id)}" alt="QR Code الطالب" />
                                  </div>
                                </div>
                              </div>
                            </body>
                          </html>
                        `);
                        printWindow.document.close();
                        setTimeout(() => {
                          printWindow.print();
                        }, 250);
                      }
                    } else {
                      // Fallback إلى window.print العادي
                      window.print();
                    }
                  }}
                  className="px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium"
                >
                  طباعة
                </button>
                <button
                  onClick={() => {
                    setPrintStudent(null);
                  }}
                  className="text-white hover:text-blue-200 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 print:p-0 print:overflow-visible">
              <div className="print-container bg-white print:w-full">
                {/* Header للطباعة */}
                <div className="text-center mb-8 print:mb-6 border-b-2 border-blue-600 pb-4 print:pb-3">
                  <h1 className="text-3xl font-bold text-gray-900 mb-2 print:text-2xl">كلية الشرق للعلوم التقنية التخصصية</h1>
                  <h2 className="text-2xl font-semibold text-gray-800 mb-2 print:text-xl">استمارة تسجيل الطالب</h2>
                  <div className="text-sm text-gray-600">السنة الأكاديمية: {printStudent.academic_year || '2025-2026'}</div>
                </div>

                {/* البيانات الشخصية - الخطوة 1 */}
                <div className="mb-8 print:mb-6">
                  <h3 className="text-xl font-bold text-white bg-blue-600 px-4 py-2 mb-4 print:mb-3 print:text-lg">
                    الخطوة الأولى: البيانات الشخصية
                  </h3>
                  <table className="w-full border-collapse mb-4 print:mb-3">
                    <tbody>
                      <tr className="border-b border-gray-200">
                        <td className="w-1/3 py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الاسم الرباعي</td>
                        <td className="w-2/3 py-2 px-3 text-gray-800">{printStudent.full_name_ar || printStudent.full_name || `${printStudent.first_name} ${printStudent.last_name}`}</td>
                      </tr>
                      {printStudent.nickname && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">اللقب</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.nickname}</td>
                        </tr>
                      )}
                      {printStudent.mother_name && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">اسم الأم الثلاثي</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.mother_name}</td>
                        </tr>
                      )}
                      <tr className="border-b border-gray-200">
                        <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الرقم الوطني</td>
                        <td className="py-2 px-3 text-gray-800 font-mono">{printStudent.national_id}</td>
                      </tr>
                      <tr className="border-b border-gray-200">
                        <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">تاريخ الميلاد</td>
                        <td className="py-2 px-3 text-gray-800">{printStudent.birth_date ? new Date(printStudent.birth_date).toLocaleDateString('ar-EG') : 'غير محدد'}</td>
                      </tr>
                      {printStudent.birth_place && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">مكان الميلاد</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.birth_place}</td>
                        </tr>
                      )}
                      {printStudent.area && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">المنطقة</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.area}</td>
                        </tr>
                      )}
                      <tr className="border-b border-gray-200">
                        <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الجنس</td>
                        <td className="py-2 px-3 text-gray-800">{printStudent.gender === 'male' ? 'ذكر' : 'أنثى'}</td>
                      </tr>
                      {printStudent.religion && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الدين</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.religion}</td>
                        </tr>
                      )}
                      {printStudent.marital_status && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الحالة الاجتماعية</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.marital_status === 'single' ? 'أعزب' : 
                             printStudent.marital_status === 'married' ? 'متزوج' : 
                             printStudent.marital_status === 'divorced' ? 'مطلق' : 
                             printStudent.marital_status === 'widowed' ? 'أرمل' : printStudent.marital_status}
                          </td>
                        </tr>
                      )}
                      {printStudent.phone && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">رقم الهاتف</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.phone}</td>
                        </tr>
                      )}
                      {printStudent.email && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">البريد الإلكتروني</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.email}</td>
                        </tr>
                      )}
                      {printStudent.address && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">العنوان</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.address}</td>
                        </tr>
                      )}
                      {printStudent.emergency_contact_name && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">اسم جهة الاتصال في حالات الطوارئ</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.emergency_contact_name}</td>
                        </tr>
                      )}
                      {printStudent.emergency_contact_relationship && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">صلة القرابة</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.emergency_contact_relationship}</td>
                        </tr>
                      )}
                      {printStudent.emergency_contact_phone && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">رقم هاتف جهة الاتصال</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.emergency_contact_phone}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* بيانات الدراسة الإعدادية - الخطوة 2 */}
                <div className="mb-8 print:mb-6">
                  <h3 className="text-xl font-bold text-white bg-blue-600 px-4 py-2 mb-4 print:mb-3 print:text-lg">
                    الخطوة الثانية: بيانات الدراسة الإعدادية
                  </h3>
                  <table className="w-full border-collapse mb-4 print:mb-3">
                    <tbody>
                      {printStudent.secondary_school_name && (
                        <tr className="border-b border-gray-200">
                          <td className="w-1/3 py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">اسم المدرسة</td>
                          <td className="w-2/3 py-2 px-3 text-gray-800">{printStudent.secondary_school_name}</td>
                        </tr>
                      )}
                      {printStudent.secondary_school_type && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">نوع المدرسة</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.secondary_school_type === 'public' ? 'حكومية' : 
                             printStudent.secondary_school_type === 'private' ? 'خاصة' : 
                             printStudent.secondary_school_type === 'international' ? 'دولية' : printStudent.secondary_school_type}
                          </td>
                        </tr>
                      )}
                      {printStudent.secondary_graduation_year && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">سنة التخرج</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.secondary_graduation_year}</td>
                        </tr>
                      )}
                      {printStudent.secondary_gpa !== undefined && printStudent.secondary_gpa !== null && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">المعدل التراكمي</td>
                          <td className="py-2 px-3 text-gray-800 font-semibold">{printStudent.secondary_gpa}</td>
                        </tr>
                      )}
                      {printStudent.secondary_total_score !== undefined && printStudent.secondary_total_score !== null && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">إجمالي الدرجات</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.secondary_total_score}</td>
                        </tr>
                      )}
                      {printStudent.exam_attempt && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الدور</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.exam_attempt === 'first' ? 'الأول' : 
                             printStudent.exam_attempt === 'second' ? 'الثاني' : 
                             printStudent.exam_attempt === 'third' ? 'الثالث' : printStudent.exam_attempt}
                          </td>
                        </tr>
                      )}
                      {printStudent.exam_number && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الرقم الامتحاني</td>
                          <td className="py-2 px-3 text-gray-800 font-mono">{printStudent.exam_number}</td>
                        </tr>
                      )}
                      {printStudent.exam_password && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الرقم السري</td>
                          <td className="py-2 px-3 text-gray-800 font-mono">{printStudent.exam_password}</td>
                        </tr>
                      )}
                      {printStudent.branch && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الفرع</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.branch}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* بيانات القبول الجامعي - الخطوة 3 */}
                <div className="mb-8 print:mb-6">
                  <h3 className="text-xl font-bold text-white bg-blue-600 px-4 py-2 mb-4 print:mb-3 print:text-lg">
                    الخطوة الثالثة: بيانات القبول الجامعي
                  </h3>
                  <table className="w-full border-collapse mb-4 print:mb-3">
                    <tbody>
                      <tr className="border-b border-gray-200 bg-blue-50">
                        <td className="w-1/3 py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الرقم الجامعي</td>
                        <td className="w-2/3 py-2 px-3 text-gray-800 font-mono font-bold text-lg">{printStudent.university_id}</td>
                      </tr>
                      {printStudent.admission_type && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">نوع القبول</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.admission_type === 'first' ? 'الأولى' : 
                             printStudent.admission_type === 'second' ? 'الثانية' : 
                             printStudent.admission_type === 'third' ? 'الثالثة' : 
                             printStudent.admission_type === 'fourth' ? 'الرابعة' : printStudent.admission_type}
                          </td>
                        </tr>
                      )}
                      {printStudent.admission_channel && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">قناة القبول</td>
                          <td className="py-2 px-3 text-gray-800">
                            {(() => {
                              const channelMap: Record<string, string> = {
                                'general': 'القناة العامة',
                                'martyrs': 'قناة ذوي الشهداء',
                                'social_care': 'قناة الرعاية الاجتماعية',
                                'special_needs': 'قناة ذوي الهمم',
                                'political_prisoners': 'قناة السجناء السياسيين',
                                'siblings_married': 'تخفيض الاخوة والمتزوجين',
                                'minister_directive': 'تخفيض توجيهات معالي الوزير',
                                'dean_approval': 'تخفيض موافقة السيد العميد',
                                'faculty_children': 'تخفيض ابناء الهيئة التدريسية',
                                'top_students': 'تخفيض الاوائل',
                                'health_ministry': 'تخفيض موظفي وزارة الصحة'
                              };
                              return channelMap[printStudent.admission_channel] || printStudent.admission_channel;
                            })()}
                          </td>
                        </tr>
                      )}
                      {printStudent.department && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">القسم</td>
                          <td className="py-2 px-3 text-gray-800 font-semibold">{printStudent.department}</td>
                        </tr>
                      )}
                      {printStudent.study_type && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">نوع الدراسة</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.study_type === 'morning' ? 'صباحي' : 
                             printStudent.study_type === 'evening' ? 'مسائي' : printStudent.study_type}
                          </td>
                        </tr>
                      )}
                      {printStudent.level && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">المستوى</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.level === 'bachelor' ? 'بكالوريوس' : 
                             printStudent.level === 'master' ? 'ماجستير' : 
                             printStudent.level === 'phd' ? 'دكتوراه' : 
                             printStudent.level === 'diploma' ? 'دبلوم' : printStudent.level}
                          </td>
                        </tr>
                      )}
                      {printStudent.semester && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الفصل الدراسي</td>
                          <td className="py-2 px-3 text-gray-800">
                            {printStudent.semester === 'first' ? 'الأول' : 
                             printStudent.semester === 'second' ? 'الثاني' : printStudent.semester}
                          </td>
                        </tr>
                      )}
                      {printStudent.academic_year && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">السنة الأكاديمية</td>
                          <td className="py-2 px-3 text-gray-800 font-semibold">{printStudent.academic_year}</td>
                        </tr>
                      )}
                      {printStudent.username && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">الاسم المستخدم</td>
                          <td className="py-2 px-3 text-gray-800 font-mono">{printStudent.username}</td>
                        </tr>
                      )}
                      {printStudent.password && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">كلمة المرور</td>
                          <td className="py-2 px-3 text-gray-800 font-mono">{printStudent.password}</td>
                        </tr>
                      )}
                      {printStudent.admission_score !== undefined && printStudent.admission_score !== null && (
                        <tr className="border-b border-gray-200">
                          <td className="py-2 px-3 font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">درجة القبول</td>
                          <td className="py-2 px-3 text-gray-800">{printStudent.admission_score}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Footer للطباعة - سيتم إضافته في صفحة الطباعة فقط */}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal الاستيراد الجماعي */}
      {showBulkImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">استيراد طلاب جماعي</h2>
                <button
                  onClick={() => {
                    setShowBulkImportModal(false);
                    setBulkImportMode('table');
                    setBulkImportStudents([{
                      full_name: '',
                      nickname: '',
                      mother_name: '',
                      birth_date: '',
                      national_id: '',
                      phone: '',
                      school_name: '',
                      gpa: '',
                      graduation_year: '',
                      exam_number: '',
                      exam_password: '',
                      department: '',
                      username: '',
                      password: '',
                      stage: '',
                      study_type: '',
                      level: '',
                      academic_year: '',
                      semester: ''
                    }]);
                    setExcelFile(null);
                  }}
                  className="text-white hover:text-purple-200 transition-colors duration-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Tabs */}
              <div className="flex items-center justify-center mt-4 gap-2">
                <button
                  onClick={() => setBulkImportMode('table')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    bulkImportMode === 'table'
                      ? 'bg-white text-purple-600'
                      : 'bg-purple-400 text-white hover:bg-purple-300'
                  }`}
                >
                  إدخال يدوي (جدول)
                </button>
                <button
                  onClick={() => setBulkImportMode('file')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    bulkImportMode === 'file'
                      ? 'bg-white text-purple-600'
                      : 'bg-purple-400 text-white hover:bg-purple-300'
                  }`}
                >
                  استيراد من ملف Excel/CSV
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 flex-1 overflow-y-auto">
              {bulkImportMode === 'file' ? (
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-blue-900 mb-3">📋 إرشادات ترتيب الأعمدة في ملف Excel/CSV</h3>
                    <div className="text-sm text-blue-800 space-y-2">
                      <p className="font-semibold">يجب أن يكون ترتيب الأعمدة في الملف كالتالي (من اليمين إلى اليسار):</p>
                      <ol className="list-decimal list-inside space-y-1 mr-4">
                        <li><strong>الاسم الرباعي</strong> (مطلوب)</li>
                        <li><strong>اللقب</strong> (اختياري)</li>
                        <li><strong>اسم الأم الثلاثي</strong> (اختياري)</li>
                        <li><strong>تاريخ الميلاد</strong> (اختياري - صيغة: YYYY-MM-DD)</li>
                        <li><strong>رقم الهوية الوطنية</strong> (اختياري)</li>
                        <li><strong>رقم هاتف الطالب</strong> (اختياري - بدون +964)</li>
                        <li><strong>اسم المدرسة</strong> (اختياري)</li>
                        <li><strong>المعدل التراكمي</strong> (اختياري)</li>
                        <li><strong>سنة التخرج</strong> (اختياري)</li>
                        <li><strong>الرقم الامتحاني</strong> (اختياري)</li>
                        <li><strong>الرقم السري</strong> (اختياري)</li>
                        <li><strong>القسم</strong> (اختياري)</li>
                        <li><strong>الاسم المستخدم</strong> (اختياري)</li>
                        <li><strong>كلمة المرور</strong> (اختياري)</li>
                        <li><strong>المرحلة</strong> (اختياري - first/second/third/fourth)</li>
                        <li><strong>نوع الدراسة</strong> (اختياري - morning/evening)</li>
                        <li><strong>المرحلة الدراسية</strong> (اختياري - bachelor/master/phd/diploma)</li>
                        <li><strong>السنة الأكاديمية</strong> (اختياري - مثل: 2025-2026)</li>
                        <li><strong>الفصل الدراسي</strong> (اختياري - first/second)</li>
                      </ol>
                      <p className="mt-3 text-xs text-blue-600">
                        💡 يمكنك ترك الأعمدة الفارغة. الحقول الفارغة يمكن ملؤها لاحقاً يدوياً.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      اختر ملف Excel أو CSV
                    </label>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setExcelFile(file);
                        }
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    {excelFile && (
                      <p className="mt-2 text-sm text-gray-600">
                        ✅ الملف المحدد: <strong>{excelFile.name}</strong>
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">جدول بيانات الطلاب</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setBulkImportStudents([...bulkImportStudents, {
                            full_name: '',
                            nickname: '',
                            mother_name: '',
                            birth_date: '',
                            national_id: '',
                            phone: '',
                            school_name: '',
                            gpa: '',
                            graduation_year: '',
                            exam_number: '',
                            exam_password: '',
                            department: '',
                            username: '',
                            password: '',
                            stage: '',
                            study_type: '',
                            level: '',
                            academic_year: '',
                            semester: ''
                          }]);
                        }}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        + إضافة صف
                      </button>
                      <button
                        onClick={() => {
                          if (bulkImportStudents.length > 1) {
                            setBulkImportStudents(bulkImportStudents.slice(0, -1));
                          }
                        }}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                        disabled={bulkImportStudents.length <= 1}
                      >
                        - حذف صف
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-gray-300 rounded-lg">
                    <table 
                      className="min-w-full divide-y divide-gray-200 bg-white"
                      onPaste={(e) => {
                        e.preventDefault();
                        const pastedData = e.clipboardData.getData('text');
                        const rows = pastedData.split('\n').filter(row => row.trim());
                        
                        if (rows.length === 0) return;
                        
                        const newStudents = [...bulkImportStudents];
                        
                        rows.forEach((row, rowIndex) => {
                          const cells = row.split('\t').map(cell => cell.trim());
                          
                          if (rowIndex >= newStudents.length) {
                            newStudents.push({
                              full_name: '',
                              nickname: '',
                              mother_name: '',
                              birth_date: '',
                              national_id: '',
                              phone: '',
                              school_name: '',
                              gpa: '',
                              graduation_year: '',
                              exam_number: '',
                              exam_password: '',
                              department: '',
                              username: '',
                              password: '',
                              stage: '',
                              study_type: '',
                              level: '',
                              academic_year: '',
                              semester: ''
                            });
                          }
                          
                          if (cells[0]) newStudents[rowIndex].full_name = cells[0] || '';
                          if (cells[1]) newStudents[rowIndex].nickname = cells[1] || '';
                          if (cells[2]) newStudents[rowIndex].mother_name = cells[2] || '';
                          if (cells[3]) newStudents[rowIndex].birth_date = cells[3] || '';
                          if (cells[4]) newStudents[rowIndex].national_id = cells[4] || '';
                          if (cells[5]) newStudents[rowIndex].phone = cells[5] || '';
                          if (cells[6]) newStudents[rowIndex].school_name = cells[6] || '';
                          if (cells[7]) newStudents[rowIndex].gpa = cells[7] || '';
                          if (cells[8]) newStudents[rowIndex].graduation_year = cells[8] || '';
                          if (cells[9]) newStudents[rowIndex].exam_number = cells[9] || '';
                          if (cells[10]) newStudents[rowIndex].exam_password = cells[10] || '';
                          if (cells[11]) newStudents[rowIndex].department = cells[11] || '';
                          if (cells[12]) newStudents[rowIndex].username = cells[12] || '';
                          if (cells[13]) newStudents[rowIndex].password = cells[13] || '';
                          if (cells[14]) newStudents[rowIndex].stage = cells[14] || '';
                          if (cells[15]) newStudents[rowIndex].study_type = cells[15] || '';
                          if (cells[16]) newStudents[rowIndex].level = cells[16] || '';
                          if (cells[17]) newStudents[rowIndex].academic_year = cells[17] || '';
                          if (cells[18]) newStudents[rowIndex].semester = cells[18] || '';
                        });
                        
                        setBulkImportStudents(newStudents);
                      }}
                    >
                      <thead className="bg-purple-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 sticky right-0 bg-purple-50 z-20 min-w-[60px]">
                            #
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[180px]">
                            الاسم الرباعي *
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[120px]">
                            اللقب
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[150px]">
                            اسم الأم الثلاثي
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[120px]">
                            تاريخ الميلاد
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[130px]">
                            رقم الهوية
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[120px]">
                            رقم الهاتف
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[150px]">
                            اسم المدرسة
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[100px]">
                            المعدل
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[100px]">
                            سنة التخرج
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[110px]">
                            الرقم الامتحاني
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[100px]">
                            الرقم السري
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[130px]">
                            القسم
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[120px]">
                            الاسم المستخدم
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[120px]">
                            كلمة المرور
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[100px]">
                            المرحلة
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[110px]">
                            نوع الدراسة
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[130px]">
                            المرحلة الدراسية
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase border-l border-gray-300 min-w-[120px]">
                            السنة الأكاديمية
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700 uppercase min-w-[110px]">
                            الفصل الدراسي
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {bulkImportStudents.map((student, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm text-gray-600 border-l border-gray-200 sticky right-0 bg-white z-10 font-semibold">
                              {index + 1}
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.full_name}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].full_name = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                                placeholder="الاسم الرباعي"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.nickname}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].nickname = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                                placeholder="اللقب"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.mother_name}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].mother_name = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                                placeholder="اسم الأم"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="date"
                                value={student.birth_date}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].birth_date = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="ltr"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.national_id}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].national_id = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="1234567890"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.phone}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].phone = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="07501234567"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.school_name}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].school_name = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                                placeholder="اسم المدرسة"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="number"
                                step="0.01"
                                value={student.gpa}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].gpa = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="95.5"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.graduation_year}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].graduation_year = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="2020"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.exam_number}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].exam_number = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="123456"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.exam_password}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].exam_password = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="ABC123"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.department}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].department = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                                placeholder="القسم"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <input
                                type="text"
                                value={student.username}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].username = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="username"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={student.password}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].password = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono"
                                dir="ltr"
                                placeholder="password"
                              />
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <select
                                value={student.stage}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].stage = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                              >
                                <option value="">اختر المرحلة</option>
                                <option value="first">الأولى</option>
                                <option value="second">الثانية</option>
                                <option value="third">الثالثة</option>
                                <option value="fourth">الرابعة</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <select
                                value={student.study_type}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].study_type = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                              >
                                <option value="">اختر نوع الدراسة</option>
                                <option value="morning">صباحي</option>
                                <option value="evening">مسائي</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <select
                                value={student.level}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].level = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                              >
                                <option value="">اختر المرحلة الدراسية</option>
                                <option value="bachelor">بكالوريوس</option>
                                <option value="master">ماجستير</option>
                                <option value="phd">دكتوراه</option>
                                <option value="diploma">دبلوم</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <select
                                value={student.academic_year}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].academic_year = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="ltr"
                              >
                                <option value="">اختر السنة الأكاديمية</option>
                                <option value="2024-2025">2024-2025</option>
                                <option value="2025-2026">2025-2026</option>
                                <option value="2026-2027">2026-2027</option>
                                <option value="2027-2028">2027-2028</option>
                                <option value="2028-2029">2028-2029</option>
                              </select>
                            </td>
                            <td className="px-3 py-2 border-l border-gray-200">
                              <select
                                value={student.semester}
                                onChange={(e) => {
                                  const newStudents = [...bulkImportStudents];
                                  newStudents[index].semester = e.target.value;
                                  setBulkImportStudents(newStudents);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                dir="rtl"
                              >
                                <option value="">اختر الفصل الدراسي</option>
                                <option value="first">الأول</option>
                                <option value="second">الثاني</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-700">
                      📊 عدد الطلاب: <strong>{bulkImportStudents.length}</strong>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      💡 يمكنك نسخ البيانات من Excel ولصقها مباشرة في الجدول. الحقول الفارغة يمكن ملؤها لاحقاً يدوياً.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowBulkImportModal(false);
                  setBulkImportMode('table');
                  setBulkImportStudents([{
                    full_name: '',
                    nickname: '',
                    mother_name: '',
                    birth_date: '',
                    national_id: '',
                    phone: '',
                    school_name: '',
                    gpa: '',
                    graduation_year: '',
                    exam_number: '',
                    exam_password: '',
                    department: '',
                    username: '',
                    password: '',
                    stage: '',
                    study_type: '',
                    level: '',
                    academic_year: '',
                    semester: ''
                  }]);
                  setExcelFile(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                disabled={isImporting}
              >
                إلغاء
              </button>
              {bulkImportMode === 'file' ? (
                <button
                  onClick={async () => {
                    if (!excelFile) {
                      alert('يرجى اختيار ملف Excel أو CSV');
                      return;
                    }

                    setIsImporting(true);
                    try {
                      const formData = new FormData();
                      formData.append('file', excelFile);

                      const response = await fetch('/api/students/bulk-import-excel', {
                        method: 'POST',
                        body: formData,
                      });

                      const result = await response.json();

                      if (result.success) {
                        alert(`تم إضافة ${result.data.added} طالب بنجاح!${result.data.failed > 0 ? `\nفشل إضافة ${result.data.failed} طالب` : ''}`);
                        setShowBulkImportModal(false);
                        setExcelFile(null);
                        await fetchStudents();
                        await fetchDepartmentCounts();
                      } else {
                        alert('خطأ في الاستيراد: ' + (result.error || 'خطأ غير معروف'));
                      }
                    } catch (error) {
                      console.error('خطأ في الاستيراد من Excel:', error);
                      alert('حدث خطأ أثناء الاستيراد');
                    } finally {
                      setIsImporting(false);
                    }
                  }}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
                  disabled={isImporting || !excelFile}
                >
                  {isImporting ? 'جاري الاستيراد...' : 'استيراد من الملف'}
                </button>
              ) : (
                <button
                  onClick={async () => {
                    const validStudents = bulkImportStudents.filter(s => s.full_name.trim());
                    
                    if (validStudents.length === 0) {
                      alert('يرجى إدخال الأسماء الرباعية على الأقل');
                      return;
                    }

                    setIsImporting(true);
                    try {
                      const studentsData = validStudents.map((student) => {
                        const stageRaw = student.stage.trim().toLowerCase();
                        const stage = (stageRaw === 'first' || stageRaw === 'second' || stageRaw === 'third' || stageRaw === 'fourth') 
                          ? stageRaw : undefined;
                        
                        const studyTypeRaw = student.study_type.trim().toLowerCase();
                        const studyType = (studyTypeRaw === 'morning' || studyTypeRaw === 'evening') 
                          ? studyTypeRaw : undefined;
                        
                        const levelRaw = student.level.trim().toLowerCase();
                        const level = (levelRaw === 'bachelor' || levelRaw === 'master' || levelRaw === 'phd' || levelRaw === 'diploma') 
                          ? levelRaw : undefined;
                        
                        const semesterRaw = student.semester.trim().toLowerCase();
                        const semester = (semesterRaw === 'first' || semesterRaw === 'second') 
                          ? semesterRaw : undefined;

                        return {
                          full_name: student.full_name.trim(),
                          nickname: student.nickname.trim() || undefined,
                          mother_name: student.mother_name.trim() || undefined,
                          birth_date: student.birth_date.trim() || null,
                          national_id: student.national_id.trim() || null,
                          phone: student.phone.trim() ? `+964${student.phone.trim().replace(/^\+964/, '')}` : null,
                          secondary_school_name: student.school_name.trim() || undefined,
                          secondary_gpa: student.gpa.trim() ? parseFloat(student.gpa) : null,
                          secondary_graduation_year: student.graduation_year.trim() || undefined,
                          exam_number: student.exam_number.trim() || undefined,
                          exam_password: student.exam_password.trim() || undefined,
                          department: student.department.trim() || undefined,
                          username: student.username.trim() || undefined,
                          password: student.password.trim() || undefined,
                          stage,
                          study_type: studyType,
                          level,
                          academic_year: student.academic_year.trim() || undefined,
                          semester
                        };
                      });

                      console.log('📤 البيانات المرسلة للاستيراد من الجدول:', studentsData);
                      console.log('📊 عدد الطلاب:', studentsData.length);
                      console.log('📋 بيانات الطالب الأول:', studentsData[0]);
                      
                      const response = await fetch('/api/students/bulk-import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ students: studentsData }),
                      });

                      const result = await response.json();

                      if (result.success) {
                        alert(`تم إضافة ${result.data.added} طالب بنجاح!${result.data.failed > 0 ? `\nفشل إضافة ${result.data.failed} طالب` : ''}`);
                        setShowBulkImportModal(false);
                        setBulkImportStudents([{
                          full_name: '',
                          nickname: '',
                          mother_name: '',
                          birth_date: '',
                          national_id: '',
                          phone: '',
                          school_name: '',
                          gpa: '',
                          graduation_year: '',
                          exam_number: '',
                          exam_password: '',
                          department: '',
                          username: '',
                          password: '',
                          stage: '',
                          study_type: '',
                          level: '',
                          academic_year: '',
                          semester: ''
                        }]);
                        await fetchStudents();
                        await fetchDepartmentCounts();
                      } else {
                        alert('خطأ في الاستيراد: ' + (result.error || 'خطأ غير معروف'));
                      }
                    } catch (error) {
                      console.error('خطأ في الاستيراد الجماعي:', error);
                      alert('حدث خطأ أثناء الاستيراد');
                    } finally {
                      setIsImporting(false);
                    }
                  }}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
                  disabled={isImporting || bulkImportStudents.filter(s => s.full_name.trim()).length === 0}
                >
                  {isImporting ? 'جاري الاستيراد...' : 'استيراد الطلاب'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
