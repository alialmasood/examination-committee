'use client';

import { useState, useEffect } from 'react';

interface Request {
  id: string;
  type: string;
  title: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'processing';
  createdAt: string;
  updatedAt: string;
  studentId: string;
  studentName: string;
  attachments?: string[];
  notes?: string;
}

const requestTypes = [
  {
    id: 'study-postponement',
    title: 'طلب تأجيل الدراسة',
    description: 'طلب تأجيل الدراسة للفصل الدراسي الحالي أو القادم',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'from-orange-500 to-red-500'
  },
  {
    id: 'transfer',
    title: 'طلب نقل بين الكليات أو الأقسام',
    description: 'طلب نقل من كلية أو قسم إلى آخر',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
    color: 'from-blue-500 to-indigo-500'
  },
  {
    id: 'grade-correction',
    title: 'طلب إعادة ترقين أو تصحيح درجات',
    description: 'طلب مراجعة وتصحيح الدرجات المسجلة',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
    color: 'from-green-500 to-emerald-500'
  },
  {
    id: 'document-issuance',
    title: 'طلب إصدار وثائق',
    description: 'طلب إصدار شهادات أو وثائق أكاديمية',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    color: 'from-purple-500 to-pink-500'
  },
  {
    id: 'attendance-confirmation',
    title: 'طلب إصدار تأييد استمرارية الدوام',
    description: 'طلب إصدار تأييد رسمي لاستمرارية الدوام والدراسة',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'from-teal-500 to-cyan-500'
  }
];

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  processing: 'bg-blue-100 text-blue-800 border-blue-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200'
};

const statusLabels = {
  pending: 'قيد المراجعة',
  processing: 'قيد المعالجة',
  approved: 'مقبول',
  rejected: 'مرفوض'
};

