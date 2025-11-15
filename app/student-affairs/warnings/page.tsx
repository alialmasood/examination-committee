'use client';

import { useState } from 'react';

interface WarningForm {
  studentId: string;
  studentName: string;
  warningType: 'academic' | 'administrative';
  reason: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  issuedBy: string;
  issuedDate: string;
}

interface PunishmentForm {
  studentId: string;
  studentName: string;
  punishmentType: 'behavior' | 'delay' | 'absence' | 'discipline';
  violationType: string;
  description: string;
  punishmentLevel: 'warning' | 'reprimand' | 'suspension' | 'expulsion';
  duration?: string;
  issuedBy: string;
  issuedDate: string;
  effectiveDate: string;
}

interface ViolationRecord {
  id: string;
  studentId: string;
  studentName: string;
  violationType: string;
  description: string;
  date: string;
  status: 'active' | 'resolved' | 'escalated';
  severity: 'low' | 'medium' | 'high';
  actions: string[];
}

export default function WarningsPage() {
  const [activeTab, setActiveTab] = useState<'warnings' | 'punishments' | 'violations'>('warnings');
  const [showForm, setShowForm] = useState(false);
  const [showPunishmentForm, setShowPunishmentForm] = useState(false);
  const [showViolationForm, setShowViolationForm] = useState(false);
  
  const [formData, setFormData] = useState<WarningForm>({
    studentId: '',
    studentName: '',
    warningType: 'academic',
    reason: '',
    description: '',
    severity: 'medium',
    issuedBy: '',
    issuedDate: new Date().toISOString().split('T')[0]
  });

  const [punishmentData, setPunishmentData] = useState<PunishmentForm>({
    studentId: '',
    studentName: '',
    punishmentType: 'behavior',
    violationType: '',
    description: '',
    punishmentLevel: 'warning',
    duration: '',
    issuedBy: '',
    issuedDate: new Date().toISOString().split('T')[0],
    effectiveDate: new Date().toISOString().split('T')[0]
  });

  const [violationData, setViolationData] = useState<ViolationRecord>({
    id: '',
    studentId: '',
    studentName: '',
    violationType: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    status: 'active',
    severity: 'medium',
    actions: []
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('إنذار جديد:', formData);
    alert('تم إصدار الإنذار بنجاح!');
    setShowForm(false);
    setFormData({
      studentId: '',
      studentName: '',
      warningType: 'academic',
      reason: '',
      description: '',
      severity: 'medium',
      issuedBy: '',
      issuedDate: new Date().toISOString().split('T')[0]
    });
  };

  const handlePunishmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('عقوبة جديدة:', punishmentData);
    alert('تم تسجيل العقوبة بنجاح!');
    setShowPunishmentForm(false);
    setPunishmentData({
      studentId: '',
      studentName: '',
      punishmentType: 'behavior',
      violationType: '',
      description: '',
      punishmentLevel: 'warning',
      duration: '',
      issuedBy: '',
      issuedDate: new Date().toISOString().split('T')[0],
      effectiveDate: new Date().toISOString().split('T')[0]
    });
  };

  const handleViolationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('مخالفة جديدة:', violationData);
    alert('تم تسجيل المخالفة بنجاح!');
    setShowViolationForm(false);
    setViolationData({
      id: '',
      studentId: '',
      studentName: '',
      violationType: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      status: 'active',
      severity: 'medium',
      actions: []
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handlePunishmentInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPunishmentData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleViolationInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setViolationData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            نظام الإنذارات والعقوبات
          </h1>
          <p className="text-gray-600">
            إدارة الإنذارات الأكاديمية والإدارية للطلاب
          </p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap space-x-8 space-x-reverse px-6">
              <button
                onClick={() => setActiveTab('warnings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'warnings'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                إصدار إنذار
              </button>
              <button
                onClick={() => setActiveTab('punishments')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'punishments'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                تسجيل عقوبات
              </button>
              <button
                onClick={() => setActiveTab('violations')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'violations'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                إدارة المخالفات
              </button>
            </nav>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'warnings' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إصدار إنذار أكاديمي أو إداري
              </h2>
              <button
                onClick={() => setShowForm(!showForm)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showForm ? 'إلغاء' : 'إصدار إنذار جديد'}
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentName"
                        value={formData.studentName}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>
                  </div>

                  {/* تفاصيل الإنذار */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل الإنذار
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع الإنذار
                      </label>
                      <select
                        name="warningType"
                        value={formData.warningType}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      >
                        <option value="academic">إنذار أكاديمي</option>
                        <option value="administrative">إنذار إداري</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        سبب الإنذار
                      </label>
                      <input
                        type="text"
                        name="reason"
                        value={formData.reason}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="مثال: تأخير في تسليم الواجبات"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مستوى الخطورة
                      </label>
                      <select
                        name="severity"
                        value={formData.severity}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        required
                      >
                        <option value="low">منخفض</option>
                        <option value="medium">متوسط</option>
                        <option value="high">عالي</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* وصف مفصل */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    وصف مفصل للإنذار
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="اكتب تفاصيل الإنذار والأسباب..."
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
                      value={formData.issuedDate}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200"
                  >
                    إصدار الإنذار
                  </button>
                </div>
              </form>
            )}

            {!showForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إصدار إنذار جديد
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;إصدار إنذار جديد&quot; لبدء عملية إصدار إنذار أكاديمي أو إداري
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'punishments' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                تسجيل عقوبات السلوك أو التأخير
              </h2>
              <button
                onClick={() => setShowPunishmentForm(!showPunishmentForm)}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showPunishmentForm ? 'إلغاء' : 'تسجيل عقوبة جديدة'}
              </button>
            </div>

            {showPunishmentForm && (
              <form onSubmit={handlePunishmentSubmit} className="space-y-6">
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
                        value={punishmentData.studentId}
                        onChange={handlePunishmentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentName"
                        value={punishmentData.studentName}
                        onChange={handlePunishmentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        required
                      />
                    </div>
                  </div>

                  {/* تفاصيل العقوبة */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل العقوبة
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع العقوبة
                      </label>
                      <select
                        name="punishmentType"
                        value={punishmentData.punishmentType}
                        onChange={handlePunishmentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        required
                      >
                        <option value="behavior">سلوك</option>
                        <option value="delay">تأخير</option>
                        <option value="absence">غياب</option>
                        <option value="discipline">انضباط</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع المخالفة
                      </label>
                      <input
                        type="text"
                        name="violationType"
                        value={punishmentData.violationType}
                        onChange={handlePunishmentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        placeholder="مثال: عدم احترام المعلم"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مستوى العقوبة
                      </label>
                      <select
                        name="punishmentLevel"
                        value={punishmentData.punishmentLevel}
                        onChange={handlePunishmentInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        required
                      >
                        <option value="warning">إنذار</option>
                        <option value="reprimand">توبيخ</option>
                        <option value="suspension">إيقاف</option>
                        <option value="expulsion">فصل</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* وصف مفصل */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    وصف مفصل للعقوبة
                  </label>
                  <textarea
                    name="description"
                    value={punishmentData.description}
                    onChange={handlePunishmentInputChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="اكتب تفاصيل العقوبة والأسباب..."
                    required
                  />
                </div>

                {/* مدة العقوبة */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    مدة العقوبة (اختياري)
                  </label>
                  <input
                    type="text"
                    name="duration"
                    value={punishmentData.duration}
                    onChange={handlePunishmentInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="مثال: 3 أيام، أسبوع واحد"
                  />
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
                      value={punishmentData.issuedBy}
                      onChange={handlePunishmentInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
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
                      value={punishmentData.issuedDate}
                      onChange={handlePunishmentInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      تاريخ السريان
                    </label>
                    <input
                      type="date"
                      name="effectiveDate"
                      value={punishmentData.effectiveDate}
                      onChange={handlePunishmentInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      required
                    />
                  </div>
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowPunishmentForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors duration-200"
                  >
                    تسجيل العقوبة
                  </button>
                </div>
              </form>
            )}

            {!showPunishmentForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  تسجيل عقوبة جديدة
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;تسجيل عقوبة جديدة&quot; لبدء عملية تسجيل عقوبة للطالب
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'violations' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إدارة سجل المخالفات الطلابية
              </h2>
              <button
                onClick={() => setShowViolationForm(!showViolationForm)}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showViolationForm ? 'إلغاء' : 'تسجيل مخالفة جديدة'}
              </button>
            </div>

            {showViolationForm && (
              <form onSubmit={handleViolationSubmit} className="space-y-6">
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
                        value={violationData.studentId}
                        onChange={handleViolationInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentName"
                        value={violationData.studentName}
                        onChange={handleViolationInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        required
                      />
                    </div>
                  </div>

                  {/* تفاصيل المخالفة */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      تفاصيل المخالفة
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع المخالفة
                      </label>
                      <input
                        type="text"
                        name="violationType"
                        value={violationData.violationType}
                        onChange={handleViolationInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        placeholder="مثال: عدم احترام المعلم"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مستوى الخطورة
                      </label>
                      <select
                        name="severity"
                        value={violationData.severity}
                        onChange={handleViolationInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        required
                      >
                        <option value="low">منخفض</option>
                        <option value="medium">متوسط</option>
                        <option value="high">عالي</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        حالة المخالفة
                      </label>
                      <select
                        name="status"
                        value={violationData.status}
                        onChange={handleViolationInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        required
                      >
                        <option value="active">نشطة</option>
                        <option value="resolved">محلولة</option>
                        <option value="escalated">متصاعدة</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* وصف مفصل */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    وصف مفصل للمخالفة
                  </label>
                  <textarea
                    name="description"
                    value={violationData.description}
                    onChange={handleViolationInputChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder="اكتب تفاصيل المخالفة والأسباب..."
                    required
                  />
                </div>

                {/* تاريخ المخالفة */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    تاريخ المخالفة
                  </label>
                  <input
                    type="date"
                    name="date"
                    value={violationData.date}
                    onChange={handleViolationInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    required
                  />
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowViolationForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200"
                  >
                    تسجيل المخالفة
                  </button>
                </div>
              </form>
            )}

            {!showViolationForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  تسجيل مخالفة جديدة
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;تسجيل مخالفة جديدة&quot; لبدء عملية تسجيل مخالفة للطالب
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}