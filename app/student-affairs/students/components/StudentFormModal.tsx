'use client';

import { useState, useEffect } from 'react';

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

interface StudentFormModalProps {
  isOpen: boolean;
  editStudentId?: string | null;
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

export default function StudentFormModal({
  isOpen,
  editStudentId = null,
  onClose,
  onSuccess,
}: StudentFormModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<StudentFormData>(initialFormData);
  const [generatedStudentId, setGeneratedStudentId] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return;

    setCurrentStep(1);
    setShowConfirmation(false);
    setShowReviewModal(false);
    setValidationErrors({});

    if (editStudentId) {
      void loadStudentForEdit(editStudentId);
    } else {
      setFormData(initialFormData);
      setGeneratedStudentId('');
      setEditingStudentId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editStudentId]);

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
    setShowReviewModal(true);
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
    setFormData(initialFormData);
    setValidationErrors({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
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
                    disabled={isSaving}
                    className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {isSaving ? 'جاري التحديث...' : 'تحديث'}
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
    </>
  );
}
