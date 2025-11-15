'use client';

import { useState } from 'react';

interface GraduationConfirmationForm {
  studentId: string;
  studentName: string;
  studentNameEn: string;
  nationalId: string;
  graduationDate: string;
  degree: string;
  major: string;
  gpa: string;
  issuedBy: string;
  issuedDate: string;
  purpose: string;
}

interface GraduationDocumentForm {
  studentId: string;
  studentName: string;
  studentNameEn: string;
  nationalId: string;
  birthDate: string;
  birthPlace: string;
  admissionDate: string;
  graduationDate: string;
  degree: string;
  major: string;
  totalCredits: string;
  gpa: string;
  grades: Array<{
    course: string;
    credits: string;
    grade: string;
    points: string;
  }>;
  issuedBy: string;
  issuedDate: string;
  documentNumber: string;
}

interface StudyStatusForm {
  studentId: string;
  studentName: string;
  studentNameEn: string;
  nationalId: string;
  statusType: 'continuation' | 'postponement' | 'withdrawal' | 'return';
  currentSemester: string;
  academicYear: string;
  reason: string;
  duration?: string;
  expectedReturnDate?: string;
  issuedBy: string;
  issuedDate: string;
  purpose: string;
}

interface DocumentTemplate {
  id: string;
  name: string;
  type: 'confirmation' | 'document' | 'status' | 'custom';
  template: string;
  fields: string[];
  isActive: boolean;
  createdAt: string;
}

