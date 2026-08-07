'use client';

import { useState, useEffect } from 'react';
import {
  buildApplicationPrintHtml,
  buildSnapshotFromFormData,
  type PrintMode,
} from '@/src/lib/student-application-print';

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
  preference1: string;
  preference2: string;
  preference3: string;
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

export type StudentFormMode = 'official' | 'new_application';

interface StudentFormModalProps {
  isOpen: boolean;
  editStudentId?: string | null;
  /** تعديل طلب تسجيل جديد (يشمل المستمسكات) */
  editRegistrationId?: string | null;
  mode?: StudentFormMode;
  onClose: () => void;
  onSuccess: () => void;
}

const initialFormData: StudentFormData = {
  personalData: {
    fullName: '',
    nickname: '',
    motherName: '',
    nationalId: '',
    birthDate: '',
    birthPlace: '',
    area: '',
    gender: 'male',
    religion: 'مسلم',
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
    examAttempt: '',
    examNumber: '',
    examPassword: '',
    branch: ''
  },
  universityAdmission: {
    admissionType: 'first',
    admissionChannel: '',
    department: '',
    preference1: '',
    preference2: '',
    preference3: '',
    studyType: '',
    level: 'bachelor',
    semester: '',
    academicYear: '2026-2027',
    specialRequirements: '',
    scholarship: false,
    scholarshipType: '',
    username: '',
    password: ''
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
};

function snapshotDocToFile(value: unknown): File | null {
  if (typeof value === 'string' && value.trim()) {
    return { name: value.trim(), type: 'image/jpeg', size: 0 } as File;
  }
  if (value === true) {
    return { name: 'مرفق', type: 'image/jpeg', size: 0 } as File;
  }
  return null;
}

function asOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export default function StudentFormModal({
  isOpen,
  editStudentId = null,
  editRegistrationId = null,
  mode = 'official',
  onClose,
  onSuccess,
}: StudentFormModalProps) {
  const isNewApplication = mode === 'new_application';
  const [currentStep, setCurrentStep] = useState(1);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<StudentFormData>(initialFormData);
  const [generatedStudentId, setGeneratedStudentId] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingRegistrationId, setEditingRegistrationId] = useState<string | null>(null);
  const [existingDocNames, setExistingDocNames] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [publicApplicationCode, setPublicApplicationCode] = useState('');
  const [publicApplicationUrl, setPublicApplicationUrl] = useState('');
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);

  const loadStudentForEdit = async (studentId: string) => {
    try {
      const response = await fetch(`/api/students/${studentId}`);
      const result = await response.json();

      if (result.success) {
        const student = result.data;

        const loadedFormData: StudentFormData = {
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
            preference1: '',
            preference2: '',
            preference3: '',
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

        setFormData(loadedFormData);
        setCurrentStep(1);
        setShowConfirmation(false);
        setShowReviewModal(false);
        setGeneratedStudentId(student.university_id);
        setEditingStudentId(studentId);
      } else {
        alert('خطأ في جلب بيانات الطالب للتعديل');
      }
    } catch (error) {
      console.error('خطأ في تعديل الطالب:', error);
      alert('خطأ في تعديل بيانات الطالب');
    }
  };

  const loadRegistrationForEdit = async (registrationId: string) => {
    try {
      const response = await fetch(`/api/new-registrations/${registrationId}`);
      const result = await response.json();
      if (!result.success || !result.data) {
        alert(result.error || 'خطأ في جلب طلب التسجيل للتعديل');
        return;
      }
      const row = result.data;
      if (row.status === 'confirmed') {
        alert('لا يمكن تعديل طلب مثبت');
        return;
      }
      const payload = row.payload || {};
      const p = payload.personalData || {};
      const se = payload.secondaryEducation || {};
      const u = payload.universityAdmission || {};
      const docs = payload.documents || {};
      const prefs = payload.departmentPreferences || {
        first: row.preference_1 || '',
        second: row.preference_2 || '',
        third: row.preference_3 || '',
      };

      const docNames: Record<string, string> = {};
      for (const [key, val] of Object.entries(docs)) {
        if (typeof val === 'string' && val.trim()) docNames[key] = val.trim();
      }

      const phoneRaw = String(p.phone || row.phone || '');
      const phoneDigits = phoneRaw.replace(/\D/g, '');
      const phone10 =
        phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;

      setFormData({
        personalData: {
          fullName: String(p.fullName || row.full_name || ''),
          nickname: String(p.nickname || ''),
          motherName: String(p.motherName || ''),
          nationalId: String(p.nationalId || row.national_id || ''),
          birthDate: String(p.birthDate || ''),
          birthPlace: String(p.birthPlace || ''),
          area: String(p.area || ''),
          gender: asOneOf(p.gender, ['male', 'female'] as const, 'male'),
          religion: asOneOf(
            p.religion,
            ['مسلم', 'مسيحي', 'الصابئة', 'اليزيدية', 'غير ذلك'] as const,
            'مسلم'
          ),
          maritalStatus: asOneOf(
            p.maritalStatus,
            ['single', 'married', 'divorced', 'widowed'] as const,
            'single'
          ),
          phone: phone10,
          email: String(p.email || ''),
          address: '',
          emergencyContact: { name: '', relationship: '', phone: '' },
        },
        secondaryEducation: {
          schoolName: String(se.schoolName || ''),
          schoolType: asOneOf(
            se.schoolType,
            ['', 'public', 'private', 'international'] as const,
            ''
          ),
          graduationYear: String(se.graduationYear || ''),
          gpa: String(se.gpa || ''),
          totalScore: String(se.totalScore || ''),
          examAttempt: asOneOf(
            se.examAttempt,
            ['', 'first', 'second', 'third'] as const,
            ''
          ),
          examNumber: String(se.examNumber || ''),
          examPassword: String(se.examPassword || ''),
          branch: String(se.branch || ''),
        },
        universityAdmission: {
          admissionType: asOneOf(
            u.admissionType,
            ['', 'first', 'second', 'third', 'fourth'] as const,
            'first'
          ),
          admissionChannel: asOneOf(
            u.admissionChannel,
            [
              '',
              'general',
              'martyrs',
              'social_care',
              'special_needs',
              'political_prisoners',
              'siblings_married',
              'minister_directive',
              'dean_approval',
              'faculty_children',
              'top_students',
              'health_ministry',
            ] as const,
            ''
          ),
          department: '',
          preference1: String(prefs.first || ''),
          preference2: String(prefs.second || ''),
          preference3: String(prefs.third || ''),
          studyType: asOneOf(
            u.studyType || row.study_type,
            ['', 'morning', 'evening'] as const,
            ''
          ),
          level: asOneOf(
            u.level,
            ['', 'bachelor', 'master', 'phd', 'diploma'] as const,
            'bachelor'
          ),
          semester: asOneOf(u.semester, ['', 'first', 'second'] as const, 'first'),
          academicYear: asOneOf(
            u.academicYear || row.academic_year,
            ['', '2024-2025', '2025-2026', '2026-2027', '2027-2028', '2028-2029'] as const,
            '2026-2027'
          ),
          specialRequirements: '',
          scholarship: false,
          scholarshipType: '',
          username: '',
          password: '',
        },
        documents: {
          nationalIdFront: snapshotDocToFile(docs.nationalIdFront),
          nationalIdBack: snapshotDocToFile(docs.nationalIdBack),
          residenceCardFront: snapshotDocToFile(docs.residenceCardFront),
          residenceCardBack: snapshotDocToFile(docs.residenceCardBack),
          secondaryCertificate: snapshotDocToFile(docs.secondaryCertificate),
          personalPhoto: snapshotDocToFile(docs.personalPhoto),
          medicalExamination: snapshotDocToFile(docs.medicalExamination),
        },
      });
      setExistingDocNames(docNames);
      setEditingRegistrationId(registrationId);
      setEditingStudentId(null);
      setGeneratedStudentId(row.code || '');
      setPublicApplicationCode(row.code || '');
      setPublicApplicationUrl(row.code ? `/public/application/${row.code}` : '');
      setCurrentStep(1);
      setShowConfirmation(false);
      setShowReviewModal(false);
    } catch (error) {
      console.error('خطأ في تعديل طلب التسجيل:', error);
      alert('خطأ في جلب طلب التسجيل للتعديل');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setCurrentStep(1);
    setShowConfirmation(false);
    setShowReviewModal(false);
    setValidationErrors({});
    setPublicApplicationCode('');
    setPublicApplicationUrl('');

    if (editRegistrationId && isNewApplication) {
      void loadRegistrationForEdit(editRegistrationId);
    } else if (editStudentId) {
      setEditingRegistrationId(null);
      setExistingDocNames({});
      void loadStudentForEdit(editStudentId);
    } else {
      setFormData(initialFormData);
      setGeneratedStudentId('');
      setEditingStudentId(null);
      setEditingRegistrationId(null);
      setExistingDocNames({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editStudentId, editRegistrationId, mode]);

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

      return newFormData;
    });
  };

  // دالة خاصة للتعامل مع القوائم المنسدلة - تحديث فوري عند التغيير
  const handleSelectChange = (section: keyof StudentFormData, field: string, value: string) => {

    // تحديث مباشر - لا حاجة للانتظار
    handleInputChange(section, field, value);
  };

  // دالة للتعامل مع حدث Input - تحديث عند أي تغيير (بما في ذلك الكيبورد)
  const handleSelectInput = (section: keyof StudentFormData, field: string, e: React.FormEvent<HTMLSelectElement>) => {
    const value = (e.target as HTMLSelectElement).value;

    handleInputChange(section, field, value);
  };

  // دالة للتعامل مع فقدان التركيز (Blur) - تحديث إضافي للتأكد
  const handleSelectBlur = (section: keyof StudentFormData, field: string, e: React.FocusEvent<HTMLSelectElement>) => {
    const value = e.target.value;

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

        handleInputChange(section, field, value);
      }, 10);
    }
  };

  // دالة للتعامل مع تغيير القيمة باستخدام الماوس أو الكيبورد
  const handleSelectValueChange = (section: keyof StudentFormData, field: string, value: string) => {

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
      { value: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', label: 'قسم هندسة تقنيات الامن السيبراني والحوسبة السحابية' },
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
    setPublicApplicationCode('');
    setPublicApplicationUrl('');
    setShowReviewModal(true);
  };

  const getDepartmentPreferences = () => ({
    first: formData.universityAdmission.preference1,
    second: formData.universityAdmission.preference2,
    third: formData.universityAdmission.preference3,
  });

  const ensurePublicApplication = async (): Promise<{ code: string; url: string } | null> => {
    if (publicApplicationCode && publicApplicationUrl) {
      return { code: publicApplicationCode, url: publicApplicationUrl };
    }
    try {
      setIsPreparingPrint(true);
      const prefs = isNewApplication ? getDepartmentPreferences() : undefined;
      const payload = buildSnapshotFromFormData(formData, {
        departmentPreferences: prefs?.first ? prefs : undefined,
      });
      const res = await fetch('/api/public/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json();
      if (!data.success || !data.code || !data.url) {
        alert(data.error || 'تعذر تجهيز رابط الاستمارة للطباعة');
        return null;
      }
      setPublicApplicationCode(data.code);
      setPublicApplicationUrl(data.url);
      return { code: data.code as string, url: data.url as string };
    } catch (err) {
      console.error(err);
      alert('تعذر الاتصال بالخادم لتجهيز الطباعة');
      return null;
    } finally {
      setIsPreparingPrint(false);
    }
  };

  const printHtmlDocument = (html: string, targetWindow: Window | null) => {
    // طباعة عبر نافذة مفتوحة مسبقاً (بدون noopener حتى نستطيع الكتابة فيها)
    if (targetWindow && !targetWindow.closed) {
      targetWindow.document.open();
      targetWindow.document.write(html);
      targetWindow.document.close();
      return;
    }

    // بديل موثوق بدون نوافذ منبثقة: iframe مخفي
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'طباعة الاستمارة');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe);
      alert('تعذر بدء الطباعة');
      return;
    }
    // تعطيل autoPrint داخل HTML لأننا نستدعي print يدوياً بعد التحميل
    const htmlNoAuto = html.replace(/window\.onload\s*=\s*function\s*\(\)\s*\{[\s\S]*?\};\s*/m, '');
    doc.open();
    doc.write(htmlNoAuto);
    doc.close();

    const triggerPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1500);
      }
    };

    // انتظار بسيط لتحميل صور الباركود/QR
    setTimeout(triggerPrint, 700);
  };

  const openApplicationPrint = async (modePrint: PrintMode) => {
    // فتح النافذة فوراً ضمن حدث الضغط حتى لا يحظرها المتصفح بعد await
    const printWindow = window.open('about:blank', '_blank');
    if (printWindow) {
      try {
        printWindow.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تجهيز الطباعة</title></head><body style="font-family:Tahoma,sans-serif;padding:24px;color:#334155">جاري تجهيز الاستمارة للطباعة...</body></html>`);
        printWindow.document.close();
      } catch {
        // تجاهل
      }
    }

    const pub = await ensurePublicApplication();
    if (!pub) {
      try {
        printWindow?.close();
      } catch {
        // تجاهل
      }
      return;
    }

    const prefs = isNewApplication ? getDepartmentPreferences() : undefined;
    const snapshot = buildSnapshotFromFormData(formData, {
      departmentPreferences: prefs?.first ? prefs : undefined,
    });
    const html = buildApplicationPrintHtml({
      snapshot,
      code: pub.code,
      publicUrl: pub.url,
      mode: modePrint,
      autoPrint: Boolean(printWindow),
    });

    printHtmlDocument(html, printWindow);
    // الإبقاء على فورم المراجعة مفتوحاً عمداً
  };

  const uploadRegistrationDocuments = async (): Promise<Record<string, string | boolean>> => {
    const keys = [
      'nationalIdFront',
      'nationalIdBack',
      'residenceCardFront',
      'residenceCardBack',
      'secondaryCertificate',
      'personalPhoto',
      'medicalExamination',
    ] as const;

    const result: Record<string, string | boolean> = {};

    for (const key of keys) {
      const file = formData.documents[key];
      if (file && file.size > 0) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        const uploadResult = await uploadResponse.json();
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || `فشل رفع المستمسك: ${key}`);
        }
        result[key] = uploadResult.filename as string;
      } else if (existingDocNames[key]) {
        result[key] = existingDocNames[key];
      } else if (file && file.name && file.size === 0 && file.name !== 'مرفق') {
        result[key] = file.name;
      } else {
        result[key] = Boolean(file);
      }
    }

    return result;
  };

  const saveNewApplication = async () => {
    const prefs = getDepartmentPreferences();
    if (!prefs.first || !prefs.second || !prefs.third) {
      alert('يجب اختيار ثلاث رغبات أقسام');
      return false;
    }
    if (new Set([prefs.first, prefs.second, prefs.third]).size < 3) {
      alert('يجب أن تكون الرغبات الثلاث أقساماً مختلفة');
      return false;
    }
    if (!formData.personalData.phone || formData.personalData.phone.length !== 10) {
      alert('⚠️ رقم الهاتف يجب أن يتكون من 10 أرقام بالضبط');
      return false;
    }

    try {
      setIsSaving(true);
      const documentNames = await uploadRegistrationDocuments();
      const payload = buildSnapshotFromFormData(formData, {
        departmentPreferences: prefs,
        documentNames,
      });

      const isEdit = Boolean(editingRegistrationId);
      const res = await fetch(
        isEdit ? `/api/new-registrations/${editingRegistrationId}` : '/api/new-registrations',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, preferences: prefs }),
        }
      );
      const result = await res.json();
      if (!result.success) {
        alert(result.error || (isEdit ? 'تعذر تحديث طلب التسجيل' : 'تعذر حفظ طلب التسجيل'));
        return false;
      }

      setShowReviewModal(false);
      onClose();
      setCurrentStep(1);
      setFormData(initialFormData);
      setEditingRegistrationId(null);
      setExistingDocNames({});
      onSuccess();
      alert(
        isEdit
          ? 'تم تحديث طلب التسجيل بنجاح (بما يشمل المستمسكات)'
          : `تم حفظ طلب التسجيل الجديد بنجاح\nرمز الطلب: ${result.data?.code || ''}`
      );
      return true;
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'تعذر الاتصال بالخادم');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickUpdate = async () => {
    try {
      setIsSaving(true);
      const result = await confirmSave();
      // إذا كان confirmSave رجع false (خطأ تحقق)، لا نكمل
      if (result === false) {
        return;
      }
      onSuccess();
      alert('تم تحديث بيانات الطالب بنجاح! 🎉');
    } catch (error) {
      console.error('خطأ في تحديث الطالب:', error);
      alert('حدث خطأ في تحديث بيانات الطالب: ' + (error instanceof Error ? error.message : 'خطأ غير معروف'));
    } finally {
      setIsSaving(false);
    }
  };

  const confirmSave = async () => {
    if (isNewApplication) {
      return saveNewApplication();
    }
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

        const uploadFormData = new FormData();
        uploadFormData.append('file', formData.documents.personalPhoto);
        
        const uploadResponse = await fetch('/api/students/upload', {
          method: 'POST',
          body: uploadFormData,
        });
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          photoFilename = uploadResult.filename;

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

        } else {
          console.error('❌ فشل رفع الفحص الطبي:', uploadResult.error);
        }
      }
      
      // تحضير البيانات للحفظ

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

          // إرجاع القيمة مع حد أقصى 100 (الحفاظ على الكسور العشرية)
          const finalValue = isNaN(gpaValue) ? 0 : Math.min(gpaValue, 100);

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





      const url = editingStudentId ? `/api/students/${editingStudentId}` : '/api/students';
      const method = editingStudentId ? 'PUT' : 'POST';


      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(studentDataWithoutFiles),
      });

      const result = await response.json();

      if (result.success) {
        // إغلاق واجهة المراجعة
        setShowReviewModal(false);
        
        // إغلاق فورم إضافة الطالب
        onClose();
        setCurrentStep(1);
        setShowConfirmation(false);
        setGeneratedStudentId('');
        
        // إعادة جلب قائمة الطلاب وعدد الطلاب للأقسام
        onSuccess();
        
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
        onClose();
        setCurrentStep(1);
        setShowConfirmation(false);
        setGeneratedStudentId('');
        
        onSuccess();
        
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
    onClose();
    setCurrentStep(1);
    setShowConfirmation(false);
    setGeneratedStudentId('');
  };

  const closeModal = () => {
    setCurrentStep(1);
    setShowConfirmation(false);
    setShowReviewModal(false);
    setGeneratedStudentId('');
    setEditingStudentId(null);
    setEditingRegistrationId(null);
    setExistingDocNames({});
    setFormData(initialFormData);
    setValidationErrors({});
    onClose();
  };

  if (!isOpen) return null;

  const stepLabels = [
    { id: 1, title: 'البيانات الشخصية' },
    { id: 2, title: 'الدراسة الإعدادية' },
    { id: 3, title: 'القبول الجامعي' },
    { id: 4, title: 'المستمسكات' },
  ] as const;

  return (
    <>
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-3 sm:p-4 backdrop-blur-[1px]">
          <div
            className="flex w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl"
            style={{ height: 'min(620px, 86vh)' }}
          >
            {/* Header — طابع رسمي ثابت */}
            <div className="shrink-0 border-b border-slate-300 bg-slate-50">
              <div className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium tracking-wide text-slate-500">
                    شؤون الطلبة · تسجيل أكاديمي
                  </p>
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {editingStudentId
                      ? 'تعديل بيانات الطالب'
                      : editingRegistrationId
                        ? 'تعديل طلب التسجيل'
                        : isNewApplication
                          ? 'تسجيل طالب جديد'
                          : 'تسجيل رسمي · إضافة طالب'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  aria-label="إغلاق"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* شريط المراحل — عرض ثابت لا يغيّر ارتفاع المودال */}
              <div className="grid grid-cols-4 border-t border-slate-200 bg-white">
                {stepLabels.map((step) => {
                  const active = currentStep === step.id;
                  const done = currentStep > step.id;
                  return (
                    <div
                      key={step.id}
                      className={`flex items-center justify-center gap-2 border-l border-slate-200 px-2 py-2.5 first:border-l-0 ${
                        active
                          ? 'bg-slate-800 text-white'
                          : done
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-white text-slate-400'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-bold ${
                          active
                            ? 'bg-white text-slate-800'
                            : done
                              ? 'bg-slate-700 text-white'
                              : 'border border-slate-300 text-slate-400'
                        }`}
                      >
                        {step.id}
                      </span>
                      <span className="hidden truncate text-xs font-medium sm:inline">
                        {step.title}
                      </span>
                    </div>
                  );
                })}
              </div>

              {editingStudentId && (
                <div className="border-t border-slate-200 bg-amber-50 px-5 py-1.5 text-center text-[11px] text-amber-900">
                  يمكن تحديث البيانات من أي مرحلة عبر زر «تحديث»
                </div>
              )}
            </div>

            {/* Content — مساحة ثابتة لكل المراحل */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4">
              {currentStep === 1 && (
                <div className="space-y-3">
                  <div className="border-b border-slate-200 pb-2 mb-1">
                    <h3 className="text-sm font-semibold text-slate-800">البيانات الشخصية</h3>
                    <p className="text-xs text-slate-500 mt-0.5">المعلومات الأساسية للطالب وجهة الاتصال</p>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الاسم الرباعي *
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.fullName}
                        onChange={(e) => handleInputChange('personalData', 'fullName', e.target.value)}
                        className={`h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 ${
                          validationErrors['personalData.fullName'] ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="مثال: أحمد محمد عبدالله السعد"
                        required
                      />
                      {validationErrors['personalData.fullName'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.fullName']}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        اللقب
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.nickname}
                        onChange={(e) => handleInputChange('personalData', 'nickname', e.target.value)}
                        className={`h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 ${
                          validationErrors['personalData.nickname'] ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="مثال: أبو محمد"
                      />
                      {validationErrors['personalData.nickname'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.nickname']}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        اسم الأم الثلاثي *
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.motherName}
                        onChange={(e) => handleInputChange('personalData', 'motherName', e.target.value)}
                        className={`h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 ${
                          validationErrors['personalData.motherName'] ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="مثال: فاطمة أحمد محمد"
                        required
                      />
                      {validationErrors['personalData.motherName'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.motherName']}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        رقم الهوية الوطنية *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formData.personalData.nationalId}
                        onChange={(e) => handleInputChange('personalData', 'nationalId', e.target.value)}
                        className={`h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 ${
                          validationErrors['personalData.nationalId'] ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="أدخل رقم الهوية (أرقام فقط)"
                        required
                      />
                      {validationErrors['personalData.nationalId'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.nationalId']}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        تاريخ الميلاد *
                      </label>
                      <input
                        type="date"
                        value={formData.personalData.birthDate}
                        onChange={(e) => handleInputChange('personalData', 'birthDate', e.target.value)}
                        onKeyDown={(e) => e.preventDefault()}
                        onPaste={(e) => e.preventDefault()}
                        onDrop={(e) => e.preventDefault()}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        المحافظة *
                      </label>
                      <select
                        value={formData.personalData.birthPlace}
                        onChange={(e) => handleSelectChange('personalData', 'birthPlace', e.target.value)}
                        onBlur={(e) => handleSelectBlur('personalData', 'birthPlace', e)}
                        onKeyDown={(e) => handleSelectKeyDown('personalData', 'birthPlace', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        المنطقة
                      </label>
                      <input
                        type="text"
                        value={formData.personalData.area}
                        onChange={(e) => handleInputChange('personalData', 'area', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="أدخل المنطقة"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الجنس *
                      </label>
                      <select
                        value={formData.personalData.gender}
                        onChange={(e) => handleSelectChange('personalData', 'gender', e.target.value)}
                        onBlur={(e) => handleSelectBlur('personalData', 'gender', e)}
                        onKeyDown={(e) => handleSelectKeyDown('personalData', 'gender', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      >
                        <option value="male">ذكر</option>
                        <option value="female">أنثى</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الديانة
                      </label>
                      <select
                        value={formData.personalData.religion}
                        onChange={(e) => handleSelectChange('personalData', 'religion', e.target.value)}
                        onInput={(e) => handleSelectInput('personalData', 'religion', e)}
                        onBlur={(e) => handleSelectBlur('personalData', 'religion', e)}
                        onKeyDown={(e) => handleSelectKeyDown('personalData', 'religion', e)}
                        onKeyUp={(e) => {
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.personalData.religion) {
                            handleSelectValueChange('personalData', 'religion', value);
                          }
                        }}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الحالة الاجتماعية
                      </label>
                      <select
                        value={formData.personalData.maritalStatus}
                        onChange={(e) => handleSelectChange('personalData', 'maritalStatus', e.target.value)}
                        onInput={(e) => handleSelectInput('personalData', 'maritalStatus', e)}
                        onBlur={(e) => handleSelectBlur('personalData', 'maritalStatus', e)}
                        onKeyDown={(e) => handleSelectKeyDown('personalData', 'maritalStatus', e)}
                        onKeyUp={(e) => {
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.personalData.maritalStatus) {
                            handleSelectValueChange('personalData', 'maritalStatus', value);
                          }
                        }}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      >
                        <option value="single">أعزب</option>
                        <option value="married">متزوج</option>
                        <option value="divorced">مطلق</option>
                        <option value="widowed">أرمل</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        رقم الهاتف العراقي *
                      </label>
                      <div
                        className={`flex h-9 overflow-hidden rounded-md border bg-white focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-500 ${
                          validationErrors['personalData.phone'] ? 'border-red-500' : 'border-slate-300'
                        }`}
                      >
                        <span className="flex shrink-0 items-center border-l border-slate-300 bg-slate-50 px-2.5 text-xs font-medium text-slate-600">
                          +964
                        </span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={formData.personalData.phone}
                          onChange={(e) => handleInputChange('personalData', 'phone', e.target.value)}
                          className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-slate-800 focus:outline-none focus:ring-0"
                          placeholder="7XXXXXXXXX"
                          required
                        />
                      </div>
                      {validationErrors['personalData.phone'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.phone']}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        البريد الإلكتروني
                      </label>
                      <input
                        type="email"
                        value={formData.personalData.email}
                        onChange={(e) => handleInputChange('personalData', 'email', e.target.value)}
                        className={`h-9 w-full rounded-md border bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 ${
                          validationErrors['personalData.email'] ? 'border-red-500' : 'border-slate-300'
                        }`}
                        placeholder="example@email.com"
                      />
                      {validationErrors['personalData.email'] && (
                        <p className="mt-1 text-xs text-red-600">{validationErrors['personalData.email']}</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <h4 className="mb-2 text-xs font-semibold text-slate-800">جهة الاتصال في حالات الطوارئ</h4>
                    <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          الاسم *
                        </label>
                        <input
                          type="text"
                          value={formData.personalData.emergencyContact.name}
                          onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          صلة القرابة *
                        </label>
                        <input
                          type="text"
                          value={formData.personalData.emergencyContact.relationship}
                          onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          رقم الهاتف العراقي *
                        </label>
                        <div className="flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-500">
                          <span className="flex shrink-0 items-center border-l border-slate-300 bg-slate-50 px-2.5 text-xs font-medium text-slate-600">
                            +964
                          </span>
                          <input
                            type="tel"
                            value={formData.personalData.emergencyContact.phone}
                            onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-slate-800 focus:outline-none focus:ring-0"
                            placeholder="7XXXXXXXXX"
                            pattern="[0-9]{10}"
                            maxLength={10}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-3">
                  <div className="border-b border-slate-200 pb-2 mb-1">
                    <h3 className="text-sm font-semibold text-slate-800">الدراسة الإعدادية</h3>
                    <p className="text-xs text-slate-500 mt-0.5">بيانات الشهادة الإعدادية والامتحان</p>
                  </div>

                  <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        اسم المدرسة *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.schoolName}
                        onChange={(e) => handleInputChange('secondaryEducation', 'schoolName', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        نوع المدرسة *
                      </label>
                      <select
                        value={formData.secondaryEducation.schoolType}
                        onChange={(e) => handleSelectChange('secondaryEducation', 'schoolType', e.target.value)}
                        onInput={(e) => handleSelectInput('secondaryEducation', 'schoolType', e)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'schoolType', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'schoolType', e)}
                        onKeyUp={(e) => {
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.secondaryEducation.schoolType) {
                            handleSelectValueChange('secondaryEducation', 'schoolType', value);
                          }
                        }}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      >
                        <option value="">اختر نوع المدرسة</option>
                        <option value="public">حكومية</option>
                        <option value="private">أهلية</option>
                        <option value="international">دولية</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        سنة التخرج *
                      </label>
                      <select
                        value={formData.secondaryEducation.graduationYear}
                        onChange={(e) => handleSelectChange('secondaryEducation', 'graduationYear', e.target.value)}
                        onInput={(e) => handleSelectInput('secondaryEducation', 'graduationYear', e)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'graduationYear', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'graduationYear', e)}
                        onKeyUp={(e) => {
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.secondaryEducation.graduationYear) {
                            handleSelectValueChange('secondaryEducation', 'graduationYear', value);
                          }
                        }}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      >
                        <option value="">اختر سنة التخرج</option>
                        {Array.from({ length: 28 }, (_, i) => {
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

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
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
                          if (value === '' || /^\d*\.?\d*$/.test(value)) {
                            handleInputChange('secondaryEducation', 'gpa', value);
                          }
                        }}
                        onBlur={(e) => {
                          const value = e.target.value;
                          if (value && !isNaN(parseFloat(value))) {
                            const numValue = parseFloat(value);
                            if (numValue > 100) {
                              handleInputChange('secondaryEducation', 'gpa', '100');
                            } else if (numValue < 0) {
                              handleInputChange('secondaryEducation', 'gpa', '0');
                            } else {
                              handleInputChange('secondaryEducation', 'gpa', numValue.toString());
                            }
                          }
                        }}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="مثال: 85.5"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        إجمالي الدرجات *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.totalScore}
                        onChange={(e) => handleInputChange('secondaryEducation', 'totalScore', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الدور *
                      </label>
                      <select
                        value={formData.secondaryEducation.examAttempt}
                        onChange={(e) => handleSelectChange('secondaryEducation', 'examAttempt', e.target.value)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'examAttempt', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'examAttempt', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      >
                        <option value="">اختر الدور</option>
                        <option value="first">الأول</option>
                        <option value="second">الثاني</option>
                        <option value="third">الثالث</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الرقم الامتحاني *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.examNumber}
                        onChange={(e) => handleInputChange('secondaryEducation', 'examNumber', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="مثال: 123456789"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الرقم السري *
                      </label>
                      <input
                        type="text"
                        value={formData.secondaryEducation.examPassword}
                        onChange={(e) => handleInputChange('secondaryEducation', 'examPassword', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="أدخل الرقم السري"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الفرع *
                      </label>
                      <select
                        value={formData.secondaryEducation.branch}
                        onChange={(e) => handleSelectChange('secondaryEducation', 'branch', e.target.value)}
                        onBlur={(e) => handleSelectBlur('secondaryEducation', 'branch', e)}
                        onKeyDown={(e) => handleSelectKeyDown('secondaryEducation', 'branch', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                <div className="space-y-3">
                  <div className="border-b border-slate-200 pb-2 mb-1">
                    <h3 className="text-sm font-semibold text-slate-800">القبول الجامعي</h3>
                    <p className="text-xs text-slate-500 mt-0.5">القسم والمرحلة ونوع الدراسة</p>
                  </div>

                  <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        المرحلة *
                      </label>
                      <select
                        value={formData.universityAdmission.admissionType}
                        onChange={(e) => handleSelectChange('universityAdmission', 'admissionType', e.target.value)}
                        onInput={(e) => handleSelectInput('universityAdmission', 'admissionType', e)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'admissionType', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'admissionType', e)}
                        onKeyUp={(e) => {
                          const value = (e.target as HTMLSelectElement).value;
                          if (value !== formData.universityAdmission.admissionType) {
                            handleSelectValueChange('universityAdmission', 'admissionType', value);
                          }
                        }}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        قناة القبول *
                      </label>
                      <select
                        value={formData.universityAdmission.admissionChannel}
                        onChange={(e) => handleSelectChange('universityAdmission', 'admissionChannel', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'admissionChannel', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'admissionChannel', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الفصل الدراسي *
                      </label>
                      <select
                        value={formData.universityAdmission.semester}
                        onChange={(e) => handleSelectChange('universityAdmission', 'semester', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'semester', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'semester', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      >
                        <option value="">اختر الفصل الدراسي</option>
                        <option value="first">الأول</option>
                        <option value="second">الثاني</option>
                      </select>
                    </div>

                    <div className={isNewApplication ? 'md:col-span-3' : ''}>
                      {isNewApplication ? (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          {(
                            [
                              { key: 'preference1', label: 'الرغبة الأولى (القسم) *' },
                              { key: 'preference2', label: 'الرغبة الثانية (القسم) *' },
                              { key: 'preference3', label: 'الرغبة الثالثة (القسم) *' },
                            ] as const
                          ).map((item) => (
                            <div key={item.key}>
                              <label className="mb-1 block text-xs font-semibold text-slate-600">
                                {item.label}
                              </label>
                              <select
                                value={formData.universityAdmission[item.key]}
                                onChange={(e) =>
                                  handleSelectChange('universityAdmission', item.key, e.target.value)
                                }
                                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                                required
                              >
                                <option value="">اختر القسم</option>
                                {getAvailableDepartments(formData.secondaryEducation.branch).map((dept) => (
                                  <option
                                    key={`${item.key}-${dept.value}`}
                                    value={dept.value}
                                    disabled={
                                      [
                                        formData.universityAdmission.preference1,
                                        formData.universityAdmission.preference2,
                                        formData.universityAdmission.preference3,
                                      ].includes(dept.value) &&
                                      formData.universityAdmission[item.key] !== dept.value
                                    }
                                  >
                                    {dept.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">
                            القسم *
                          </label>
                          <select
                            value={formData.universityAdmission.department}
                            onChange={(e) => handleSelectChange('universityAdmission', 'department', e.target.value)}
                            onBlur={(e) => handleSelectBlur('universityAdmission', 'department', e)}
                            onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'department', e)}
                            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                            required
                          >
                            <option value="">اختر القسم</option>
                            {getAvailableDepartments(formData.secondaryEducation.branch).map((dept) => (
                              <option key={dept.value} value={dept.value}>
                                {dept.label}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        نوع الدراسة *
                      </label>
                      <select
                        value={formData.universityAdmission.studyType}
                        onChange={(e) => handleSelectChange('universityAdmission', 'studyType', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'studyType', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'studyType', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      >
                        <option value="">اختر نوع الدراسة</option>
                        <option value="morning">صباحي</option>
                        <option value="evening">مسائي</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        المرحلة الدراسية *
                      </label>
                      <select
                        value={formData.universityAdmission.level}
                        onChange={(e) => handleSelectChange('universityAdmission', 'level', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'level', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'level', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        السنة الأكاديمية *
                      </label>
                      <select
                        value={formData.universityAdmission.academicYear}
                        onChange={(e) => handleSelectChange('universityAdmission', 'academicYear', e.target.value)}
                        onBlur={(e) => handleSelectBlur('universityAdmission', 'academicYear', e)}
                        onKeyDown={(e) => handleSelectKeyDown('universityAdmission', 'academicYear', e)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الاسم المستخدم
                      </label>
                      <input
                        type="text"
                        value={formData.universityAdmission.username || ''}
                        onChange={(e) => handleInputChange('universityAdmission', 'username', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="أدخل الاسم المستخدم"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        كلمة المرور
                      </label>
                      <input
                        type="text"
                        value={formData.universityAdmission.password || ''}
                        onChange={(e) => handleInputChange('universityAdmission', 'password', e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        placeholder="أدخل كلمة المرور"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        متطلبات خاصة
                      </label>
                      <textarea
                        value={formData.universityAdmission.specialRequirements}
                        onChange={(e) => handleInputChange('universityAdmission', 'specialRequirements', e.target.value)}
                        rows={2}
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 4 && (
                <div className="space-y-3">
                  <div className="border-b border-slate-200 pb-2 mb-1">
                    <h3 className="text-sm font-semibold text-slate-800">المستمسكات والوثائق</h3>
                    <p className="text-xs text-slate-500 mt-0.5">رفع المستمسكات المطلوبة بصيغة صورة أو PDF</p>
                  </div>

                  <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-800">ضوابط رفع الملفات</p>
                    <ul className="mt-1 grid grid-cols-1 gap-0.5 text-[11px] leading-relaxed text-slate-600 sm:grid-cols-2">
                      <li>• الصيغ المقبولة: JPG, PNG, GIF, WEBP, PDF</li>
                      <li>• الحد الأقصى لحجم الملف: 5 ميجابايت</li>
                      <li>• يجب أن تكون الصور واضحة ومقروءة</li>
                      <li>• الصورة الشخصية حديثة وبخلفية بيضاء</li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 md:grid-cols-2">
                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        البطاقة الوطنية / الجنسية — الوجه الأول *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('nationalIdFront', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.nationalIdFront ? `ملف: ${formData.documents.nationalIdFront.name}` : ''}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        البطاقة الوطنية / الجنسية — الوجه الثاني *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('nationalIdBack', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.nationalIdBack ? `ملف: ${formData.documents.nationalIdBack.name}` : ''}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        بطاقة السكن — الوجه الأول *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('residenceCardFront', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.residenceCardFront ? `ملف: ${formData.documents.residenceCardFront.name}` : ''}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        بطاقة السكن — الوجه الثاني *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('residenceCardBack', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.residenceCardBack ? `ملف: ${formData.documents.residenceCardBack.name}` : ''}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        وثيقة الإعدادية *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('secondaryCertificate', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.secondaryCertificate ? `ملف: ${formData.documents.secondaryCertificate.name}` : ''}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-2.5">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        صورة شخصية (خلفية بيضاء) *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('personalPhoto', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.personalPhoto ? `ملف: ${formData.documents.personalPhoto.name}` : ''}
                      </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-white p-2.5 md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        الفحص الطبي *
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileChange('medicalExamination', e.target.files?.[0] || null)}
                        className="block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 file:ml-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium file:text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        required
                      />
                      <p className="mt-1 min-h-[16px] truncate text-[11px] text-emerald-700">
                        {formData.documents.medicalExamination ? `ملف: ${formData.documents.medicalExamination.name}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-300 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={prevStep}
                disabled={currentStep === 1}
                className={`inline-flex min-w-[88px] items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                  currentStep === 1
                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                السابق
              </button>

              <p className="hidden text-xs text-slate-500 sm:block">
                المرحلة {currentStep} من 4
              </p>

              <div className="flex items-center gap-2">
                {editingStudentId && (
                  <button
                    type="button"
                    onClick={handleQuickUpdate}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {isSaving ? 'جاري التحديث...' : 'تحديث'}
                  </button>
                )}

                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={nextStep}
                    className="inline-flex min-w-[88px] items-center justify-center rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-900"
                  >
                    التالي
                  </button>
                ) : (
                  !editingStudentId && (
                    <button
                      type="button"
                      onClick={handleSave}
                      className="inline-flex min-w-[88px] items-center justify-center rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-900"
                    >
                      حفظ
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Review Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-3 sm:p-4 backdrop-blur-[1px]">
          <div
            className="flex w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl"
            style={{ height: 'min(580px, 84vh)' }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-300 bg-slate-50 px-5 py-3">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-slate-500">مراجعة قبل الاعتماد</p>
                <h2 className="text-base font-semibold text-slate-900">مراجعة البيانات قبل الحفظ</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                aria-label="إغلاق"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4">
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <h3 className="mb-2 border-b border-slate-100 pb-1.5 text-sm font-semibold text-slate-800">البيانات الشخصية</h3>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs text-slate-700 md:grid-cols-3">
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
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 p-3">
                  <h3 className="mb-2 border-b border-slate-100 pb-1.5 text-sm font-semibold text-slate-800">الدراسة الإعدادية</h3>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs text-slate-700 md:grid-cols-3">
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

                <div className="rounded-md border border-slate-200 p-3">
                  <h3 className="mb-2 border-b border-slate-100 pb-1.5 text-sm font-semibold text-slate-800">القبول الجامعي</h3>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs text-slate-700 md:grid-cols-3">
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
                    {isNewApplication ? (
                      <>
                        <div><strong>الرغبة الأولى:</strong> {formData.universityAdmission.preference1 || '—'}</div>
                        <div><strong>الرغبة الثانية:</strong> {formData.universityAdmission.preference2 || '—'}</div>
                        <div><strong>الرغبة الثالثة:</strong> {formData.universityAdmission.preference3 || '—'}</div>
                      </>
                    ) : (
                      <div><strong>القسم:</strong> {formData.universityAdmission.department}</div>
                    )}
                    <div><strong>نوع الدراسة:</strong> {formData.universityAdmission.studyType === 'morning' ? 'صباحي' : 'مسائي'}</div>
                    <div><strong>المرحلة الدراسية:</strong> {formData.universityAdmission.level === 'bachelor' ? 'بكالوريوس' : formData.universityAdmission.level === 'master' ? 'ماجستير' : formData.universityAdmission.level === 'phd' ? 'دكتوراه' : 'دبلوم'}</div>
                    <div><strong>الفصل الدراسي:</strong> {formData.universityAdmission.semester === 'first' ? 'الأول' : 'الثاني'}</div>
                    <div><strong>السنة الأكاديمية:</strong> {formData.universityAdmission.academicYear}</div>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 p-3">
                  <h3 className="mb-2 border-b border-slate-100 pb-1.5 text-sm font-semibold text-slate-800">المستمسكات والوثائق</h3>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs text-slate-700 md:grid-cols-2">
                    <div><strong>البطاقة الوطنية (وجه 1):</strong> {formData.documents.nationalIdFront ? 'مرفق' : 'غير مرفق'}</div>
                    <div><strong>البطاقة الوطنية (وجه 2):</strong> {formData.documents.nationalIdBack ? 'مرفق' : 'غير مرفق'}</div>
                    <div><strong>بطاقة السكن (وجه 1):</strong> {formData.documents.residenceCardFront ? 'مرفق' : 'غير مرفق'}</div>
                    <div><strong>بطاقة السكن (وجه 2):</strong> {formData.documents.residenceCardBack ? 'مرفق' : 'غير مرفق'}</div>
                    <div><strong>وثيقة الإعدادية:</strong> {formData.documents.secondaryCertificate ? 'مرفق' : 'غير مرفق'}</div>
                    <div><strong>الصورة الشخصية:</strong> {formData.documents.personalPhoto ? 'مرفق' : 'غير مرفق'}</div>
                    <div><strong>الفحص الطبي:</strong> {formData.documents.medicalExamination ? 'مرفق' : 'غير مرفق'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowReviewModal(false)}
                className="inline-flex min-w-[88px] items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                إلغاء
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isNewApplication && (
                  <>
                    <button
                      type="button"
                      disabled={isPreparingPrint}
                      onClick={() => void openApplicationPrint('full')}
                      className="inline-flex items-center justify-center rounded-md border border-[#053E37] bg-white px-3 py-1.5 text-sm font-medium text-[#053E37] hover:bg-slate-100 disabled:opacity-60"
                    >
                      {isPreparingPrint ? 'جاري التجهيز...' : 'طباعة استمارة الطالب'}
                    </button>
                    <button
                      type="button"
                      disabled={isPreparingPrint}
                      onClick={() => void openApplicationPrint('codes')}
                      className="inline-flex items-center justify-center rounded-md border border-[#E8913A] bg-white px-3 py-1.5 text-sm font-medium text-[#E8913A] hover:bg-orange-50 disabled:opacity-60"
                    >
                      طباعة باركود
                    </button>
                  </>
                )}
                {!editingStudentId && !isNewApplication && (
                  <button
                    type="button"
                    onClick={saveAsPendingRegistration}
                    className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
                  >
                    قيد التسجيل
                  </button>
                )}
                <button
                  type="button"
                  onClick={confirmSave}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
                >
                  {isSaving
                    ? 'جاري الحفظ...'
                    : isNewApplication
                      ? editingRegistrationId
                        ? 'تحديث الاستمارة'
                        : 'حفظ الاستمارة'
                      : editingStudentId
                        ? 'تأكيد التحديث'
                        : 'تأكيد الحفظ'}
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
    </>
  );
}