export default function RequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [newRequestData, setNewRequestData] = useState({
    type: '',
    title: '',
    description: '',
    studentName: '',
    studentId: '',
    to: '',
    attachments: [] as File[]
  });
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const [filteredStudents, setFilteredStudents] = useState<Array<{id: string, universityId: string, fullNameAr: string, fullName: string, firstName: string, lastName: string, middleName: string, nationalId: string, status: string}>>([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);

  // دالة للبحث عن الطلبة في قاعدة البيانات
  const searchStudents = async (searchTerm: string) => {
    if (searchTerm.length < 1) {
      setFilteredStudents([]);
      setShowStudentDropdown(false);
      return;
    }

    setIsSearchingStudents(true);
    try {
      const response = await fetch(`/api/students/search?q=${encodeURIComponent(searchTerm)}&limit=10`);
      const data = await response.json();
      
      if (response.ok) {
        setFilteredStudents(data.students);
        setShowStudentDropdown(true);
      } else {
        console.error('Error searching students:', data.error);
        setFilteredStudents([]);
      }
    } catch (error) {
      console.error('Error searching students:', error);
      setFilteredStudents([]);
    } finally {
      setIsSearchingStudents(false);
    }
  };

  // دالة لتحويل المرحلة الدراسية إلى العربية
  const getLevelInArabic = (semester: string) => {
    // إذا كانت القيمة فارغة أو غير محددة
    if (!semester || semester === 'غير محدد') {
      return 'غير محدد';
    }

    const semesterMap: { [key: string]: string } = {
      'أولى': 'المرحلة الأولى',
      'ثانية': 'المرحلة الثانية', 
      'ثالثة': 'المرحلة الثالثة',
      'رابعة': 'المرحلة الرابعة',
      'خامسة': 'المرحلة الخامسة',
      'سادسة': 'المرحلة السادسة',
      '1': 'المرحلة الأولى',
      '2': 'المرحلة الثانية',
      '3': 'المرحلة الثالثة',
      '4': 'المرحلة الرابعة',
      '5': 'المرحلة الخامسة',
      '6': 'المرحلة السادسة',
      'first': 'المرحلة الأولى',
      'second': 'المرحلة الثانية',
      'third': 'المرحلة الثالثة',
      'fourth': 'المرحلة الرابعة',
      'fifth': 'المرحلة الخامسة',
      'sixth': 'المرحلة السادسة',
      'year1': 'المرحلة الأولى',
      'year2': 'المرحلة الثانية',
      'year3': 'المرحلة الثالثة',
      'year4': 'المرحلة الرابعة',
      'year5': 'المرحلة الخامسة',
      'year6': 'المرحلة السادسة'
    };
    
    const lowerSemester = semester.toLowerCase();
    return semesterMap[lowerSemester] || semester;
  };

  // دالة لجلب تفاصيل الطالب الكاملة
  const fetchStudentDetails = async (studentId: string) => {
    try {
      const response = await fetch(`/api/students/${studentId}`);
      const data = await response.json();
      
      if (response.ok && data.success) {
        const student = data.data;
        return student;
      } else {
        console.error('Error fetching student details:', data.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching student details:', error);
      return null;
    }
  };

  // تهيئة قائمة الطلبات فارغة
  useEffect(() => {
    setRequests([]);
    setLoading(false);
  }, []);

  // البحث عن الطلبة عند تغيير مصطلح البحث
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchStudents(studentSearchTerm);
    }, 300); // تأخير 300ms لتجنب البحث المفرط

    return () => clearTimeout(timeoutId);
  }, [studentSearchTerm]);

  const filteredRequests = requests.filter(request => {
    if (selectedType && request.type !== selectedType) return false;
    if (filterStatus !== 'all' && request.status !== filterStatus) return false;
    return true;
  });

  const getRequestTypeInfo = (type: string) => {
    return requestTypes.find(rt => rt.id === type) || requestTypes[0];
  };

  const handleNewRequest = (type: string) => {
    const typeInfo = requestTypes.find(rt => rt.id === type);
    setSelectedType(type);
    setStudentSearchTerm('');
    setShowStudentDropdown(false);
    setNewRequestData({
      type: type,
      title: typeInfo?.title || '',
      description: typeInfo?.description || '',
      studentName: '',
      studentId: '',
      to: '',
      attachments: []
    });
    setShowNewRequestForm(true);
  };

  const handleStatusUpdate = (requestId: string, newStatus: Request['status']) => {
    setRequests(prev => prev.map(req => 
      req.id === requestId 
        ? { ...req, status: newStatus, updatedAt: new Date().toISOString().split('T')[0] }
        : req
    ));
  };

  const handleCloseForm = () => {
    setShowNewRequestForm(false);
    setSelectedType(null);
    setStudentSearchTerm('');
    setShowStudentDropdown(false);
    setNewRequestData({
      type: '',
      title: '',
      description: '',
      studentName: '',
      studentId: '',
      to: '',
      attachments: []
    });
  };

  const handleInputChange = (field: string, value: string | File[]) => {
    setNewRequestData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleStudentSearch = (value: string) => {
    setStudentSearchTerm(value);
    if (value === '') {
      setNewRequestData(prev => ({
        ...prev,
        studentName: '',
        studentId: ''
      }));
    }
  };

  const handleStudentSelect = async (student: {id: string, universityId: string, fullNameAr: string, fullName: string, firstName: string, lastName: string, middleName: string, nationalId: string, status: string}) => {
    setNewRequestData(prev => ({
      ...prev,
      studentName: student.fullNameAr || student.fullName,
      studentId: student.id
    }));
    setStudentSearchTerm(student.fullNameAr || student.fullName);
    setShowStudentDropdown(false);

    // جلب تفاصيل الطالب الكاملة
    const studentDetails = await fetchStudentDetails(student.id);
    
    // إذا كان الطلب تأييد استمرارية الدوام، قم بتحديث الوصف تلقائياً
    if (newRequestData.type === 'attendance-confirmation' && studentDetails) {
      const semesterInArabic = getLevelInArabic(studentDetails.semester);
      const description = `تحية طيبة نؤيد ان الطالب ${studentDetails.full_name_ar || studentDetails.full_name} هو احد طلبة كليتنا (كلية الشرق للعلوم التقنية التخصصية) في قسم ${studentDetails.major || 'غير محدد'} المرحلة ${semesterInArabic}

وبناءا على طلبه زود بهذا التاييد يرجى تسهيل مهمته

مع الشكر والتقدير`;

      setNewRequestData(prev => ({
        ...prev,
        description: description
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // هنا يمكن إضافة منطق إرسال الطلب
    console.log('New request data:', newRequestData);
    handleCloseForm();
  };

  const handlePrint = () => {
    // إنشاء محتوى الطباعة
    const printContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>طباعة الطلب</title>
        <style>
          @page {
            size: A4;
            margin: 2.54cm 3.17cm;
          }
          body {
            font-family: 'Arial', sans-serif;
            font-size: 18px;
            line-height: 1.6;
            color: #000;
            background: white;
            margin: 0;
            padding: 0;
          }
          .print-header {
            text-align: center;
            margin-bottom: 30px;
          }
          .print-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .print-subtitle {
            font-size: 18px;
            color: #666;
          }
          .print-content {
            margin: 20px 0;
          }
          .print-field {
            margin-bottom: 15px;
            display: flex;
            align-items: flex-start;
            margin-right: 4cm;
          }
          .print-field-center {
            margin-bottom: 15px;
            text-align: center;
          }
          .print-label {
            font-weight: bold;
            min-width: 80px;
            margin-left: 10px;
          }
          .print-value {
            flex: 1;
            padding-bottom: 2px;
            min-height: 20px;
          }
          .print-center-content {
            font-weight: bold;
            font-size: 20px;
          }
          .print-description {
            margin-top: 30px;
            padding: 20px;
            background: #f9f9f9;
            white-space: pre-wrap;
            font-size: 18px;
            line-height: 1.8;
          }
          .print-footer {
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="print-header">
        </div>
        
        <div class="print-content">
          <div class="print-field">
            <span class="print-label">إلى:</span>
            <div class="print-value">${newRequestData.to || ''}</div>
          </div>
          
          <div class="print-field-center">
            <div class="print-center-content">م/ ${newRequestData.title || ''}</div>
          </div>
        </div>
        
        <div class="print-description">
          ${newRequestData.description || ''}
        </div>
        
      </body>
      </html>
    `;

    // فتح نافذة الطباعة
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      
      // انتظار تحميل المحتوى ثم الطباعة
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
        }, 500);
      };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <>
      {/* CSS للطباعة */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-content, .print-content * {
            visibility: visible;
          }
          .print-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white;
            padding: 20px;
            font-family: Arial, sans-serif;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
      
      <div className="space-y-8">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">طلبات الطلبة</h1>
            <p className="text-gray-600">إدارة ومتابعة جميع طلبات الطلبة الأكاديمية</p>
          </div>
          <div className="flex items-center space-x-4 space-x-reverse">
            <button
              onClick={() => {
                setStudentSearchTerm('');
                setShowStudentDropdown(false);
                setNewRequestData({
                  type: '',
                  title: '',
                  description: '',
                  studentName: '',
                  studentId: '',
                  to: '',
                  attachments: []
                });
                setShowNewRequestForm(true);
              }}
              className="bg-gradient-to-r from-blue-600 to-blue-500 text-white px-6 py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-blue-600 transition-all duration-300 shadow-lg hover:shadow-xl"
            >
              طلب جديد
            </button>
          </div>
        </div>

        {/* Request Types Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {requestTypes.map((type) => (
            <div
              key={type.id}
              className={`bg-gradient-to-br ${type.color} p-6 rounded-2xl text-white cursor-pointer hover:scale-105 transition-all duration-300 shadow-lg hover:shadow-xl`}
              onClick={() => handleNewRequest(type.id)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  {type.icon}
                </div>
                <div className="text-right">
                  <h3 className="font-bold text-base">{type.title}</h3>
                  <p className="text-xs opacity-90 mt-1">{type.description}</p>
                </div>
              </div>
              <div className="text-xs opacity-80">
                انقر لإنشاء طلب جديد
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">جميع الطلبات</h2>
          <div className="flex items-center space-x-4 space-x-reverse">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">جميع الحالات</option>
              <option value="pending">قيد المراجعة</option>
              <option value="processing">قيد المعالجة</option>
              <option value="approved">مقبول</option>
              <option value="rejected">مرفوض</option>
            </select>
          </div>
        </div>

        {/* Requests List */}
        <div className="space-y-4">
          {filteredRequests.map((request) => {
            const typeInfo = getRequestTypeInfo(request.type);
            return (
              <div
                key={request.id}
                className="bg-gray-50 rounded-xl p-6 hover:bg-gray-100 transition-all duration-300 border border-gray-200 hover:border-gray-300"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4 space-x-reverse">
                    <div className={`p-3 rounded-xl bg-gradient-to-br ${typeInfo.color} text-white`}>
                      {typeInfo.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 space-x-reverse mb-2">
                        <h3 className="text-lg font-bold text-gray-900">{request.title}</h3>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium border ${statusColors[request.status]}`}>
                          {statusLabels[request.status]}
                        </span>
                      </div>
                      <p className="text-gray-600 mb-3">{request.description}</p>
                      <div className="flex items-center space-x-6 space-x-reverse text-sm text-gray-500">
                        <span>الطالب: {request.studentName}</span>
                        <span>رقم الطالب: {request.studentId}</span>
                        <span>تاريخ الطلب: {request.createdAt}</span>
                        <span>آخر تحديث: {request.updatedAt}</span>
                      </div>
                      {request.notes && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <p className="text-sm text-blue-800">
                            <span className="font-semibold">ملاحظات:</span> {request.notes}
                          </p>
                        </div>
                      )}
                      {request.attachments && request.attachments.length > 0 && (
                        <div className="mt-3">
                          <p className="text-sm font-semibold text-gray-700 mb-2">المرفقات:</p>
                          <div className="flex flex-wrap gap-2">
                            {request.attachments.map((attachment, index) => (
                              <span
                                key={index}
                                className="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg text-sm"
                              >
                                {attachment}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 space-x-reverse">
                    {request.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleStatusUpdate(request.id, 'processing')}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                        >
                          بدء المعالجة
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(request.id, 'approved')}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                        >
                          قبول
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(request.id, 'rejected')}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                        >
                          رفض
                        </button>
                      </>
                    )}
                    {request.status === 'processing' && (
                      <>
                        <button
                          onClick={() => handleStatusUpdate(request.id, 'approved')}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                        >
                          قبول
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(request.id, 'rejected')}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                        >
                          رفض
                        </button>
                      </>
                    )}
                    <button className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm">
                      عرض التفاصيل
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredRequests.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد طلبات</h3>
            <p className="text-gray-600">لم يتم العثور على طلبات تطابق المعايير المحددة</p>
          </div>
        )}
      </div>

      {/* New Request Form Modal */}
      {showNewRequestForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto print-content">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">إنشاء طلب جديد</h2>
                <button
                  onClick={() => setShowNewRequestForm(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors no-print"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">نوع الطلب</label>
                  <input
                    type="text"
                    value={newRequestData.title}
                    readOnly
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                  <p className="text-xs text-gray-500 mt-1">تم تحديد نوع الطلب بناءً على البطاقة المختارة</p>
                </div>

                <div className="relative">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">اسم الطالب</label>
                  <input
                    type="text"
                    value={studentSearchTerm}
                    onChange={(e) => handleStudentSearch(e.target.value)}
                    onFocus={() => {
                      if (studentSearchTerm.length >= 1) {
                        setShowStudentDropdown(true);
                      }
                    }}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="ابحث عن اسم الطالب (اكتب حرف أو حرفين)"
                    required
                  />
                  
                  {/* قائمة الطلبة المفلترة */}
                  {showStudentDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {isSearchingStudents ? (
                        <div className="px-4 py-3 text-center text-gray-500">
                          <div className="flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                            جاري البحث...
                          </div>
                        </div>
                      ) : filteredStudents.length > 0 ? (
                        filteredStudents.map((student) => (
                          <div
                            key={student.id}
                            onClick={() => handleStudentSelect(student)}
                            className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                          >
                            <div className="font-medium text-gray-900">
                              {student.fullNameAr || student.fullName}
                            </div>
                            <div className="text-sm text-gray-500">
                              الرقم الجامعي: {student.universityId} | الهوية: {student.nationalId}
                            </div>
                          </div>
                        ))
                      ) : studentSearchTerm.length >= 1 ? (
                        <div className="px-4 py-3 text-gray-500 text-center">
                          لا توجد نتائج للبحث عن &quot;{studentSearchTerm}&quot;
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {newRequestData.type === 'attendance-confirmation' ? (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">إلى</label>
                    <input
                      type="text"
                      value={newRequestData.to}
                      onChange={(e) => handleInputChange('to', e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="أدخل الجهة أو الشخص المرسل إليه الطلب"
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">إلى</label>
                    <select
                      value={newRequestData.to}
                      onChange={(e) => handleInputChange('to', e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    >
                      <option value="">اختر الجهة</option>
                      <option value="السيد عميد الكلية المحترم">السيد عميد الكلية المحترم</option>
                      <option value="السيد المعاون العلمي المحترم">السيد المعاون العلمي المحترم</option>
                    </select>
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">وصف الطلب</label>
                  {newRequestData.type === 'attendance-confirmation' ? (
                    <textarea
                      value={newRequestData.description}
                      readOnly
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 cursor-not-allowed"
                      rows={6}
                      placeholder="سيتم ملء الوصف تلقائياً عند اختيار الطالب"
                    />
                  ) : (
                    <textarea
                      value={newRequestData.description}
                      onChange={(e) => handleInputChange('description', e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows={4}
                      placeholder="اكتب تفاصيل الطلب هنا..."
                      required
                    />
                  )}
                  {newRequestData.type === 'attendance-confirmation' && (
                    <p className="text-xs text-gray-500 mt-1">سيتم ملء الوصف تلقائياً عند اختيار الطالب</p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">المرفقات</label>
                  <input
                    type="file"
                    multiple
                    onChange={(e) => handleInputChange('attachments', Array.from(e.target.files || []))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  />
                  <p className="text-xs text-gray-500 mt-1">يمكن رفع ملفات PDF، Word، أو الصور</p>
                </div>
                
                <div className="flex items-center justify-end space-x-4 space-x-reverse pt-4 no-print">
                  <button
                    type="button"
                    onClick={handleCloseForm}
                    className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-2 space-x-reverse"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    <span>طباعة الطلب</span>
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    إرسال الطلب
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