export default function DocumentsPage() {
  const [activeTab, setActiveTab] = useState<'confirmation' | 'document' | 'status' | 'templates'>('confirmation');
  const [showForm, setShowForm] = useState(false);
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [showStatusForm, setShowStatusForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  
  const [formData, setFormData] = useState<GraduationConfirmationForm>({
    studentId: '',
    studentName: '',
    studentNameEn: '',
    nationalId: '',
    graduationDate: '',
    degree: '',
    major: '',
    gpa: '',
    issuedBy: '',
    issuedDate: new Date().toISOString().split('T')[0],
    purpose: ''
  });

  const [documentData, setDocumentData] = useState<GraduationDocumentForm>({
    studentId: '',
    studentName: '',
    studentNameEn: '',
    nationalId: '',
    birthDate: '',
    birthPlace: '',
    admissionDate: '',
    graduationDate: '',
    degree: '',
    major: '',
    totalCredits: '',
    gpa: '',
    grades: [],
    issuedBy: '',
    issuedDate: new Date().toISOString().split('T')[0],
    documentNumber: ''
  });

  const [statusData, setStatusData] = useState<StudyStatusForm>({
    studentId: '',
    studentName: '',
    studentNameEn: '',
    nationalId: '',
    statusType: 'continuation',
    currentSemester: '',
    academicYear: '',
    reason: '',
    duration: '',
    expectedReturnDate: '',
    issuedBy: '',
    issuedDate: new Date().toISOString().split('T')[0],
    purpose: ''
  });

  const [templateData, setTemplateData] = useState<DocumentTemplate>({
    id: '',
    name: '',
    type: 'confirmation',
    template: '',
    fields: [],
    isActive: true,
    createdAt: new Date().toISOString().split('T')[0]
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('تأييد تخرج جديد:', formData);
    alert('تم إصدار تأييد التخرج بنجاح!');
    setShowForm(false);
    setFormData({
      studentId: '',
      studentName: '',
      studentNameEn: '',
      nationalId: '',
      graduationDate: '',
      degree: '',
      major: '',
      gpa: '',
      issuedBy: '',
      issuedDate: new Date().toISOString().split('T')[0],
      purpose: ''
    });
  };

  const handleDocumentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('وثيقة تخرج جديدة:', documentData);
    alert('تم إصدار وثيقة التخرج بنجاح!');
    setShowDocumentForm(false);
    setDocumentData({
      studentId: '',
      studentName: '',
      studentNameEn: '',
      nationalId: '',
      birthDate: '',
      birthPlace: '',
      admissionDate: '',
      graduationDate: '',
      degree: '',
      major: '',
      totalCredits: '',
      gpa: '',
      grades: [],
      issuedBy: '',
      issuedDate: new Date().toISOString().split('T')[0],
      documentNumber: ''
    });
  };

  const handleStatusSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('تأييد حالة دراسة جديدة:', statusData);
    alert('تم إصدار تأييد حالة الدراسة بنجاح!');
    setShowStatusForm(false);
    setStatusData({
      studentId: '',
      studentName: '',
      studentNameEn: '',
      nationalId: '',
      statusType: 'continuation',
      currentSemester: '',
      academicYear: '',
      reason: '',
      duration: '',
      expectedReturnDate: '',
      issuedBy: '',
      issuedDate: new Date().toISOString().split('T')[0],
      purpose: ''
    });
  };

  const handleTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('قالب جديد:', templateData);
    alert('تم إنشاء القالب بنجاح!');
    setShowTemplateForm(false);
    setTemplateData({
      id: '',
      name: '',
      type: 'confirmation',
      template: '',
      fields: [],
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0]
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleDocumentInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDocumentData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleStatusInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setStatusData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleTemplateInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTemplateData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const addGrade = () => {
    setDocumentData(prev => ({
      ...prev,
      grades: [...prev.grades, { course: '', credits: '', grade: '', points: '' }]
    }));
  };

  const removeGrade = (index: number) => {
    setDocumentData(prev => ({
      ...prev,
      grades: prev.grades.filter((_, i) => i !== index)
    }));
  };

  const updateGrade = (index: number, field: string, value: string) => {
    setDocumentData(prev => ({
      ...prev,
      grades: prev.grades.map((grade, i) => 
        i === index ? { ...grade, [field]: value } : grade
      )
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            نظام الوثائق والشهادات
          </h1>
          <p className="text-gray-600">
            إدارة وإصدار الوثائق الرسمية والشهادات الأكاديمية
          </p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap space-x-8 space-x-reverse px-6">
              <button
                onClick={() => setActiveTab('confirmation')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'confirmation'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                تأييد تخرج
              </button>
              <button
                onClick={() => setActiveTab('document')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'document'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                وثيقة تخرج
              </button>
              <button
                onClick={() => setActiveTab('status')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'status'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                تأييد حالة دراسة
              </button>
              <button
                onClick={() => setActiveTab('templates')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'templates'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                إدارة النماذج
              </button>
            </nav>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'confirmation' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إصدار تأييد تخرج
              </h2>
              <button
                onClick={() => setShowForm(!showForm)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showForm ? 'إلغاء' : 'إصدار تأييد جديد'}
              </button>
            </div>

            {showForm && (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* معلومات الطالب */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      معلومات الطالب
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentId"
                        value={formData.studentId}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب (عربي)
                      </label>
                      <input
                        type="text"
                        name="studentName"
                        value={formData.studentName}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب (إنجليزي)
                      </label>
                      <input
                        type="text"
                        name="studentNameEn"
                        value={formData.studentNameEn}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الهوية الوطنية
                      </label>
                      <input
                        type="text"
                        name="nationalId"
                        value={formData.nationalId}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                    </div>
                  </div>

                  {/* تفاصيل التخرج */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل التخرج
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ التخرج
                      </label>
                      <input
                        type="date"
                        name="graduationDate"
                        value={formData.graduationDate}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الدرجة العلمية
                      </label>
                      <select
                        name="degree"
                        value={formData.degree}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      >
                        <option value="">اختر الدرجة</option>
                        <option value="bachelor">بكالوريوس</option>
                        <option value="master">ماجستير</option>
                        <option value="phd">دكتوراه</option>
                        <option value="diploma">دبلوم</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        التخصص
                      </label>
                      <input
                        type="text"
                        name="major"
                        value={formData.major}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        المعدل التراكمي
                      </label>
                      <input
                        type="text"
                        name="gpa"
                        value={formData.gpa}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        placeholder="مثال: 3.75"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* الغرض من التأييد */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    الغرض من التأييد
                  </label>
                  <textarea
                    name="purpose"
                    value={formData.purpose}
                    onChange={handleInputChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="اكتب الغرض من إصدار هذا التأييد..."
                    required
                  />
                </div>

                {/* معلومات الإصدار */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      صادر من
                    </label>
                    <input
                      type="text"
                      name="issuedBy"
                      value={formData.issuedBy}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      placeholder="اسم المسؤول"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      تاريخ الإصدار
                    </label>
                    <input
                      type="date"
                      name="issuedDate"
                      value={formData.issuedDate}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      required
                    />
                  </div>
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors duration-200"
                  >
                    إصدار التأييد
                  </button>
                </div>
              </form>
            )}

            {!showForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إصدار تأييد تخرج جديد
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;إصدار تأييد جديد&quot; لبدء عملية إصدار تأييد تخرج للطالب
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'document' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إصدار وثيقة تخرج
              </h2>
              <button
                onClick={() => setShowDocumentForm(!showDocumentForm)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showDocumentForm ? 'إلغاء' : 'إصدار وثيقة جديدة'}
              </button>
            </div>

            {showDocumentForm && (
              <form onSubmit={handleDocumentSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* معلومات الطالب */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      معلومات الطالب
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentId"
                        value={documentData.studentId}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب (عربي)
                      </label>
                      <input
                        type="text"
                        name="studentName"
                        value={documentData.studentName}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب (إنجليزي)
                      </label>
                      <input
                        type="text"
                        name="studentNameEn"
                        value={documentData.studentNameEn}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الهوية الوطنية
                      </label>
                      <input
                        type="text"
                        name="nationalId"
                        value={documentData.nationalId}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ الميلاد
                      </label>
                      <input
                        type="date"
                        name="birthDate"
                        value={documentData.birthDate}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مكان الميلاد
                      </label>
                      <input
                        type="text"
                        name="birthPlace"
                        value={documentData.birthPlace}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>
                  </div>

                  {/* تفاصيل الدراسة */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل الدراسة
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ الالتحاق
                      </label>
                      <input
                        type="date"
                        name="admissionDate"
                        value={documentData.admissionDate}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ التخرج
                      </label>
                      <input
                        type="date"
                        name="graduationDate"
                        value={documentData.graduationDate}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الدرجة العلمية
                      </label>
                      <select
                        name="degree"
                        value={documentData.degree}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      >
                        <option value="">اختر الدرجة</option>
                        <option value="bachelor">بكالوريوس</option>
                        <option value="master">ماجستير</option>
                        <option value="phd">دكتوراه</option>
                        <option value="diploma">دبلوم</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        التخصص
                      </label>
                      <input
                        type="text"
                        name="major"
                        value={documentData.major}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        إجمالي الساعات المعتمدة
                      </label>
                      <input
                        type="text"
                        name="totalCredits"
                        value={documentData.totalCredits}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="مثال: 132"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        المعدل التراكمي
                      </label>
                      <input
                        type="text"
                        name="gpa"
                        value={documentData.gpa}
                        onChange={handleDocumentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="مثال: 3.75"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* الدرجات */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-gray-800">
                      الدرجات
                    </h3>
                    <button
                      type="button"
                      onClick={addGrade}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                    >
                      إضافة مادة
                    </button>
                  </div>

                  {documentData.grades.map((grade, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 border border-gray-200 rounded-lg">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          اسم المادة
                        </label>
                        <input
                          type="text"
                          value={grade.course}
                          onChange={(e) => updateGrade(index, 'course', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الساعات المعتمدة
                        </label>
                        <input
                          type="text"
                          value={grade.credits}
                          onChange={(e) => updateGrade(index, 'credits', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الدرجة
                        </label>
                        <input
                          type="text"
                          value={grade.grade}
                          onChange={(e) => updateGrade(index, 'grade', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          required
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeGrade(index)}
                          className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* معلومات الإصدار */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      صادر من
                    </label>
                    <input
                      type="text"
                      name="issuedBy"
                      value={documentData.issuedBy}
                      onChange={handleDocumentInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="اسم المسؤول"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      تاريخ الإصدار
                    </label>
                    <input
                      type="date"
                      name="issuedDate"
                      value={documentData.issuedDate}
                      onChange={handleDocumentInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      رقم الوثيقة
                    </label>
                    <input
                      type="text"
                      name="documentNumber"
                      value={documentData.documentNumber}
                      onChange={handleDocumentInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="رقم الوثيقة"
                      required
                    />
                  </div>
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowDocumentForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200"
                  >
                    إصدار الوثيقة
                  </button>
                </div>
              </form>
            )}

            {!showDocumentForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إصدار وثيقة تخرج جديدة
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;إصدار وثيقة جديدة&quot; لبدء عملية إصدار وثيقة تخرج رسمية
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'status' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                تأييد استمرار / تأجيل دراسة
              </h2>
              <button
                onClick={() => setShowStatusForm(!showStatusForm)}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showStatusForm ? 'إلغاء' : 'إصدار تأييد جديد'}
              </button>
            </div>

            {showStatusForm && (
              <form onSubmit={handleStatusSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* معلومات الطالب */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      معلومات الطالب
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentId"
                        value={statusData.studentId}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب (عربي)
                      </label>
                      <input
                        type="text"
                        name="studentName"
                        value={statusData.studentName}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب (إنجليزي)
                      </label>
                      <input
                        type="text"
                        name="studentNameEn"
                        value={statusData.studentNameEn}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الهوية الوطنية
                      </label>
                      <input
                        type="text"
                        name="nationalId"
                        value={statusData.nationalId}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>
                  </div>

                  {/* تفاصيل الحالة */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل الحالة
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع التأييد
                      </label>
                      <select
                        name="statusType"
                        value={statusData.statusType}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      >
                        <option value="continuation">تأييد استمرار دراسة</option>
                        <option value="postponement">تأييد تأجيل دراسة</option>
                        <option value="withdrawal">تأييد انسحاب</option>
                        <option value="return">تأييد عودة</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الفصل الحالي
                      </label>
                      <input
                        type="text"
                        name="currentSemester"
                        value={statusData.currentSemester}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        placeholder="مثال: الفصل الأول 2024"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        السنة الأكاديمية
                      </label>
                      <input
                        type="text"
                        name="academicYear"
                        value={statusData.academicYear}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        placeholder="مثال: 2024/2025"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        السبب
                      </label>
                      <input
                        type="text"
                        name="reason"
                        value={statusData.reason}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        placeholder="مثال: لأغراض العمل"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* مدة التأجيل */}
                {statusData.statusType === 'postponement' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مدة التأجيل
                      </label>
                      <input
                        type="text"
                        name="duration"
                        value={statusData.duration}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        placeholder="مثال: فصل دراسي واحد"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ العودة المتوقع
                      </label>
                      <input
                        type="date"
                        name="expectedReturnDate"
                        value={statusData.expectedReturnDate}
                        onChange={handleStatusInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}

                {/* الغرض من التأييد */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    الغرض من التأييد
                  </label>
                  <textarea
                    name="purpose"
                    value={statusData.purpose}
                    onChange={handleStatusInputChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="اكتب الغرض من إصدار هذا التأييد..."
                    required
                  />
                </div>

                {/* معلومات الإصدار */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      صادر من
                    </label>
                    <input
                      type="text"
                      name="issuedBy"
                      value={statusData.issuedBy}
                      onChange={handleStatusInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      placeholder="اسم المسؤول"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      تاريخ الإصدار
                    </label>
                    <input
                      type="date"
                      name="issuedDate"
                      value={statusData.issuedDate}
                      onChange={handleStatusInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      required
                    />
                  </div>
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowStatusForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors duration-200"
                  >
                    إصدار التأييد
                  </button>
                </div>
              </form>
            )}

            {!showStatusForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إصدار تأييد حالة دراسة جديد
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;إصدار تأييد جديد&quot; لبدء عملية إصدار تأييد حالة الدراسة
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إدارة النماذج الرسمية
              </h2>
              <button
                onClick={() => setShowTemplateForm(!showTemplateForm)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showTemplateForm ? 'إلغاء' : 'إنشاء قالب جديد'}
              </button>
            </div>

            {showTemplateForm && (
              <form onSubmit={handleTemplateSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* معلومات القالب */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      معلومات القالب
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم القالب
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={templateData.name}
                        onChange={handleTemplateInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع القالب
                      </label>
                      <select
                        name="type"
                        value={templateData.type}
                        onChange={handleTemplateInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      >
                        <option value="confirmation">تأييد تخرج</option>
                        <option value="document">وثيقة تخرج</option>
                        <option value="status">تأييد حالة دراسة</option>
                        <option value="custom">قالب مخصص</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        حالة القالب
                      </label>
                      <select
                        name="isActive"
                        value={templateData.isActive ? 'true' : 'false'}
                        onChange={handleTemplateInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      >
                        <option value="true">نشط</option>
                        <option value="false">غير نشط</option>
                      </select>
                    </div>
                  </div>

                  {/* تفاصيل القالب */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل القالب
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الحقول المطلوبة
                      </label>
                      <textarea
                        name="fields"
                        value={templateData.fields.join(', ')}
                        onChange={(e) => setTemplateData(prev => ({
                          ...prev,
                          fields: e.target.value.split(',').map(field => field.trim()).filter(field => field)
                        }))}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        placeholder="مثال: studentName, studentId, graduationDate"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ الإنشاء
                      </label>
                      <input
                        type="date"
                        name="createdAt"
                        value={templateData.createdAt}
                        onChange={handleTemplateInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* محتوى القالب */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    محتوى القالب
                  </label>
                  <textarea
                    name="template"
                    value={templateData.template}
                    onChange={handleTemplateInputChange}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                    placeholder="اكتب محتوى القالب هنا..."
                    required
                  />
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowTemplateForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
                  >
                    إنشاء القالب
                  </button>
                </div>
              </form>
            )}

            {!showTemplateForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إدارة النماذج الرسمية
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;إنشاء قالب جديد&quot; لبدء عملية إنشاء قالب جديد للوثائق
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
