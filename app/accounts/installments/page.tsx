'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

interface DepartmentStat {
  id: string;
  name: string;
  total: number;
  totalAmount?: number;
  years?: {
    first: number;
    second: number;
    third: number;
    fourth: number;
  };
}

interface PendingStudent {
  id: string;
  university_id: string;
  name: string;
  nickname?: string;
  mother_name?: string;
  department: string;
  level?: string;
  admission_type?: string;
  admission_channel?: string;
  semester?: string;
  academic_year?: string;
  registration_date?: string;
  photo?: string;
  study_type?: string;
}

type ReceiptStudent = {
  id: string;
  university_id: string;
  name: string;
  nickname?: string;
  department: string;
  payment_amount: number | null;
  payment_date: string | null;
  study_type?: string;
  admission_type?: string;
  discount_percentage?: number | null;
  discount_amount?: number | null;
  final_fee?: number | null;
  admission_channel?: string;
};

export default function AccountsInstallmentsPage() {
  const [departments, setDepartments] = useState<DepartmentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newStudentsNeedingReceipt, setNewStudentsNeedingReceipt] = useState<number>(0);
  const [pendingStudents, setPendingStudents] = useState<PendingStudent[]>([]);
  const [marking, setMarking] = useState<string | null>(null);
  const [paidStudents, setPaidStudents] = useState<Array<{id:string;university_id:string;name:string;nickname?:string;department:string;payment_amount:number|null;payment_date:string|null;study_type?:string;admission_channel?:string;admission_type?:string;discount_percentage?:number|null;discount_amount?:number|null;final_fee?:number|null}>>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<PendingStudent | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [discountPercentage, setDiscountPercentage] = useState<string>('0');
  const [pendingSearchTerm, setPendingSearchTerm] = useState<string>('');
  const [pendingDepartmentFilter, setPendingDepartmentFilter] = useState<string>('');
  const [paidSearchTerm, setPaidSearchTerm] = useState<string>('');
  const [paidDepartmentFilter, setPaidDepartmentFilter] = useState<string>('');

  const totalStudentsAcrossDepartments = useMemo(() => {
    return departments.reduce((sum, department) => sum + (department.total || 0), 0);
  }, [departments]);

  const totalAmountsAcrossDepartments = useMemo(() => {
    return departments.reduce((sum, department) => sum + (department.totalAmount || 0), 0);
  }, [departments]);

  const pendingDepartments = useMemo(() => {
    const unique = new Set<string>();
    pendingStudents.forEach((student) => {
      if (student.department) {
        unique.add(student.department);
      }
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [pendingStudents]);

  const filteredPendingStudents = useMemo(() => {
    const term = pendingSearchTerm.trim().toLowerCase();
    return pendingStudents.filter((student) => {
      if (pendingDepartmentFilter && student.department !== pendingDepartmentFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      const fieldsToSearch = [
        student.name,
        student.nickname,
        student.university_id,
        student.mother_name,
        student.department,
        student.academic_year,
        student.semester,
        student.study_type
      ];
      return fieldsToSearch.some((field) => field?.toLowerCase().includes(term));
    });
  }, [pendingStudents, pendingDepartmentFilter, pendingSearchTerm]);

  const paidDepartments = useMemo(() => {
    const unique = new Set<string>();
    paidStudents.forEach((student) => {
      if (student.department) {
        unique.add(student.department);
      }
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [paidStudents]);

  const filteredPaidStudents = useMemo(() => {
    const term = paidSearchTerm.trim().toLowerCase();
    return paidStudents.filter((student) => {
      if (paidDepartmentFilter && student.department !== paidDepartmentFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      const fieldsToSearch = [
        student.name,
        student.university_id,
        student.department,
        student.study_type,
        student.admission_channel,
        student.admission_type
      ];
      return fieldsToSearch.some((field) => field?.toLowerCase().includes(term));
    });
  }, [paidStudents, paidDepartmentFilter, paidSearchTerm]);

  const exportPaidStudentsToCSV = useCallback(() => {
    if (filteredPaidStudents.length === 0) {
      alert('لا توجد بيانات لتصديرها.');
      return;
    }
    const headers = ['الاسم', 'اللقب', 'التسلسلي', 'القسم', 'نوع الدراسة', 'المرحلة', 'قناة القبول', 'المبلغ المدفوع', 'تاريخ الدفع'];
    const rows = filteredPaidStudents.map((student) => {
      const studyTypeLabel = student.study_type === 'evening' ? 'مسائي' : 'صباحي';
      const stageLabel = formatStage(student.admission_type);
      const channel = formatAdmissionChannel(student.admission_channel);
      const fields = [
        student.name ?? '',
        student.nickname ?? '',
        student.university_id ?? '',
        student.department ?? '',
        studyTypeLabel,
        stageLabel,
        channel,
        String(student.payment_amount ?? ''),
        student.payment_date ? formatDate(student.payment_date) : ''
      ];
      return fields
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `paid-students-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredPaidStudents]);

  const exportPaidStudentsToPDF = useCallback(() => {
    if (filteredPaidStudents.length === 0) {
      alert('لا توجد بيانات لتصديرها.');
      return;
    }
    const tableRows = filteredPaidStudents
      .map((student, index) => {
        const studyTypeLabel = student.study_type === 'evening' ? 'مسائي' : 'صباحي';
        const stageLabel = formatStage(student.admission_type);
        const channel = formatAdmissionChannel(student.admission_channel);
        const paymentDate = student.payment_date ? formatDate(student.payment_date) : '-';
        return `
          <tr>
            <td>${index + 1}</td>
            <td>${student.name ?? ''}</td>
            <td>${student.nickname ?? ''}</td>
            <td>${student.university_id ?? ''}</td>
            <td>${student.department ?? ''}</td>
            <td>${studyTypeLabel}</td>
            <td>${stageLabel}</td>
            <td>${channel}</td>
            <td>${student.payment_amount ?? ''}</td>
            <td>${paymentDate}</td>
          </tr>
        `;
      })
      .join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>تقرير الطلبة المسددين</title>
          <style>
            body { font-family: 'Cairo', sans-serif; margin: 24px; }
            h1 { text-align: center; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #94a3b8; padding: 6px 8px; font-size: 12px; }
            th { background-color: #e0f2fe; }
            tr:nth-child(even) { background-color: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>الطلبة المسددون للأقساط</h1>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>الاسم</th>
                <th>اللقب</th>
                <th>التسلسلي</th>
                <th>القسم</th>
                <th>نوع الدراسة</th>
                <th>المرحلة</th>
                <th>قناة القبول</th>
                <th>المبلغ المدفوع</th>
                <th>تاريخ الدفع</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
      alert('تعذر إنشاء مستند التصدير.');
      document.body.removeChild(iframe);
      return;
    }

    iframeDoc.open();
    iframeDoc.write(htmlContent);
    iframeDoc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 500);
      }
    }, 300);
  }, [filteredPaidStudents]);

  const fetchDepartmentStats = useCallback(async () => {
      try {
        const res = await fetch('/api/departments/stats');
        const data = await res.json();
        if (data.success) {
          setDepartments(data.data);
        setError(null);
        } else {
          setError('تعذر جلب بيانات الأقسام');
        }
      } catch {
        setError('خطأ في الاتصال بالخادم');
      }
  }, []);

  const fetchPendingSummary = useCallback(async () => {
      try {
      const res = await fetch('/api/accounts/installments/pending');
      const data = await res.json();
      if (data.success) {
        setNewStudentsNeedingReceipt(data.data.count);
      }
      } catch {}
  }, []);

  const fetchPendingList = useCallback(async () => {
      try {
      const res = await fetch('/api/accounts/installments/pending/list');
      const data = await res.json();
      if (data.success) {
        setPendingStudents(data.data);
      }
      } catch {}
  }, []);

  const fetchPaidList = useCallback(async () => {
      try {
      const res = await fetch('/api/accounts/installments/paid/list');
      const data = await res.json();
      if (data.success) {
        setPaidStudents(data.data);
      }
      } catch {}
  }, []);

  const refreshRealtimeData = useCallback(async () => {
    await Promise.all([
      fetchDepartmentStats(),
      fetchPendingSummary(),
      fetchPendingList()
    ]);
  }, [fetchDepartmentStats, fetchPendingSummary, fetchPendingList]);

  const refreshAllData = useCallback(async () => {
    await Promise.all([
      fetchDepartmentStats(),
      fetchPendingSummary(),
      fetchPendingList(),
      fetchPaidList()
    ]);
  }, [fetchDepartmentStats, fetchPendingSummary, fetchPendingList, fetchPaidList]);

  useEffect(() => {
    let isMounted = true;
    const initialize = async () => {
      try {
        await refreshAllData();
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    initialize();

    const interval = setInterval(() => {
      refreshRealtimeData();
    }, 10000);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('payments');
      channel.onmessage = (event) => {
        if (event?.data?.type === 'payment-updated') {
          refreshAllData();
        }
      };
    } catch {}

    return () => {
      isMounted = false;
      clearInterval(interval);
      try {
        channel?.close();
    } catch {}
  };
  }, [refreshAllData, refreshRealtimeData]);

  const handleMarkPaid = async (id: string) => {
    try {
      setMarking(id);
      const res = await fetch(`/api/accounts/installments/mark-paid/${id}`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          amount: Number(amount || 0) || 0,
          discount_percentage: Number(discountPercentage || 0) || 0
        })
      });
      const data = await res.json();
      if (data.success) {
        await refreshAllData();
        try {
          const ch = new BroadcastChannel('payments');
          ch.postMessage({ 
            type: 'payment-updated', 
            studentId: id,
            systemPath: data.systemPath || null,
            department: data.department || null
          });
          ch.close();
        } catch {}
        setShowModal(false);
        setSelectedStudent(null);
        setAmount('');
        setDiscountPercentage('0');
      } else {
        alert('تعذر تحديث حالة الدفع');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    } finally {
      setMarking(null);
    }
  };

  const formatStage = (admissionType?: string) => {
    switch (admissionType) {
      case 'first':
        return 'الأولى';
      case 'second':
        return 'الثانية';
      case 'third':
        return 'الثالثة';
      case 'fourth':
        return 'الرابعة';
      default:
        return 'غير محدد';
    }
  };

  const formatAdmissionChannel = (channel?: string) => {
    if (!channel) return 'غير محدد';
    const channels: Record<string, string> = {
      'general': 'القناة العامة',
      'martyrs': 'قناة ذوي الشهداء',
      'social_care': 'قناة ذوي الرعاية الاجتماعية',
      'special_needs': 'قناة ذوي الهمم',
      'political_prisoners': 'قناة ذوي السجناء السياسيين',
      'top_students': 'تخفيض الاوائل',
      'siblings_married': 'تخفيض الاخوة والمتزوجين',
      'minister_directive': 'تخفيض توجيهات معالي الوزير',
      'dean_approval': 'تخفيض موافقة السيد العميد',
      'faculty_children': 'تخفيض ابناء الهيئة التدريسية',
      'health_ministry': 'تخفيض موظفي وزارة الصحة'
    };
    return channels[channel] || channel;
  };

  const getDefaultDiscountPercentage = (channel?: string): number => {
    if (!channel) return 0;
    const discounts: Record<string, number> = {
      'general': 0,
      'martyrs': 50,
      'social_care': 50,
      'special_needs': 0, // تحديد يدوي
      'political_prisoners': 0, // تحديد يدوي
      'top_students': 10,
      'siblings_married': 10,
      'health_ministry': 20,
      'minister_directive': 0, // تحديد يدوي
      'dean_approval': 0, // تحديد يدوي
      'faculty_children': 0 // تحديد يدوي
    };
    return discounts[channel] ?? 0;
  };

  const isManualDiscount = (channel?: string): boolean => {
    if (!channel) return false;
    const manualChannels = ['special_needs', 'political_prisoners', 'minister_directive', 'dean_approval', 'faculty_children'];
    return manualChannels.includes(channel);
  };

  const hasFixedDiscount = (channel?: string): boolean => {
    if (!channel) return false;
    const fixedChannels = ['general', 'martyrs', 'social_care', 'siblings_married', 'top_students', 'health_ministry'];
    return fixedChannels.includes(channel);
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const getAnnualTuitionFee = (department: string, studyType?: string) => {
    const isEvening = studyType === 'evening';
    
    const fees: Record<string, number> = {
      'تقنيات التخدير': isEvening ? 2750000 : 3000000,
      'تقنيات الاشعة': isEvening ? 2750000 : 3000000,
      'تقنيات صناعة الاسنان': isEvening ? 2250000 : 2500000,
      'تقنيات البصريات': 2750000,
      'تقنيات طب الطوارئ': 2750000,
      'تقنيات صحة المجتمع': 2750000,
      'تقنيات العلاج الطبيعي': 2750000,
      'هندسة تقنيات البناء والانشاءات': 2500000,
      'تقنيات البناء والاستشارات': 2500000, // للتوافق مع البيانات القديمة
      'تقنيات هندسة النفط والغاز': 2500000,
      'تقنيات الفيزياء الصحية': 2500000,
      'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 3000000,
      'تقنيات الامن السيبراني': 3000000, // للتوافق مع البيانات القديمة
      'تقنيات الأمن السيبراني': 3000000, // للتوافق مع البيانات القديمة
    };
    
    return fees[department] || 0;
  };

  const calculateRemainingAmount = (department: string, studyType: string | undefined, paidAmount: string, discountPercent: string = '0') => {
    const annualFee = getAnnualTuitionFee(department, studyType);
    const discount = Number(discountPercent || 0);
    const discountAmount = (annualFee * discount) / 100;
    const finalFee = annualFee - discountAmount; // القسط بعد التخفيض
    const paid = Number(paidAmount || 0);
    const remaining = finalFee - paid;
    return { annualFee, discount, discountAmount, finalFee, paid, remaining };
  };

  const convertNumberToArabicWords = (value: number): string => {
    if (!Number.isFinite(value)) return '';
    const number = Math.floor(Math.abs(value));
    if (number === 0) return 'صفر';

    const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
    const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
    const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
    const hundreds = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

    const convertLessThanOneHundred = (n: number): string => {
      if (n < 10) return ones[n];
      if (n < 20) return teens[n - 10];
      const ten = Math.floor(n / 10);
      const unit = n % 10;
      if (unit === 0) return tens[ten];
      return `${ones[unit]} و${tens[ten]}`;
    };

    const convertLessThanOneThousand = (n: number): string => {
      const hundred = Math.floor(n / 100);
      const remainder = n % 100;
      const parts: string[] = [];
      if (hundred > 0) {
        parts.push(hundreds[hundred]);
      }
      if (remainder > 0) {
        parts.push(convertLessThanOneHundred(remainder));
      }
      return parts.join(' و ');
    };

    const scales = [
      { value: 1_000_000_000, singular: 'مليار', dual: 'ملياران', plural: 'مليارات' },
      { value: 1_000_000, singular: 'مليون', dual: 'مليونان', plural: 'ملايين' },
      { value: 1_000, singular: 'ألف', dual: 'ألفان', plural: 'آلاف' },
    ];

    let remainder = number;
    const words: string[] = [];

    for (const scale of scales) {
      const scaleAmount = Math.floor(remainder / scale.value);
      if (scaleAmount > 0) {
        remainder %= scale.value;
        if (scaleAmount === 1) {
          words.push(scale.singular);
        } else if (scaleAmount === 2) {
          words.push(scale.dual);
        } else {
          const scaleText = convertLessThanOneThousand(scaleAmount);
          const suffix = scaleAmount >= 3 && scaleAmount <= 10 ? scale.plural : scale.singular;
          words.push(`${scaleText} ${suffix}`.trim());
        }
      }
    }

    if (remainder > 0) {
      words.push(convertLessThanOneThousand(remainder));
    }

    const finalWords = words.join(' و ');
    return value < 0 ? `سالب ${finalWords}` : finalWords;
  };

  const handlePrintReceipt = (student: ReceiptStudent) => {
    if (!student) return;
    
    const annualFee = getAnnualTuitionFee(student.department, student.study_type);
    const discountPercent = student.discount_percentage ?? getDefaultDiscountPercentage(student.admission_channel);
    const discountAmount = student.discount_amount ?? (annualFee * discountPercent) / 100;
    const finalFee = student.final_fee ?? (annualFee - discountAmount);
    const paid = student.payment_amount ?? 0;
    const stageLabel = student.admission_type ? formatStage(student.admission_type) : 'غير محدد';
    const studyTypeLabel = student.study_type === 'evening' ? 'مسائي' : 'صباحي';
    const admissionChannelLabel = formatAdmissionChannel(student.admission_channel);
    const amountInWordsText = `${convertNumberToArabicWords(Math.round(paid))} دينار عراقي`;
    const receiptIndex = paidStudents.findIndex((ps) => ps.id === student.id);
    const sequentialNumber = receiptIndex >= 0 ? receiptIndex + 1 : paidStudents.length + 1;
    const receiptNumber = `SH${String(sequentialNumber).padStart(7, '0')}`;
    const studentSerial = student.university_id || 'غير متوفر';
    const displayName = student.nickname
      ? `${student.name} (${student.nickname})`
      : student.name;

    const buildReceiptSection = () => `
      <div class="receipt-section">
          <div class="top-bar">
            <div class="top-bar-content">
              <div class="top-right">
                <div class="logo">
                  <img src="/logos/college-logo.png" alt="شعار كلية الشرق الأهلية" />
                </div>
                <div class="institution">
                  <span class="college-name">كلية الشرق الأهلية</span>
                  <span class="department-name">شعبة الحسابات</span>
                </div>
              </div>
              <div class="top-center">وصل قبض</div>
              <div class="top-left">
                <span class="info-line">رقم الطالب: ${studentSerial}</span>
                <span class="info-line">رقم الوصل: ${receiptNumber}</span>
              </div>
            </div>
          </div>
        <div class="bottom-bar">
          <div class="bottom-bar-content">
            <div class="footer-address">العنوان: البصرة - حي الزيتون - طرق صناعية حمدان - مقابل دائرة الكهرباء</div>
            <div class="footer-contact">
              <span>الهاتف: 07870703000 - 07744445669</span>
              <span>البريد: info@shau.edu.iq</span>
              <span>الموقع: shau.edu.iq</span>
            </div>
          </div>
        </div>
        <div class="content">
          <div class="content-body lowered">
            <div class="section-card student-info">
              <div class="key-badges">
                <div class="badge">
                  <span>اسم الطالب</span>
                  <span>${displayName}</span>
                </div>
                <div class="badge">
                  <span>القسم</span>
                  <span>${student.department}</span>
                </div>
              </div>
              <div class="detail-badges">
                <div class="mini-badge"><span>المرحلة</span><span>${stageLabel}</span></div>
                <div class="mini-badge"><span>نوع الدراسة</span><span>${studyTypeLabel}</span></div>
                <div class="mini-badge"><span>قناة القبول</span><span>${admissionChannelLabel}</span></div>
                <div class="mini-badge"><span>نسبة التخفيض</span><span>${discountPercent}%</span></div>
              </div>
            </div>
            <div class="section-card">
              <div class="info-grid">
                <div class="info-item"><span class="label">القسط السنوي قبل التخفيض</span><span class="value">${new Intl.NumberFormat('en-US').format(annualFee)} IQD</span></div>
                <div class="info-item"><span class="label">مبلغ التخفيض</span><span class="value">${new Intl.NumberFormat('en-US').format(discountAmount)} IQD</span></div>
                <div class="info-item full-span"><span class="label">القسط بعد التخفيض</span><span class="value emphasis">${new Intl.NumberFormat('en-US').format(finalFee)} IQD</span></div>
              </div>
            </div>
            <div class="section-card">
              <div class="info-grid">
                <div class="info-item full-span"><span class="label">المبلغ المقبوض</span><span class="value">${new Intl.NumberFormat('en-US').format(paid)} IQD<span class="value-note">(${amountInWordsText})</span></span></div>
              </div>
              <div class="payment-date">تاريخ التسديد: ${student.payment_date ? formatDate(student.payment_date) : formatDate(new Date().toISOString())}</div>
            </div>
            <div class="signatures">
              <div class="signature-block">
                <span class="signature-label">توقيع الطالب</span>
                <div class="signature-line"></div>
              </div>
              <div class="signature-block last">
                <span class="signature-label">اسم المحاسب وتوقيعه</span>
                <div class="signature-line"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <title>وصل قبض</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700&display=swap');
            @page {
              size: 210mm 297mm;
              margin: 0;
            }
            html, body {
              height: 100%;
            }
            body {
              font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              direction: rtl;
              text-align: right;
              background-color: #f5f7fa;
            }
            .page-wrapper {
              height: 100%;
              display: flex;
              flex-direction: column;
              padding: 10mm 12mm 10mm 12mm;
              gap: 4mm;
              box-sizing: border-box;
            }
            .receipt-section {
              flex: 0 0 calc((100% - 4mm) / 2);
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              background-color: #ffffff;
              padding: 10mm 14mm;
              box-sizing: border-box;
              position: relative;
              border: 1px solid #dbeafe;
              border-radius: 12px;
              box-shadow: 0 4px 12px rgba(148, 163, 184, 0.15);
            }
            .top-bar,
            .bottom-bar {
              position: absolute;
              left: 0;
              right: 0;
              height: 12mm;
              background: linear-gradient(135deg, #1d4ed8, #2563eb);
            }
            .top-bar {
              height: 18mm;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 0 12mm;
              box-sizing: border-box;
            }
            .top-bar-content {
              width: 100%;
              display: flex;
              align-items: center;
              justify-content: space-between;
              color: #fff;
              font-size: 12px;
              font-weight: 600;
              font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              gap: 16px;
            }
            .top-right {
              display: flex;
              align-items: center;
              gap: 12px;
            }
            .logo img {
              height: 60px;
              width: auto;
              filter: brightness(0) invert(1);
            }
            .institution {
              display: flex;
              flex-direction: column;
              gap: 2px;
            }
            .college-name {
              font-size: 13px;
              letter-spacing: 0.5px;
            }
            .department-name {
              font-size: 11px;
              opacity: 0.9;
            }
            .top-center {
              flex: 1;
              text-align: center;
              font-size: 16px;
              font-weight: 700;
              letter-spacing: 1px;
            }
            .top-left {
              display: flex;
              flex-direction: column;
              gap: 4px;
              font-size: 11px;
              text-align: left;
            }
            .info-line {
              font-weight: 600;
            }
            .bottom-bar {
              display: block;
              padding: 2.5mm 12mm 11mm 12mm;
              box-sizing: border-box;
              font-size: 10px;
              color: rgba(255,255,255,0.9);
              font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .bottom-bar-content {
              width: 100%;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 1px;
              font-size: 10px;
              color: rgba(255,255,255,0.9);
              font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .footer-address {
              font-weight: 600;
              text-align: center;
            }
            .footer-contact {
              display: flex;
              flex-wrap: wrap;
              justify-content: center;
              gap: 8px;
              font-weight: 500;
            }
            .top-bar { top: 0; border-bottom: 4px solid rgba(255,255,255,0.85); }
            .bottom-bar { bottom: 0; border-top: 4px solid rgba(255,255,255,0.85); }
            .content {
              position: relative;
              z-index: 1;
              height: calc(100% - 30mm);
            }
            .content-body {
              width: 100%;
              height: 100%;
              display: flex;
              flex-direction: column;
              gap: 10px;
            }
            .content-body.lowered {
              margin-top: 12mm;
            }
            .section-card {
              background-color: rgba(248, 250, 252, 0.95);
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 12px 16px;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
            }
            .section-card.student-info {
              background-color: transparent;
              border: none;
              box-shadow: none;
              padding: 0;
            }
            .section-title {
              font-size: 13px;
              font-weight: 700;
              color: #1d4ed8;
              margin-bottom: 8px;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 8px 18px;
              font-size: 12px;
              color: #1f2937;
            }
            .info-grid.student-grid {
              margin-top: 8px;
            }
            .info-item {
              display: flex;
              justify-content: space-between;
              gap: 8px;
            }
            .info-item.full-span {
              grid-column: span 2;
            }
            .info-item .label {
              font-weight: 600;
              color: #475569;
            }
            .info-item .value {
              font-weight: 600;
              color: #0f172a;
            }
            .info-item .value.emphasis {
              color: #2563eb;
            }
            .info-item .value.warning {
              color: #c2410c;
            }
            .info-item .value.positive {
              color: #047857;
            }
            .value-note {
              margin-right: 8px;
              font-size: 11px;
              color: #475569;
              font-weight: 500;
            }
            .payment-date {
              margin-top: 12px;
              font-size: 11px;
              color: #475569;
              font-weight: 600;
            }
            .signatures {
              margin-top: 12px;
              display: flex;
              justify-content: space-between;
              gap: 18px;
              font-size: 11px;
              color: #1f2937;
            }
            .signature-block {
              flex: 1;
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .signature-block.last {
              align-items: flex-end;
              text-align: left;
            }
            .signature-label {
              font-weight: 600;
            }
            .signature-line {
              height: 18px;
              border-bottom: none;
              margin-top: 6px;
            }
            .key-badges {
              display: flex;
              flex-direction: row;
              gap: 8px;
            }
            .badge {
              border: 1px solid #2563eb;
              background-color: transparent;
              border-radius: 0;
              padding: 8px 14px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-weight: 600;
              color: #1e3a8a;
              font-size: 12px;
              flex: 1;
            }
            .detail-badges {
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
              margin-top: 8px;
            }
            .mini-badge {
              border: 1px solid #93c5fd;
              background-color: rgba(37,99,235,0.05);
              border-radius: 0;
              padding: 6px 12px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-weight: 600;
              font-size: 11px;
              color: #1d4ed8;
              min-width: 160px;
              flex: 1 1 160px;
            }
            .mini-badge span:last-child {
              color: #0f172a;
              font-weight: 700;
            }
            @media print {
              body {
                background-color: #ffffff;
              }
              .page-wrapper {
                height: 100%;
                gap: 4mm;
                padding: 10mm 12mm 10mm 12mm;
              }
              .receipt-section {
                page-break-inside: avoid;
                box-shadow: none;
                border: 1px solid #cbd5f5;
              }
            }
          </style>
        </head>
        <body>
          <div class="page-wrapper">
            ${buildReceiptSection()}
            ${buildReceiptSection()}
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-gray-900">أقساط الطلاب</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-2 bg-white/40 backdrop-blur-sm">
          <span>
            إجمالي الطلبة: <span className="font-semibold text-gray-900">{new Intl.NumberFormat('en-US').format(totalStudentsAcrossDepartments)}</span>
          </span>
          <span>
            إجمالي المبالغ: <span className="font-semibold text-emerald-600">{new Intl.NumberFormat('en-US').format(totalAmountsAcrossDepartments)} IQD</span>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border p-6">جاري التحميل...</div>
      ) : error ? (
        <div className="bg-white rounded-lg border p-6 text-red-600">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {departments.map((dept) => (
            <div key={dept.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-gray-800">{dept.name}</h3>
                <span className="text-sm font-semibold text-gray-600">{dept.total}</span>
              </div>
              <div className="space-y-2">
                {dept.years && (
                  <div className="pt-2 border-t border-gray-100">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">الأولى:</span>
                        <span className="font-semibold text-gray-700">{dept.years.first}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">الثانية:</span>
                        <span className="font-semibold text-gray-700">{dept.years.second}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">الثالثة:</span>
                        <span className="font-semibold text-gray-700">{dept.years.third}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">الرابعة:</span>
                        <span className="font-semibold text-gray-700">{dept.years.fourth}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">إجمالي المبالغ</span>
                  <span className="text-lg font-bold text-emerald-600">{new Intl.NumberFormat('en-US').format(dept.totalAmount || 0)} IQD</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* شريط حالة الطلبة الجدد المحتاجين لوصل قبض وتأكيد الدفع */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-3.866 0-7 1.79-7 4v3a2 2 0 002 2h10a2 2 0 002-2v-3c0-2.21-3.134-4-7-4z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8V6m0 0a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-amber-800">عدد الطلبة الجدد الذين بحاجة إلى وصل قبض وتأكيد الدفع</p>
          </div>
        </div>
        <div className="text-2xl font-extrabold text-amber-700">
          {newStudentsNeedingReceipt}
        </div>
      </div>

      {/* قائمة الطلبة قيد الدفع */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900">الطلبة الجدد بانتظار إصدار وصل القبض</h2>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>الإجمالي: {pendingStudents.length}</span>
                {pendingDepartmentFilter && (
                  <span className="text-amber-600">
                    قسم مختار: <span className="font-semibold">{pendingDepartmentFilter}</span>
                  </span>
                )}
                {pendingSearchTerm.trim() && (
                  <span className="text-blue-600">المعروض: {filteredPendingStudents.length}</span>
                )}
        </div>
            </div>
            <div className="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:gap-3 md:w-auto">
              {pendingDepartments.length > 1 && (
                <div className="w-full sm:w-48 md:w-52">
                  <label htmlFor="pending-department-filter" className="sr-only">تصفية حسب القسم</label>
                  <select
                    id="pending-department-filter"
                    value={pendingDepartmentFilter}
                    onChange={(e) => setPendingDepartmentFilter(e.target.value)}
                    className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">كل الأقسام</option>
                    {pendingDepartments.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="w-full sm:w-64 md:w-60">
                <label htmlFor="pending-search" className="sr-only">بحث عن طالب</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.35-5.15a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                    </svg>
                  </span>
                  <input
                    id="pending-search"
                    type="search"
                    value={pendingSearchTerm}
                    onChange={(e) => setPendingSearchTerm(e.target.value)}
                    placeholder="ابحث بالاسم أو التسلسلي..."
                    className="h-10 w-full rounded-md border border-gray-300 pl-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {pendingSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setPendingSearchTerm('')}
                      className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 hover:text-gray-600"
                      aria-label="مسح البحث"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredPendingStudents.length === 0 ? (
            <div className="p-5 text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg md:col-span-2">
              {pendingSearchTerm.trim() ? 'لا توجد سجلات تطابق البحث الجاري.' : 'لا توجد سجلات حالياً.'}
            </div>
          ) : (
            filteredPendingStudents.map((s) => {
              const stageLabel = formatStage(s.admission_type);
              const studyTypeLabel = s.study_type === 'evening' ? 'مسائي' : 'صباحي';
              const admissionChannelLabel = formatAdmissionChannel(s.admission_channel);
              const registrationDate = formatDate(s.registration_date);
              const academicYear = s.academic_year || '-';
              const semesterLabel = s.semester === 'first' ? 'الأول' : s.semester === 'second' ? 'الثاني' : (s.semester || '-');
              const annualTuition = new Intl.NumberFormat('en-US').format(getAnnualTuitionFee(s.department, s.study_type));
              const channelDiscountPercentage = getDefaultDiscountPercentage(s.admission_channel);
              const isManualChannel = isManualDiscount(s.admission_channel);
              const channelDiscountLabel = s.admission_channel
                ? `${channelDiscountPercentage}%${isManualChannel ? ' (تخفيض يدوي)' : ''}`
                : '';

              return (
                <div key={s.id} className="p-5 flex h-full flex-col gap-4 rounded-lg border border-gray-200 transition-colors hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 flex-shrink-0 overflow-hidden rounded-full bg-gray-100 flex items-center justify-center">
                    {s.photo ? (
                        <Image src={`/uploads/students/${s.photo}`} alt={s.name} width={48} height={48} className="h-12 w-12 object-cover" />
                    ) : (
                        <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 15c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                          {s.name}
                          {s.nickname ? <span className="ml-2 text-xs font-normal text-gray-500">({s.nickname})</span> : null}
                        </p>
                        <span className="text-xs font-medium text-gray-500">{s.university_id}</span>
                    </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">{s.department}</span>
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-600">{stageLabel}</span>
                        <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 font-medium text-purple-600">{studyTypeLabel}</span>
                        {s.admission_channel ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600">
                            {admissionChannelLabel}
                            <span className="text-[10px] text-indigo-500">{channelDiscountLabel}</span>
                          </span>
                        ) : null}
                  </div>
                </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-xs text-gray-600 sm:grid-cols-2">
                    <div className="rounded-md bg-white/60 p-3 shadow-sm ring-1 ring-gray-100">
                      <p className="text-[11px] text-gray-500">اسم الأم</p>
                      <p className="mt-1 font-medium text-gray-900">{s.mother_name || '-'}</p>
                    </div>
                    <div className="rounded-md bg-white/60 p-3 shadow-sm ring-1 ring-gray-100">
                      <p className="text-[11px] text-gray-500">السنة الأكاديمية</p>
                      <p className="mt-1 font-medium text-gray-900">{academicYear}</p>
                    </div>
                    <div className="rounded-md bg-white/60 p-3 shadow-sm ring-1 ring-gray-100">
                      <p className="text-[11px] text-gray-500">الفصل الدراسي</p>
                      <p className="mt-1 font-medium text-gray-900">{semesterLabel}</p>
                    </div>
                    <div className="rounded-md bg-white/60 p-3 shadow-sm ring-1 ring-gray-100">
                      <p className="text-[11px] text-gray-500">القسط السنوي</p>
                      <p className="mt-1 font-semibold text-emerald-600">{annualTuition} IQD</p>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-col gap-3 border-t border-dashed border-gray-200 pt-3 sm:flex-row sm:items-center sm:gap-4">
                <button
                  onClick={() => { 
                    setSelectedStudent(s); 
                    setAmount(''); 
                    const defaultDiscount = getDefaultDiscountPercentage(s.admission_channel);
                    setDiscountPercentage(String(defaultDiscount));
                    setShowModal(true); 
                  }}
                  disabled={marking === s.id}
                      className="w-full sm:w-auto sm:min-w-[160px] rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {marking === s.id ? 'جاري الإصدار...' : 'تأكيد الدفع وإصدار وصل'}
                </button>
                    <div className="flex-1 text-xs text-gray-500 sm:text-left">
                      <p className="font-semibold text-gray-900">{registrationDate}</p>
                      <p>مسجل في {academicYear}</p>
              </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* قائمة الطلبة المسددين */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-900">الطلبة المسددون للأقساط</h2>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>الإجمالي: {paidStudents.length}</span>
                {paidDepartmentFilter && (
                  <span className="text-amber-600">
                    قسم مختار: <span className="font-semibold">{paidDepartmentFilter}</span>
                  </span>
                )}
                {paidSearchTerm.trim() && (
                  <span className="text-blue-600">المعروض: {filteredPaidStudents.length}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:gap-3 md:w-auto">
              {paidDepartments.length > 1 && (
                <div className="w-full sm:w-48 md:w-52">
                  <label htmlFor="paid-department-filter" className="sr-only">تصفية حسب القسم</label>
                  <select
                    id="paid-department-filter"
                    value={paidDepartmentFilter}
                    onChange={(e) => setPaidDepartmentFilter(e.target.value)}
                    className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">كل الأقسام</option>
                    {paidDepartments.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="w-full sm:w-64 md:w-60">
                <label htmlFor="paid-search" className="sr-only">بحث عن طالب مسدد</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.35-5.15a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                    </svg>
                  </span>
                  <input
                    id="paid-search"
                    type="search"
                    value={paidSearchTerm}
                    onChange={(e) => setPaidSearchTerm(e.target.value)}
                    placeholder="ابحث بالاسم أو التسلسلي..."
                    className="h-10 w-full rounded-md border border-gray-300 pl-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {paidSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setPaidSearchTerm('')}
                      className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 hover:text-gray-600"
                      aria-label="مسح البحث"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={exportPaidStudentsToCSV}
                  className="px-3 py-2 text-xs rounded-md border border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                >
                  تصدير Excel
                </button>
                <button
                  type="button"
                  onClick={exportPaidStudentsToPDF}
                  className="px-3 py-2 text-xs rounded-md border border-red-500 text-red-600 hover:bg-red-50"
                >
                  تصدير PDF
                </button>
              </div>
            </div>
          </div>
        </div>
        {filteredPaidStudents.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">
            {paidSearchTerm.trim() || paidDepartmentFilter ? 'لا توجد سجلات تطابق الفلاتر الحالية.' : 'لا توجد سجلات حالياً.'}
          </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-right">
              <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
                <tr>
                  <th scope="col" className="px-4 py-3">الاسم</th>
                  <th scope="col" className="px-4 py-3">التسلسلي</th>
                  <th scope="col" className="px-4 py-3">القسم</th>
                  <th scope="col" className="px-4 py-3">نوع الدراسة</th>
                  <th scope="col" className="px-4 py-3">المرحلة</th>
                  <th scope="col" className="px-4 py-3">قناة القبول</th>
                  <th scope="col" className="px-4 py-3">القسط بعد التخفيض</th>
                  <th scope="col" className="px-4 py-3">المدفوع</th>
                  <th scope="col" className="px-4 py-3">المتبقي</th>
                  <th scope="col" className="px-4 py-3">تاريخ الدفع</th>
                  <th scope="col" className="px-4 py-3">وصل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                {filteredPaidStudents.map((s) => {
              const annualFee = getAnnualTuitionFee(s.department, s.study_type);
              const discountAmountValue = s.discount_amount !== null && s.discount_amount !== undefined ? Number(s.discount_amount) : null;
              const discountPercentageValue = s.discount_percentage !== null && s.discount_percentage !== undefined ? Number(s.discount_percentage) : null;
              const directFinalFee = s.final_fee !== null && s.final_fee !== undefined ? Number(s.final_fee) : NaN;
              const inferredDiscountAmount = discountAmountValue !== null ? discountAmountValue : (discountPercentageValue !== null ? (annualFee * discountPercentageValue) / 100 : 0);
              let finalFee = Number.isFinite(directFinalFee) ? directFinalFee : annualFee - inferredDiscountAmount;
              if (!Number.isFinite(finalFee) || finalFee <= 0) {
                finalFee = annualFee;
              }
              const paid = Number(s.payment_amount || 0);
              const remaining = Math.max(finalFee - paid, 0);
                  const studyTypeLabel = s.study_type === 'evening' ? 'مسائي' : 'صباحي';
                  const admissionChannelLabel = formatAdmissionChannel(s.admission_channel);
                  const stageLabel = formatStage(s.admission_type);
              
              return (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {s.name}
                        {s.nickname ? <span className="text-xs text-gray-500"> ({s.nickname})</span> : null}
                      </td>
                      <td className="px-4 py-3">{s.university_id}</td>
                      <td className="px-4 py-3">{s.department}</td>
                      <td className="px-4 py-3 text-gray-600">{studyTypeLabel}</td>
                      <td className="px-4 py-3 text-gray-600">{stageLabel}</td>
                      <td className="px-4 py-3 text-indigo-600 font-medium">{admissionChannelLabel}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{new Intl.NumberFormat('en-US').format(finalFee)} IQD</td>
                      <td className="px-4 py-3 text-blue-600 font-semibold">{new Intl.NumberFormat('en-US').format(paid)} IQD</td>
                      <td className="px-4 py-3 font-semibold">
                      <span className={remaining > 0 ? 'text-amber-600' : 'text-green-600'}>
                          {new Intl.NumberFormat('en-US').format(remaining)} IQD
                      </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{s.payment_date ? formatDate(s.payment_date) : '-'}</td>
                      <td className="px-4 py-3">
                    <button
                      onClick={() => handlePrintReceipt(s)}
                          className="inline-flex items-center justify-center text-blue-600 hover:text-blue-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                    </button>
                      </td>
                    </tr>
              );
                })}
              </tbody>
            </table>
          </div>
          )}
      </div>

      {/* مودال تأكيد الدفع */}
      {showModal && selectedStudent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">تأكيد الدفع وإصدار وصل</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
                  {selectedStudent.photo ? (
                    <Image src={`/uploads/students/${selectedStudent.photo}`} alt={selectedStudent.name} width={56} height={56} className="w-14 h-14 object-cover" />
                  ) : (
                    <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 15c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{selectedStudent.name} {selectedStudent.nickname ? <span className="text-gray-500">({selectedStudent.nickname})</span> : null}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{selectedStudent.university_id} • {selectedStudent.department}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600 mt-1">
                    <span>اسم الأم: <span className="font-medium text-gray-900">{selectedStudent.mother_name || '-'}</span></span>
                    <span>المرحلة: <span className="font-medium text-gray-900">{formatStage(selectedStudent.admission_type)}</span></span>
                    <span>قناة القبول: <span className="font-medium text-indigo-600">{formatAdmissionChannel(selectedStudent.admission_channel)}</span></span>
                    <span>السنة الأكاديمية: <span className="font-medium text-gray-900">{selectedStudent.academic_year || '-'}</span></span>
                    <span>الفصل الدراسي: <span className="font-medium text-gray-900">{selectedStudent.semester === 'first' ? 'الأول' : selectedStudent.semester === 'second' ? 'الثاني' : (selectedStudent.semester || '-')}</span></span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 bg-gray-50 p-3 rounded-md">
                <div>
                  <label className="block text-xs text-gray-700 mb-1">القسط السنوي الكامل (IQD)</label>
                  <div className="text-lg font-bold text-gray-900">
                    {new Intl.NumberFormat('en-US').format(getAnnualTuitionFee(selectedStudent.department, selectedStudent.study_type))} IQD
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">
                    نسبة التخفيض (%) 
                    {isManualDiscount(selectedStudent.admission_channel) && (
                      <span className="text-amber-600 text-xs mr-1">(تحديد يدوي)</span>
                    )}
                    {hasFixedDiscount(selectedStudent.admission_channel) && (
                      <span className="text-gray-500 text-xs mr-1">(ثابتة - غير قابلة للتعديل)</span>
                    )}
                  </label>
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    step="0.1" 
                    value={discountPercentage} 
                    onChange={(e) => setDiscountPercentage(e.target.value)} 
                    disabled={hasFixedDiscount(selectedStudent.admission_channel)}
                    className={`w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${
                      hasFixedDiscount(selectedStudent.admission_channel) 
                        ? 'bg-gray-100 cursor-not-allowed text-gray-600' 
                        : ''
                    }`}
                    placeholder="أدخل نسبة التخفيض" 
                  />
                  {hasFixedDiscount(selectedStudent.admission_channel) && (
                    <p className="text-xs text-gray-600 mt-1">
                      هذه النسبة ثابتة حسب قناة القبول: {getDefaultDiscountPercentage(selectedStudent.admission_channel)}%
                    </p>
                  )}
                  {isManualDiscount(selectedStudent.admission_channel) && (
                    <p className="text-xs text-amber-600 mt-1">يرجى إدخال نسبة التخفيض يدوياً</p>
                  )}
                </div>
                {Number(discountPercentage || 0) > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-2">
                    <div className="flex justify-between text-xs text-blue-700 mb-1">
                      <span>مبلغ التخفيض:</span>
                      <span className="font-semibold">
                        {new Intl.NumberFormat('en-US').format(calculateRemainingAmount(selectedStudent.department, selectedStudent.study_type, amount, discountPercentage).discountAmount)} IQD
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-blue-700">
                      <span>القسط بعد التخفيض:</span>
                      <span className="font-bold">
                        {new Intl.NumberFormat('en-US').format(calculateRemainingAmount(selectedStudent.department, selectedStudent.study_type, amount, discountPercentage).finalFee)} IQD
                      </span>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-700 mb-1">المبلغ المدفوع (IQD)</label>
                  <input type="number" min="0" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" placeholder="أدخل المبلغ" />
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">المبلغ المتبقي (IQD)</label>
                  <div className={`text-base font-semibold ${calculateRemainingAmount(selectedStudent.department, selectedStudent.study_type, amount, discountPercentage).remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                    {new Intl.NumberFormat('en-US').format(calculateRemainingAmount(selectedStudent.department, selectedStudent.study_type, amount, discountPercentage).remaining)} IQD
                  </div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">إلغاء</button>
              <button onClick={async () => {
                await handleMarkPaid(selectedStudent.id);
                setTimeout(() => {
                  if (selectedStudent) {
                    const calc = calculateRemainingAmount(selectedStudent.department, selectedStudent.study_type, amount, discountPercentage);
                    const receiptStudent: ReceiptStudent = {
                      id: selectedStudent.id,
                      university_id: selectedStudent.university_id,
                      name: selectedStudent.name,
                      nickname: selectedStudent.nickname,
                      department: selectedStudent.department,
                      payment_amount: Number(amount || 0),
                      payment_date: new Date().toISOString(),
                      study_type: selectedStudent.study_type,
                      admission_type: selectedStudent.admission_type,
                      discount_percentage: calc.discount,
                      discount_amount: calc.discountAmount,
                      final_fee: calc.finalFee,
                      admission_channel: selectedStudent.admission_channel
                    };
                    handlePrintReceipt(receiptStudent);
                  }
                }, 1000);
              }} disabled={marking === selectedStudent.id} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                {marking === selectedStudent.id ? 'جاري الإصدار...' : 'تأكيد الدفع وإصدار وصل'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


